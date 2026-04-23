const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  _private: {
    buildTrackingStateDirs,
    clearRetrieveState,
    isSafeTrackingIdentifier,
  },
} = require("../src/commands/retrieve");

function makeTempProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-retrieve-clean-"));
  return {
    cwd,
    cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }),
  };
}

test("isSafeTrackingIdentifier rejects path traversal identifiers", () => {
  assert.equal(isSafeTrackingIdentifier("00Dxx0000000001"), true);
  assert.equal(isSafeTrackingIdentifier("user@example.com"), true);
  assert.equal(isSafeTrackingIdentifier("../other"), false);
  assert.equal(isSafeTrackingIdentifier("nested/path"), false);
  assert.equal(isSafeTrackingIdentifier("/tmp/org"), false);
  assert.equal(isSafeTrackingIdentifier(".."), false);
});

test("buildTrackingStateDirs builds .sf and .sfdx directories for safe unique identifiers", () => {
  const cwd = path.join(os.tmpdir(), "project");
  assert.deepEqual(buildTrackingStateDirs(cwd, ["00Dxx0000000001", "00Dxx0000000001", "../skip"]), [
    path.join(cwd, ".sf", "orgs", "00Dxx0000000001"),
    path.join(cwd, ".sfdx", "orgs", "00Dxx0000000001"),
  ]);
});

test("clearRetrieveState clears force-app and only matching tracking directories", () => {
  const project = makeTempProject();
  try {
    const forceAppDir = path.join(project.cwd, "force-app");
    const matchingSfDir = path.join(project.cwd, ".sf", "orgs", "00Dxx0000000001");
    const matchingSfdxDir = path.join(project.cwd, ".sfdx", "orgs", "user@example.com");
    const unrelatedSfDir = path.join(project.cwd, ".sf", "orgs", "00Dxx0000000002");

    fs.mkdirSync(path.join(forceAppDir, "main", "default"), { recursive: true });
    fs.writeFileSync(path.join(forceAppDir, "main", "default", "stale.txt"), "stale\n", "utf8");
    fs.mkdirSync(matchingSfDir, { recursive: true });
    fs.mkdirSync(matchingSfdxDir, { recursive: true });
    fs.mkdirSync(unrelatedSfDir, { recursive: true });

    const result = clearRetrieveState({
      cwd: project.cwd,
      forceAppDir,
      trackingIdentifiers: ["00Dxx0000000001", "user@example.com", "../skip"],
    });

    assert.equal(fs.existsSync(forceAppDir), true);
    assert.deepEqual(fs.readdirSync(forceAppDir), []);
    assert.equal(fs.existsSync(matchingSfDir), false);
    assert.equal(fs.existsSync(matchingSfdxDir), false);
    assert.equal(fs.existsSync(unrelatedSfDir), true);
    assert.deepEqual(result.deletedTrackingStateDirs.sort(), [matchingSfDir, matchingSfdxDir].sort());
  } finally {
    project.cleanup();
  }
});
