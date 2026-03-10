function parseJson(raw, context) {
  try {
    return JSON.parse(String(raw || ""));
  } catch (err) {
    throw new Error(`${context}: invalid JSON (${err.message})`);
  }
}

function inferEnvironmentFromUrl(instanceUrl) {
  const value = String(instanceUrl || "").toLowerCase();
  if (!value) {
    return "Unknown";
  }
  if (value.includes("sandbox") || value.includes(".cs")) {
    return "Sandbox";
  }
  if (value.includes(".scratch.")) {
    return "Scratch";
  }
  if (value.includes("trailblaze.my.salesforce.com")) {
    return "Trailhead";
  }
  return "Production";
}

async function fetchTargetOrgDetails({ targetOrg, runSfCommand, artifactsDir, artifactBaseNamePrefix = "org-target" }) {
  const displayOutput = await runSfCommand({
    cmdArgs: ["org", "display", "--target-org", targetOrg, "--json"],
    cwd: process.cwd(),
    artifactsDir,
    artifactBaseName: `${artifactBaseNamePrefix}-display`,
    streamLiveOutput: false,
  });
  const displayJson = parseJson(displayOutput.stdout, "sf org display");
  const displayResult = displayJson?.result || {};

  let isSandbox = null;
  try {
    const queryOutput = await runSfCommand({
      cmdArgs: [
        "data",
        "query",
        "--query",
        "SELECT IsSandbox FROM Organization",
        "--target-org",
        targetOrg,
        "--json",
      ],
      cwd: process.cwd(),
      artifactsDir,
      artifactBaseName: `${artifactBaseNamePrefix}-organization`,
      streamLiveOutput: false,
    });
    const queryJson = parseJson(queryOutput.stdout, "sf data query");
    const row = queryJson?.result?.records?.[0] || null;
    if (row && Object.prototype.hasOwnProperty.call(row, "IsSandbox")) {
      isSandbox = Boolean(row.IsSandbox);
    }
  } catch (_err) {
    // If this query fails, continue with inferred environment.
    isSandbox = null;
  }

  const username = displayResult.username || displayResult.userName || "";
  const alias = displayResult.alias || targetOrg;
  const instanceUrl = displayResult.instanceUrl || "";
  const orgId = displayResult.id || displayResult.orgId || "";
  const environment =
    isSandbox == null ? inferEnvironmentFromUrl(instanceUrl) : isSandbox ? "Sandbox" : "Production";

  return {
    alias,
    username,
    instanceUrl,
    orgId,
    environment,
    isSandbox,
  };
}

module.exports = {
  fetchTargetOrgDetails,
};
