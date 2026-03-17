const test = require("node:test");
const assert = require("node:assert/strict");

const { getSfCommand, formatSfCommandError } = require("../src/commands/helpers/command-utils");

test("getSfCommand uses sf.cmd on Windows", () => {
  assert.equal(getSfCommand("win32"), "sf.cmd");
  assert.equal(getSfCommand("darwin"), "sf");
  assert.equal(getSfCommand("linux"), "sf");
});

test("formatSfCommandError gives actionable ENOENT guidance", () => {
  const message = formatSfCommandError({ code: "ENOENT", message: "spawn sf.cmd ENOENT" }, "sf.cmd");
  assert.match(message, /sf command failed \(ENOENT\)/);
  assert.match(message, /sf\.cmd/);
  assert.match(message, /available on PATH/);
});
