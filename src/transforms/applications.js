const fs = require("fs");
const path = require("path");
const {
  listFilesWithSuffix,
  getMemberName,
  getTypeInfo,
  isMemberIncluded,
} = require("./helpers/xml-utils");
const {
  parseXml,
  elementName,
  getFirstChildText,
  sortDirectChildElements,
  serializeXml,
} = require("./helpers/dom-xml");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function actionOverrideSortKey(node) {
  const action = getFirstChildText(node, "actionName");
  const content = getFirstChildText(node, "content");
  const formFactor = getFirstChildText(node, "formFactor");
  const pageOrSobjectType = getFirstChildText(node, "pageOrSobjectType");
  const recordType = getFirstChildText(node, "recordType");
  const profile = getFirstChildText(node, "profile");
  return `${action}-${content}-${formFactor}-${pageOrSobjectType}-${recordType}-${profile}`;
}

function includeProfileActionOverride(node, manifestMembersByType) {
  const flexiPageName = getFirstChildText(node, "content");
  const recordTypeName = getFirstChildText(node, "recordType");
  const profileName = getFirstChildText(node, "profile");

  if (flexiPageName && !isMemberIncluded(manifestMembersByType, "FlexiPage", flexiPageName)) {
    return false;
  }
  if (recordTypeName && !isMemberIncluded(manifestMembersByType, "RecordType", recordTypeName)) {
    return false;
  }
  if (profileName && !isMemberIncluded(manifestMembersByType, "Profile", profileName)) {
    return false;
  }
  return true;
}

function getDirectChildrenByTag(parentNode, tagName) {
  const out = [];
  if (!parentNode) {
    return out;
  }
  for (let child = parentNode.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) {
      continue;
    }
    if (elementName(child) === tagName) {
      out.push(child);
    }
  }
  return out;
}

async function runApplicationsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "applications",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  const { hasType, includeAll, allowSet } = getTypeInfo(manifestMembersByType, "CustomApplication");
  if (!hasType) {
    summary.skipped = true;
    return summary;
  }

  const dirPath = path.join(forceAppDir, "main", "default", "applications");
  const files = listFilesWithSuffix(dirPath, ".app-meta.xml");
  const optionalProcessing = resolveOptionalProcessing(config);
  const sortApplicationOverrides = optionalProcessing.sortApplicationOverrides;

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".app-meta.xml");
    if (!memberName) {
      continue;
    }
    if (!includeAll && !allowSet.has(memberName)) {
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const doc = parseXml(xml);
    const root = doc && doc.documentElement;
    if (!root || elementName(root) !== "CustomApplication") {
      continue;
    }
    if (sortApplicationOverrides) {
      sortDirectChildElements(root, "actionOverrides", actionOverrideSortKey);
      sortDirectChildElements(root, "profileActionOverrides", actionOverrideSortKey);
    }
    let removedCount = 0;
    for (const profileActionOverride of getDirectChildrenByTag(root, "profileActionOverrides")) {
      const keep = includeProfileActionOverride(profileActionOverride, manifestMembersByType);
      if (!keep) {
        root.removeChild(profileActionOverride);
        removedCount += 1;
      }
    }
    const cleaned = serializeXml(doc);

    summary.scannedFiles += 1;
    summary.writtenFiles += 1;
    summary.removedEntries += removedCount;
    if (cleaned !== xml) {
      summary.changedFiles += 1;
    }

    fs.writeFileSync(filePath, cleaned, "utf8");
  }

  return summary;
}

module.exports = {
  id: "applications",
  run: runApplicationsTransform,
};
