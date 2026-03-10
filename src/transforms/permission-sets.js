const fs = require("fs");
const path = require("path");
const { applyPermissionPolicies } = require("./helpers/user-permissions");
const { getMemberName } = require("./helpers/xml-utils");

function listPermissionSetFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".permissionset-meta.xml"))
    .map((entry) => path.join(dirPath, entry.name));
}

async function runPermissionSetsTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "permissionSets",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  if (!manifestMembersByType.has("PermissionSet")) {
    summary.skipped = true;
    return summary;
  }

  const userPermissionsPolicy =
    config &&
    config.processingRules &&
    config.processingRules.userPermissionsPolicy &&
    typeof config.processingRules.userPermissionsPolicy === "object"
      ? config.processingRules.userPermissionsPolicy
      : { mode: "all", members: [] };
  const excludedStandardFields = new Set(config.processingRules.excludeStandardFields || []);

  const members = manifestMembersByType.get("PermissionSet") || [];
  const includeAll = members.includes("*");
  const allowSet = includeAll ? null : new Set(members);
  const permissionSetsDir = path.join(forceAppDir, "main", "default", "permissionsets");
  const files = listPermissionSetFiles(permissionSetsDir);

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".permissionset-meta.xml");
    if (!memberName) {
      continue;
    }
    if (allowSet && !allowSet.has(memberName)) {
      continue;
    }

    const xml = fs.readFileSync(filePath, "utf8");
    const { cleaned, removedCount, changed } = applyPermissionPolicies(
      xml,
      userPermissionsPolicy,
      manifestMembersByType,
      excludedStandardFields,
      { applyProfileScopeCleanup: false }
    );

    summary.scannedFiles += 1;
    summary.writtenFiles += 1;
    summary.removedEntries += removedCount;
    if (changed) {
      summary.changedFiles += 1;
    }

    fs.writeFileSync(filePath, cleaned, "utf8");
  }

  return summary;
}

module.exports = {
  id: "permissionSets",
  run: runPermissionSetsTransform,
};
