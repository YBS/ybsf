const fs = require("fs");
const path = require("path");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function salesforceLexSort(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function writePackageXml({ outputPath, apiVersion, typeMembersMap }) {
  const typeNames = Array.from(typeMembersMap.keys()).sort(salesforceLexSort);
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Package xmlns="http://soap.sforce.com/2006/04/metadata">');
  for (const typeName of typeNames) {
    const members = Array.from(typeMembersMap.get(typeName) || []).sort(salesforceLexSort);
    if (members.length === 0) {
      continue;
    }
    lines.push("  <types>");
    for (const member of members) {
      lines.push(`    <members>${escapeXml(member)}</members>`);
    }
    lines.push(`    <name>${escapeXml(typeName)}</name>`);
    lines.push("  </types>");
  }
  lines.push(`  <version>${escapeXml(apiVersion)}</version>`);
  lines.push("</Package>");

  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  writePackageXml,
};
