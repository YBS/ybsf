const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./helpers/command-utils");
const { prepareDeploy, runSfCommand } = require("../deploy/prepare-deploy");
const { confirmTargetOrg, resolveApplyDestructive } = require("./helpers/interactive");
const { fetchTargetOrgDetails } = require("./helpers/target-org");
const { resolveDeployTestOptions } = require("./helpers/deploy-test-options");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");

function isRenderableComponentsLine(line) {
  return /^Components:\s+\d+\/\d+/.test(String(line || "").trim());
}

function isRenderableTestsLine(line) {
  return /^Tests:\s+(?:\d+\/\d+|Running)/.test(String(line || "").trim());
}

function isRenderableSuccessfulLine(line) {
  return /^Successful:\s+\d+\/\d+/.test(String(line || "").trim());
}

function isRenderableFailedLine(line) {
  return /^Failed:\s+\d+\/\d+/.test(String(line || "").trim());
}

function formatRunningTestsLine(successfulLine) {
  const text = String(successfulLine || "").trim();
  const match = text.match(/^Successful:\s+(.+)$/);
  if (!match) {
    return text;
  }
  return `Running Tests: ${match[1]}`;
}

async function runValidateDeploy({ configPath, targetOrg, applyDestructive, testLevel, tests, status, debug = false }) {
  const startedAt = Date.now();
  const step = (message) => {
    if (typeof status === "function") {
      status(`[validate-deploy] ${message}`);
    }
  };
  if (!targetOrg || !String(targetOrg).trim()) {
    throw new Error("target org is required");
  }

  const preflightRunDir = createRunArtifactsDir("ybsf-validate-deploy-preflight", process.cwd());
  let prepared = null;
  try {
    step("Getting target org details");
    const targetDetails = await fetchTargetOrgDetails({
      targetOrg,
      runSfCommand,
      artifactsDir: preflightRunDir,
      artifactBaseNamePrefix: "validate-target-org",
    });
    const confirmed = await confirmTargetOrg({
      commandLabel: "validate-deploy",
      details: targetDetails,
      step,
    });
    if (!confirmed) {
      throw new Error("Deployment canceled by user.");
    }

    prepared = await prepareDeploy({
      configPath,
      targetOrg,
      debug,
      status: (message) => step(message),
    });

  const cmdArgs = [
    "project",
    "deploy",
    "start",
    "--target-org",
    prepared.targetOrg,
    "--api-version",
    prepared.config.apiVersion,
    "--manifest",
    prepared.desiredManifestPath,
    "--dry-run",
    "--wait",
    "60",
    "--concise",
    "--ignore-conflicts",
  ];
  const testOptions = resolveDeployTestOptions({ testLevel, tests });
  cmdArgs.push(...testOptions.cmdArgs);

  let includeDestructive = false;
  if (prepared.destructivePath) {
    includeDestructive = await resolveApplyDestructive({
      explicitApplyDestructive: Boolean(applyDestructive),
      destructiveCount: prepared.destructiveCount,
      commandLabel: "validate-deploy",
      step,
    });
  }

  if (prepared.destructivePath && includeDestructive) {
    cmdArgs.push("--post-destructive-changes", prepared.destructivePath);
  } else if (prepared.destructivePath && !includeDestructive) {
    prepared.warnings.push(
      `Destructive candidates found (${prepared.destructiveCount}) but not applied. Use --apply-destructive to apply them automatically.`
    );
  }

  step(`Validating deployment to ${prepared.targetOrg}`);
  const deployStartedAt = Date.now();
  let currentStatus = "";
  let currentComponents = "";
  let currentTests = "";
  let currentSuccessful = "";
  let currentFailed = "";
  const currentProgressLine = () => {
    if (currentSuccessful || currentFailed || currentTests) {
      const runningTests = currentSuccessful ? formatRunningTestsLine(currentSuccessful) : "";
      if (currentSuccessful && currentFailed) {
        return `${runningTests} | ${currentFailed}`;
      }
      return runningTests || currentFailed || currentTests;
    }
    return currentComponents;
  };
  let deployError = null;
  const heartbeat = setInterval(() => {
    const elapsed = formatDuration(Date.now() - deployStartedAt);
    if (currentStatus) {
      const progress = currentProgressLine();
      const progressPart = progress ? ` | ${progress}` : "";
      step(`validate: Status: ${currentStatus}${progressPart} (${elapsed})`);
    } else {
      step(`validate: Waiting (${elapsed})`);
    }
  }, 15_000);
  try {
    await runSfCommand({
      cmdArgs,
      cwd: process.cwd(),
      artifactsDir: prepared.runDir,
      artifactBaseName: "project-validate-deploy",
      streamLiveOutput: false,
      onProgress: (line) => {
        if (line.startsWith("Status: ")) {
          const nextStatus = line.slice("Status: ".length).trim();
          if (nextStatus && nextStatus !== currentStatus) {
            currentStatus = nextStatus;
            const progress = currentProgressLine();
            const progressPart = progress ? ` | ${progress}` : "";
            step(`validate: Status: ${currentStatus}${progressPart}`);
          }
          return;
        }
        if (line.startsWith("Components: ")) {
          if (isRenderableComponentsLine(line)) {
            currentComponents = line;
          }
          return;
        }
        if (line.startsWith("Tests: ")) {
          if (isRenderableTestsLine(line)) {
            currentTests = line;
          }
          return;
        }
        if (line.startsWith("Successful: ")) {
          if (isRenderableSuccessfulLine(line)) {
            currentSuccessful = line;
            if (!currentTests) {
              currentTests = "Tests: Running";
            }
          }
          return;
        }
        if (line.startsWith("Failed: ")) {
          if (isRenderableFailedLine(line)) {
            currentFailed = line;
            if (!currentTests) {
              currentTests = "Tests: Running";
            }
          }
        }
      },
    });
  } catch (err) {
    deployError = err;
  } finally {
    clearInterval(heartbeat);
    step(`Validation deploy time: ${formatDuration(Date.now() - deployStartedAt)}`);
    step(`Total time: ${formatDuration(Date.now() - startedAt)}`);
  }
  if (deployError) {
    throw deployError;
  }

    return {
      configPath: prepared.configPath,
      targetOrg: prepared.targetOrg,
      runDir: debug ? prepared.runDir : null,
      debugPath: debug ? prepared.debugPath : null,
      desiredManifestPath: prepared.desiredManifestPath,
      destructivePath: includeDestructive ? prepared.destructivePath : null,
      destructiveCount: prepared.destructiveCount,
      testLevel: testOptions.testLevel,
      tests: testOptions.tests,
      warnings: prepared.warnings,
    };
  } finally {
    cleanupRunArtifactsDir(preflightRunDir, debug);
    if (prepared && typeof prepared.cleanup === "function") {
      prepared.cleanup();
    }
  }
}

module.exports = {
  runValidateDeploy,
};
