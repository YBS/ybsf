const fs = require("fs");
const path = require("path");
const {
  listFilesWithSuffix,
  getMemberName,
  getTypeInfo,
} = require("./helpers/xml-utils");
const { parseXml, elementName, serializeXml } = require("./helpers/dom-xml");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function removeElementsByName(root, elementNames) {
  const names = new Set((elementNames || []).map((name) => String(name || "")));
  const toRemove = [];

  function walk(node) {
    if (!node) {
      return;
    }
    if (node.nodeType === 1 && names.has(elementName(node))) {
      toRemove.push(node);
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  }

  walk(root);
  for (const node of toRemove) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
  return toRemove.length;
}

async function runSitesTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "sites",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  const { hasType, includeAll, allowSet } = getTypeInfo(manifestMembersByType, "CustomSite");
  if (!hasType) {
    summary.skipped = true;
    return summary;
  }

  const dirPath = path.join(forceAppDir, "main", "default", "sites");
  const files = listFilesWithSuffix(dirPath, ".site-meta.xml");
  const optionalProcessing = resolveOptionalProcessing(config);
  const removeSiteUserDomains = optionalProcessing.removeSiteUserDomains;

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".site-meta.xml");
    if (!memberName) {
      continue;
    }
    if (!includeAll && !allowSet.has(memberName)) {
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const doc = parseXml(xml);
    const root = doc && doc.documentElement;
    const removedCount =
      root && removeSiteUserDomains
        ? removeElementsByName(root, ["siteAdmin", "subdomain", "siteGuestRecordDefaultOwner"])
        : 0;
    const cleaned = removedCount > 0 ? serializeXml(doc) : xml;

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
  id: "sites",
  run: runSitesTransform,
};
