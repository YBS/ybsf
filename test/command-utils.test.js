const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSfCommandSpec,
  getSfCommand,
  formatSfCommandError,
} = require("../src/commands/helpers/command-utils");

test("getSfCommand uses sf across platforms", () => {
  assert.equal(getSfCommand("win32"), "sf");
  assert.equal(getSfCommand("darwin"), "sf");
  assert.equal(getSfCommand("linux"), "sf");
});

test("buildSfCommandSpec uses direct sf launch on non-Windows", () => {
  assert.deepEqual(buildSfCommandSpec(["org", "list"], "darwin", {}), {
    command: "sf",
    args: ["org", "list"],
    options: {},
    sfCommand: "sf",
  });
});

test("buildSfCommandSpec uses cmd.exe wrapping on Windows", () => {
  assert.deepEqual(buildSfCommandSpec(["org", "display", "--target-org", "My Org"], "win32", {
    ComSpec: "C:\\\\Windows\\\\System32\\\\cmd.exe",
  }), {
    command: "C:\\\\Windows\\\\System32\\\\cmd.exe",
    args: ["/d", "/s", "/c", 'sf "org" "display" "--target-org" "My Org"'],
    options: {
      windowsVerbatimArguments: false,
    },
    sfCommand: "sf",
  });
});

test("formatSfCommandError gives actionable ENOENT guidance", () => {
  const message = formatSfCommandError({ code: "ENOENT", message: "spawn sf ENOENT" }, "sf");
  assert.match(message, /sf command failed \(ENOENT\)/);
  assert.match(message, /\bsf\b/);
  assert.match(message, /available on PATH/);
});
