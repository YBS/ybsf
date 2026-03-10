const fs = require("fs");
const path = require("path");
const {
  parseXml,
  elementName,
  getFirstChildText,
  sortDirectChildElements,
  serializeXml,
} = require("./helpers/dom-xml");
const { normalizeActivityFieldName } = require("./helpers/field-scope");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function parseObjectAndMember(typeName, fullMemberName) {
  const text = String(fullMemberName || "").trim();
  if (!text) {
    return null;
  }
  if (typeName === "CustomObjectTranslation") {
    const idx = text.indexOf("-");
    if (idx <= 0) {
      return null;
    }
    return { objectName: text.slice(0, idx), memberName: text };
  }
  if (typeName === "Layout") {
    const idx = text.indexOf("-");
    if (idx <= 0) {
      return null;
    }
    return { objectName: text.slice(0, idx), memberName: text };
  }
  if (typeName === "QuickAction") {
    if (!text.includes(".")) {
      return null;
    }
    const [objectName] = text.split(".", 1);
    return { objectName, memberName: text };
  }
  if (
    typeName === "CustomField" ||
    typeName === "BusinessProcess" ||
    typeName === "CompactLayout" ||
    typeName === "FieldSet" ||
    typeName === "ListView" ||
    typeName === "RecordType" ||
    typeName === "SharingReason" ||
    typeName === "SharingCriteriaRule" ||
    typeName === "SharingOwnerRule" ||
    typeName === "AssignmentRule" ||
    typeName === "AutoResponseRule" ||
    typeName === "ValidationRule" ||
    typeName === "WebLink"
  ) {
    if (!text.includes(".")) {
      return null;
    }
    const [objectName, memberName] = text.split(".", 2);
    return { objectName, memberName };
  }
  return null;
}

function buildObjectChildAllowMap(manifestMembersByType, typeName) {
  const byObject = new Map();
  const members = manifestMembersByType.get(typeName) || [];
  for (const member of members) {
    const parsed = parseObjectAndMember(typeName, member);
    if (!parsed) {
      continue;
    }
    if (!byObject.has(parsed.objectName)) {
      byObject.set(parsed.objectName, new Set());
    }
    byObject.get(parsed.objectName).add(parsed.memberName);
  }
  return byObject;
}

function filterRecordTypePicklistValuesFile({
  filePath,
  objectName,
  manifestMembersByType,
  excludedStandardFields,
  summary,
}) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  summary.scannedFiles += 1;
  const original = fs.readFileSync(filePath, "utf8");
  const doc = parseXml(original);
  const root = doc.documentElement;
  if (!root || elementName(root) !== "RecordType") {
    return;
  }

  const objectMembers = manifestMembersByType.get("CustomObject") || [];
  const hasCustomObjectScope = manifestMembersByType.has("CustomObject");
  const includeAllObjects = objectMembers.includes("*");
  const objectAllowSet = includeAllObjects ? null : new Set(objectMembers);

  const customFieldMembers = manifestMembersByType.get("CustomField") || [];
  const hasCustomFieldScope = manifestMembersByType.has("CustomField");
  const includeAllCustomFields = customFieldMembers.includes("*");
  const customFieldAllowSet = includeAllCustomFields ? null : new Set(customFieldMembers);

  const excludedStandardFieldSet =
    excludedStandardFields instanceof Set ? excludedStandardFields : new Set();

  const objectInScope =
    !hasCustomObjectScope || includeAllObjects || (objectAllowSet && objectAllowSet.has(objectName));

  if (objectInScope) {
    for (let child = root.firstChild; child; ) {
      const next = child.nextSibling;
      if (child.nodeType === 1 && elementName(child) === "picklistValues") {
        const picklistName = getFirstChildText(child, "picklist");
        if (!picklistName) {
          child = next;
          continue;
        }
        const fullFieldName = `${objectName}.${picklistName}`;
        const normalizedFieldName = normalizeActivityFieldName(fullFieldName);
        const isCustomField = picklistName.includes("__");

        let remove = false;
        if (isCustomField) {
          if (!hasCustomFieldScope) {
            remove = true;
          } else if (!includeAllCustomFields && customFieldAllowSet && !customFieldAllowSet.has(normalizedFieldName)) {
            remove = true;
          }
        } else if (
          excludedStandardFieldSet.has(fullFieldName) ||
          excludedStandardFieldSet.has(normalizedFieldName)
        ) {
          remove = true;
        }

        if (remove) {
          root.removeChild(child);
        }
      }
      child = next;
    }
  }

  const serialized = serializeXml(doc);
  summary.writtenFiles += 1;
  if (serialized !== original) {
    summary.changedFiles += 1;
  }
  fs.writeFileSync(filePath, serialized, "utf8");
}

function removePath(targetPath, summary) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  const stat = fs.statSync(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
  if (stat.isDirectory()) {
    summary.deletedDirs += 1;
  } else {
    summary.deletedFiles += 1;
  }
}

function deleteUnlistedFilesInObjectSubdir({
  objectsDir,
  objectName,
  relativeDir,
  suffix,
  allowSet,
  summary,
}) {
  const dirPath = path.join(objectsDir, objectName, relativeDir);
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) {
      continue;
    }
    summary.scannedFiles += 1;
    const memberName = entry.name.slice(0, -suffix.length);
    if (!allowSet || !allowSet.has(memberName)) {
      removePath(path.join(dirPath, entry.name), summary);
    }
  }
}

function listObjectDirs(objectsDir) {
  if (!fs.existsSync(objectsDir)) {
    return [];
  }
  return fs
    .readdirSync(objectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function parseObjectNameFromExternalFile(typeName, fileName) {
  if (typeName === "Layout" || typeName === "CustomObjectTranslation") {
    const idx = fileName.indexOf("-");
    if (idx <= 0) {
      return null;
    }
    return fileName.slice(0, idx);
  }
  if (typeName === "QuickAction") {
    if (!fileName.includes(".")) {
      return null;
    }
    return fileName.split(".", 1)[0];
  }
  if (typeName === "SharingRules" || typeName === "TopicsForObjects") {
    return fileName;
  }
  if (typeName === "AssignmentRules" || typeName === "AutoResponseRules") {
    return fileName;
  }
  if (typeName === "CustomTab") {
    return fileName.endsWith("__c") ? fileName : null;
  }
  return null;
}

function sortObjectActionOverrides(objectMetaPath) {
  if (!fs.existsSync(objectMetaPath)) {
    return { changed: false, scanned: false };
  }

  const original = fs.readFileSync(objectMetaPath, "utf8");
  const doc = parseXml(original);
  const root = doc.documentElement;
  if (!root || elementName(root) !== "CustomObject") {
    return { changed: false, scanned: true };
  }

  sortDirectChildElements(root, "actionOverrides", (itemElement) => {
    const actionName = getFirstChildText(itemElement, "actionName");
    const formFactor = getFirstChildText(itemElement, "formFactor");
    const pageOrSobjectType = getFirstChildText(itemElement, "pageOrSobjectType");
    const recordType = getFirstChildText(itemElement, "recordType");
    const profile = getFirstChildText(itemElement, "profile");
    const type = getFirstChildText(itemElement, "type");
    return `${actionName}|${formFactor}|${pageOrSobjectType}|${recordType}|${profile}|${type}`;
  });

  const serialized = serializeXml(doc);
  const changed = serialized !== original;
  fs.writeFileSync(objectMetaPath, serialized, "utf8");
  return { changed, scanned: true };
}

function filterSharingRulesFile({
  sharingRulesFilePath,
  criteriaAllowSet,
  ownerAllowSet,
  filterCriteriaRules,
  filterOwnerRules,
  summary,
}) {
  if (!fs.existsSync(sharingRulesFilePath)) {
    return;
  }

  summary.scannedFiles += 1;
  const original = fs.readFileSync(sharingRulesFilePath, "utf8");
  const doc = parseXml(original);
  const root = doc.documentElement;
  if (!root || elementName(root) !== "SharingRules") {
    return;
  }

  if (filterCriteriaRules || filterOwnerRules) {
    for (let child = root.firstChild; child; ) {
      const next = child.nextSibling;
      if (child.nodeType === 1) {
        const childTag = elementName(child);
        if (childTag === "sharingCriteriaRules" && filterCriteriaRules) {
          const fullName = getFirstChildText(child, "fullName");
          if (!criteriaAllowSet || !criteriaAllowSet.has(fullName)) {
            root.removeChild(child);
          }
        } else if (childTag === "sharingOwnerRules" && filterOwnerRules) {
          const fullName = getFirstChildText(child, "fullName");
          if (!ownerAllowSet || !ownerAllowSet.has(fullName)) {
            root.removeChild(child);
          }
        }
      }
      child = next;
    }
  }

  const serialized = serializeXml(doc);
  summary.writtenFiles += 1;
  if (serialized !== original) {
    summary.changedFiles += 1;
  }
  fs.writeFileSync(sharingRulesFilePath, serialized, "utf8");
}

function filterObjectRuleFileByFullName({
  filePath,
  rootElementName,
  ruleElementName,
  allowSet,
  shouldFilter,
  summary,
}) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  summary.scannedFiles += 1;
  const original = fs.readFileSync(filePath, "utf8");
  const doc = parseXml(original);
  const root = doc.documentElement;
  if (!root || elementName(root) !== rootElementName) {
    return;
  }

  if (shouldFilter) {
    for (let child = root.firstChild; child; ) {
      const next = child.nextSibling;
      if (child.nodeType === 1 && elementName(child) === ruleElementName) {
        const fullName = getFirstChildText(child, "fullName");
        if (!allowSet || !allowSet.has(fullName)) {
          root.removeChild(child);
        }
      }
      child = next;
    }
  }

  const serialized = serializeXml(doc);
  summary.writtenFiles += 1;
  if (serialized !== original) {
    summary.changedFiles += 1;
  }
  fs.writeFileSync(filePath, serialized, "utf8");
}

function includeObjectScopedMember(manifestMembersByType, typeName, memberName) {
  if (!manifestMembersByType.has(typeName)) {
    return false;
  }
  const members = manifestMembersByType.get(typeName) || [];
  if (members.includes("*")) {
    return true;
  }
  if (members.includes(memberName)) {
    return true;
  }

  // package.xml can contain percent-encoded members (for example "%26" for "&").
  const decodeSafely = (value) => {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  };
  const normalizedTarget = decodeSafely(memberName);
  return members.some((candidate) => decodeSafely(candidate) === normalizedTarget);
}

function collapseSingleCommentElements(xmlText) {
  return String(xmlText || "").replace(
    /<([A-Za-z0-9_:-]+)>\n\s*<!--([\s\S]*?)-->\n\s*<\/\1>/g,
    "<$1><!--$2--></$1>"
  );
}

function filterCustomObjectTranslationFile({
  filePath,
  objectName,
  manifestMembersByType,
  excludedStandardFields,
  summary,
}) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  summary.scannedFiles += 1;
  const original = fs.readFileSync(filePath, "utf8");
  const doc = parseXml(original);
  const root = doc.documentElement;
  if (!root || elementName(root) !== "CustomObjectTranslation") {
    return;
  }

  const hasLayoutType = manifestMembersByType.has("Layout");
  const hasWebLinkType = manifestMembersByType.has("WebLink");
  const hasRecordTypeType = manifestMembersByType.has("RecordType");
  const hasValidationRuleType = manifestMembersByType.has("ValidationRule");
  const hasSharingReasonType = manifestMembersByType.has("SharingReason");
  const hasFieldSetType = manifestMembersByType.has("FieldSet");
  const hasQuickActionType = manifestMembersByType.has("QuickAction");
  const hasWorkflowTaskType = manifestMembersByType.has("WorkflowTask");

  for (let child = root.firstChild; child; ) {
    const next = child.nextSibling;
    if (child.nodeType !== 1) {
      child = next;
      continue;
    }

    const tag = elementName(child);
    if (tag === "layouts" && hasLayoutType) {
      const layoutName = getFirstChildText(child, "layout");
      if (layoutName) {
        const memberName = `${objectName}-${layoutName}`;
        if (!includeObjectScopedMember(manifestMembersByType, "Layout", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "webLinks" && hasWebLinkType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "WebLink", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "recordTypes" && hasRecordTypeType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "RecordType", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "validationRules" && hasValidationRuleType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "ValidationRule", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "sharingReasons" && hasSharingReasonType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "SharingReason", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "fieldSets" && hasFieldSetType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "FieldSet", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "quickActions" && hasQuickActionType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "QuickAction", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "workflowTasks" && hasWorkflowTaskType) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const memberName = `${objectName}.${name}`;
        if (!includeObjectScopedMember(manifestMembersByType, "WorkflowTask", memberName)) {
          root.removeChild(child);
        }
      }
    } else if (tag === "standardFields" && excludedStandardFields.size > 0) {
      const name = getFirstChildText(child, "name");
      if (name) {
        const fullFieldName = `${objectName}.${name}`;
        const normalizedFieldName = normalizeActivityFieldName(fullFieldName);
        if (
          excludedStandardFields.has(fullFieldName) ||
          excludedStandardFields.has(normalizedFieldName)
        ) {
          root.removeChild(child);
        }
      }
    }

    child = next;
  }

  const serialized = collapseSingleCommentElements(serializeXml(doc));
  summary.writtenFiles += 1;
  if (serialized !== original) {
    summary.changedFiles += 1;
  }
  fs.writeFileSync(filePath, serialized, "utf8");
}

function pruneObjectTranslationFolder({
  folderPath,
  objectName,
  manifestMembersByType,
  hasCustomFieldType,
  customFieldAllowByObject,
  summary,
  excludedStandardFields,
}) {
  if (!fs.existsSync(folderPath)) {
    return;
  }
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(folderPath, entry.name);
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".fieldTranslation-meta.xml")) {
      summary.scannedFiles += 1;
      const fieldName = entry.name.slice(0, -".fieldTranslation-meta.xml".length);
      const isCustomField = fieldName.includes("__");
      if (isCustomField) {
        if (!hasCustomFieldType) {
          removePath(filePath, summary);
          continue;
        }
        const allowSet = customFieldAllowByObject.get(objectName);
        const fullFieldName = `${objectName}.${fieldName}`;
        const normalizedFieldName = normalizeActivityFieldName(fullFieldName);
        const included =
          allowSet &&
          (allowSet.has(fieldName) || allowSet.has(fullFieldName) || allowSet.has(normalizedFieldName));
        if (!included) {
          removePath(filePath, summary);
        }
      } else {
        const fullFieldName = `${objectName}.${fieldName}`;
        const normalizedFieldName = normalizeActivityFieldName(fullFieldName);
        const excludedStandard =
          excludedStandardFields.has(fullFieldName) || excludedStandardFields.has(normalizedFieldName);
        if (excludedStandard) {
          removePath(filePath, summary);
        }
      }
      continue;
    }
    if (entry.name.endsWith(".objectTranslation-meta.xml")) {
      filterCustomObjectTranslationFile({
        filePath,
        objectName,
        manifestMembersByType,
        excludedStandardFields,
        summary,
      });
    }
  }
}

function pruneObjectTranslationDirectories({
  rootDir,
  manifestMembersByType,
  hasCustomObjectType,
  objectAllowSet,
  summary,
  excludedStandardFields,
}) {
  const objectTranslationsDir = path.join(rootDir, "objectTranslations");
  if (!fs.existsSync(objectTranslationsDir)) {
    return;
  }
  const hasTranslationType = manifestMembersByType.has("CustomObjectTranslation");
  const translationMembers = manifestMembersByType.get("CustomObjectTranslation") || [];
  const includeAllTranslations = translationMembers.includes("*");
  const translationAllowSet = includeAllTranslations ? null : new Set(translationMembers);

  const hasCustomFieldType = manifestMembersByType.has("CustomField");
  const customFieldAllowByObject = buildObjectChildAllowMap(manifestMembersByType, "CustomField");

  const entries = fs.readdirSync(objectTranslationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const localeMemberName = entry.name;
    const idx = localeMemberName.indexOf("-");
    const objectName = idx > 0 ? localeMemberName.slice(0, idx) : null;
    const folderPath = path.join(objectTranslationsDir, entry.name);
    if (!objectName) {
      removePath(folderPath, summary);
      continue;
    }
    summary.scannedFiles += 1;
    if (hasCustomObjectType && !objectAllowSet.has(objectName)) {
      removePath(folderPath, summary);
      continue;
    }
    if (!hasTranslationType) {
      removePath(folderPath, summary);
      continue;
    }
    if (translationAllowSet && !translationAllowSet.has(localeMemberName)) {
      removePath(folderPath, summary);
      continue;
    }
    pruneObjectTranslationFolder({
      folderPath,
      objectName,
      manifestMembersByType,
      hasCustomFieldType,
      customFieldAllowByObject,
      summary,
      excludedStandardFields,
    });
  }
}

function deleteExternalObjectScopedFiles({
  rootDir,
  manifestMembersByType,
  objectAllowSet,
  typeName,
  relativeDir,
  suffix,
  summary,
}) {
  const dirPath = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const hasType = manifestMembersByType.has(typeName);
  const typeMembers = new Set(manifestMembersByType.get(typeName) || []);
  const includeAllMembers = typeMembers.has("*");
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) {
      continue;
    }
    summary.scannedFiles += 1;
    const memberName = entry.name.slice(0, -suffix.length);
    const objectName = parseObjectNameFromExternalFile(typeName, memberName);
    // Layouts can have pseudo-object prefixes (for example CaseClose-...,
    // CaseInteraction-..., Global-...) that are not CustomObject members.
    // For Layout, drive filtering by explicit Layout members instead.
    if (objectName && objectAllowSet && typeName !== "Layout" && !objectAllowSet.has(objectName)) {
      removePath(path.join(dirPath, entry.name), summary);
      continue;
    }
    if (!hasType) {
      removePath(path.join(dirPath, entry.name), summary);
      continue;
    }
    if (!includeAllMembers && !typeMembers.has(memberName)) {
      removePath(path.join(dirPath, entry.name), summary);
    }
  }
}

async function runObjectsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "objects",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    deletedFiles: 0,
    deletedDirs: 0,
    skipped: false,
  };

  const rootDir = path.join(forceAppDir, "main", "default");
  const objectsDir = path.join(rootDir, "objects");
  const optionalProcessing = resolveOptionalProcessing(config);
  const shouldSortObjectActionOverrides = optionalProcessing.sortObjectActionOverrides;
  if (!fs.existsSync(rootDir)) {
    summary.skipped = true;
    return summary;
  }

  const hasCustomObjectType = manifestMembersByType.has("CustomObject");
  const objectAllowSet = new Set(manifestMembersByType.get("CustomObject") || []);
  const objectDirs = listObjectDirs(objectsDir);
  for (const objectName of objectDirs) {
    if (!hasCustomObjectType || !objectAllowSet.has(objectName)) {
      removePath(path.join(objectsDir, objectName), summary);
    }
  }

  const remainingObjectDirs = listObjectDirs(objectsDir);
  const childMappings = [
    { typeName: "CustomField", relativeDir: "fields", suffix: ".field-meta.xml" },
    { typeName: "BusinessProcess", relativeDir: "businessProcesses", suffix: ".businessProcess-meta.xml" },
    { typeName: "CompactLayout", relativeDir: "compactLayouts", suffix: ".compactLayout-meta.xml" },
    { typeName: "FieldSet", relativeDir: "fieldSets", suffix: ".fieldSet-meta.xml" },
    { typeName: "ListView", relativeDir: "listViews", suffix: ".listView-meta.xml" },
    { typeName: "RecordType", relativeDir: "recordTypes", suffix: ".recordType-meta.xml" },
    { typeName: "SharingReason", relativeDir: "sharingReasons", suffix: ".sharingReason-meta.xml" },
    { typeName: "ValidationRule", relativeDir: "validationRules", suffix: ".validationRule-meta.xml" },
    { typeName: "WebLink", relativeDir: "webLinks", suffix: ".webLink-meta.xml" },
  ];

  for (const mapping of childMappings) {
    const hasType = manifestMembersByType.has(mapping.typeName);
    const allowByObject = buildObjectChildAllowMap(manifestMembersByType, mapping.typeName);
    for (const objectName of remainingObjectDirs) {
      const allowSet = hasType ? allowByObject.get(objectName) || null : null;
      deleteUnlistedFilesInObjectSubdir({
        objectsDir,
        objectName,
        relativeDir: mapping.relativeDir,
        suffix: mapping.suffix,
        allowSet,
        summary,
      });
    }
  }

  const excludedStandardFields = new Set(
    (config && config.processingRules && Array.isArray(config.processingRules.excludeStandardFields)
      ? config.processingRules.excludeStandardFields
      : []
    ).map((value) => String(value || "").trim())
  );
  const hasRecordTypeType = manifestMembersByType.has("RecordType");
  if (hasRecordTypeType) {
    for (const objectName of remainingObjectDirs) {
      const dirPath = path.join(objectsDir, objectName, "recordTypes");
      if (!fs.existsSync(dirPath)) {
        continue;
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".recordType-meta.xml")) {
          continue;
        }
        filterRecordTypePicklistValuesFile({
          filePath: path.join(dirPath, entry.name),
          objectName,
          manifestMembersByType,
          excludedStandardFields,
          summary,
        });
      }
    }
  }

  const externalMappings = [
    { typeName: "Layout", relativeDir: "layouts", suffix: ".layout-meta.xml" },
    { typeName: "QuickAction", relativeDir: "quickActions", suffix: ".quickAction-meta.xml" },
    { typeName: "CustomObjectTranslation", relativeDir: "objectTranslations", suffix: ".objectTranslation-meta.xml" },
    { typeName: "SharingRules", relativeDir: "sharingRules", suffix: ".sharingRules-meta.xml" },
    { typeName: "AssignmentRules", relativeDir: "assignmentRules", suffix: ".assignmentRules-meta.xml" },
    { typeName: "AutoResponseRules", relativeDir: "autoResponseRules", suffix: ".autoResponseRules-meta.xml" },
    { typeName: "TopicsForObjects", relativeDir: "topicsForObjects", suffix: ".topicsForObjects-meta.xml" },
    { typeName: "CustomTab", relativeDir: "tabs", suffix: ".tab-meta.xml" },
  ];

  for (const mapping of externalMappings) {
    deleteExternalObjectScopedFiles({
      rootDir,
      manifestMembersByType,
      objectAllowSet: hasCustomObjectType ? objectAllowSet : null,
      typeName: mapping.typeName,
      relativeDir: mapping.relativeDir,
      suffix: mapping.suffix,
      summary,
    });
  }

  pruneObjectTranslationDirectories({
    rootDir,
    manifestMembersByType,
    hasCustomObjectType,
    objectAllowSet,
    summary,
    excludedStandardFields,
  });

  const hasSharingRulesType = manifestMembersByType.has("SharingRules");
  const hasSharingCriteriaType = manifestMembersByType.has("SharingCriteriaRule");
  const hasSharingOwnerType = manifestMembersByType.has("SharingOwnerRule");
  if (hasSharingRulesType && (hasSharingCriteriaType || hasSharingOwnerType)) {
    const criteriaAllowByObject = hasSharingCriteriaType
      ? buildObjectChildAllowMap(manifestMembersByType, "SharingCriteriaRule")
      : new Map();
    const ownerAllowByObject = hasSharingOwnerType
      ? buildObjectChildAllowMap(manifestMembersByType, "SharingOwnerRule")
      : new Map();
    const sharingRulesDir = path.join(rootDir, "sharingRules");
    if (fs.existsSync(sharingRulesDir)) {
      const entries = fs.readdirSync(sharingRulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".sharingRules-meta.xml")) {
          continue;
        }
        const objectName = entry.name.slice(0, -".sharingRules-meta.xml".length);
        if (hasCustomObjectType && !objectAllowSet.has(objectName)) {
          continue;
        }
        const criteriaAllowSet = hasSharingCriteriaType ? criteriaAllowByObject.get(objectName) || new Set() : null;
        const ownerAllowSet = hasSharingOwnerType ? ownerAllowByObject.get(objectName) || new Set() : null;
        filterSharingRulesFile({
          sharingRulesFilePath: path.join(sharingRulesDir, entry.name),
          criteriaAllowSet,
          ownerAllowSet,
          filterCriteriaRules: hasSharingCriteriaType,
          filterOwnerRules: hasSharingOwnerType,
          summary,
        });
      }
    }
  }

  const hasAssignmentRulesType = manifestMembersByType.has("AssignmentRules");
  const hasAssignmentRuleType = manifestMembersByType.has("AssignmentRule");
  if (hasAssignmentRulesType && hasAssignmentRuleType) {
    const assignmentAllowByObject = buildObjectChildAllowMap(manifestMembersByType, "AssignmentRule");
    const dirPath = path.join(rootDir, "assignmentRules");
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".assignmentRules-meta.xml")) {
          continue;
        }
        const objectName = entry.name.slice(0, -".assignmentRules-meta.xml".length);
        if (hasCustomObjectType && !objectAllowSet.has(objectName)) {
          continue;
        }
        const allowSet = assignmentAllowByObject.get(objectName) || new Set();
        filterObjectRuleFileByFullName({
          filePath: path.join(dirPath, entry.name),
          rootElementName: "AssignmentRules",
          ruleElementName: "assignmentRule",
          allowSet,
          shouldFilter: true,
          summary,
        });
      }
    }
  }

  const hasAutoResponseRulesType = manifestMembersByType.has("AutoResponseRules");
  const hasAutoResponseRuleType = manifestMembersByType.has("AutoResponseRule");
  if (hasAutoResponseRulesType && hasAutoResponseRuleType) {
    const autoResponseAllowByObject = buildObjectChildAllowMap(manifestMembersByType, "AutoResponseRule");
    const dirPath = path.join(rootDir, "autoResponseRules");
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".autoResponseRules-meta.xml")) {
          continue;
        }
        const objectName = entry.name.slice(0, -".autoResponseRules-meta.xml".length);
        if (hasCustomObjectType && !objectAllowSet.has(objectName)) {
          continue;
        }
        const allowSet = autoResponseAllowByObject.get(objectName) || new Set();
        filterObjectRuleFileByFullName({
          filePath: path.join(dirPath, entry.name),
          rootElementName: "AutoResponseRules",
          ruleElementName: "autoResponseRule",
          allowSet,
          shouldFilter: true,
          summary,
        });
      }
    }
  }

  if (shouldSortObjectActionOverrides) {
    for (const objectName of remainingObjectDirs) {
      const objectMetaPath = path.join(objectsDir, objectName, `${objectName}.object-meta.xml`);
      const result = sortObjectActionOverrides(objectMetaPath);
      if (!result.scanned) {
        continue;
      }
      summary.scannedFiles += 1;
      summary.writtenFiles += 1;
      if (result.changed) {
        summary.changedFiles += 1;
      }
    }
  }

  return summary;
}

module.exports = {
  id: "objects",
  run: runObjectsTransform,
};
