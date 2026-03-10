const fs = require("fs");
const path = require("path");
const {
  listFilesWithSuffix,
  getMemberName,
} = require("./helpers/xml-utils");
const {
  parseXml,
  getFirstChildText,
  sortDirectChildElements,
  elementName,
  serializeXml,
} = require("./helpers/dom-xml");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function workflowTimeTriggerSortKey(node) {
  const timeLength = getFirstChildText(node, "timeLength");
  const unit = getFirstChildText(node, "workflowTimeTriggerUnit");
  return `${timeLength}-${unit}`;
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

const WORKFLOW_MEMBER_TYPES = [
  "WorkflowRule",
  "WorkflowAlert",
  "WorkflowFieldUpdate",
  "WorkflowTask",
  "WorkflowOutboundMessage",
];

function collectWorkflowObjectScope(manifestMembersByType) {
  const objectAllowSet = new Set();
  let hasWorkflowScope = false;
  let includeAll = false;

  for (const typeName of WORKFLOW_MEMBER_TYPES) {
    if (!manifestMembersByType.has(typeName)) {
      continue;
    }
    hasWorkflowScope = true;
    const members = manifestMembersByType.get(typeName) || [];
    if (members.includes("*")) {
      includeAll = true;
      continue;
    }
    for (const member of members) {
      const text = String(member || "").trim();
      if (!text) {
        continue;
      }
      if (!text.includes(".")) {
        // Defensive fallback in case future members appear as object-level names.
        objectAllowSet.add(text);
        continue;
      }
      const [objectName] = text.split(".", 1);
      if (objectName) {
        objectAllowSet.add(objectName);
      }
    }
  }

  return { hasWorkflowScope, includeAll, objectAllowSet };
}

async function runWorkflowsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "workflows",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  const { hasWorkflowScope, includeAll, objectAllowSet } = collectWorkflowObjectScope(manifestMembersByType);
  if (!hasWorkflowScope) {
    summary.skipped = true;
    return summary;
  }

  const dirPath = path.join(forceAppDir, "main", "default", "workflows");
  const files = listFilesWithSuffix(dirPath, ".workflow-meta.xml");
  const optionalProcessing = resolveOptionalProcessing(config);
  const sortWorkflowTimeTriggers = optionalProcessing.sortWorkflowTimeTriggers;

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".workflow-meta.xml");
    if (!memberName) {
      continue;
    }
    if (!includeAll && !objectAllowSet.has(memberName)) {
      fs.rmSync(filePath, { force: true });
      summary.scannedFiles += 1;
      summary.writtenFiles += 1;
      summary.removedEntries += 1;
      summary.changedFiles += 1;
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const doc = parseXml(xml);
    const root = doc && doc.documentElement;
    if (root && sortWorkflowTimeTriggers) {
      for (const ruleNode of getDirectChildrenByTag(root, "rules")) {
        sortDirectChildElements(ruleNode, "workflowTimeTriggers", workflowTimeTriggerSortKey);
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
  id: "workflows",
  run: runWorkflowsTransform,
};
