const test = require("node:test");
const assert = require("node:assert/strict");
const { runCli } = require("../src/cli");

function captureConsole(methodName, fn) {
  const original = console[methodName];
  const lines = [];
  console[methodName] = (message = "") => {
    lines.push(String(message));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console[methodName] = original;
    })
    .then((result) => ({ result, output: lines.join("\n") }));
}

test("top-level help includes command-specific help hints", async () => {
  const { result, output } = await captureConsole("log", () => runCli([]));
  assert.equal(result, 0);
  assert.match(output, /ybsf <command> --help/);
  assert.match(output, /ybsf help \[command\]/);
});

test("help command prints deploy-specific options", async () => {
  const { result, output } = await captureConsole("log", () => runCli(["help", "deploy"]));
  assert.equal(result, 0);
  assert.match(output, /ybsf deploy - Run deploy from manifest\/package\.xml with optional destructive apply/);
  assert.match(output, /--target-org <alias>, -o/);
  assert.match(output, /--test-level <level>, -l/);
  assert.match(output, /--apply-destructive/);
});

test("command --help prints command-specific options without running the command", async () => {
  const { result, output } = await captureConsole("log", () => runCli(["deploy", "--help"]));
  assert.equal(result, 0);
  assert.match(output, /Usage:\n  ybsf deploy/);
  assert.doesNotMatch(output, /target org is required/);
});
