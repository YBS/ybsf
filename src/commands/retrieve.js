const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig } = require("../config/load-config");
const { runGenerateManifest } = require("./generate-manifest");
const { runPostRetrieveTransforms } = require("../transforms/run-post-retrieve-transforms");
const {
  buildSfCommandSpec,
  safeFileSuffix,
  formatDuration,
  formatSfCommandError,
} = require("./helpers/command-utils");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");

function redactSensitiveFields(input) {
  // Mask credential-bearing JSON fields so that artifact files persisted with
  // --debug do not leak live session tokens. Pattern intentionally tolerates
  // optional whitespace around the colon and any JSON-string value content.
  const text = String(input || "");
  return text.replace(
    /("(?:accessToken|refreshToken|clientSecret|password)"\s*:\s*")[^"]*(")/g,
    "$1<REDACTED>$2"
  );
}

function stripAnsi(input) {
  const text = String(input || "");
  // CSI sequences
  const noCsi = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  // OSC sequences
  return noCsi.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function sanitizeTerminalOutput(input) {
  const ansiStripped = stripAnsi(input);
  const normalizedNewlines = ansiStripped.replace(/\r\n/g, "\n");
  // Preserve carriage-return overwrite semantics by keeping only the latest
  // segment on each physical line.
  const rendered = normalizedNewlines
    .split("\n")
    .map((line) => line.split("\r").pop() || "")
    .join("\n");
  const withoutControl = rendered.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  const lines = withoutControl.split("\n").map((line) => line.replace(/\s+$/g, ""));
  const compact = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank && previousBlank) {
      continue;
    }
    compact.push(line);
    previousBlank = isBlank;
  }
  return `${compact.join("\n").trim()}\n`;
}

function normalizeProgressLine(line) {
  const text = String(line || "").trim();
  if (!text) {
    return null;
  }
  if (text.startsWith("Status:")) {
    const raw = text.replace(/^Status:\s*/u, "").trim();
    // Ignore spinner-only status glyph updates.
    if (!/[A-Za-z]/.test(raw)) {
      return null;
    }
    return `Status: ${raw}`;
  }
  if (text.includes("Preparing retrieve request")) {
    return "Preparing retrieve request";
  }
  if (text.includes("Sending request to org")) {
    return "Sending request to org";
  }
  if (text.includes("Waiting for the org to respond")) {
    return "Waiting for the org to respond";
  }
  if (text.includes("Done")) {
    return null;
  }
  return null;
}

async function runSfCommand({ cmdArgs, cwd, artifactsDir, artifactBaseName, onProgress, streamLiveOutput }) {
  const { command, args, options, sfCommand } = buildSfCommandSpec(cmdArgs);
  const commandText = `sf ${cmdArgs.join(" ")}`;
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    ...options,
  });

  let stdout = "";
  let stderr = "";
  let stdoutRemainder = "";
  let stderrRemainder = "";
  const emittedProgress = new Set();
  let lastStatus = "";
  let processError = null;
  let suppressRetrievedSource = false;
  let detectBuffer = "";

  const writeFilteredLiveOutput = (value, isStderr) => {
    const plain = stripAnsi(value);
    detectBuffer = `${detectBuffer}${plain}`;
    if (detectBuffer.length > 4096) {
      detectBuffer = detectBuffer.slice(-4096);
    }

    if (!suppressRetrievedSource && detectBuffer.includes("Retrieved Source")) {
      suppressRetrievedSource = true;
      // Ensure subsequent output starts on a clean line after the dynamic block.
      process.stdout.write("\n");
      return;
    }

    if (suppressRetrievedSource) {
      if (/\bWarnings?\b|\bErrors?\b/u.test(detectBuffer)) {
        suppressRetrievedSource = false;
      } else {
        return;
      }
    }

    if (isStderr) {
      process.stderr.write(value);
    } else {
      process.stdout.write(value);
    }
  };

  const consumeChunk = (chunk, isStderr) => {
    const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    if (streamLiveOutput) {
      writeFilteredLiveOutput(value, isStderr);
    }
    if (isStderr) {
      stderr += value;
    } else {
      stdout += value;
    }
    const incoming = (isStderr ? stderrRemainder : stdoutRemainder) + value;
    const normalized = stripAnsi(incoming).replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    const remainder = parts.pop() || "";
    if (isStderr) {
      stderrRemainder = remainder;
    } else {
      stdoutRemainder = remainder;
    }
    if (!streamLiveOutput) {
      for (const part of parts) {
        const progress = normalizeProgressLine(part);
        if (!progress) {
          continue;
        }
        if (progress.startsWith("Status: ")) {
          if (progress === lastStatus) {
            continue;
          }
          lastStatus = progress;
        } else if (emittedProgress.has(progress)) {
          continue;
        } else {
          emittedProgress.add(progress);
        }
        if (typeof onProgress === "function") {
          onProgress(progress);
        }
      }
    }
  };

  const result = await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => consumeChunk(chunk, false));
    child.stderr.on("data", (chunk) => consumeChunk(chunk, true));
    child.on("error", (err) => {
      processError = err;
      reject(err);
    });
    child.on("close", (code, signal) => {
      resolve({ status: code, signal });
    });
  }).catch((err) => {
    processError = err;
    return { status: null, signal: null };
  });

  const elapsedMs = Date.now() - startedAt;

  const baseName = safeFileSuffix(artifactBaseName);
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.cmd.txt`), `${commandText}\n`, "utf8");
  const rawStdout = stdout || "";
  const rawStderr = stderr || "";
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.raw.txt`), redactSensitiveFields(rawStdout), "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.raw.txt`), redactSensitiveFields(rawStderr), "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.txt`), redactSensitiveFields(sanitizeTerminalOutput(rawStdout)), "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.txt`), redactSensitiveFields(sanitizeTerminalOutput(rawStderr)), "utf8");
  fs.writeFileSync(
    path.join(artifactsDir, `${baseName}.status.json`),
    `${JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        error: processError ? { message: processError.message, code: processError.code } : null,
        elapsedMs,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (processError) {
    throw new Error(formatSfCommandError(processError, sfCommand));
  }

  if (result.status !== 0) {
    const stderrMessage = rawStderr.trim();
    const signalMessage = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(
      stderrMessage.length > 0
        ? stderrMessage
        : `sf command failed with status ${result.status}${signalMessage}`
    );
  }

  return {
    stdout: rawStdout,
    elapsedMs,
  };
}

function clearDirectoryContents(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function parseJson(raw, context) {
  try {
    return JSON.parse(String(raw || ""));
  } catch (err) {
    throw new Error(`${context}: invalid JSON (${err.message})`);
  }
}

function isSafeTrackingIdentifier(identifier) {
  const value = String(identifier || "").trim();
  return Boolean(value) && value !== "." && value !== ".." && !path.isAbsolute(value) && !/[\\/]/u.test(value);
}

function buildTrackingStateDirs(cwd, identifiers) {
  const safeIdentifiers = Array.from(new Set((identifiers || []).filter(isSafeTrackingIdentifier)));
  const dirs = [];
  for (const identifier of safeIdentifiers) {
    dirs.push(path.join(cwd, ".sf", "orgs", identifier));
    dirs.push(path.join(cwd, ".sfdx", "orgs", identifier));
  }
  return dirs;
}

function isSandboxLikeUrl(instanceUrl) {
  // Sandboxes and scratch orgs in modern enhanced domains include `.sandbox.`
  // in the host (e.g., `<myDomain>--<sbx>.sandbox.my.salesforce.com`). Legacy
  // sandbox instances live on `cs<N>.*` hosts. Production / dev edition orgs
  // do not match either pattern, and source tracking is not available there.
  const url = String(instanceUrl || "").toLowerCase();
  if (!url) return false;
  if (url.includes(".sandbox.")) return true;
  if (/\/\/cs\d+\./.test(url)) return true;
  return false;
}

async function resolveTargetOrgInfo({ targetOrg, cwd, runDir }) {
  const displayOutput = await runSfCommand({
    cmdArgs: ["org", "display", "--target-org", targetOrg, "--json"],
    cwd,
    artifactsDir: runDir,
    artifactBaseName: "org-display-for-clean",
    streamLiveOutput: false,
  });
  const displayJson = parseJson(displayOutput.stdout, "sf org display");
  const result = displayJson?.result || {};
  const trackingIdentifiers = [
    targetOrg,
    result.id,
    result.orgId,
    result.username,
    result.userName,
    result.alias,
  ].filter(Boolean);
  return {
    trackingIdentifiers,
    instanceUrl: result.instanceUrl || "",
    isSandboxLike: isSandboxLikeUrl(result.instanceUrl),
  };
}

function clearTrackingStateDirs({ cwd, trackingIdentifiers }) {
  const deletedTrackingStateDirs = [];
  for (const dirPath of buildTrackingStateDirs(cwd, trackingIdentifiers)) {
    if (!fs.existsSync(dirPath)) {
      continue;
    }
    fs.rmSync(dirPath, { recursive: true, force: true });
    deletedTrackingStateDirs.push(dirPath);
  }
  return { deletedTrackingStateDirs };
}

function clearRetrieveState({ cwd, forceAppDir, trackingIdentifiers }) {
  clearDirectoryContents(forceAppDir);
  return clearTrackingStateDirs({ cwd, trackingIdentifiers });
}

async function runRetrieve({ targetOrg, status, debug = false, clean = false }) {
  const startedAt = Date.now();
  const step = (message) => {
    if (typeof status === "function") {
      status(`[retrieve] ${message}`);
    }
  };

  if (!targetOrg || !String(targetOrg).trim()) {
    throw new Error("retrieve requires --target-org");
  }

  const cwd = process.cwd();
  const runDir = createRunArtifactsDir("ybsf-retrieve", cwd);

  try {
    const timings = {};

  const loadStartedAt = Date.now();
  step("Loading config");
  const { config, path: configPath } = loadConfig(path.resolve("ybsf-metadata-config.json"));
  timings.loadConfigMs = Date.now() - loadStartedAt;

  const generateStartedAt = Date.now();
  step("Generating manifest");
  const manifestPath = path.resolve("manifest/package.xml");
    const generateResult = await runGenerateManifest({
      configPath,
      outputPath: manifestPath,
      targetOrg,
      debug,
      status: (msg) => step(msg.replace(/^\[generate-manifest\]\s*/u, "generate-manifest: ")),
    });
  timings.generateManifestMs = Date.now() - generateStartedAt;

  const forceAppDir = path.resolve(cwd, "force-app");
  let cleanResult = {
    deletedTrackingStateDirs: [],
  };
  const cleanStartedAt = Date.now();
  const orgInfo = await resolveTargetOrgInfo({ targetOrg, cwd, runDir });
  const { trackingIdentifiers, isSandboxLike } = orgInfo;
  if (clean) {
    step("Clean retrieve requested; clearing force-app");
    if (isSandboxLike) {
      step("Clean retrieve rebuilds source tracking; close IDE extensions that poll the org during this retrieve if possible");
    }
    cleanResult = clearRetrieveState({ cwd, forceAppDir, trackingIdentifiers });
    step(`Cleared ${forceAppDir}`);
    if (isSandboxLike && cleanResult.deletedTrackingStateDirs.length > 0) {
      step(`Cleared ${cleanResult.deletedTrackingStateDirs.length} Salesforce CLI tracking state directories`);
    }
  } else if (isSandboxLike) {
    step("Clearing Salesforce CLI source-tracking state for a clean baseline (use --clean to also reset force-app)");
    cleanResult = clearTrackingStateDirs({ cwd, trackingIdentifiers });
    if (cleanResult.deletedTrackingStateDirs.length > 0) {
      step(`Cleared ${cleanResult.deletedTrackingStateDirs.length} Salesforce CLI tracking state directories`);
    } else {
      step("No matching Salesforce CLI tracking state directories found");
    }
  }
  timings.cleanRetrieveStateMs = Date.now() - cleanStartedAt;

  const retrieveStartedAt = Date.now();
  step(`Retrieving metadata from ${targetOrg}`);
  let currentRetrieveStatus = null;
  const retrieveHeartbeat = setInterval(() => {
    const elapsed = formatDuration(Date.now() - retrieveStartedAt);
    if (currentRetrieveStatus) {
      step(`retrieve: Status: ${currentRetrieveStatus} (${elapsed})`);
    } else {
      step(`retrieve: Waiting (${elapsed})`);
    }
  }, 15_000);
  let retrieveResult = null;
  try {
    retrieveResult = await runSfCommand({
      cmdArgs: [
        "project",
        "retrieve",
        "start",
        "--manifest",
        manifestPath,
        "--target-org",
        targetOrg,
        "--api-version",
        config.apiVersion,
        "--ignore-conflicts",
      ],
      cwd,
      artifactsDir: runDir,
      artifactBaseName: "project-retrieve-start",
      onProgress: (line) => {
        if (line.startsWith("Status: ")) {
          currentRetrieveStatus = line.slice("Status: ".length);
        }
        step(`retrieve: ${line}`);
      },
      streamLiveOutput: false,
    });
  } finally {
    clearInterval(retrieveHeartbeat);
  }
  timings.sfRetrieveMs = retrieveResult.elapsedMs;
  timings.retrieveStageMs = Date.now() - retrieveStartedAt;
  step(`Retrieve metadata time: ${formatDuration(timings.sfRetrieveMs)}`);

  const transformStartedAt = Date.now();
  step("Running post-retrieve transforms");
  const transformResult = await runPostRetrieveTransforms({
    config,
    manifestPath,
    forceAppDir,
    status: step,
  });
  timings.postRetrieveTransformsMs = Date.now() - transformStartedAt;
  step(`Post-retrieve transforms time: ${formatDuration(timings.postRetrieveTransformsMs)}`);
  const transformErrors = Array.isArray(transformResult.errors) ? transformResult.errors : [];
  if (transformErrors.length > 0) {
    step(`Post-retrieve transforms completed with ${transformErrors.length} error(s)`);
    for (const transformError of transformErrors) {
      step(`transform error [${transformError.id}]: ${transformError.message}`);
    }
  }

  const resetTrackingStartedAt = Date.now();
  let trackingResetOutcome = "succeeded";
  let trackingResetError = null;
  if (!isSandboxLike) {
    trackingResetOutcome = "not-applicable";
  } else {
    try {
      step("Resetting source tracking to current org state for a clean baseline (post-transforms)");
      await runSfCommand({
        cmdArgs: [
          "project",
          "reset",
          "tracking",
          "--target-org",
          targetOrg,
          "--no-prompt",
        ],
        cwd,
        artifactsDir: runDir,
        artifactBaseName: "project-reset-tracking",
        streamLiveOutput: false,
      });
    } catch (err) {
      trackingResetOutcome = "skipped";
      trackingResetError = err && err.message ? String(err.message) : "unknown error";
      step("Source tracking reset skipped (see debug log for details)");
    }
  }
  timings.resetTrackingMs = Date.now() - resetTrackingStartedAt;

  timings.totalMs = Date.now() - startedAt;
  const debugPath = path.join(runDir, "debug.json");
  fs.writeFileSync(
    debugPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targetOrg,
        configPath,
        manifestPath,
        forceAppDir,
        clean,
        cleanResult,
        trackingResetOutcome,
        trackingResetError,
        timings,
      warnings: generateResult.warnings || [],
      transformResult,
    },
    null,
    2
    )}\n`,
    "utf8"
  );

  step(`Total time: ${formatDuration(timings.totalMs)}`);
    return {
      configPath,
      targetOrg,
      manifestPath,
      forceAppDir,
      clean,
      cleanResult,
      trackingResetOutcome,
      trackingResetError,
      runDir: debug ? runDir : null,
      debugPath: debug ? debugPath : null,
      timings,
      warnings: generateResult.warnings || [],
      transformResult,
      transformErrors,
    };
  } finally {
    cleanupRunArtifactsDir(runDir, debug);
  }
}

module.exports = {
  runRetrieve,
  _private: {
    buildTrackingStateDirs,
    clearDirectoryContents,
    clearRetrieveState,
    clearTrackingStateDirs,
    isSafeTrackingIdentifier,
    isSandboxLikeUrl,
    redactSensitiveFields,
  },
};
