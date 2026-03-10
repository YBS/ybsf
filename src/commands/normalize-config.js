const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { validateConfigSchema } = require("../config/schema-validate");
const { validateConfigSemantics } = require("../config/semantic-validate");
const {
  DEFAULT_PSEUDO_OBJECT_SCOPES,
  normalizePseudoObjectScopes,
} = require("../config/pseudo-object-scopes");
const { OPTIONAL_PROCESSING_DEFAULTS } = require("../config/optional-processing");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");
const {
  writeDiscoveryProject,
  buildProjectGenerateManifestArgs,
  parseDiscoveredPackageXml,
} = require("./helpers/project-manifest-discovery");

const FOLDERED_TYPES = new Set(["Report", "Dashboard", "Document", "EmailTemplate"]);
const FOLDER_MODE_MEMBER_POLICY = "memberPolicy";
const OBJECT_HYPHEN_TYPES = new Set(["Layout", "CustomObjectTranslation"]);
const OBJECT_RELATED_TYPES = new Set([
  "Workflow",
  "SharingRules",
  "AssignmentRules",
  "AutoResponseRules",
  "TopicsForObjects",
  "CustomTab",
]);
const OBJECT_SCOPE_FILTER_TYPES = new Set([
  "BusinessProcess",
  "CompactLayout",
  "CustomField",
  "FieldSet",
  "Layout",
  "ListView",
  "RecordType",
  "SharingReason",
  "SharingRules",
  "SharingCriteriaRule",
  "SharingOwnerRule",
  "AssignmentRule",
  "AutoResponseRule",
  "TopicsForObjects",
  "CustomTab",
  "ValidationRule",
  "WebLink",
  "CustomObjectTranslation",
  "QuickAction",
  "WorkflowAlert",
  "WorkflowFieldUpdate",
  "WorkflowOutboundMessage",
  "WorkflowRule",
  "WorkflowTask",
]);
const LEVEL3_PARENT_RULES = [
  {
    parentType: "SharingRules",
    childTypes: ["SharingCriteriaRule", "SharingOwnerRule"],
  },
  {
    parentType: "AssignmentRules",
    childTypes: ["AssignmentRule"],
  },
  {
    parentType: "AutoResponseRules",
    childTypes: ["AutoResponseRule"],
  },
  {
    parentType: "Workflow",
    childTypes: ["WorkflowAlert", "WorkflowFieldUpdate", "WorkflowOutboundMessage", "WorkflowRule", "WorkflowTask"],
  },
];

function salesforceLexSort(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function normalizeDocumentMemberName(memberName) {
  const text = String(memberName || "").trim();
  if (!text) {
    return "";
  }
  if (!text.includes("/")) {
    return text.replace(/\/$/u, "");
  }
  const [folderName, memberTokenRaw] = text.split("/", 2);
  const memberToken = String(memberTokenRaw || "").replace(/\/$/u, "");
  if (!memberToken) {
    return folderName;
  }
  const base = memberToken.replace(/\.[^./]+$/u, "");
  return `${folderName}/${base}`;
}

function normalizeMemberForComparison(typeName, memberName) {
  const text = String(memberName || "").trim();
  if (typeName === "Document") {
    return normalizeDocumentMemberName(text);
  }
  if (FOLDERED_TYPES.has(typeName)) {
    return text.replace(/\/$/u, "");
  }
  return text;
}

function createDefaultRule(metadataType, initMode) {
  if (FOLDERED_TYPES.has(metadataType)) {
    return {
      metadataType,
      enabled: Boolean(initMode),
      folderPolicy: {
        mode: FOLDER_MODE_MEMBER_POLICY,
        folders: [],
      },
      memberPolicy: {
        mode: "all",
        members: [],
      },
    };
  }
  return {
    metadataType,
    enabled: Boolean(initMode),
    memberPolicy: {
      mode: "all",
      members: [],
    },
  };
}

function ensureNoDuplicateMetadataTypes(config) {
  const seen = new Set();
  for (const rule of config.metadataTypes || []) {
    const key = String(rule && rule.metadataType ? rule.metadataType : "");
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate metadataType rule: ${key}`);
    }
    seen.add(key);
  }
}

function buildDiscoveredIndex(discoveredByType) {
  const index = new Map();
  for (const [typeName, members] of discoveredByType.entries()) {
    const set = new Set();
    const folderSet = new Set();
    for (const member of members || []) {
      const normalized = normalizeMemberForComparison(typeName, member);
      if (!normalized) {
        continue;
      }
      set.add(normalized);
      if (normalized.includes("/")) {
        folderSet.add(normalized.split("/", 1)[0]);
      } else if (FOLDERED_TYPES.has(typeName)) {
        folderSet.add(normalized);
      }
    }
    index.set(typeName, {
      members: set,
      folders: folderSet,
    });
  }
  return index;
}

function getObjectName(typeName, memberName) {
  const text = String(memberName || "").trim();
  if (!text) {
    return null;
  }
  if (OBJECT_HYPHEN_TYPES.has(typeName)) {
    return text.split("-", 2)[0];
  }
  if (OBJECT_RELATED_TYPES.has(typeName)) {
    if (typeName === "CustomTab") {
      return text.endsWith("__c") ? text : null;
    }
    return text;
  }
  if (text.includes(".")) {
    const objectName = text.split(".", 2)[0];
    if (typeName === "CustomMetadata") {
      return `${objectName}__mdt`;
    }
    return objectName;
  }
  return null;
}

function resolveMembersFromPolicy(typeName, memberPolicy, discoveredMembers) {
  const discovered = (discoveredMembers || []).map((m) => String(m || "").trim()).filter((m) => m.length > 0);
  if (!memberPolicy || typeof memberPolicy !== "object") {
    return discovered;
  }
  const mode = memberPolicy.mode;
  const members = Array.isArray(memberPolicy.members) ? memberPolicy.members : [];
  if (mode === "all") {
    return discovered;
  }
  const normalizedMembers = new Set(members.map((m) => normalizeMemberForComparison(typeName, m)));
  if (mode === "include") {
    return discovered.filter((m) => normalizedMembers.has(normalizeMemberForComparison(typeName, m)));
  }
  if (mode === "exclude") {
    return discovered.filter((m) => !normalizedMembers.has(normalizeMemberForComparison(typeName, m)));
  }
  return discovered;
}

function resolveCandidatesFromPolicy(memberPolicy, candidates) {
  const mode = memberPolicy && typeof memberPolicy === "object" ? memberPolicy.mode : "all";
  const members = Array.isArray(memberPolicy && memberPolicy.members)
    ? memberPolicy.members.map((value) => String(value || "").trim())
    : [];
  const memberSet = new Set(members);
  const list = (candidates || []).map((value) => String(value || "").trim()).filter((value) => value.length > 0);
  if (mode === "all") {
    return list;
  }
  if (mode === "include") {
    return list.filter((value) => memberSet.has(value));
  }
  if (mode === "exclude") {
    return list.filter((value) => !memberSet.has(value));
  }
  return list;
}

function removeUndiscoveredMembers(config, discoveredByType, removedMembers) {
  const index = buildDiscoveredIndex(discoveredByType);
  const configuredPseudoObjects = normalizePseudoObjectScopes(
    config &&
      config.processingRules &&
      Array.isArray(config.processingRules.includePseudoObjects)
      ? config.processingRules.includePseudoObjects
      : DEFAULT_PSEUDO_OBJECT_SCOPES
  );
  const pseudoSet = new Set(configuredPseudoObjects);

  const removeFromMemberPolicy = (typeName, memberPolicy, contextPrefix, folderName) => {
    if (!memberPolicy || !Array.isArray(memberPolicy.members) || memberPolicy.members.length === 0) {
      return;
    }
    const discovered = index.get(typeName);
    if (!discovered) {
      return;
    }
    const nextMembers = [];
    for (const rawMember of memberPolicy.members) {
      const text = String(rawMember || "").trim();
      if (!text) {
        continue;
      }
      let effective = text;
      if (folderName && !effective.includes("/")) {
        effective = `${folderName}/${effective}`;
      }
      const normalized = normalizeMemberForComparison(typeName, effective);
      if (typeName === "CustomObject" && pseudoSet.has(normalized)) {
        nextMembers.push(text);
        continue;
      }
      if (!discovered.members.has(normalized)) {
        removedMembers.push(`${contextPrefix}${effective}`);
        continue;
      }
      nextMembers.push(text);
    }
    memberPolicy.members = nextMembers;
  };

  const removeOutOfScopeObjectMembers = () => {
    const customObjectRule = (config.metadataTypes || []).find(
      (rule) => rule && rule.metadataType === "CustomObject" && rule.enabled
    );
    if (!customObjectRule || !index.has("CustomObject")) {
      return;
    }

    const selectedObjects = new Set(
      resolveMembersFromPolicy(
        "CustomObject",
        customObjectRule.memberPolicy,
        Array.from(index.get("CustomObject").members || [])
      )
    );
    for (const pseudoObject of pseudoSet) {
      selectedObjects.add(pseudoObject);
    }

    for (const rule of config.metadataTypes || []) {
      const typeName = String(rule && rule.metadataType ? rule.metadataType : "");
      if (!OBJECT_SCOPE_FILTER_TYPES.has(typeName)) {
        continue;
      }
      const memberPolicy = rule.memberPolicy;
      if (!memberPolicy || !Array.isArray(memberPolicy.members) || memberPolicy.members.length === 0) {
        continue;
      }
      const nextMembers = [];
      for (const member of memberPolicy.members) {
        const text = String(member || "").trim();
        if (!text) {
          continue;
        }
        const objectName = getObjectName(typeName, text);
        if (objectName && !selectedObjects.has(objectName)) {
          removedMembers.push(
            `Type ${typeName}: removed member ${text} (object ${objectName} not included by CustomObject policy)`
          );
          continue;
        }
        nextMembers.push(member);
      }
      memberPolicy.members = nextMembers;
    }
  };

  const removeOutOfScopeLevel3Members = () => {
    const selectedLevel1Objects = (() => {
      const customObjectRule = (config.metadataTypes || []).find(
        (rule) => rule && rule.metadataType === "CustomObject" && rule.enabled
      );
      if (!customObjectRule || !index.has("CustomObject")) {
        return null;
      }
      const selected = new Set(
        resolveMembersFromPolicy(
          "CustomObject",
          customObjectRule.memberPolicy,
          Array.from(index.get("CustomObject").members || [])
        )
      );
      for (const pseudoObject of pseudoSet) {
        selected.add(pseudoObject);
      }
      return selected;
    })();

    const enabledRulesByType = new Map(
      (config.metadataTypes || [])
        .filter((rule) => rule && rule.enabled && rule.metadataType)
        .map((rule) => [rule.metadataType, rule])
    );

    for (const mapping of LEVEL3_PARENT_RULES) {
      const parentRule = enabledRulesByType.get(mapping.parentType);
      let parentSelectedObjects = new Set();
      if (parentRule && index.has(mapping.parentType)) {
        const parentResolved = resolveMembersFromPolicy(
          mapping.parentType,
          parentRule.memberPolicy,
          Array.from(index.get(mapping.parentType).members || [])
        );
        const pseudoParentMembers =
          mapping.parentType === "Workflow"
            ? resolveCandidatesFromPolicy(parentRule.memberPolicy, Array.from(pseudoSet))
            : [];
        parentSelectedObjects = new Set(
          parentResolved.concat(pseudoParentMembers).filter((memberName) => {
            const objectName = getObjectName(mapping.parentType, memberName);
            if (!objectName) {
              return false;
            }
            if (selectedLevel1Objects && !selectedLevel1Objects.has(objectName)) {
              return false;
            }
            return true;
          }).map((memberName) => getObjectName(mapping.parentType, memberName))
        );
      }

      for (const childType of mapping.childTypes) {
        const childRule = enabledRulesByType.get(childType);
        if (!childRule || !childRule.memberPolicy || !Array.isArray(childRule.memberPolicy.members)) {
          continue;
        }
        const nextMembers = [];
        for (const member of childRule.memberPolicy.members) {
          const text = String(member || "").trim();
          if (!text) {
            continue;
          }
          const objectName = getObjectName(childType, text);
          if (objectName && !parentSelectedObjects.has(objectName)) {
            removedMembers.push(
              `Type ${childType}: removed member ${text} (object ${objectName} not included by ${mapping.parentType} policy)`
            );
            continue;
          }
          nextMembers.push(member);
        }
        childRule.memberPolicy.members = nextMembers;
      }
    }
  };

  for (const rule of config.metadataTypes || []) {
    const typeName = rule.metadataType;
    const discovered = index.get(typeName);
    if (!discovered) {
      continue;
    }

    removeFromMemberPolicy(typeName, rule.memberPolicy, `Type ${typeName}: removed member `, null);

    if (FOLDERED_TYPES.has(typeName) && rule.folderPolicy && Array.isArray(rule.folderPolicy.folders)) {
      const nextFolders = [];
      for (const folderRule of rule.folderPolicy.folders) {
        const folderName = String(folderRule && folderRule.folder ? folderRule.folder : "").trim();
        if (!folderName) {
          continue;
        }
        if (!discovered.folders.has(folderName)) {
          removedMembers.push(`Type ${typeName}: removed member ${folderName}/`);
          continue;
        }
        removeFromMemberPolicy(
          typeName,
          folderRule.memberPolicy,
          `Type ${typeName}: removed member `,
          folderName
        );
        nextFolders.push(folderRule);
      }
      rule.folderPolicy.folders = nextFolders;
    }
  }

  for (const namespaceRule of (config.packageRules && config.packageRules.namespaces) || []) {
    for (const typeRule of namespaceRule.metadataTypes || []) {
      removeFromMemberPolicy(
        typeRule.metadataType,
        typeRule.memberPolicy,
        `Type ${typeRule.metadataType}: removed member `,
        null
      );
      const discovered = index.get(typeRule.metadataType);
      if (
        !discovered ||
        !FOLDERED_TYPES.has(typeRule.metadataType) ||
        !typeRule.folderPolicy ||
        !Array.isArray(typeRule.folderPolicy.folders)
      ) {
        continue;
      }
      const nextFolders = [];
      for (const folderRule of typeRule.folderPolicy.folders) {
        const folderName = String(folderRule && folderRule.folder ? folderRule.folder : "").trim();
        if (!folderName) {
          continue;
        }
        if (!discovered.folders.has(folderName)) {
          removedMembers.push(`Type ${typeRule.metadataType}: removed member ${folderName}/`);
          continue;
        }
        removeFromMemberPolicy(
          typeRule.metadataType,
          folderRule.memberPolicy,
          `Type ${typeRule.metadataType}: removed member `,
          folderName
        );
        nextFolders.push(folderRule);
      }
      typeRule.folderPolicy.folders = nextFolders;
    }
  }

  removeOutOfScopeObjectMembers();
  removeOutOfScopeLevel3Members();
}

function normalizePseudoObjectMembers(config, removedMembers) {
  const configuredPseudoObjects = normalizePseudoObjectScopes(
    config &&
      config.processingRules &&
      Array.isArray(config.processingRules.includePseudoObjects)
      ? config.processingRules.includePseudoObjects
      : DEFAULT_PSEUDO_OBJECT_SCOPES
  );
  const pseudoSet = new Set(configuredPseudoObjects);
  if (pseudoSet.size === 0) {
    return;
  }

  const customObjectRule = (config.metadataTypes || []).find(
    (rule) => rule && rule.metadataType === "CustomObject" && rule.memberPolicy
  );
  if (
    !customObjectRule ||
    !customObjectRule.memberPolicy ||
    !Array.isArray(customObjectRule.memberPolicy.members)
  ) {
    return;
  }

  const nextMembers = [];
  for (const member of customObjectRule.memberPolicy.members) {
    const text = String(member || "").trim();
    if (text && pseudoSet.has(text)) {
      removedMembers.push(
        `Type CustomObject: removed member ${text} (handled by processingRules.includePseudoObjects)`
      );
      continue;
    }
    nextMembers.push(member);
  }
  customObjectRule.memberPolicy.members = nextMembers;
}

function ensurePackageRules(config) {
  if (!config.packageRules || typeof config.packageRules !== "object") {
    config.packageRules = {
      includeManagedPackages: false,
      includeUnlockedPackages: false,
      namespaces: [],
    };
  }
  if (typeof config.packageRules.includeManagedPackages !== "boolean") {
    config.packageRules.includeManagedPackages = false;
  }
  if (typeof config.packageRules.includeUnlockedPackages !== "boolean") {
    config.packageRules.includeUnlockedPackages = false;
  }
  if (!Array.isArray(config.packageRules.namespaces)) {
    config.packageRules.namespaces = [];
  }
  for (const namespaceRule of config.packageRules.namespaces) {
    if (!namespaceRule || typeof namespaceRule !== "object") {
      continue;
    }
    if (!Array.isArray(namespaceRule.metadataTypes) && Array.isArray(namespaceRule.typeRules)) {
      namespaceRule.metadataTypes = namespaceRule.typeRules;
    }
    if (!Array.isArray(namespaceRule.metadataTypes)) {
      namespaceRule.metadataTypes = [];
    }
    delete namespaceRule.typeRules;
  }
}

function sortConfig(config) {
  const sortMembers = (memberPolicy) => {
    if (memberPolicy && Array.isArray(memberPolicy.members)) {
      memberPolicy.members = memberPolicy.members.slice().sort(salesforceLexSort);
    }
  };

  for (const rule of config.metadataTypes || []) {
    if (rule && FOLDERED_TYPES.has(rule.metadataType) && rule.folderPolicy) {
      const folderMode = rule.folderPolicy.mode;
      if (folderMode === FOLDER_MODE_MEMBER_POLICY) {
        rule.folderPolicy.folders = [];
      } else if (folderMode === "all" && rule.memberPolicy) {
        const isIncludeNone =
          rule.memberPolicy.mode === "include" &&
          Array.isArray(rule.memberPolicy.members) &&
          rule.memberPolicy.members.length === 0;
        if (isIncludeNone) {
          rule.folderPolicy.mode = "include";
          rule.folderPolicy.folders = [];
          delete rule.memberPolicy;
        } else {
          // Preserve explicit member filtering intent under the new mode model.
          rule.folderPolicy.mode = FOLDER_MODE_MEMBER_POLICY;
          rule.folderPolicy.folders = [];
        }
      } else if (folderMode === "all") {
        rule.folderPolicy.folders = [];
      } else if (folderMode !== FOLDER_MODE_MEMBER_POLICY && rule.memberPolicy) {
        if (rule.memberPolicy.mode === "all" && Array.isArray(rule.memberPolicy.members) && rule.memberPolicy.members.length === 0) {
          delete rule.memberPolicy;
        } else {
          // Resolve conflicting mixed model by prioritizing explicit member policy.
          rule.folderPolicy.mode = FOLDER_MODE_MEMBER_POLICY;
          rule.folderPolicy.folders = [];
        }
      }
    }
    sortMembers(rule.memberPolicy);
    if (rule.folderPolicy && Array.isArray(rule.folderPolicy.folders)) {
      rule.folderPolicy.folders = rule.folderPolicy.folders
        .slice()
        .sort((a, b) => salesforceLexSort(String(a.folder || ""), String(b.folder || "")));
      for (const folderRule of rule.folderPolicy.folders) {
        sortMembers(folderRule.memberPolicy);
      }
    }
  }

  const canonicalizeTypeRule = (rule) => {
    if (!rule || typeof rule !== "object") {
      return rule;
    }
    const {
      metadataType,
      enabled,
      folderPolicy,
      memberPolicy,
      ...rest
    } = rule;
    const next = {};
    if (metadataType !== undefined) {
      next.metadataType = metadataType;
    }
    if (enabled !== undefined) {
      next.enabled = enabled;
    }
    if (folderPolicy !== undefined) {
      next.folderPolicy = folderPolicy;
    }
    if (memberPolicy !== undefined) {
      next.memberPolicy = memberPolicy;
    }
    for (const key of Object.keys(rest)) {
      next[key] = rest[key];
    }
    return next;
  };

  config.metadataTypes = (config.metadataTypes || [])
    .slice()
    .sort((a, b) => salesforceLexSort(String(a.metadataType || ""), String(b.metadataType || "")))
    .map(canonicalizeTypeRule);

  ensurePackageRules(config);
  config.packageRules.namespaces = config.packageRules.namespaces
    .slice()
    .sort((a, b) => salesforceLexSort(String(a.namespace || ""), String(b.namespace || "")))
    .map((namespaceRule) => {
      const next = { ...namespaceRule };
      next.metadataTypes = (next.metadataTypes || [])
        .slice()
        .sort((a, b) => salesforceLexSort(String(a.metadataType || ""), String(b.metadataType || "")))
        .map((typeRule) => {
          const t = canonicalizeTypeRule({ ...typeRule });
          if (t && FOLDERED_TYPES.has(t.metadataType) && t.folderPolicy) {
            const folderMode = t.folderPolicy.mode;
            if (folderMode === FOLDER_MODE_MEMBER_POLICY) {
              t.folderPolicy.folders = [];
            } else if (folderMode === "all" && t.memberPolicy) {
              const isIncludeNone =
                t.memberPolicy.mode === "include" &&
                Array.isArray(t.memberPolicy.members) &&
                t.memberPolicy.members.length === 0;
              if (isIncludeNone) {
                t.folderPolicy.mode = "include";
                t.folderPolicy.folders = [];
                delete t.memberPolicy;
              } else {
                t.folderPolicy.mode = FOLDER_MODE_MEMBER_POLICY;
                t.folderPolicy.folders = [];
              }
            } else if (folderMode === "all") {
              t.folderPolicy.folders = [];
            } else if (folderMode !== FOLDER_MODE_MEMBER_POLICY && t.memberPolicy) {
              if (
                t.memberPolicy.mode === "all" &&
                Array.isArray(t.memberPolicy.members) &&
                t.memberPolicy.members.length === 0
              ) {
                delete t.memberPolicy;
              } else {
                t.folderPolicy.mode = FOLDER_MODE_MEMBER_POLICY;
                t.folderPolicy.folders = [];
              }
            }
          }
          sortMembers(t.memberPolicy);
          if (t.folderPolicy && Array.isArray(t.folderPolicy.folders)) {
            t.folderPolicy.folders = t.folderPolicy.folders
              .slice()
              .sort((a, b) => salesforceLexSort(String(a.folder || ""), String(b.folder || "")));
            for (const folderRule of t.folderPolicy.folders) {
              sortMembers(folderRule.memberPolicy);
            }
          }
          return t;
        });
      delete next.typeRules;
      return next;
    });
  config.packageRules = {
    includeUnlockedPackages: Boolean(config.packageRules.includeUnlockedPackages),
    includeManagedPackages: Boolean(config.packageRules.includeManagedPackages),
    namespaces: config.packageRules.namespaces,
  };

  if (!config.processingRules || typeof config.processingRules !== "object") {
    config.processingRules = {
      userPermissionsPolicy: {
        mode: "all",
        members: [],
      },
      excludeStandardFields: [],
      includePseudoObjects: DEFAULT_PSEUDO_OBJECT_SCOPES.slice(),
      optionalProcessing: { ...OPTIONAL_PROCESSING_DEFAULTS },
    };
  }
  if (
    !config.processingRules.userPermissionsPolicy ||
    typeof config.processingRules.userPermissionsPolicy !== "object"
  ) {
    const hasLegacyExcludedPermissions = Array.isArray(config.processingRules.excludeUserPermissions);
    const legacyExcludedPermissions = hasLegacyExcludedPermissions
      ? config.processingRules.excludeUserPermissions
      : [];
    config.processingRules.userPermissionsPolicy = {
      mode: hasLegacyExcludedPermissions ? "exclude" : "all",
      members: legacyExcludedPermissions.slice(),
    };
  }
  if (
    config.processingRules.userPermissionsPolicy.mode === "all" ||
    !Array.isArray(config.processingRules.userPermissionsPolicy.members)
  ) {
    config.processingRules.userPermissionsPolicy.members = [];
  }
  delete config.processingRules.excludeUserPermissions;
  if (!Array.isArray(config.processingRules.excludeStandardFields)) {
    config.processingRules.excludeStandardFields = [];
  }
  if (!Array.isArray(config.processingRules.includePseudoObjects)) {
    config.processingRules.includePseudoObjects = DEFAULT_PSEUDO_OBJECT_SCOPES.slice();
  }
  if (
    !config.processingRules.optionalProcessing ||
    typeof config.processingRules.optionalProcessing !== "object"
  ) {
    config.processingRules.optionalProcessing = { ...OPTIONAL_PROCESSING_DEFAULTS };
  } else {
    const normalizedOptional = {};
    for (const key of Object.keys(OPTIONAL_PROCESSING_DEFAULTS)) {
      const value = config.processingRules.optionalProcessing[key];
      normalizedOptional[key] = typeof value === "boolean" ? value : OPTIONAL_PROCESSING_DEFAULTS[key];
    }
    config.processingRules.optionalProcessing = normalizedOptional;
  }
  config.processingRules.userPermissionsPolicy.members = config.processingRules.userPermissionsPolicy.members
    .slice()
    .sort(salesforceLexSort);
  config.processingRules.excludeStandardFields = config.processingRules.excludeStandardFields
    .slice()
    .sort(salesforceLexSort);
  config.processingRules.includePseudoObjects = normalizePseudoObjectScopes(
    config.processingRules.includePseudoObjects
  );
  config.processingRules.optionalProcessing = {
    removeSiteUserDomains: Boolean(config.processingRules.optionalProcessing.removeSiteUserDomains),
    removeProfileInactiveComponents: Boolean(
      config.processingRules.optionalProcessing.removeProfileInactiveComponents
    ),
    sortObjectActionOverrides: Boolean(config.processingRules.optionalProcessing.sortObjectActionOverrides),
    sortApplicationOverrides: Boolean(config.processingRules.optionalProcessing.sortApplicationOverrides),
    sortLayoutPlatformActionListItems: Boolean(
      config.processingRules.optionalProcessing.sortLayoutPlatformActionListItems
    ),
    sortGlobalValueSetInactiveValues: Boolean(
      config.processingRules.optionalProcessing.sortGlobalValueSetInactiveValues
    ),
    sortWorkflowTimeTriggers: Boolean(config.processingRules.optionalProcessing.sortWorkflowTimeTriggers),
  };
}

function discoverMembersViaProjectManifest(
  targetOrg,
  apiVersion,
  runDir,
  includeManagedPackages,
  includeUnlockedPackages
) {
  const discoveryDir = path.join(runDir, "org-discovery");
  writeDiscoveryProject(discoveryDir, apiVersion);

  const result = spawnSync(
    "sf",
    buildProjectGenerateManifestArgs({
      targetOrg,
      apiVersion,
      outputDir: discoveryDir,
      includeManagedPackages,
      includeUnlockedPackages,
    }),
    {
      cwd: discoveryDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) {
    const message = (result.stderr || "").trim() || `status ${result.status}`;
    throw new Error(`Org manifest discovery failed (${message})`);
  }

  const packagePath = path.join(discoveryDir, "package.xml");
  return parseDiscoveredPackageXml(packagePath);
}

async function runNormalizeConfig({
  configPath,
  targetOrg,
  initMode,
  status,
  discoveredByType,
  debug = false,
  includeManagedPackages = false,
  includeUnlockedPackages = false,
}) {
  const step = (message) => {
    if (typeof status === "function") {
      status(`[normalize-config] ${message}`);
    }
  };

  const resolvedConfigPath = path.resolve(configPath || "ybsf-metadata-config.json");
  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  const raw = fs.readFileSync(resolvedConfigPath, "utf8");
  let config = null;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config file ${resolvedConfigPath}: ${err.message}`);
  }

  ensureNoDuplicateMetadataTypes(config);
  ensurePackageRules(config);
  if (includeManagedPackages) {
    config.packageRules.includeManagedPackages = true;
  }
  if (includeUnlockedPackages) {
    config.packageRules.includeUnlockedPackages = true;
  }

  let resolvedDiscoveredByType = discoveredByType instanceof Map ? discoveredByType : new Map();
  let runDir = null;
  const addedTypes = [];
  const removedMembers = [];

  try {
    if (targetOrg && resolvedDiscoveredByType.size === 0) {
      runDir = createRunArtifactsDir("ybsf-normalize-config", process.cwd());

      step(`Discovering org metadata from ${targetOrg}`);
      resolvedDiscoveredByType = discoverMembersViaProjectManifest(
        targetOrg,
        config.apiVersion,
        runDir,
        config.packageRules.includeManagedPackages,
        config.packageRules.includeUnlockedPackages
      );
      step(`Discovered ${resolvedDiscoveredByType.size} metadata types`);
    } else if (targetOrg && resolvedDiscoveredByType.size > 0) {
      step(`Using org discovery from previous step (${resolvedDiscoveredByType.size} metadata types)`);
    }

    if (targetOrg && resolvedDiscoveredByType.size > 0) {
      const existingTypes = new Set((config.metadataTypes || []).map((rule) => rule.metadataType));
      for (const typeName of Array.from(resolvedDiscoveredByType.keys()).sort(salesforceLexSort)) {
        if (typeName === "InstalledPackage") {
          continue;
        }
        if (existingTypes.has(typeName)) {
          continue;
        }
        config.metadataTypes.push(createDefaultRule(typeName, initMode));
        existingTypes.add(typeName);
        addedTypes.push(typeName);
      }

      removeUndiscoveredMembers(config, resolvedDiscoveredByType, removedMembers);
    }

    normalizePseudoObjectMembers(config, removedMembers);
    sortConfig(config);
    ensureNoDuplicateMetadataTypes(config);
    validateConfigSchema(config);
    validateConfigSemantics(config);

    fs.writeFileSync(resolvedConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    return {
      configPath: resolvedConfigPath,
      targetOrg: targetOrg || null,
      initMode: Boolean(initMode),
      runDir: debug ? runDir : null,
      addedTypes,
      removedMembers,
    };
  } finally {
    cleanupRunArtifactsDir(runDir, debug);
  }
}

module.exports = {
  runNormalizeConfig,
};
