const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDeployIdFromText, summarizeDeployReport } = require("../src/commands/helpers/deploy-report");

test("parseDeployIdFromText extracts deploy id from streamed output", () => {
  const value = parseDeployIdFromText(`
Status: Failed
Deploy ID: 0AfWF00000CO5MD0A1
Target Org: test@example.com
`);
  assert.equal(value, "0AfWF00000CO5MD0A1");
});

test("summarizeDeployReport includes failures and aggregate coverage", () => {
  const summary = summarizeDeployReport({
    warnings: ["A top-level warning"],
    result: {
      id: "0AfWF00000CO5MD0A1",
      status: "Failed",
      numberComponentsDeployed: 9,
      numberComponentsTotal: 10,
      numberTestsCompleted: 2,
      numberTestsTotal: 2,
      details: {
        componentFailures: [
          {
            componentType: "ContentAsset",
            fullName: "WBD_Logo",
            problem: "Unexpected error",
          },
        ],
        runTestResult: {
          failures: [
            {
              name: "MyClassTest",
              methodName: "testExample",
              message: "Assertion failed",
              lineNumber: 44,
              columnNumber: 1,
            },
          ],
          codeCoverage: [
            { numLocations: 10, numLocationsNotCovered: 2 },
            { numLocations: 20, numLocationsNotCovered: 5 },
          ],
          codeCoverageWarnings: ["Coverage warning"],
          flowCoverageWarnings: [],
        },
      },
    },
  });

  assert.equal(summary.deployId, "0AfWF00000CO5MD0A1");
  assert.equal(summary.coverage.percent, "76.67");
  assert.match(summary.lines.join("\n"), /Component failures \(1\)/);
  assert.match(summary.lines.join("\n"), /Test failures \(1\)/);
  assert.match(summary.lines.join("\n"), /Apex coverage: 76\.67% \(23\/30 locations\)/);
});
