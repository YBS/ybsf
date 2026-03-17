const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSfCommand,
  getSfSpawnOptions,
  formatSfCommandError,
} = require("../src/commands/helpers/command-utils");

test("getSfCommand uses sf across platforms", () => {
  assert.equal(getSfCommand("win32"), "sf");
  assert.equal(getSfCommand("darwin"), "sf");
  assert.equal(getSfCommand("linux"), "sf");
});

test("getSfSpawnOptions enables shell-backed launch on Windows", () => {
  assert.deepEqual(getSfSpawnOptions("darwin", {}), {});
  assert.deepEqual(getSfSpawnOptions("win32", { ComSpec: "C:\\\\Windows\\\\System32\\\\cmd.exe" }), {
    shell: "C:\\\\Windows\\\\System32\\\\cmd.exe",
  });
});

test("formatSfCommandError gives actionable ENOENT guidance", () => {
  const message = formatSfCommandError({ code: "ENOENT", message: "spawn sf ENOENT" }, "sf");
  assert.match(message, /sf command failed \(ENOENT\)/);
  assert.match(message, /\bsf\b/);
  assert.match(message, /available on PATH/);
});
