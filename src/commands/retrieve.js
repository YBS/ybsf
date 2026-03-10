const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig } = require("../config/load-config");
const { runGenerateManifest } = require("./generate-manifest");
const { runPostRetrieveTransforms } = require("../transforms/run-post-retrieve-transforms");
const { safeFileSuffix, formatDuration } = require("./helpers/command-utils");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");

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
  const commandText = `sf ${cmdArgs.join(" ")}`;
  const startedAt = Date.now();
  const child = spawn("sf", cmdArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
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
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.raw.txt`), rawStdout, "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.raw.txt`), rawStderr, "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.txt`), sanitizeTerminalOutput(rawStdout), "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.txt`), sanitizeTerminalOutput(rawStderr), "utf8");
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
    const code = processError.code ? ` (${processError.code})` : "";
    const msg = processError.message || "unknown error";
    throw new Error(`sf command failed${code}: ${msg}`);
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

async function runRetrieve({ targetOrg, status, debug = false }) {
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
  const clearStartedAt = Date.now();
  step(`Clearing ${forceAppDir}`);
  clearDirectoryContents(forceAppDir);
  timings.clearForceAppMs = Date.now() - clearStartedAt;

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
};
