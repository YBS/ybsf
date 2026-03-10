const fs = require("fs");
const path = require("path");
const { runConvertConfig } = require("./convert-config");
const { runNormalizeConfig } = require("./normalize-config");
const { DEFAULT_PSEUDO_OBJECT_SCOPES } = require("../config/pseudo-object-scopes");
const { OPTIONAL_PROCESSING_DEFAULTS } = require("../config/optional-processing");

function exists(p) {
  return fs.existsSync(p);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJsonFile(filePath, value, force) {
  if (exists(filePath) && !force) {
    return false;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return true;
}

function detectLegacyLayout(cwd) {
  const inSfdcDir =
    exists(path.join(cwd, "sfdc", "salesforce.properties")) &&
    exists(path.join(cwd, "sfdc", "includePackage.xml")) &&
    exists(path.join(cwd, "sfdc", "ignorePackage.xml"));

  const inRootDir =
    exists(path.join(cwd, "salesforce.properties")) &&
    exists(path.join(cwd, "includePackage.xml")) &&
    exists(path.join(cwd, "ignorePackage.xml"));

  if (inSfdcDir) {
    return {
      isLegacy: true,
      inputDir: path.join(cwd, "sfdc"),
      mode: "legacy-sfdc-subdir",
    };
  }
  if (inRootDir) {
    return {
      isLegacy: true,
      inputDir: cwd,
      mode: "legacy-root",
    };
  }
  return {
    isLegacy: false,
    inputDir: null,
    mode: "empty-or-nonlegacy",
  };
}

function ensureProjectScaffold(cwd, apiVersion, force) {
  const sfdxProjectPath = path.join(cwd, "sfdx-project.json");
  const projectJson = {
    packageDirectories: [
      {
        path: "force-app",
        default: true,
      },
    ],
    namespace: "",
    sourceApiVersion: apiVersion,
  };
  const projectCreatedOrUpdated = writeJsonFile(sfdxProjectPath, projectJson, force);

  ensureDir(path.join(cwd, "force-app", "main", "default"));
  ensureDir(path.join(cwd, "manifest"));

  return {
    sfdxProjectPath,
    projectCreatedOrUpdated,
  };
}

async function runInitProject({
  cwd,
  apiVersion,
  targetOrg,
  force,
  status,
  debug = false,
  includeManagedPackages = false,
  includeUnlockedPackages = false,
}) {
  const root = path.resolve(cwd || ".");
  const legacy = detectLegacyLayout(root);
  const scaffold = ensureProjectScaffold(root, apiVersion, force);

  let converted = false;
  let convertResult = null;
  let normalizeResult = null;
  if (legacy.isLegacy) {
    convertResult = await runConvertConfig({
      inputDir: legacy.inputDir,
      outputDir: root,
      targetOrg: targetOrg || null,
      apiVersion,
      force,
      debug,
      includeManagedPackages,
      includeUnlockedPackages,
      status,
    });
    converted = true;
    normalizeResult = await runNormalizeConfig({
      configPath: path.join(root, "ybsf-metadata-config.json"),
      targetOrg: targetOrg || null,
      initMode: false,
      debug,
      status,
      discoveredByType: convertResult && convertResult.discoveredByType instanceof Map
        ? convertResult.discoveredByType
        : undefined,
      includeManagedPackages,
      includeUnlockedPackages,
    });
  } else {
    const configPath = path.join(root, "ybsf-metadata-config.json");
    const created = writeJsonFile(
      configPath,
      {
        version: 1,
        apiVersion,
        metadataTypes: [],
        packageRules: {
          includeManagedPackages: Boolean(includeManagedPackages),
          includeUnlockedPackages: Boolean(includeUnlockedPackages),
          namespaces: [],
        },
        processingRules: {
          userPermissionsPolicy: {
            mode: "all",
            members: [],
          },
          excludeStandardFields: [],
          includePseudoObjects: DEFAULT_PSEUDO_OBJECT_SCOPES.slice(),
          optionalProcessing: { ...OPTIONAL_PROCESSING_DEFAULTS },
        },
      },
      force
    );
    if (created || exists(configPath)) {
      normalizeResult = await runNormalizeConfig({
        configPath,
        targetOrg: targetOrg || null,
        initMode: true,
        debug,
        includeManagedPackages,
        includeUnlockedPackages,
        status,
      });
    }
  }

  return {
    cwd: root,
    mode: legacy.mode,
    converted,
    convertResult,
    normalizeResult,
    scaffold,
  };
}

module.exports = {
  runInitProject,
};
