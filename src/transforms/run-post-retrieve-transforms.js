const fs = require("fs");
const { parsePackageXml } = require("../legacy/parse-package-xml");
const { TRANSFORMS } = require("./registry");

function parseManifestMembers(manifestPath) {
  const xml = fs.readFileSync(manifestPath, "utf8");
  return parsePackageXml(xml);
}

async function runPostRetrieveTransforms({ config, manifestPath, forceAppDir, status }) {
  const step = (message) => {
    if (typeof status === "function") {
      status(message);
    }
  };
  const manifestMembersByType = parseManifestMembers(manifestPath);
  const summaries = [];
  const errors = [];

  for (const transform of TRANSFORMS) {
    step(`Transform: ${transform.id}`);
    try {
      const result = await transform.run({
        config,
        manifestMembersByType,
        forceAppDir,
      });
      summaries.push(result);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      step(`Transform failed: ${transform.id}: ${message}`);
      errors.push({
        id: transform.id,
        message,
      });
      summaries.push({
        id: transform.id,
        scannedFiles: 0,
        writtenFiles: 0,
        changedFiles: 0,
        removedEntries: 0,
        deletedFiles: 0,
        deletedDirs: 0,
        skipped: false,
        failed: true,
        error: message,
      });
    }
  }

  const aggregate = summaries.reduce(
    (acc, item) => {
      acc.scannedFiles += item.scannedFiles || 0;
      acc.writtenFiles += item.writtenFiles || 0;
      acc.changedFiles += item.changedFiles || 0;
      acc.removedEntries += item.removedEntries || 0;
      acc.deletedFiles += item.deletedFiles || 0;
      acc.deletedDirs += item.deletedDirs || 0;
      acc.errorCount += item.failed ? 1 : 0;
      return acc;
    },
    {
      transformCount: summaries.length,
      scannedFiles: 0,
      writtenFiles: 0,
      changedFiles: 0,
      removedEntries: 0,
      deletedFiles: 0,
      deletedDirs: 0,
      errorCount: 0,
    }
  );

  return {
    summaries,
    aggregate,
    errors,
  };
}

module.exports = {
  runPostRetrieveTransforms,
};
