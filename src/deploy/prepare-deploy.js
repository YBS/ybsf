const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig } = require("../config/load-config");
const { runGenerateManifest } = require("../commands/generate-manifest");
const { parsePackageXml } = require("../legacy/parse-package-xml");
const { writePackageXml } = require("../manifest/write-package-xml");
const { safeFileSuffix } = require("../commands/helpers/command-utils");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("../commands/helpers/run-artifacts");

function salesforceLexSort(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function stripAnsi(input) {
  const text = String(input || "");
  const noCsi = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return noCsi.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function normalizeDeployProgressLine(line) {
  const text = stripAnsi(String(line || "")).trim();
  if (!text) {
    return null;
  }

  const statusMatch = text.match(/^Status:\s*(.+)$/u);
  if (statusMatch) {
    const value = statusMatch[1].trim();
    if (!/[A-Za-z]/.test(value)) {
      return null;
    }
    return `Status: ${value}`;
  }

  const componentMatch = text.match(/(?:^|^\S+\s+)Components:\s+.+$/u);
  if (componentMatch) {
    const normalized = text.replace(/^\S+\s+(Components:\s+.+)$/u, "$1");
    return normalized.startsWith("Components:") ? normalized : text;
  }

  const testsMatch = text.match(/(?:^|^\S+\s+)Tests:\s+.+$/u);
  if (testsMatch) {
    const normalized = text.replace(/^\S+\s+(Tests:\s+.+)$/u, "$1");
    return normalized.startsWith("Tests:") ? normalized : text;
  }

  if (/Running Tests/i.test(text) && /\b\d+(?:\.\d+)?s\b/.test(text)) {
    return "Tests: Running";
  }

  const successfulMatch = text.match(/Successful:\s+.+$/u);
  if (successfulMatch) {
    return successfulMatch[0].trim();
  }

  const failedMatch = text.match(/Failed:\s+.+$/u);
  if (failedMatch) {
    return failedMatch[0].trim();
  }

  return null;
}

async function runSfCommand({ cmdArgs, cwd, artifactsDir, artifactBaseName, streamLiveOutput, onProgress }) {
  const commandText = `sf ${cmdArgs.join(" ")}`;
  const startedAt = Date.now();
  const child = spawn("sf", cmdArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  let processError = null;
  let stdoutRemainder = "";
  let stderrRemainder = "";
  let lastProgress = "";
  const consumeProgress = (value, isStderr) => {
    const incoming = (isStderr ? stderrRemainder : stdoutRemainder) + value;
    const normalized = stripAnsi(incoming).replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    const remainder = parts.pop() || "";
    if (isStderr) {
      stderrRemainder = remainder;
    } else {
      stdoutRemainder = remainder;
    }
    if (typeof onProgress !== "function") {
      return;
    }
    for (const line of parts) {
      const progress = normalizeDeployProgressLine(line);
      if (!progress || progress === lastProgress) {
        continue;
      }
      lastProgress = progress;
      onProgress(progress);
    }
  };

  const result = await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      stdout += value;
      consumeProgress(value, false);
      if (streamLiveOutput) {
        process.stdout.write(value);
      }
    });
    child.stderr.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      stderr += value;
      consumeProgress(value, true);
      if (streamLiveOutput) {
        process.stderr.write(value);
      }
    });
    child.on("error", (err) => {
      processError = err;
      reject(err);
    });
    child.on("close", (code, signal) => resolve({ status: code, signal }));
  }).catch((err) => {
    processError = err;
    return { status: null, signal: null };
  });

  const elapsedMs = Date.now() - startedAt;
  const baseName = safeFileSuffix(artifactBaseName);
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.cmd.txt`), `${commandText}\n`, "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.txt`), stdout || "", "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.txt`), stderr || "", "utf8");
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
    const stderrMessage = (stderr || "").trim();
    const signalMessage = result.signal ? ` (signal ${result.signal})` : "";
    const error = new Error(
      stderrMessage.length > 0
        ? stderrMessage
        : `sf command failed with status ${result.status}${signalMessage}`
    );
    error.stdout = stdout || "";
    error.stderr = stderr || "";
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }

  return {
    stdout: stdout || "",
    stderr: stderr || "",
    elapsedMs,
  };
}

function mapToSortedObject(map) {
  const out = {};
  const sortedTypes = Array.from(map.keys()).sort(salesforceLexSort);
  for (const typeName of sortedTypes) {
    out[typeName] = Array.from(map.get(typeName) || []).sort(salesforceLexSort);
  }
  return out;
}

function computeDestructiveCandidates({ desiredMembersByType, orgMembersByType }) {
  const destructiveByType = new Map();
  const nonDeletableRecordTypes = [];

  for (const [typeName, orgMembers] of orgMembersByType.entries()) {
    const desired = new Set(desiredMembersByType.get(typeName) || []);
    for (const member of orgMembers) {
      if (desired.has(member)) {
        continue;
      }
      if (typeName === "RecordType") {
        nonDeletableRecordTypes.push(member);
        continue;
      }
      if (!destructiveByType.has(typeName)) {
        destructiveByType.set(typeName, new Set());
      }
      destructiveByType.get(typeName).add(member);
    }
  }

  return {
    destructiveByType,
    nonDeletableRecordTypes: nonDeletableRecordTypes.sort(salesforceLexSort),
  };
}

async function prepareDeploy({
  configPath,
  targetOrg,
  status,
  desiredManifestPath = path.resolve("manifest/package.xml"),
  debug = false,
}) {
  const step = (message) => {
    if (typeof status === "function") {
      status(message);
    }
  };
  if (!targetOrg || !String(targetOrg).trim()) {
    throw new Error("target org is required");
  }

  const runDir = createRunArtifactsDir("ybsf-deploy", process.cwd());
  try {

  step("Loading config");
  const { config, path: resolvedConfigPath } = loadConfig(configPath || path.resolve("ybsf-metadata-config.json"));

  const resolvedDesiredManifestPath = path.resolve(desiredManifestPath);
  if (!fs.existsSync(resolvedDesiredManifestPath)) {
    throw new Error(`Committed deploy manifest not found: ${resolvedDesiredManifestPath}`);
  }
  step(`Using committed deploy manifest ${resolvedDesiredManifestPath}`);
  const desiredMembersByType = parsePackageXml(fs.readFileSync(resolvedDesiredManifestPath, "utf8"));

  step(`Generating target-org scoped manifest from ${targetOrg}`);
  const targetOrgManifestPath = path.join(runDir, "target-org-manifest", "package.xml");
  const targetOrgManifestResult = await runGenerateManifest({
    configPath: resolvedConfigPath,
    outputPath: targetOrgManifestPath,
    targetOrg,
    debug,
    status: (msg) => step(msg.replace(/^\[generate-manifest\]\s*/u, "generate-manifest: ")),
  });
  const orgPackagePath = targetOrgManifestResult.outputPath;
  const orgMembersByType = parsePackageXml(fs.readFileSync(orgPackagePath, "utf8"));

  const { destructiveByType, nonDeletableRecordTypes } = computeDestructiveCandidates({
    desiredMembersByType,
    orgMembersByType,
  });
  const destructivePath = path.join(runDir, "destructiveChanges.xml");
  if (destructiveByType.size > 0) {
    writePackageXml({
      outputPath: destructivePath,
      apiVersion: config.apiVersion,
      typeMembersMap: destructiveByType,
    });
  } else {
    fs.rmSync(destructivePath, { force: true });
  }

  const destructiveCount = Array.from(destructiveByType.values()).reduce(
    (sum, members) => sum + members.size,
    0
  );
  const destructiveManifestXml =
    destructiveByType.size > 0 && fs.existsSync(destructivePath)
      ? fs.readFileSync(destructivePath, "utf8")
      : null;
  const debugPath = path.join(runDir, "deploy-prepare-debug.json");
  fs.writeFileSync(
    debugPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        configPath: resolvedConfigPath,
        targetOrg,
        apiVersion: config.apiVersion,
        desiredManifestPath: resolvedDesiredManifestPath,
        orgPackagePath,
        destructiveCount,
        destructiveByType: mapToSortedObject(destructiveByType),
        nonDeletableRecordTypes,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

    return {
      runDir,
      debugPath: debug ? debugPath : null,
      cleanup: () => cleanupRunArtifactsDir(runDir, debug),
      configPath: resolvedConfigPath,
      config,
      targetOrg,
      desiredManifestPath: resolvedDesiredManifestPath,
      orgPackagePath,
      destructivePath: destructiveByType.size > 0 ? destructivePath : null,
      destructiveManifestXml,
      destructiveCount,
      destructiveByType,
      nonDeletableRecordTypes,
      warnings: [
        ...(nonDeletableRecordTypes.length > 0
          ? [
              `RecordType destructive candidates are excluded (${nonDeletableRecordTypes.length}) and require manual cleanup.`,
            ]
          : []),
      ],
    };
  } catch (err) {
    cleanupRunArtifactsDir(runDir, debug);
    throw err;
  }
}

module.exports = {
  runSfCommand,
  prepareDeploy,
};
