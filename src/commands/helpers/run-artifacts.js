const fs = require("fs");
const path = require("path");

function createRunArtifactsDir(prefix, cwd = process.cwd()) {
  const tempRoot = path.resolve(cwd, "tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const runDir = path.join(tempRoot, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function cleanupRunArtifactsDir(runDir, debug) {
  if (debug || !runDir) {
    return;
  }
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
  } catch (_err) {
    // Best-effort cleanup for non-debug mode.
  }
}

module.exports = {
  createRunArtifactsDir,
  cleanupRunArtifactsDir,
};
