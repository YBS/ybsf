function safeFileSuffix(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "_");
}

function getSfCommand(platform = process.platform) {
  return platform === "win32" ? "sf.cmd" : "sf";
}

function formatSfCommandError(err, sfCommand = getSfCommand()) {
  const code = err && err.code ? ` (${err.code})` : "";
  if (err && err.code === "ENOENT") {
    return `sf command failed${code}: unable to launch Salesforce CLI executable "${sfCommand}". Ensure Salesforce CLI is installed and available on PATH.`;
  }
  const msg = err && err.message ? err.message : "unknown error";
  return `sf command failed${code}: ${msg}`;
}

function formatDuration(ms) {
  const value = Number(ms) || 0;
  if (value > 60_000) {
    const totalSeconds = Math.round(value / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  if (value > 1_000) {
    const seconds = Math.round(value / 1000);
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  return `${Math.round(value)} ms`;
}

module.exports = {
  formatSfCommandError,
  safeFileSuffix,
  formatDuration,
  getSfCommand,
};
