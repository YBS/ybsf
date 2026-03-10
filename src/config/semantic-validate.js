const FOLDERED_TYPES = new Set(["Report", "Dashboard", "Document", "EmailTemplate"]);
const MEMBER_MODES = new Set(["all", "include", "exclude"]);
const FOLDER_POLICY_MODES = new Set([
  "all",
  "include",
  "exclude",
  "memberPolicy",
]);
const {
  DEFAULT_PSEUDO_OBJECT_SCOPES,
  normalizePseudoObjectScopes,
} = require("./pseudo-object-scopes");
const { OPTIONAL_PROCESSING_DEFAULTS } = require("./optional-processing");
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

function validateMemberPolicy(memberPolicy, context) {
  if (!memberPolicy || typeof memberPolicy !== "object") {
    throw new Error(`${context}: memberPolicy is required`);
  }
  if (!MEMBER_MODES.has(memberPolicy.mode)) {
    throw new Error(`${context}: memberPolicy.mode must be one of all|include|exclude`);
  }
  if (!Array.isArray(memberPolicy.members)) {
    throw new Error(`${context}: memberPolicy.members must be an array`);
  }
  if (memberPolicy.mode === "all" && memberPolicy.members.length > 0) {
    throw new Error(`${context}: memberPolicy.members must be empty when mode=all`);
  }
}

function validateFolderPolicy(folderPolicy, context) {
  if (!folderPolicy || typeof folderPolicy !== "object") {
    throw new Error(`${context}: folderPolicy is required for foldered type`);
  }
  if (!FOLDER_POLICY_MODES.has(folderPolicy.mode)) {
    throw new Error(`${context}: folderPolicy.mode must be one of all|include|exclude|memberPolicy`);
  }
  if (!Array.isArray(folderPolicy.folders)) {
    throw new Error(`${context}: folderPolicy.folders must be an array`);
  }

  for (const folderRule of folderPolicy.folders) {
    if (!folderRule || typeof folderRule !== "object") {
      throw new Error(`${context}: folderPolicy.folders[] entries must be objects`);
    }
    if (!folderRule.folder || typeof folderRule.folder !== "string") {
      throw new Error(`${context}: folderPolicy.folders[].folder is required`);
    }
    if (folderPolicy.mode === "exclude" && folderRule.memberPolicy != null) {
      throw new Error(
        `${context}: folderPolicy.folders[].memberPolicy is not allowed when folderPolicy.mode=exclude`
      );
    }
    if (folderPolicy.mode === "include" && folderRule.memberPolicy != null) {
      validateMemberPolicy(folderRule.memberPolicy, `${context} folder ${folderRule.folder}`);
    }
  }
}

function validateConfigSemantics(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Config must be an object");
  }
  if (config.version !== 1) {
    throw new Error("Config version must be 1");
  }
  if (typeof config.apiVersion !== "string" || !/^[0-9]+\.[0-9]+$/.test(config.apiVersion)) {
    throw new Error("apiVersion must match N.N");
  }
  if (!Array.isArray(config.metadataTypes)) {
    throw new Error("metadataTypes must be an array");
  }

  const seenTypes = new Set();
  for (const rule of config.metadataTypes) {
    const context = `metadataType rule ${JSON.stringify(rule && rule.metadataType)}`;
    if (!rule || typeof rule !== "object") {
      throw new Error("Invalid metadataType rule");
    }
    if (!rule.metadataType || typeof rule.metadataType !== "string") {
      throw new Error(`${context}: metadataType is required`);
    }
    if (rule.metadataType === "InstalledPackage") {
      throw new Error(`${context}: InstalledPackage is not allowed in metadataTypes`);
    }
    if (seenTypes.has(rule.metadataType)) {
      throw new Error(`Duplicate metadataType rule: ${rule.metadataType}`);
    }
    seenTypes.add(rule.metadataType);

    if (typeof rule.enabled !== "boolean") {
      throw new Error(`${context}: enabled must be boolean`);
    }
    if (FOLDERED_TYPES.has(rule.metadataType)) {
      validateFolderPolicy(rule.folderPolicy, context);
      if (rule.folderPolicy.mode === "memberPolicy") {
        validateMemberPolicy(rule.memberPolicy, context);
      } else if (rule.memberPolicy != null) {
        throw new Error(
          `${context}: memberPolicy must be omitted when folderPolicy.mode=${rule.folderPolicy.mode}`
        );
      }
    } else if (rule.folderPolicy != null) {
      throw new Error(`${context}: folderPolicy is only valid for foldered types`);
    } else {
      validateMemberPolicy(rule.memberPolicy, context);
    }
  }
  const enabledTypes = new Set(
    (config.metadataTypes || []).filter((rule) => rule && rule.enabled).map((rule) => rule.metadataType)
  );
  for (const mapping of LEVEL3_PARENT_RULES) {
    if (enabledTypes.has(mapping.parentType)) {
      continue;
    }
    const enabledChildren = mapping.childTypes.filter((typeName) => enabledTypes.has(typeName));
    if (enabledChildren.length === 0) {
      continue;
    }
    throw new Error(
      `Invalid config: ${mapping.parentType} must be enabled when enabled level-3 types exist (${enabledChildren.join(", ")}).`
    );
  }

  if (!config.packageRules || typeof config.packageRules !== "object") {
    throw new Error("packageRules is required");
  }
  if (typeof config.packageRules.includeManagedPackages !== "boolean") {
    throw new Error("packageRules.includeManagedPackages must be boolean");
  }
  if (typeof config.packageRules.includeUnlockedPackages !== "boolean") {
    throw new Error("packageRules.includeUnlockedPackages must be boolean");
  }
  if (!Array.isArray(config.packageRules.namespaces)) {
    throw new Error("packageRules.namespaces must be an array");
  }
  if (!config.packageRules.includeManagedPackages && config.packageRules.namespaces.length > 0) {
    throw new Error("packageRules.namespaces is not allowed when includeManagedPackages=false");
  }
  const seenNamespaces = new Set();
  for (const nsRule of config.packageRules.namespaces) {
    if (!nsRule || typeof nsRule !== "object") {
      throw new Error("Invalid packageRules namespace rule");
    }
    if (!nsRule.namespace || typeof nsRule.namespace !== "string") {
      throw new Error("packageRules.namespaces[].namespace is required");
    }
    if (seenNamespaces.has(nsRule.namespace)) {
      throw new Error(`Duplicate installed package namespace: ${nsRule.namespace}`);
    }
    seenNamespaces.add(nsRule.namespace);
    if (!Array.isArray(nsRule.metadataTypes)) {
      throw new Error(`packageRules namespace ${nsRule.namespace}: metadataTypes must be an array`);
    }
    for (const typeRule of nsRule.metadataTypes) {
      if (!typeRule || typeof typeRule !== "object" || !typeRule.metadataType) {
        throw new Error(`packageRules namespace ${nsRule.namespace}: invalid metadataType rule`);
      }
      const context = `installed namespace ${nsRule.namespace}/${typeRule.metadataType}`;
      if (FOLDERED_TYPES.has(typeRule.metadataType)) {
        validateFolderPolicy(typeRule.folderPolicy, context);
        if (typeRule.folderPolicy.mode === "memberPolicy") {
          validateMemberPolicy(typeRule.memberPolicy, context);
        } else if (typeRule.memberPolicy != null) {
          throw new Error(
            `${context}: memberPolicy must be omitted when folderPolicy.mode=${typeRule.folderPolicy.mode}`
          );
        }
      } else if (typeRule.folderPolicy != null) {
        throw new Error(`${context}: folderPolicy is only valid for foldered types`);
      } else {
        validateMemberPolicy(typeRule.memberPolicy, context);
      }
    }
  }

  if (!config.processingRules || typeof config.processingRules !== "object") {
    throw new Error("processingRules is required");
  }
  if (config.processingRules.userPermissionsPolicy == null) {
    config.processingRules.userPermissionsPolicy = {
      mode: "all",
      members: [],
    };
  } else {
    validateMemberPolicy(config.processingRules.userPermissionsPolicy, "processingRules.userPermissionsPolicy");
  }
  if (config.processingRules.excludeStandardFields == null) {
    config.processingRules.excludeStandardFields = [];
  } else if (!Array.isArray(config.processingRules.excludeStandardFields)) {
    throw new Error("processingRules.excludeStandardFields must be an array");
  }
  if (config.processingRules.includePseudoObjects == null) {
    config.processingRules.includePseudoObjects = DEFAULT_PSEUDO_OBJECT_SCOPES.slice();
  } else if (!Array.isArray(config.processingRules.includePseudoObjects)) {
    throw new Error("processingRules.includePseudoObjects must be an array");
  } else {
    config.processingRules.includePseudoObjects = normalizePseudoObjectScopes(config.processingRules.includePseudoObjects);
  }
  if (config.processingRules.optionalProcessing == null) {
    config.processingRules.optionalProcessing = { ...OPTIONAL_PROCESSING_DEFAULTS };
  } else if (typeof config.processingRules.optionalProcessing !== "object") {
    throw new Error("processingRules.optionalProcessing must be an object");
  } else {
    const normalized = {};
    for (const key of Object.keys(OPTIONAL_PROCESSING_DEFAULTS)) {
      const value = config.processingRules.optionalProcessing[key];
      if (value == null) {
        normalized[key] = OPTIONAL_PROCESSING_DEFAULTS[key];
        continue;
      }
      if (typeof value !== "boolean") {
        throw new Error(`processingRules.optionalProcessing.${key} must be boolean`);
      }
      normalized[key] = value;
    }
    config.processingRules.optionalProcessing = normalized;
  }
}

module.exports = {
  validateConfigSemantics,
};
