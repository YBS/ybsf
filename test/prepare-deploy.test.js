const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prepareDeploy } = require("../src/deploy/prepare-deploy");

test("prepareDeploy skips destructive generation when skipDestructive is true", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-prepare-deploy-"));
  const configPath = path.join(tempDir, "ybsf-metadata-config.json");
  const desiredManifestPath = path.join(tempDir, "package.xml");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        apiVersion: "61.0",
        metadataTypes: [],
        packageRules: {
          includeManagedPackages: false,
          includeUnlockedPackages: false,
          namespaces: [],
        },
        processingRules: {},
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    desiredManifestPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
      "  <version>61.0</version>",
      "</Package>",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = await prepareDeploy({
    configPath,
    targetOrg: "unused-org-alias",
    desiredManifestPath,
    skipDestructive: true,
    debug: true,
  });

  try {
    assert.equal(result.destructiveSkipped, true);
    assert.equal(result.orgPackagePath, null);
    assert.equal(result.destructivePath, null);
    assert.equal(result.destructiveManifestXml, null);
    assert.equal(result.destructiveCount, 0);
    assert.deepEqual(result.warnings, []);

    const debugPayload = JSON.parse(fs.readFileSync(result.debugPath, "utf8"));
    assert.equal(debugPayload.destructiveSkipped, true);
    assert.equal(debugPayload.orgPackagePath, null);
    assert.equal(debugPayload.destructiveCount, 0);
    assert.deepEqual(debugPayload.destructiveByType, {});
  } finally {
    if (typeof result.cleanup === "function") {
      result.cleanup();
    }
    fs.rmSync(result.runDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
