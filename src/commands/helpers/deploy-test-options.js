const VALID_TEST_LEVELS = new Set([
  "NoTestRun",
  "RunSpecifiedTests",
  "RunLocalTests",
  "RunAllTestsInOrg",
  "RunRelevantTests",
]);

function parseTestsValue(raw) {
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function resolveDeployTestOptions({ testLevel, tests }) {
  const level = testLevel ? String(testLevel).trim() : "";
  const parsedTests = parseTestsValue(tests);

  if (!level) {
    if (parsedTests.length > 0) {
      throw new Error("Cannot use --tests without --test-level RunSpecifiedTests");
    }
    return {
      cmdArgs: [],
      testLevel: null,
      tests: [],
    };
  }

  if (!VALID_TEST_LEVELS.has(level)) {
    throw new Error(
      `Invalid --test-level "${level}". Must be one of: ${Array.from(VALID_TEST_LEVELS).join(", ")}`
    );
  }

  if (level === "RunSpecifiedTests" && parsedTests.length === 0) {
    throw new Error("--test-level RunSpecifiedTests requires --tests");
  }
  if (level !== "RunSpecifiedTests" && parsedTests.length > 0) {
    throw new Error("--tests can only be used with --test-level RunSpecifiedTests");
  }

  const cmdArgs = ["--test-level", level];
  for (const testName of parsedTests) {
    cmdArgs.push("--tests", testName);
  }

  return {
    cmdArgs,
    testLevel: level,
    tests: parsedTests,
  };
}

module.exports = {
  resolveDeployTestOptions,
};
