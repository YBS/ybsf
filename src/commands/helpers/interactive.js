const readline = require("readline");

function isInteractiveTerminal() {
  return Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
}

async function promptYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(question, (value) => resolve(String(value || "").trim()));
    });
    return /^y(?:es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}

async function confirmTargetOrg({ commandLabel, details, step }) {
  const alias = details?.alias || "";
  const username = details?.username || "";
  const instanceUrl = details?.instanceUrl || "";
  const environment = details?.environment || "Unknown";
  const orgId = details?.orgId || "";

  if (!isInteractiveTerminal()) {
    if (typeof step === "function") {
      step(
        `${commandLabel}: Non-interactive terminal; skipping target-org confirmation. target=${alias}, user=${username}, env=${environment}, endpoint=${instanceUrl}`
      );
    }
    return true;
  }

  const lines = [
    `${commandLabel}: Confirm target org before deploy:`,
    `  Alias: ${alias}`,
    `  Username: ${username}`,
    `  Environment: ${environment}`,
    `  Endpoint: ${instanceUrl}`,
    `  Org Id: ${orgId}`,
  ];
  if (typeof step === "function") {
    for (const line of lines) {
      step(line);
    }
  }
  return promptYesNo(`${commandLabel}: Proceed with this target org? [y/N] `);
}

async function resolveApplyDestructive({
  explicitApplyDestructive,
  destructiveCount,
  commandLabel,
  step,
}) {
  if (explicitApplyDestructive) {
    return true;
  }
  if (!isInteractiveTerminal()) {
    if (typeof step === "function") {
      step(
        `${commandLabel}: Destructive candidates found (${destructiveCount}) but terminal is non-interactive; continuing without destructive changes.`
      );
    }
    return false;
  }

  return promptYesNo(
    `${commandLabel}: Destructive candidates found (${destructiveCount}). Include destructive changes in this run? [y/N] `
  );
}

module.exports = {
  confirmTargetOrg,
  resolveApplyDestructive,
};
