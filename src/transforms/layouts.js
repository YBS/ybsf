const fs = require("fs");
const path = require("path");
const {
  listFilesWithSuffix,
  getMemberName,
  getTypeInfo,
} = require("./helpers/xml-utils");
const {
  parseXml,
  elementName,
  getFirstChildText,
  sortDirectChildElements,
  serializeXml,
} = require("./helpers/dom-xml");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function platformActionSortKey(itemElement) {
  const sortOrder = getFirstChildText(itemElement, "sortOrder");
  const numeric = Number.parseInt(sortOrder, 10);
  if (Number.isNaN(numeric)) {
    return String(sortOrder || "");
  }
  return String(numeric).padStart(10, "0");
}

function walkElements(node, out) {
  if (!node) {
    return;
  }
  if (node.nodeType === 1) {
    out.push(node);
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkElements(child, out);
  }
}

async function runLayoutsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "layouts",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  const { hasType, includeAll, allowSet } = getTypeInfo(manifestMembersByType, "Layout");
  if (!hasType) {
    summary.skipped = true;
    return summary;
  }

  const dirPath = path.join(forceAppDir, "main", "default", "layouts");
  const files = listFilesWithSuffix(dirPath, ".layout-meta.xml");
  const optionalProcessing = resolveOptionalProcessing(config);
  const sortLayoutPlatformActionListItems = optionalProcessing.sortLayoutPlatformActionListItems;

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".layout-meta.xml");
    if (!memberName) {
      continue;
    }
    if (!includeAll && !allowSet.has(memberName)) {
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const doc = parseXml(xml);
    const allElements = [];
    walkElements(doc.documentElement, allElements);
    if (sortLayoutPlatformActionListItems) {
      for (const element of allElements) {
        if (elementName(element) !== "platformActionList") {
          continue;
        }
        sortDirectChildElements(element, "platformActionListItems", platformActionSortKey);
      }
    }
    const cleaned = serializeXml(doc);

    summary.scannedFiles += 1;
    summary.writtenFiles += 1;
    if (cleaned !== xml) {
      summary.changedFiles += 1;
    }

    fs.writeFileSync(filePath, cleaned, "utf8");
  }

  return summary;
}

module.exports = {
  id: "layouts",
  run: runLayoutsTransform,
};
