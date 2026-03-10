const path = require("path");
const pkg = require("../package.json");
const { runConvertConfig } = require("./commands/convert-config");
const { runGenerateManifest } = require("./commands/generate-manifest");
const { runNormalizeConfig } = require("./commands/normalize-config");
const { runRetrieve } = require("./commands/retrieve");
const { runInitProject } = require("./commands/init-project");
const { runCompletion } = require("./commands/completion");
const { runDestructivePreview } = require("./commands/destructive-preview");
const { runValidateDeploy } = require("./commands/validate-deploy");
const { runDeploy } = require("./commands/deploy");
const { runDocument } = require("./commands/document");
const { COMMANDS } = require("./command-registry");
const { DEFAULT_API_VERSION } = require("./constants");

const COMMAND_SHORT_FLAG_ALIASES = {
  "convert-config": {
    i: "input-dir",
    d: "output-dir",
    o: "target-org",
    a: "api-version",
    f: "force",
  },
  "init-project": {
    a: "api-version",
    o: "target-org",
    f: "force",
  },
  "generate-manifest": {
    c: "config",
    p: "output",
    o: "target-org",
  },
  "normalize-config": {
    c: "config",
    o: "target-org",
    i: "init-mode",
  },
  retrieve: {
    o: "target-org",
  },
  "destructive-preview": {
    c: "config",
    o: "target-org",
  },
  "validate-deploy": {
    c: "config",
    o: "target-org",
    l: "test-level",
    t: "tests",
  },
  deploy: {
    c: "config",
    o: "target-org",
    l: "test-level",
    t: "tests",
  },
  document: {
    a: "all",
    s: "source-dir",
    d: "output-dir",
    o: "target-org",
  },
};

function printUsage() {
  const commandLines = COMMANDS.map((c) => `  ${c.name.padEnd(20)}${c.description}`);
  console.log(`ybsf - Yellow Brick Systems Salesforce metadata CLI

Usage:
  ybsf <command> [options]

Commands:
${commandLines.join("\n")}
`);
}

function printVersion() {
  console.log(pkg.version);
}

function parseArgs(args, shortAliases = {}) {
  const BOOLEAN_FLAGS = new Set([
    "force",
    "apply-destructive",
    "init-mode",
    "debug",
    "includeManagedPackages",
    "includeUnlockedPackages",
    "all",
  ]);
  const parsed = {
    _: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-") && !token.startsWith("--")) {
      const short = token.substring(1);
      const long = shortAliases[short];
      if (!long) {
        throw new Error(`Unknown short flag: -${short}`);
      }
      if (BOOLEAN_FLAGS.has(long)) {
        parsed[long] = true;
        continue;
      }
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Missing value for -${short}`);
      }
      parsed[long] = next;
      i += 1;
      continue;
    }

    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }

    const key = token.substring(2);
    if (BOOLEAN_FLAGS.has(key)) {
      parsed[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (!next || next.startsWith("-")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function shouldSuppressNonDebugLine(message) {
  const text = String(message || "");
  return /(?:^|[\\/])tmp[\\/]+ybsf-/u.test(text);
}

function statusLogger(debug) {
  return (message) => {
    if (!debug && shouldSuppressNonDebugLine(message)) {
      return;
    }
    console.log(message);
  };
}

function printWarnings(warnings, debug) {
  const list = (warnings || []).filter((warning) => debug || !shouldSuppressNonDebugLine(warning));
  if (list.length === 0) {
    return;
  }
  console.warn(`Warnings (${list.length}):`);
  for (const warning of list) {
    console.warn(`- ${warning}`);
  }
}

async function runCli(args) {
  if (!args || args.length === 0) {
    printUsage();
    return 0;
  }

  const [command, ...rest] = args;
  if (command === "--version" || command === "-v" || command === "version") {
    printVersion();
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  if (command === "convert-config") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["convert-config"]);
    const debug = Boolean(parsed.debug);
    const inputDir = path.resolve(parsed["input-dir"] || ".");
    const outputDir = path.resolve(parsed["output-dir"] || ".");
    const result = await runConvertConfig({
      inputDir,
      outputDir,
      targetOrg: parsed["target-org"] || null,
      apiVersion: parsed["api-version"] || DEFAULT_API_VERSION,
      force: Boolean(parsed.force),
      includeManagedPackages: Boolean(parsed.includeManagedPackages),
      includeUnlockedPackages: Boolean(parsed.includeUnlockedPackages),
      debug,
      status: statusLogger(debug),
    });

    printWarnings(result.warnings, debug);
    console.log(`Wrote config: ${result.outputFile}`);
    if (parsed["target-org"]) {
      console.log(`Target org: ${parsed["target-org"]}`);
    }
    console.log(`Metadata types: ${result.metadataTypeCount}`);
    console.log(`Conflicts resolved with include precedence: ${result.conflictCount}`);
    return 0;
  }

  if (command === "generate-manifest") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["generate-manifest"]);
    const debug = Boolean(parsed.debug);
    const result = await runGenerateManifest({
      configPath: parsed.config ? path.resolve(parsed.config) : path.resolve("ybsf-metadata-config.json"),
      outputPath: parsed.output ? path.resolve(parsed.output) : path.resolve("manifest/package.xml"),
      targetOrg: parsed["target-org"] || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Config: ${result.configPath}`);
    console.log(`Target org: ${result.targetOrg}`);
    console.log(`Wrote manifest: ${result.outputPath}`);
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    console.log(`Metadata types: ${result.typeCount}`);
    return 0;
  }

  if (command === "normalize-config") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["normalize-config"]);
    const debug = Boolean(parsed.debug);
    const result = await runNormalizeConfig({
      configPath: parsed.config ? path.resolve(parsed.config) : path.resolve("ybsf-metadata-config.json"),
      targetOrg: parsed["target-org"] || null,
      initMode: Boolean(parsed["init-mode"]),
      includeManagedPackages: Boolean(parsed.includeManagedPackages),
      includeUnlockedPackages: Boolean(parsed.includeUnlockedPackages),
      debug,
      status: statusLogger(debug),
    });
    console.log(`Config: ${result.configPath}`);
    if (result.targetOrg) {
      console.log(`Target org: ${result.targetOrg}`);
    }
    console.log(`Init mode: ${result.initMode ? "true" : "false"}`);
    console.log(`Added metadata types: ${result.addedTypes.length}`);
    console.log(`Removed members: ${result.removedMembers.length}`);
    for (const removed of result.removedMembers) {
      console.warn(`- ${removed}`);
    }
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    return 0;
  }

  if (command === "init-project") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["init-project"]);
    const debug = Boolean(parsed.debug);
    const apiVersion = parsed["api-version"] || DEFAULT_API_VERSION;
    const result = await runInitProject({
      cwd: process.cwd(),
      apiVersion,
      targetOrg: parsed["target-org"] || null,
      force: Boolean(parsed.force),
      includeManagedPackages: Boolean(parsed.includeManagedPackages),
      includeUnlockedPackages: Boolean(parsed.includeUnlockedPackages),
      debug,
      status: statusLogger(debug),
    });
    console.log(`Project root: ${result.cwd}`);
    console.log(`Detected mode: ${result.mode}`);
    console.log(`sfdx-project.json: ${result.scaffold.projectCreatedOrUpdated ? "written" : "kept existing"}`);
    if (result.converted) {
      console.log(`Converted legacy config: ${result.convertResult.outputFile}`);
      if (parsed["target-org"]) {
        console.log(`Target org: ${parsed["target-org"]}`);
      }
      console.log(`Metadata types: ${result.convertResult.metadataTypeCount}`);
      console.log(`Conflicts resolved with include precedence: ${result.convertResult.conflictCount}`);
      printWarnings(result.convertResult.warnings, debug);
      if (result.normalizeResult) {
        console.log(`Normalized config: ${result.normalizeResult.configPath}`);
        console.log(`Added metadata types: ${result.normalizeResult.addedTypes.length}`);
        console.log(`Removed members: ${result.normalizeResult.removedMembers.length}`);
        for (const removed of result.normalizeResult.removedMembers) {
          console.warn(`- ${removed}`);
        }
      }
    } else {
      if (result.normalizeResult) {
        console.log(`Initialized config: ${result.normalizeResult.configPath}`);
        if (parsed["target-org"]) {
          console.log(`Target org: ${parsed["target-org"]}`);
        }
        console.log(`Added metadata types: ${result.normalizeResult.addedTypes.length}`);
        console.log(`Removed members: ${result.normalizeResult.removedMembers.length}`);
      } else {
        console.log("No legacy metadata config files detected; scaffold only.");
      }
    }
    return 0;
  }

  if (command === "completion") {
    const shell = rest[0] || "zsh";
    const script = runCompletion({ shell });
    process.stdout.write(script);
    return 0;
  }

  if (command === "retrieve") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES.retrieve);
    const debug = Boolean(parsed.debug);
    const result = await runRetrieve({
      targetOrg: parsed["target-org"] || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Config: ${result.configPath}`);
    console.log(`Target org: ${result.targetOrg}`);
    if (Array.isArray(result.transformErrors) && result.transformErrors.length > 0) {
      console.error(`Transform errors (${result.transformErrors.length}):`);
      for (const transformError of result.transformErrors) {
        console.error(`- ${transformError.id}: ${transformError.message}`);
      }
    }
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    return Array.isArray(result.transformErrors) && result.transformErrors.length > 0 ? 1 : 0;
  }

  if (command === "destructive-preview") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["destructive-preview"]);
    const debug = Boolean(parsed.debug);
    const result = await runDestructivePreview({
      configPath: parsed.config ? path.resolve(parsed.config) : path.resolve("ybsf-metadata-config.json"),
      targetOrg: parsed["target-org"] || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Config: ${result.configPath}`);
    console.log(`Target org: ${result.targetOrg}`);
    console.log(`Destructive candidates: ${result.destructiveCount}`);
    console.log(`Destructive types: ${result.destructiveTypeCount}`);
    if (result.destructivePath) {
      console.log(`Destructive manifest: ${result.destructivePath}`);
    } else {
      console.log("Destructive manifest: none");
    }
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    return 0;
  }

  if (command === "validate-deploy") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES["validate-deploy"]);
    const debug = Boolean(parsed.debug);
    const result = await runValidateDeploy({
      configPath: parsed.config ? path.resolve(parsed.config) : path.resolve("ybsf-metadata-config.json"),
      targetOrg: parsed["target-org"] || null,
      applyDestructive: Boolean(parsed["apply-destructive"]),
      testLevel: parsed["test-level"] || null,
      tests: parsed.tests || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Config: ${result.configPath}`);
    console.log(`Target org: ${result.targetOrg}`);
    console.log(`Deploy manifest: ${result.desiredManifestPath}`);
    console.log(`Source directory: ${path.resolve("force-app")}`);
    console.log(`Test level: ${result.testLevel || "(sf default)"}`);
    if (result.tests && result.tests.length > 0) {
      console.log(`Tests: ${result.tests.join(", ")}`);
    }
    if (result.destructivePath) {
      console.log(`Destructive manifest: ${result.destructivePath}`);
    } else {
      console.log("Destructive manifest: none");
    }
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    return 0;
  }

  if (command === "deploy") {
    const parsed = parseArgs(rest, COMMAND_SHORT_FLAG_ALIASES.deploy);
    const debug = Boolean(parsed.debug);
    const result = await runDeploy({
      configPath: parsed.config ? path.resolve(parsed.config) : path.resolve("ybsf-metadata-config.json"),
      targetOrg: parsed["target-org"] || null,
      applyDestructive: Boolean(parsed["apply-destructive"]),
      testLevel: parsed["test-level"] || null,
      tests: parsed.tests || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Config: ${result.configPath}`);
    console.log(`Target org: ${result.targetOrg}`);
    console.log(`Deploy manifest: ${result.desiredManifestPath}`);
    console.log(`Source directory: ${path.resolve("force-app")}`);
    console.log(`Test level: ${result.testLevel || "(sf default)"}`);
    if (result.tests && result.tests.length > 0) {
      console.log(`Tests: ${result.tests.join(", ")}`);
    }
    if (result.destructivePath) {
      console.log(`Destructive manifest: ${result.destructivePath}`);
    } else {
      console.log("Destructive manifest: none");
    }
    if (result.runDir) {
      console.log(`Run artifacts: ${result.runDir}`);
    }
    return 0;
  }

  if (command === "document") {
    const [task, ...flagTokens] = rest;
    if (!task) {
      throw new Error("document requires a task: objectFields | picklistValues | picklistValuesControllingField | picklistValuesRecordTypes");
    }
    const parsed = parseArgs(flagTokens, COMMAND_SHORT_FLAG_ALIASES.document);
    const debug = Boolean(parsed.debug);
    const result = await runDocument({
      task,
      object: parsed.object || null,
      all: Boolean(parsed.all),
      sourceDir: parsed["source-dir"] ? path.resolve(parsed["source-dir"]) : path.resolve("force-app/main/default"),
      outputDir: parsed["output-dir"] ? path.resolve(parsed["output-dir"]) : path.resolve("doc"),
      targetOrg: parsed["target-org"] || null,
      debug,
      status: statusLogger(debug),
    });
    printWarnings(result.warnings, debug);
    console.log(`Task: ${result.task}`);
    console.log(`Source directory: ${result.sourceDir}`);
    console.log(`Output directory: ${result.outputDir}`);
    if (result.targetOrg) {
      console.log(`Target org: ${result.targetOrg}`);
    }
    console.log(`Objects processed: ${result.objectsProcessed}`);
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

module.exports = {
  runCli,
};
