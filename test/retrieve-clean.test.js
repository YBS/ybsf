const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  _private: {
    buildTrackingStateDirs,
    clearRetrieveState,
    clearTrackingStateDirs,
    isSafeTrackingIdentifier,
    isSandboxLikeUrl,
    redactSensitiveFields,
  },
} = require("../src/commands/retrieve");

function makeTempProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-retrieve-clean-"));
  return {
    cwd,
    cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }),
  };
}

test("isSandboxLikeUrl recognizes sandbox and scratch domains, rejects production", () => {
  // Modern enhanced domain: sandbox
  assert.equal(isSandboxLikeUrl("https://flow-dream-1528--crmdev2.sandbox.my.salesforce.com"), true);
  // Modern enhanced domain: scratch org (also uses .sandbox.)
  assert.equal(isSandboxLikeUrl("https://power-customer-9038-dev-ed.sandbox.my.salesforce.com"), true);
  // Legacy sandbox instance
  assert.equal(isSandboxLikeUrl("https://cs99.salesforce.com"), true);
  assert.equal(isSandboxLikeUrl("https://cs7.my.salesforce.com"), true);
  // Production: enhanced domain
  assert.equal(isSandboxLikeUrl("https://acme.my.salesforce.com"), false);
  // Production: legacy
  assert.equal(isSandboxLikeUrl("https://na1.salesforce.com"), false);
  // Empty / nullish input
  assert.equal(isSandboxLikeUrl(""), false);
  assert.equal(isSandboxLikeUrl(null), false);
  assert.equal(isSandboxLikeUrl(undefined), false);
});

test("redactSensitiveFields masks credential JSON fields", () => {
  const input = '{"accessToken":"00DO300!AQEAQ.live","refreshToken":"5Aep8wow","other":"keep"}';
  const out = redactSensitiveFields(input);
  assert.match(out, /"accessToken":"<REDACTED>"/);
  assert.match(out, /"refreshToken":"<REDACTED>"/);
  assert.match(out, /"other":"keep"/);
  // Tolerate whitespace around the colon
  const spaced = '{"accessToken" : "live"}';
  assert.match(redactSensitiveFields(spaced), /"accessToken" : "<REDACTED>"/);
  // No-op on text without the fields
  assert.equal(redactSensitiveFields("plain text"), "plain text");
  assert.equal(redactSensitiveFields(""), "");
  assert.equal(redactSensitiveFields(null), "");
});

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

test("clearTrackingStateDirs clears only matching tracking directories and leaves force-app alone", () => {
  const project = makeTempProject();
  try {
    const forceAppDir = path.join(project.cwd, "force-app");
    const matchingSfDir = path.join(project.cwd, ".sf", "orgs", "00Dxx0000000001");
    const unrelatedSfDir = path.join(project.cwd, ".sf", "orgs", "00Dxx0000000002");
    const stalePath = path.join(forceAppDir, "main", "default", "stale.txt");

    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, "stale\n", "utf8");
    fs.mkdirSync(matchingSfDir, { recursive: true });
    fs.mkdirSync(unrelatedSfDir, { recursive: true });

    const result = clearTrackingStateDirs({
      cwd: project.cwd,
      trackingIdentifiers: ["00Dxx0000000001"],
    });

    assert.equal(fs.existsSync(stalePath), true, "force-app must not be touched");
    assert.equal(fs.existsSync(matchingSfDir), false);
    assert.equal(fs.existsSync(unrelatedSfDir), true);
    assert.deepEqual(result.deletedTrackingStateDirs, [matchingSfDir]);
  } finally {
    project.cleanup();
  }
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
