const fs = require("fs");
const path = require("path");

function listFilesWithSuffix(dirPath, suffix) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(dirPath, entry.name));
}

function getMemberName(filePath, suffix) {
  const baseName = path.basename(filePath);
  if (!baseName.endsWith(suffix)) {
    return null;
  }
  return baseName.slice(0, -suffix.length);
}

function getTypeInfo(manifestMembersByType, typeName) {
  const hasType = manifestMembersByType.has(typeName);
  const members = manifestMembersByType.get(typeName) || [];
  const includeAll = members.includes("*");
  const allowSet = includeAll ? null : new Set(members);
  return { hasType, members, includeAll, allowSet };
}

function isMemberIncluded(manifestMembersByType, typeName, memberName) {
  const info = getTypeInfo(manifestMembersByType, typeName);
  if (!info.hasType) {
    return false;
  }
  if (info.includeAll) {
    return true;
  }
  return info.allowSet.has(memberName);
}

module.exports = {
  listFilesWithSuffix,
  getMemberName,
  getTypeInfo,
  isMemberIncluded,
};
