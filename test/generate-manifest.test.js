const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProjectGenerateManifestArgs } = require("../src/commands/helpers/project-manifest-discovery");
const {
  collectExcludedConfigMetadataTypes,
  getMemberNamespace,
} = require("../src/commands/generate-manifest");

test("buildProjectGenerateManifestArgs adds excluded metadata filter when no positive metadata filter is provided", () => {
  const args = buildProjectGenerateManifestArgs({
    targetOrg: "my-org",
    apiVersion: "61.0",
    outputDir: "/tmp/out",
    excludedMetadataTypes: ["Workflow", "ApexPage", "Workflow"],
  });

  assert.deepEqual(args, [
    "project",
    "generate",
    "manifest",
    "--from-org",
    "my-org",
    "--output-dir",
    "/tmp/out",
    "--api-version",
    "61.0",
    "--type",
    "package",
    "--excluded-metadata",
    "ApexPage",
    "--excluded-metadata",
    "Workflow",
  ]);
});

test("collectExcludedConfigMetadataTypes returns disabled top-level types", () => {
  const config = {
    metadataTypes: [
      { metadataType: "ApexClass", enabled: true },
      { metadataType: "Workflow", enabled: false },
      { metadataType: "Layout", enabled: false },
    ],
  };

  assert.deepEqual(collectExcludedConfigMetadataTypes(config), ["Layout", "Workflow"]);
});

test("getMemberNamespace detects managed namespaces on hyphenated custom object translations", () => {
  assert.equal(getMemberNamespace("CustomObjectTranslation", "ContentVersion-dfsle__de"), "dfsle");
});
