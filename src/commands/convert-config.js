const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseLegacyProperties } = require("../legacy/parse-properties");
const { parsePackageXml } = require("../legacy/parse-package-xml");
const { parseLegacyPropertyTypeMap } = require("../legacy/parse-legacy-type-map");
const { validateConfigSemantics } = require("../config/semantic-validate");

const FOLDER_MODE_MEMBER_POLICY = "memberPolicy";
const { parseListMetadataJson } = require("../sf/parse-list-metadata-json");
const { DEFAULT_API_VERSION } = require("../constants");
const { DEFAULT_PSEUDO_OBJECT_SCOPES } = require("../config/pseudo-object-scopes");
const { OPTIONAL_PROCESSING_DEFAULTS } = require("../config/optional-processing");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");
const {
  writeDiscoveryProject,
  buildProjectGenerateManifestArgs,
  parseDiscoveredPackageXml,
} = require("./helpers/project-manifest-discovery");

const OUTPUT_FILE_NAME = "ybsf-metadata-config.json";
const SCHEMA_VERSION = 1;
const OBJECT_COMPONENT_PROPERTIES = [
  "sf.includeActionOverrides",
  "sf.includeBusinessProcesses",
  "sf.includeCompactLayouts",
  "sf.includeCustomFields",
  "sf.includeFieldSets",
  "sf.includeListViews",
  "sf.includeRecordTypes",
  "sf.includeSearchLayouts",
  "sf.includeSharingReasons",
  "sf.includeSharingRecalculations",
  "sf.includeValidationRules",
  "sf.includeWeblinks",
];
const SETTINGS_PROPERTIES = new Set([
  "sf.includeAccountSettings",
  "sf.includeActivitiesSettings",
  "sf.includeAddressSettings",
  "sf.includeBusinessHoursSettings",
  "sf.includeCaseSettings",
  "sf.includeCompanySettings",
  "sf.includeContractSettings",
  "sf.includeEntitlementSettings",
  "sf.includeFileUploadAndDownloadSecuritySettings",
  "sf.includeForecastingSettings",
  "sf.includeIdeasSettings",
  "sf.includeKnowledgeSettings",
  "sf.includeLiveAgentSettings",
  "sf.includeMobileSettings",
  "sf.includeNameSettings",
  "sf.includeOpportunitySettings",
  "sf.includeOrderSettings",
  "sf.includeOrgPreferenceSettings",
  "sf.includePathAssistantSettings",
  "sf.includeProductSettings",
  "sf.includeQuoteSettings",
  "sf.includeSearchSettings",
  "sf.includeSecuritySettings",
  "sf.includeSocialCustomerServiceSettings",
  "sf.includeTerritory2Settings",
]);
const STANDARD_VALUE_SET_MEMBERS = [
  "AccountContactMultiRoles",
  "AccountContactRole",
  "AccountOwnership",
  "AccountRating",
  "AccountType",
  "AssetStatus",
  "CampaignMemberStatus",
  "CampaignStatus",
  "CampaignType",
  "CaseContactRole",
  "CaseOrigin",
  "CasePriority",
  "CaseReason",
  "CaseStatus",
  "CaseType",
  "ContactRole",
  "ContractContactRole",
  "ContractStatus",
  "EntitlementType",
  "EventSubject",
  "EventType",
  "FiscalYearPeriodName",
  "FiscalYearPeriodPrefix",
  "FiscalYearQuarterName",
  "FiscalYearQuarterPrefix",
  "IdeaMultiCategory",
  "IdeaStatus",
  "IdeaThemeStatus",
  "Industry",
  "LeadSource",
  "LeadStatus",
  "OpportunityCompetitor",
  "OpportunityStage",
  "OpportunityType",
  "OrderType",
  "PartnerRole",
  "Product2Family",
  "QuickTextCategory",
  "QuickTextChannel",
  "QuoteStatus",
  "RoleInTerritory2",
  "SalesTeamRole",
  "Salutation",
  "ServiceContractApprovalStatus",
  "SocialPostClassification",
  "SocialPostEngagementLevel",
  "SocialPostReviewedStatus",
  "SolutionStatus",
  "TaskPriority",
  "TaskStatus",
  "TaskSubject",
  "TaskType",
  "WorkOrderLineItemStatus",
  "WorkOrderPriority",
  "WorkOrderStatus",
];
const OBJECT_HYPHEN_TYPES = new Set(["Layout", "CustomObjectTranslation"]);
const OBJECT_RELATED_TYPES = new Set([
  "Workflow",
  "SharingRules",
  "AssignmentRules",
  "AutoResponseRules",
  "TopicsForObjects",
  "CustomTab",
]);
const UNMANAGED_SUFFIX_TOKENS = new Set([
  "c",
  "mdt",
  "kav",
  "x",
  "b",
  "xo",
  "e",
  "p",
  "r",
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
    childTypes: [
      "WorkflowAlert",
      "WorkflowFieldUpdate",
      "WorkflowOutboundMessage",
      "WorkflowRule",
      "WorkflowTask",
    ],
  },
];

function isEnabledLegacyValue(raw) {
  if (raw == null) {
    return false;
  }
  const v = String(raw).trim().toLowerCase();
  return v === "true" || v === "yes";
}

function parseNamespacePrefix(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const delimiterIdx = text.indexOf("__");
  if (delimiterIdx <= 0) {
    return null;
  }
  const namespace = text.slice(0, delimiterIdx);
  const rest = text.slice(delimiterIdx + 2);
  if (!rest) {
    return null;
  }
  if (!rest.includes("__") && UNMANAGED_SUFFIX_TOKENS.has(rest.toLowerCase())) {
    return null;
  }
  return namespace;
}

function getObjectNamespace(objectName) {
  if (!objectName) {
    return null;
  }
  const cleanObjectName = String(objectName)
    .replace(/__c$/i, "")
    .replace(/__kav$/i, "")
    .replace(/__x$/i, "")
    .replace(/__b$/i, "")
    .replace(/__xo$/i, "")
    .replace(/__e$/i, "")
    .replace(/__p$/i, "")
    .replace(/__mdt$/i, "");
  const parts = cleanObjectName.split("__");
  if (parts.length === 2 && parts[0]) {
    return parts[0];
  }
  return null;
}

function getObjectName(typeName, memberName) {
  if (OBJECT_HYPHEN_TYPES.has(typeName)) {
    return String(memberName || "").split("-", 2)[0];
  }
  if (OBJECT_RELATED_TYPES.has(typeName)) {
    if (typeName === "CustomTab") {
      const text = String(memberName || "");
      return text.endsWith("__c") ? text : null;
    }
    return memberName;
  }
  const text = String(memberName || "");
  if (text.includes(".")) {
    const objectName = text.split(".", 2)[0];
    if (typeName === "CustomMetadata") {
      return `${objectName}__mdt`;
    }
    return objectName;
  }
  return null;
}

function getMemberNamespace(typeName, memberName) {
  const full = String(memberName || "");
  if (!full) {
    return null;
  }
  if (full.includes(".")) {
    const [objectToken, memberToken] = full.split(".", 2);
    if (typeName === "CustomMetadata" && objectToken.includes("__")) {
      const packageName = objectToken.split("__", 1)[0];
      if (packageName) {
        return packageName;
      }
    }
    const objectNs = parseNamespacePrefix(objectToken);
    if (objectNs) {
      return objectNs;
    }
    return parseNamespacePrefix(memberToken);
  }
  if (OBJECT_HYPHEN_TYPES.has(typeName) && full.includes("-")) {
    const objectToken = full.split("-", 1)[0];
    return parseNamespacePrefix(objectToken);
  }
  if (full.includes("/")) {
    const [folderName, memberPart] = full.split("/", 2);
    const folderNs = parseNamespacePrefix(folderName);
    if (folderNs) {
      return folderNs;
    }
    const memberNs = parseNamespacePrefix(memberPart);
    if (memberNs) {
      return memberNs;
    }
  }
  const direct = parseNamespacePrefix(full);
  if (direct) {
    return direct;
  }
  return getObjectNamespace(getObjectName(typeName, full));
}

function getOrCreateNamespaceRule(packageRulesConfig, namespace) {
  if (!Array.isArray(packageRulesConfig.namespaces)) {
    packageRulesConfig.namespaces = [];
  }
  let namespaceRule = packageRulesConfig.namespaces.find((item) => item && item.namespace === namespace);
  if (!namespaceRule) {
    namespaceRule = {
      namespace,
      metadataTypes: [],
    };
    packageRulesConfig.namespaces.push(namespaceRule);
  }
  if (!Array.isArray(namespaceRule.metadataTypes)) {
    namespaceRule.metadataTypes = [];
  }
  return namespaceRule;
}

function mergeNamespaceTypeMembers(namespaceRule, metadataType, mode, incomingMembers, warnings) {
  if (!Array.isArray(incomingMembers) || incomingMembers.length === 0) {
    return;
  }
  const dedupedIncoming = Array.from(
    new Set(incomingMembers.map((m) => String(m || "").trim()).filter((m) => m.length > 0))
  );
  if (dedupedIncoming.length === 0) {
    return;
  }
  let typeRule = namespaceRule.metadataTypes.find((item) => item && item.metadataType === metadataType);
  if (!typeRule) {
    typeRule = {
      metadataType,
      memberPolicy: {
        mode,
        members: [],
      },
    };
    namespaceRule.metadataTypes.push(typeRule);
  }
  if (!typeRule.memberPolicy || typeof typeRule.memberPolicy !== "object") {
    typeRule.memberPolicy = {
      mode,
      members: [],
    };
  }
  if (!Array.isArray(typeRule.memberPolicy.members)) {
    typeRule.memberPolicy.members = [];
  }

  const existingMode = typeRule.memberPolicy.mode;
  if (existingMode === "all" && mode !== "all") {
    typeRule.memberPolicy.mode = mode;
    typeRule.memberPolicy.members = [];
  } else if (existingMode !== mode && mode !== "all") {
    if (existingMode === "include") {
      warnings.push(
        `Type ${metadataType}/${namespaceRule.namespace}: include and exclude managed members conflicted; include precedence applied.`
      );
      return;
    }
    if (mode === "include") {
      warnings.push(
        `Type ${metadataType}/${namespaceRule.namespace}: include and exclude managed members conflicted; include precedence applied.`
      );
      typeRule.memberPolicy.mode = "include";
      typeRule.memberPolicy.members = [];
    } else {
      return;
    }
  }

  if (typeRule.memberPolicy.mode === "all") {
    return;
  }
  typeRule.memberPolicy.members = Array.from(
    new Set(typeRule.memberPolicy.members.concat(dedupedIncoming))
  ).sort();
}

function migrateManagedMembersToPackageRules(typeRuleMap, packageRulesConfig, warnings) {
  if (!packageRulesConfig || !packageRulesConfig.includeManagedPackages) {
    return;
  }
  const namespaceSet = new Set(
    (packageRulesConfig.namespaces || [])
      .map((rule) => (rule && rule.namespace ? String(rule.namespace).trim() : ""))
      .filter((value) => value.length > 0)
  );

  for (const rule of typeRuleMap.values()) {
    if (!rule || !rule.metadataType || !rule.memberPolicy || !Array.isArray(rule.memberPolicy.members)) {
      continue;
    }
    if (rule.metadataType === "InstalledPackage") {
      continue;
    }
    const mode = rule.memberPolicy.mode;
    if (mode !== "include" && mode !== "exclude") {
      continue;
    }

    const byNamespace = new Map();
    const remaining = [];
    for (const member of rule.memberPolicy.members) {
      const namespace = getMemberNamespace(rule.metadataType, member);
      if (!namespace || !namespaceSet.has(namespace)) {
        remaining.push(member);
        continue;
      }
      if (!byNamespace.has(namespace)) {
        byNamespace.set(namespace, []);
      }
      byNamespace.get(namespace).push(member);
    }
    if (byNamespace.size === 0) {
      continue;
    }

    rule.memberPolicy.members = Array.from(
      new Set(remaining.map((m) => String(m || "").trim()).filter((m) => m.length > 0))
    ).sort();
    for (const [namespace, members] of byNamespace.entries()) {
      const namespaceRule = getOrCreateNamespaceRule(packageRulesConfig, namespace);
      mergeNamespaceTypeMembers(namespaceRule, rule.metadataType, mode, members, warnings);
    }
  }
}
function getOrCreateTypeRule(typeRuleMap, metadataType) {
  if (!typeRuleMap.has(metadataType)) {
    typeRuleMap.set(metadataType, {
      metadataType,
      enabled: true,
      memberPolicy: {
        mode: "all",
        members: [],
      },
    });
  }
  return typeRuleMap.get(metadataType);
}

function ensureLevel3ParentEnablement(typeRuleMap, warnings) {
  for (const mapping of LEVEL3_PARENT_RULES) {
    const enabledChildren = mapping.childTypes.filter((typeName) => {
      const rule = typeRuleMap.get(typeName);
      return Boolean(rule && rule.enabled);
    });
    if (enabledChildren.length === 0) {
      continue;
    }
    const parentExisted = typeRuleMap.has(mapping.parentType);
    const parentRule = getOrCreateTypeRule(typeRuleMap, mapping.parentType);
    let changed = false;
    if (!parentRule.enabled) {
      parentRule.enabled = true;
      changed = true;
    }
    if (!parentRule.memberPolicy || typeof parentRule.memberPolicy !== "object") {
      parentRule.memberPolicy = {
        mode: "all",
        members: [],
      };
      changed = true;
    }
    if (changed || !parentExisted) {
      warnings.push(
        `Type ${mapping.parentType}: auto-enabled because level-3 types are enabled (${enabledChildren.join(", ")}).`
      );
    }
  }
}

function buildPackageRulesConfig(properties, includeMap, warnings, overrides = {}) {
  const includeManagedPackages = overrides.includeManagedPackages
    ? true
    : isEnabledLegacyValue(properties["sf.includeInstalledPackages"]);
  // Legacy behavior effectively included unlocked package metadata in discovery.
  const includeUnlockedPackages = true;
  const namespaces = [];
  const installedPackageIncludes = includeMap.get("InstalledPackage") || [];

  // Parse legacy sf.includeManagedPackageTypes list.
  const managedTypesRaw = properties["sf.includeManagedPackageTypes"] || "";
  const managedTypes = managedTypesRaw
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (includeManagedPackages) {
    for (const namespace of installedPackageIncludes) {
      const metadataTypes = managedTypes.map((metadataType) => ({
        metadataType,
        memberPolicy: {
          mode: "all",
          members: [],
        },
      }));
      namespaces.push({
        namespace,
        metadataTypes,
      });
    }
    if (installedPackageIncludes.length === 0) {
      warnings.push(
        "Managed package inclusion enabled, but no InstalledPackage include namespaces were found. Managed namespaces default to deny."
      );
    }
  } else if (installedPackageIncludes.length > 0) {
    warnings.push(
      "InstalledPackage include namespaces were provided but includeManagedPackages is false; namespaces were ignored."
    );
  }

  return {
    includeManagedPackages,
    includeUnlockedPackages,
    namespaces,
  };
}

function applyFolderPolicyIfNeeded(rule, properties) {
  const type = rule.metadataType;
  const folderConfig = {
    Report: {
      foldersProp: "sf.includeReportsFolders",
      unfiledProp: "sf.includeReportsUnfiledPublic",
    },
    Dashboard: {
      foldersProp: "sf.includeDashboardsFolders",
      unfiledProp: null,
    },
    Document: {
      foldersProp: "sf.includeDocumentsFolders",
      unfiledProp: null,
    },
    EmailTemplate: {
      foldersProp: "sf.includeEmailsFolders",
      unfiledProp: "sf.includeEmailsUnfiledPublic",
    },
  };

  const cfg = folderConfig[type];
  if (!cfg) {
    return;
  }

  const foldersRaw = properties[cfg.foldersProp] || "";
  const folders = foldersRaw
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const includeUnfiledPublic = cfg.unfiledProp ? isEnabledLegacyValue(properties[cfg.unfiledProp]) : false;
  let mode = folders.length > 0 ? "include" : FOLDER_MODE_MEMBER_POLICY;
  if (cfg.unfiledProp && !includeUnfiledPublic) {
    if (folders.length === 0) {
      mode = "exclude";
      folders.push("unfiled$public");
    }
  } else if (cfg.unfiledProp && includeUnfiledPublic && !folders.includes("unfiled$public")) {
    folders.push("unfiled$public");
  }

  rule.folderPolicy = {
    mode,
    folders: folders.sort().map((folder) => {
      if (mode === "exclude") {
        return { folder };
      }
      return {
        folder,
        memberPolicy: {
          mode: "all",
          members: [],
        },
      };
    }),
  };
  if (rule.folderPolicy.mode === FOLDER_MODE_MEMBER_POLICY) {
    rule.folderPolicy.folders = [];
  }
}

function isFolderedMetadataType(typeName) {
  return typeName === "Report" || typeName === "Dashboard" || typeName === "Document" || typeName === "EmailTemplate";
}

function resolvePolicyFromIncludeIgnore(metadataType, includeMap, ignoreMap, warnings, defaultPolicy) {
  const includeMembers = includeMap.get(metadataType) || [];
  const excludeMembers = ignoreMap.get(metadataType) || [];

  if (includeMembers.length > 0 && excludeMembers.length > 0) {
    warnings.push(
      `Type ${metadataType} has both include and ignore members. Include precedence applied and ignore members discarded.`
    );
  }

  if (includeMembers.length > 0) {
    return {
      mode: "include",
      members: includeMembers.slice().sort(),
    };
  }
  if (excludeMembers.length > 0) {
    return {
      mode: "exclude",
      members: excludeMembers.slice().sort(),
    };
  }
  return defaultPolicy;
}

function isCustomFieldMemberName(memberName) {
  const text = String(memberName || "").trim();
  if (!text.includes(".")) {
    return false;
  }
  const fieldName = text.split(".", 2)[1] || "";
  return fieldName.includes("__");
}

function splitCustomFieldMembersByKind(members) {
  const customFieldMembers = [];
  const standardFieldMembers = [];
  for (const member of members || []) {
    if (isCustomFieldMemberName(member)) {
      customFieldMembers.push(member);
    } else {
      standardFieldMembers.push(member);
    }
  }
  return {
    customFieldMembers,
    standardFieldMembers,
  };
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

function normalizeMemberForDiscoveryComparison(metadataType, memberName) {
  const text = String(memberName || "").trim();
  if (metadataType === "Document") {
    return normalizeDocumentMemberName(text);
  }
  return text;
}

function filterIncludeMembersByDiscovery(metadataType, includeMembers, discoveredMembers, warnings) {
  if (!Array.isArray(includeMembers) || includeMembers.length === 0) {
    return [];
  }
  if (!Array.isArray(discoveredMembers)) {
    return includeMembers.slice().sort();
  }
  const discoveredSet = new Set(
    discoveredMembers
      .map((m) => normalizeMemberForDiscoveryComparison(metadataType, m))
      .filter((m) => m.length > 0)
  );
  const kept = [];
  const removedMembers = [];
  for (const member of includeMembers) {
    const normalized = normalizeMemberForDiscoveryComparison(metadataType, member);
    if (!normalized) {
      continue;
    }
    if (discoveredSet.has(normalized)) {
      kept.push(normalized);
    } else {
      removedMembers.push(normalized);
    }
  }
  if (removedMembers.length > 0) {
    warnings.push(
      `Type ${metadataType}: removed ${removedMembers.length} include member(s) not found in org discovery: ${removedMembers
        .sort()
        .join(", ")}`
    );
  }
  return kept.sort();
}

function discoverFolderedTypeMembersFromOrg(targetOrg, apiVersion, metadataType, warnings) {
  const result = spawnSync(
    "sf",
    [
      "org",
      "list",
      "metadata",
      "--metadata-type",
      metadataType,
      "--target-org",
      targetOrg,
      "--api-version",
      apiVersion,
      "--json",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) {
    const message = (result.stderr || "").trim() || `status ${result.status}`;
    warnings.push(`Type ${metadataType}: org discovery failed during convert-config (${message}).`);
    return [];
  }
  try {
    return parseListMetadataJson(result.stdout || "")
      .map((member) => normalizeMemberForDiscoveryComparison(metadataType, member))
      .filter((member) => !!member);
  } catch (err) {
    warnings.push(`Type ${metadataType}: failed to parse org discovery JSON during convert-config (${err.message}).`);
    return [];
  }
}

function discoverMembersViaProjectManifest(
  targetOrg,
  apiVersion,
  warnings,
  debug,
  includeManagedPackages,
  includeUnlockedPackages
) {
  const runDir = createRunArtifactsDir("ybsf-convert-config-discovery", process.cwd());
  const discoveryDir = path.join(runDir, "org-discovery");
  try {
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
      warnings.push(`Org manifest discovery failed during convert-config (${message}).`);
      return new Map();
    }

    try {
      const packagePath = path.join(discoveryDir, "package.xml");
      const parsed = parseDiscoveredPackageXml(packagePath);
      for (const [typeName, members] of parsed.entries()) {
        parsed.set(
          typeName,
          (members || [])
            .map((m) => normalizeMemberForDiscoveryComparison(typeName, m))
            .filter((m) => m.length > 0)
        );
      }
      return parsed;
    } catch (err) {
      warnings.push(`Org manifest discovery parsing failed during convert-config (${err.message}).`);
      return new Map();
    }
  } finally {
    cleanupRunArtifactsDir(runDir, debug);
  }
}

function canonicalizeDocumentIncludeMembers(includeMembers, discoveredOrgMembers, warnings) {
  if (!Array.isArray(includeMembers) || includeMembers.length === 0) {
    return [];
  }
  const canonical = includeMembers.map((member) => normalizeDocumentMemberName(member)).filter((member) => !!member);
  if (!Array.isArray(discoveredOrgMembers) || discoveredOrgMembers.length === 0) {
    return canonical;
  }
  const discoveredSet = new Set(discoveredOrgMembers.map((member) => normalizeDocumentMemberName(member)));
  const removedMembers = canonical.filter((member) => !discoveredSet.has(member));
  if (removedMembers.length > 0) {
    warnings.push(
      `Type Document: removed ${removedMembers.length} include member(s) not found in org discovery: ${removedMembers
        .sort()
        .join(", ")}`
    );
  }
  return canonical.filter((member) => discoveredSet.has(member));
}

function buildFolderPolicyFromIncludedMembers(rule, includeMembers, discoveredOrgMembers, knownFolders) {
  if (!Array.isArray(includeMembers) || includeMembers.length === 0) {
    // Include policy resolved to no valid members (for example after org-aware pruning).
    // Represent this as explicit folder include with an empty list.
    rule.folderPolicy = {
      mode: "include",
      folders: [],
    };
    delete rule.memberPolicy;
    return;
  }

  const explicitInFolderMap = new Map();
  const folderMarkerSet = new Set();
  const unresolvedStandaloneMembers = [];
  const inferredFoldersFromMembers = new Set();
  for (const entry of includeMembers) {
    if (entry.includes("/")) {
      inferredFoldersFromMembers.add(entry.split("/", 2)[0]);
    }
  }
  const discoveredFolderSet = new Set();
  for (const discovered of discoveredOrgMembers || []) {
    const folderName = discovered.split("/", 1)[0];
    if (folderName) {
      discoveredFolderSet.add(folderName);
    }
  }

  for (const entry of includeMembers) {
    if (!entry.includes("/")) {
      const canTreatAsFolder =
        (knownFolders && knownFolders.has(entry)) ||
        discoveredFolderSet.has(entry) ||
        inferredFoldersFromMembers.has(entry);
      if (canTreatAsFolder) {
        folderMarkerSet.add(entry);
      } else {
        unresolvedStandaloneMembers.push(entry);
      }
      continue;
    }
    const [folder, memberName] = entry.split("/", 2);
    if (!explicitInFolderMap.has(folder)) {
      explicitInFolderMap.set(folder, new Set());
    }
    explicitInFolderMap.get(folder).add(memberName);
  }

  if (Array.isArray(discoveredOrgMembers) && discoveredOrgMembers.length > 0) {
    const discoveredByFolder = new Map();
    for (const discovered of discoveredOrgMembers) {
      if (!discovered.includes("/")) {
        continue;
      }
      const [folder, memberName] = discovered.split("/", 2);
      // Ignore folder marker rows like "Folder/" when evaluating full member coverage.
      if (!memberName || memberName.length === 0) {
        continue;
      }
      if (!discoveredByFolder.has(folder)) {
        discoveredByFolder.set(folder, new Set());
      }
      discoveredByFolder.get(folder).add(memberName);
    }
    for (const [folder, membersSet] of discoveredByFolder.entries()) {
      const includeMembersSet = explicitInFolderMap.get(folder);
      if (!includeMembersSet || includeMembersSet.size === 0) {
        continue;
      }
      const includeSet = new Set(includeMembersSet);
      if (includeSet.size === 0 || includeSet.size !== membersSet.size) {
        continue;
      }
      let allMatched = true;
      for (const discoveredMember of membersSet) {
        if (!includeSet.has(discoveredMember)) {
          allMatched = false;
          break;
        }
      }
      if (allMatched) {
        folderMarkerSet.add(folder);
        explicitInFolderMap.delete(folder);
      }
    }
  }

  if (unresolvedStandaloneMembers.length > 0) {
    rule.folderPolicy = {
      mode: FOLDER_MODE_MEMBER_POLICY,
      folders: [],
    };
    rule.memberPolicy = {
      mode: "include",
      members: includeMembers.slice().sort(),
    };
    return;
  }

  const allFolders = new Set([...folderMarkerSet, ...explicitInFolderMap.keys()]);
  if (allFolders.size === 0) {
    // No folders/members resolved after discovery-aware normalization.
    // Keep explicit folder include with an empty list.
    rule.folderPolicy = {
      mode: "include",
      folders: [],
    };
    delete rule.memberPolicy;
    return;
  }

  const folderEntries = Array.from(allFolders)
    .sort()
    .map((folder) => {
      const explicitMembers = explicitInFolderMap.get(folder);
      if (!explicitMembers || explicitMembers.size === 0) {
        return {
          folder,
          memberPolicy: {
            mode: "all",
            members: [],
          },
        };
      }
      return {
        folder,
        memberPolicy: {
          mode: "include",
          members: Array.from(explicitMembers).sort(),
        },
      };
    });

  rule.folderPolicy = {
    mode: "include",
    folders: folderEntries,
  };
  delete rule.memberPolicy;
}

function resolvePolicyFromBaseline(metadataType, includeMap, ignoreMap, warnings, baselineMembers) {
  const includeMembers = includeMap.get(metadataType) || [];
  const excludeMembers = ignoreMap.get(metadataType) || [];
  const baseline = baselineMembers.slice().sort();
  const baselineSet = new Set(baseline);

  if (includeMembers.length > 0 && excludeMembers.length > 0) {
    warnings.push(
      `Type ${metadataType} has both include and ignore members. Include precedence applied and ignore members discarded.`
    );
  }

  if (includeMembers.length > 0) {
    return {
      mode: "include",
      members: includeMembers.filter((m) => baselineSet.has(m)).sort(),
    };
  }
  if (excludeMembers.length > 0) {
    const denySet = new Set(excludeMembers);
    warnings.push(
      `Type ${metadataType}: legacy exclude list converted to explicit include list from baseline members.`
    );
    return {
      mode: "include",
      members: baseline.filter((m) => !denySet.has(m)),
    };
  }
  return {
    mode: "include",
    members: baseline,
  };
}

function derivePseudoObjectScopesFromLegacy(includeMap, ignoreMap) {
  const pseudoDefaults = DEFAULT_PSEUDO_OBJECT_SCOPES.slice();
  const includeMembers = (includeMap.get("CustomObject") || []).map((m) => String(m || "").trim());
  const ignoreMembers = (ignoreMap.get("CustomObject") || []).map((m) => String(m || "").trim());
  const includeSet = new Set(includeMembers);
  const ignoreSet = new Set(ignoreMembers);

  if (includeMembers.length > 0) {
    return pseudoDefaults.filter((member) => includeSet.has(member));
  }
  if (ignoreMembers.length > 0) {
    return pseudoDefaults.filter((member) => !ignoreSet.has(member));
  }
  return pseudoDefaults;
}

async function runConvertConfig({
  inputDir,
  outputDir,
  force,
  targetOrg,
  apiVersion,
  status,
  debug = false,
  includeManagedPackages = false,
  includeUnlockedPackages = false,
}) {
  const startedAt = Date.now();
  const resolvedApiVersion = apiVersion || DEFAULT_API_VERSION;
  const step = (message) => {
    if (typeof status === "function") {
      status(`[convert-config] ${message}`);
    }
  };

  step(`Starting conversion from ${inputDir}`);
  if (targetOrg) {
    step(`Org-aware conversion enabled for ${targetOrg}`);
  }
  const outputFile = path.join(outputDir, OUTPUT_FILE_NAME);
  if (fs.existsSync(outputFile) && !force) {
    throw new Error(`Output file already exists: ${outputFile}. Re-run with --force to overwrite.`);
  }

  const propertiesPath = path.join(inputDir, "salesforce.properties");
  const includePath = path.join(inputDir, "includePackage.xml");
  const ignorePath = path.join(inputDir, "ignorePackage.xml");

  if (!fs.existsSync(propertiesPath)) {
    throw new Error(`Missing input file: ${propertiesPath}`);
  }
  step("Loading legacy salesforce.properties / includePackage.xml / ignorePackage.xml");
  const parseStartedAt = Date.now();
  const warnings = [];
  const properties = parseLegacyProperties(fs.readFileSync(propertiesPath, "utf8"));
  const includeMap = fs.existsSync(includePath)
    ? parsePackageXml(fs.readFileSync(includePath, "utf8"))
    : new Map();
  const ignoreMap = fs.existsSync(ignorePath)
    ? parsePackageXml(fs.readFileSync(ignorePath, "utf8"))
    : new Map();
  if (!fs.existsSync(includePath)) {
    warnings.push("Missing includePackage.xml; treated as empty include rules.");
  }
  if (!fs.existsSync(ignorePath)) {
    warnings.push("Missing ignorePackage.xml; treated as empty ignore rules.");
  }
  const propertyToTypeMap = parseLegacyPropertyTypeMap();
  step(`Loaded legacy inputs in ${Date.now() - parseStartedAt}ms`);

  step("Converting legacy property flags to metadata rules");
  const convertStartedAt = Date.now();
  const typeRuleMap = new Map();
  const enabledSettingsMembers = new Set();
  let orgDiscoveredByType = new Map();
  let hasPrimaryOrgDiscovery = false;
  const packageRulesConfig = buildPackageRulesConfig(properties, includeMap, warnings, {
    includeManagedPackages,
    includeUnlockedPackages,
  });
  if (targetOrg) {
    step("Org discovery: project generate manifest");
    orgDiscoveredByType = discoverMembersViaProjectManifest(
      targetOrg,
      resolvedApiVersion,
      warnings,
      debug,
      packageRulesConfig.includeManagedPackages,
      packageRulesConfig.includeUnlockedPackages
    );
    hasPrimaryOrgDiscovery = orgDiscoveredByType.size > 0;
  }
  for (const [propertyName, metadataType] of propertyToTypeMap.entries()) {
    const enabled = isEnabledLegacyValue(properties[propertyName]);
    if (!enabled) {
      continue;
    }

    if (SETTINGS_PROPERTIES.has(propertyName)) {
      enabledSettingsMembers.add(metadataType);
      continue;
    }
    if (metadataType === "InstalledPackage") {
      warnings.push(
        "Type InstalledPackage: skipped metadataTypes rule (managed package behavior is controlled by packageRules)."
      );
      continue;
    }

    const rule = getOrCreateTypeRule(typeRuleMap, metadataType);
    applyFolderPolicyIfNeeded(rule, properties);
    rule.memberPolicy = resolvePolicyFromIncludeIgnore(metadataType, includeMap, ignoreMap, warnings, {
      mode: "all",
      members: [],
    });
    if (
      targetOrg &&
      hasPrimaryOrgDiscovery &&
      rule.memberPolicy.mode === "include" &&
      !isFolderedMetadataType(metadataType)
    ) {
      const discoveredForType = orgDiscoveredByType.get(metadataType) || [];
      rule.memberPolicy.members = filterIncludeMembersByDiscovery(
        metadataType,
        rule.memberPolicy.members || [],
        discoveredForType,
        warnings
      );
    }
    if (isFolderedMetadataType(metadataType) && rule.memberPolicy.mode === "include") {
      const knownFolders = new Set(
        ((rule.folderPolicy && rule.folderPolicy.folders) || [])
          .map((folderRule) => (folderRule && folderRule.folder ? folderRule.folder : null))
          .filter((v) => typeof v === "string" && v.length > 0)
      );
      let discovered = [];
      if (targetOrg) {
        discovered = orgDiscoveredByType.get(metadataType) || [];
        if (discovered.length === 0) {
          step(`Org discovery fallback: ${metadataType}`);
          discovered = discoverFolderedTypeMembersFromOrg(targetOrg, resolvedApiVersion, metadataType, warnings);
        }
        if (metadataType === "Document") {
          rule.memberPolicy.members = canonicalizeDocumentIncludeMembers(
            rule.memberPolicy.members || [],
            discovered,
            warnings
          ).sort();
        }
      }
      buildFolderPolicyFromIncludedMembers(rule, rule.memberPolicy.members || [], discovered, knownFolders);
    } else if (isFolderedMetadataType(metadataType) && rule.folderPolicy.mode !== FOLDER_MODE_MEMBER_POLICY) {
      if (rule.memberPolicy.mode === "all") {
        delete rule.memberPolicy;
      } else {
        warnings.push(
          `Type ${metadataType}: conflicting top-level memberPolicy with folderPolicy.${rule.folderPolicy.mode}; using memberPolicy and resetting folderPolicy to memberPolicy mode.`
        );
        rule.folderPolicy = {
          mode: FOLDER_MODE_MEMBER_POLICY,
          folders: [],
        };
      }
    }
  }

  // Legacy SharingRules toggles object-level sharing scope only. For the new config
  // model, always emit granular sharing rule types in "all" mode when SharingRules
  // is enabled so users can refine later without losing default behavior.
  const sharingRulesRule = typeRuleMap.get("SharingRules");
  if (sharingRulesRule && sharingRulesRule.enabled) {
    for (const sharingSubtype of ["SharingCriteriaRule", "SharingOwnerRule"]) {
      const subtypeRule = getOrCreateTypeRule(typeRuleMap, sharingSubtype);
      subtypeRule.enabled = true;
      subtypeRule.memberPolicy = {
        mode: "all",
        members: [],
      };
    }
  }

  const assignmentRulesRule = typeRuleMap.get("AssignmentRules");
  if (assignmentRulesRule && assignmentRulesRule.enabled) {
    const assignmentRule = getOrCreateTypeRule(typeRuleMap, "AssignmentRule");
    assignmentRule.enabled = true;
    assignmentRule.memberPolicy = {
      mode: "all",
      members: [],
    };
  }

  const autoResponseRulesRule = typeRuleMap.get("AutoResponseRules");
  if (autoResponseRulesRule && autoResponseRulesRule.enabled) {
    const autoResponseRule = getOrCreateTypeRule(typeRuleMap, "AutoResponseRule");
    autoResponseRule.enabled = true;
    autoResponseRule.memberPolicy = {
      mode: "all",
      members: [],
    };
  }

  if (OBJECT_COMPONENT_PROPERTIES.some((propertyName) => isEnabledLegacyValue(properties[propertyName]))) {
    const customObjectRule = getOrCreateTypeRule(typeRuleMap, "CustomObject");
    customObjectRule.memberPolicy = resolvePolicyFromIncludeIgnore("CustomObject", includeMap, ignoreMap, warnings, {
      mode: "all",
      members: [],
    });
  }

  if (enabledSettingsMembers.size > 0) {
    const settingsRule = getOrCreateTypeRule(typeRuleMap, "Settings");
    settingsRule.memberPolicy = resolvePolicyFromBaseline(
      "Settings",
      includeMap,
      ignoreMap,
      warnings,
      Array.from(enabledSettingsMembers)
    );
  }

  if (isEnabledLegacyValue(properties["sf.includeStandardValueSets"])) {
    const standardValueSetRule = getOrCreateTypeRule(typeRuleMap, "StandardValueSet");
    standardValueSetRule.memberPolicy = resolvePolicyFromBaseline(
      "StandardValueSet",
      includeMap,
      ignoreMap,
      warnings,
      STANDARD_VALUE_SET_MEMBERS
    );
  }
  ensureLevel3ParentEnablement(typeRuleMap, warnings);
  migrateManagedMembersToPackageRules(typeRuleMap, packageRulesConfig, warnings);
  step(`Converted metadata rules in ${Date.now() - convertStartedAt}ms`);

  const ignoredCustomFieldMembers = ignoreMap.get("CustomField") || [];
  const splitIgnoredCustomFields = splitCustomFieldMembersByKind(ignoredCustomFieldMembers);
  const excludeStandardFields = Array.from(new Set(splitIgnoredCustomFields.standardFieldMembers)).sort();
  if (excludeStandardFields.length > 0) {
    warnings.push(
      `CustomField ignore members: moved ${excludeStandardFields.length} standard field(s) to processingRules.excludeStandardFields.`
    );
  }

  const customFieldRule = typeRuleMap.get("CustomField");
  if (customFieldRule && customFieldRule.memberPolicy && customFieldRule.memberPolicy.mode === "exclude") {
    const splitRuleMembers = splitCustomFieldMembersByKind(customFieldRule.memberPolicy.members || []);
    customFieldRule.memberPolicy.members = splitRuleMembers.customFieldMembers.slice().sort();
    if (customFieldRule.memberPolicy.members.length === 0) {
      customFieldRule.memberPolicy = {
        mode: "all",
        members: [],
      };
    }
  }

  const processingRules = {
    userPermissionsPolicy: {
      mode: "exclude",
      members: Array.from(
        new Set(
          (properties["sf.excludeUserPermissions"] || "")
            .split(";")
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        )
      ).sort(),
    },
    excludeStandardFields,
    includePseudoObjects: derivePseudoObjectScopesFromLegacy(includeMap, ignoreMap),
    optionalProcessing: { ...OPTIONAL_PROCESSING_DEFAULTS },
  };

  const config = {
    version: SCHEMA_VERSION,
    apiVersion: resolvedApiVersion,
    metadataTypes: Array.from(typeRuleMap.values()).sort((a, b) =>
      a.metadataType.localeCompare(b.metadataType)
    ),
    packageRules: packageRulesConfig,
    processingRules,
  };

  step("Validating and writing ybsf-metadata-config.json");
  const writeStartedAt = Date.now();
  validateConfigSemantics(config);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  step(`Wrote config in ${Date.now() - writeStartedAt}ms`);
  step(`Completed in ${Date.now() - startedAt}ms`);

  const conflicts = warnings.filter((w) => w.includes("both include and ignore")).length;
  return {
    outputFile,
    metadataTypeCount: config.metadataTypes.length,
    conflictCount: conflicts,
    warnings,
    discoveredByType: orgDiscoveredByType,
  };
}

module.exports = {
  runConvertConfig,
  OUTPUT_FILE_NAME,
};
