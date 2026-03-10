const fs = require("fs");
const path = require("path");
const { parsePackageXml } = require("../../legacy/parse-package-xml");

function writeDiscoveryProject(discoveryDir, apiVersion) {
  fs.mkdirSync(discoveryDir, { recursive: true });
  const projectFile = {
    packageDirectories: [
      {
        path: "force-app",
        default: true,
      },
    ],
    namespace: "",
    sourceApiVersion: apiVersion,
  };
  fs.writeFileSync(
    path.join(discoveryDir, "sfdx-project.json"),
    `${JSON.stringify(projectFile, null, 2)}\n`,
    "utf8"
  );
  fs.mkdirSync(path.join(discoveryDir, "force-app"), { recursive: true });
}

function buildProjectGenerateManifestArgs({
  targetOrg,
  apiVersion,
  outputDir,
  includeManagedPackages = false,
  includeUnlockedPackages = false,
}) {
  const cmdArgs = [
    "project",
    "generate",
    "manifest",
    "--from-org",
    targetOrg,
    "--output-dir",
    outputDir,
    "--api-version",
    apiVersion,
    "--type",
    "package",
  ];
  if (includeManagedPackages) {
    cmdArgs.push("--include-packages", "managed");
  }
  if (includeUnlockedPackages) {
    cmdArgs.push("--include-packages", "unlocked");
  }
  return cmdArgs;
}

function parseDiscoveredPackageXml(packagePath) {
  const parsed = parsePackageXml(fs.readFileSync(packagePath, "utf8"));
  for (const [typeName, members] of parsed.entries()) {
    parsed.set(
      typeName,
      (members || [])
        .filter((m) => m !== "*")
        .map((m) => String(m || "").trim())
        .filter((m) => m.length > 0)
    );
  }
  return parsed;
}

module.exports = {
  writeDiscoveryProject,
  buildProjectGenerateManifestArgs,
  parseDiscoveredPackageXml,
};
