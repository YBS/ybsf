const fs = require("fs");
const path = require("path");
const { applyPermissionPolicies } = require("./helpers/user-permissions");
const { getMemberName } = require("./helpers/xml-utils");
const { resolveOptionalProcessing } = require("../config/optional-processing");

function listProfileFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".profile-meta.xml"))
    .map((entry) => path.join(dirPath, entry.name));
}

async function runProfilesTransform({ config, manifestMembersByType, forceAppDir }) {
  const summary = {
    id: "profiles",
    scannedFiles: 0,
    writtenFiles: 0,
    changedFiles: 0,
    removedEntries: 0,
    skipped: false,
  };

  if (!manifestMembersByType.has("Profile")) {
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
  const optionalProcessing = resolveOptionalProcessing(config);

  const members = manifestMembersByType.get("Profile") || [];
  const includeAll = members.includes("*");
  const allowSet = includeAll ? null : new Set(members);
  const profilesDir = path.join(forceAppDir, "main", "default", "profiles");
  const files = listProfileFiles(profilesDir);

  for (const filePath of files) {
    const memberName = getMemberName(filePath, ".profile-meta.xml");
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
      {
        applyProfileScopeCleanup: true,
        removeProfileInactiveComponents: optionalProcessing.removeProfileInactiveComponents,
      }
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
  id: "profiles",
  run: runProfilesTransform,
};
