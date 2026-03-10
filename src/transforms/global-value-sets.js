const fs = require("fs");
const path = require("path");
const {
  listFilesWithSuffix,
  getMemberName,
  getTypeInfo,
} = require("./helpers/xml-utils");
const { parseXml, getFirstChildText, elementName, serializeXml } = require("./helpers/dom-xml");
const { resolveOptionalProcessing } = require("../config/optional-processing");

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

function sortInactiveCustomValues(root) {
  const sortedValue = getFirstChildText(root, "sorted");
  if (String(sortedValue).toLowerCase() === "true") {
    return;
  }

  const customValues = getDirectChildrenByTag(root, "customValue");
  if (customValues.length === 0) {
    return;
  }
  const inactive = [];
  const active = [];
  for (const node of customValues) {
    const isActiveValue = getFirstChildText(node, "isActive");
    if (String(isActiveValue).toLowerCase() === "false") {
      inactive.push(node);
    } else {
      active.push(node);
    }
  }
  if (inactive.length === 0) {
    return;
  }
  inactive.sort((a, b) => {
    const keyA = getFirstChildText(a, "fullName");
    const keyB = getFirstChildText(b, "fullName");
    return keyA.localeCompare(keyB);
  });

  const allNodes = [];
  for (let node = root.firstChild; node; node = node.nextSibling) {
    allNodes.push(node);
  }
  const customValueSet = new Set(customValues);
  const firstCustomIndex = allNodes.findIndex((node) => customValueSet.has(node));
  if (firstCustomIndex < 0) {
    return;
  }

  const rebuilt = [];
  let inserted = false;
  for (const node of allNodes) {
    if (customValueSet.has(node)) {
      if (!inserted) {
        rebuilt.push(...active, ...inactive);
        inserted = true;
      }
      continue;
    }
    rebuilt.push(node);
  }
  for (const node of allNodes) {
    root.removeChild(node);
  }
  for (const node of rebuilt) {
    root.appendChild(node);
  }
}

async function runGlobalValueSetsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "globalValueSets",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  const { hasType, includeAll, allowSet } = getTypeInfo(manifestMembersByType, "GlobalValueSet");
  if (!hasType) {
    summary.skipped = true;
    return summary;
  }

  const dirPath = path.join(forceAppDir, "main", "default", "globalValueSets");
  const files = listFilesWithSuffix(dirPath, ".globalValueSet-meta.xml");
  const optionalProcessing = resolveOptionalProcessing(config);
  const sortGlobalValueSetInactiveValues = optionalProcessing.sortGlobalValueSetInactiveValues;

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".globalValueSet-meta.xml");
    if (!memberName) {
      continue;
    }
    if (!includeAll && !allowSet.has(memberName)) {
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const doc = parseXml(xml);
    const root = doc && doc.documentElement;
    if (!root || elementName(root) !== "GlobalValueSet") {
      continue;
    }
    if (sortGlobalValueSetInactiveValues) {
      sortInactiveCustomValues(root);
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
  id: "globalValueSets",
  run: runGlobalValueSetsTransform,
};
