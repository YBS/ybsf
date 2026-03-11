const { formatDuration } = require("./helpers/command-utils");
const { prepareDeploy } = require("../deploy/prepare-deploy");

async function runDestructivePreview({ configPath, targetOrg, status, debug = false }) {
  const startedAt = Date.now();
  const step = (message) => {
    if (typeof status === "function") {
      status(`[destructive-preview] ${message}`);
    }
  };

  const prepared = await prepareDeploy({
    configPath,
    targetOrg,
    debug,
    status: (message) => step(message),
  });
  try {
    step(`Found ${prepared.destructiveCount} destructive candidate(s)`);
    step(`Total time: ${formatDuration(Date.now() - startedAt)}`);

    return {
      configPath: prepared.configPath,
      targetOrg: prepared.targetOrg,
      runDir: debug ? prepared.runDir : null,
      debugPath: debug ? prepared.debugPath : null,
      destructivePath: prepared.destructivePath,
      destructiveManifestXml: prepared.destructiveManifestXml,
      destructiveCount: prepared.destructiveCount,
      destructiveTypeCount: prepared.destructiveByType.size,
      warnings: prepared.warnings,
    };
  } finally {
    if (typeof prepared.cleanup === "function") {
      prepared.cleanup();
    }
  }
}

module.exports = {
  runDestructivePreview,
};
