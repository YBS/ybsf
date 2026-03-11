const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./helpers/command-utils");
const { prepareDeploy, runSfCommand } = require("../deploy/prepare-deploy");
const { confirmTargetOrg, resolveApplyDestructive } = require("./helpers/interactive");
const { fetchTargetOrgDetails } = require("./helpers/target-org");
const { resolveDeployTestOptions } = require("./helpers/deploy-test-options");
const { parseDeployIdFromText, summarizeDeployReport } = require("./helpers/deploy-report");
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

function emitDestructiveManifestPreview(step, prepared) {
  if (typeof step !== "function" || !prepared || !prepared.destructivePath) {
    return;
  }
  step(`Destructive manifest: ${prepared.destructivePath}`);
  const xml = String(prepared.destructiveManifestXml || "").trim();
  if (!xml) {
    return;
  }
  step("Destructive manifest contents:");
  for (const line of xml.split(/\r?\n/)) {
    step(line);
  }
}

async function runDeploy({ configPath, targetOrg, applyDestructive, testLevel, tests, status, debug = false }) {
  const startedAt = Date.now();
  const step = (message) => {
    if (typeof status === "function") {
      status(`[deploy] ${message}`);
    }
  };
  if (!targetOrg || !String(targetOrg).trim()) {
    throw new Error("target org is required");
  }

  const preflightRunDir = createRunArtifactsDir("ybsf-deploy-preflight", process.cwd());
  let prepared = null;
  try {
    step("Getting target org details");
    const targetDetails = await fetchTargetOrgDetails({
      targetOrg,
      runSfCommand,
      artifactsDir: preflightRunDir,
      artifactBaseNamePrefix: "deploy-target-org",
    });
    const confirmed = await confirmTargetOrg({
      commandLabel: "deploy",
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
    "--wait",
    "60",
    "--concise",
    "--ignore-conflicts",
  ];
  const testOptions = resolveDeployTestOptions({ testLevel, tests });
  cmdArgs.push(...testOptions.cmdArgs);

  let includeDestructive = false;
  if (prepared.destructivePath) {
    emitDestructiveManifestPreview(step, prepared);
    includeDestructive = await resolveApplyDestructive({
      explicitApplyDestructive: Boolean(applyDestructive),
      destructiveCount: prepared.destructiveCount,
      commandLabel: "deploy",
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

  step(`Deploying to ${prepared.targetOrg}`);
  const deployStartedAt = Date.now();
  let currentStatus = "";
  let currentComponents = "";
  let currentTests = "";
  let currentSuccessful = "";
  let currentFailed = "";
  let deployResult = null;
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
      step(`deploy: Status: ${currentStatus}${progressPart} (${elapsed})`);
    } else {
      step(`deploy: Waiting (${elapsed})`);
    }
  }, 15_000);
  try {
    deployResult = await runSfCommand({
      cmdArgs,
      cwd: process.cwd(),
      artifactsDir: prepared.runDir,
      artifactBaseName: "project-deploy-start",
      streamLiveOutput: false,
      onProgress: (line) => {
        if (line.startsWith("Status: ")) {
          const nextStatus = line.slice("Status: ".length).trim();
          if (nextStatus && nextStatus !== currentStatus) {
            currentStatus = nextStatus;
            const progress = currentProgressLine();
            const progressPart = progress ? ` | ${progress}` : "";
            step(`deploy: Status: ${currentStatus}${progressPart}`);
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
    step(`Deploy time: ${formatDuration(Date.now() - deployStartedAt)}`);
    step(`Total time: ${formatDuration(Date.now() - startedAt)}`);
  }
  const deployRawOutput = `${deployResult && deployResult.stdout ? deployResult.stdout : ""}\n${
    deployError && deployError.stdout ? deployError.stdout : ""
  }\n${deployError && deployError.stderr ? deployError.stderr : ""}`;
  const deployId = parseDeployIdFromText(deployRawOutput);
  let deployReportSummary = null;
  if (deployId) {
    step(`Getting deployment status (${deployId})`);
    const reportResult = await runSfCommand({
      cmdArgs: ["project", "deploy", "report", "--job-id", deployId, "--target-org", prepared.targetOrg, "--json"],
      cwd: process.cwd(),
      artifactsDir: prepared.runDir,
      artifactBaseName: "project-deploy-report",
      streamLiveOutput: false,
    });
    deployReportSummary = summarizeDeployReport(JSON.parse(reportResult.stdout || "{}"));
    for (const line of deployReportSummary.lines) {
      step(line);
    }
  } else {
    step("Getting deployment status skipped because the deploy ID could not be determined.");
  }
  if (deployError) {
    const error = new Error(
      deployReportSummary && deployReportSummary.errorMessage
        ? deployReportSummary.errorMessage
        : deployError.message
    );
    error.alreadyReported = Boolean(deployReportSummary);
    throw error;
  }

    return {
      configPath: prepared.configPath,
      targetOrg: prepared.targetOrg,
      runDir: debug ? prepared.runDir : null,
      debugPath: debug ? prepared.debugPath : null,
      desiredManifestPath: prepared.desiredManifestPath,
      destructivePath: prepared.destructivePath,
      destructiveApplied: includeDestructive,
      destructiveManifestXml: prepared.destructiveManifestXml,
      destructiveCount: prepared.destructiveCount,
      testLevel: testOptions.testLevel,
      tests: testOptions.tests,
      deployId,
      deployReport: deployReportSummary,
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
  runDeploy,
};
