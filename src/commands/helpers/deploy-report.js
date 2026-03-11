function parseDeployIdFromText(raw) {
  const text = String(raw || "");
  const match = text.match(/Deploy ID:\s*([A-Za-z0-9]+)/u);
  return match ? match[1] : null;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function toInteger(value) {
  const numeric = Number.parseInt(String(value == null ? "" : value), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPercent(covered, total) {
  if (total <= 0) {
    return null;
  }
  return ((covered / total) * 100).toFixed(2);
}

function buildCoverageSummary(runTestResult) {
  const codeCoverage = asArray(runTestResult && runTestResult.codeCoverage);
  let covered = 0;
  let total = 0;

  for (const entry of codeCoverage) {
    const numLocations = toInteger(entry && entry.numLocations);
    const numLocationsNotCovered = toInteger(entry && entry.numLocationsNotCovered);
    if (numLocations <= 0) {
      continue;
    }
    total += numLocations;
    covered += Math.max(0, numLocations - numLocationsNotCovered);
  }

  if (total <= 0) {
    return null;
  }

  return {
    covered,
    total,
    percent: formatPercent(covered, total),
  };
}

function buildFailureLine(failure) {
  const type = failure.componentType || failure.type || "UnknownType";
  const name = failure.fullName || failure.name || failure.methodName || "UnknownName";
  const problem = failure.problem || failure.message || failure.error || "Unknown error";
  const line = failure.lineNumber || failure.line || "";
  const column = failure.columnNumber || failure.column || "";
  const location = line ? ` (${line}${column ? `:${column}` : ""})` : "";
  return `${type} ${name}: ${problem}${location}`;
}

function summarizeDeployReport(reportJson) {
  const report = reportJson && reportJson.result ? reportJson.result : {};
  const details = report.details || {};
  const runTestResult = details.runTestResult || {};
  const componentFailures = asArray(details.componentFailures);
  const testFailures = asArray(runTestResult.failures);
  const warnings = asArray(reportJson && reportJson.warnings);
  const coverageWarnings = asArray(runTestResult.codeCoverageWarnings);
  const flowCoverageWarnings = asArray(runTestResult.flowCoverageWarnings);
  const coverage = buildCoverageSummary(runTestResult);

  const lines = [];
  lines.push("");
  lines.push(`report: ********** Status: ${report.status || "Unknown"} **********`);
  lines.push(`report: Deploy ID: ${report.id || "Unknown"}`);
  lines.push(
    `report: Components: ${toInteger(report.numberComponentsDeployed)}/${toInteger(report.numberComponentsTotal)}`
  );
  lines.push(`report: Tests: ${toInteger(report.numberTestsCompleted)}/${toInteger(report.numberTestsTotal)}`);

  if (coverage) {
    lines.push(`report: Apex coverage: ${coverage.percent}% (${coverage.covered}/${coverage.total} locations)`);
  }

  if (warnings.length > 0) {
    lines.push(`report: Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      lines.push(`report:   ${String(warning)}`);
    }
  }

  if (coverageWarnings.length > 0) {
    lines.push(`report: Coverage warnings (${coverageWarnings.length}):`);
    for (const warning of coverageWarnings) {
      lines.push(`report:   ${String(warning)}`);
    }
  }

  if (flowCoverageWarnings.length > 0) {
    lines.push(`report: Flow coverage warnings (${flowCoverageWarnings.length}):`);
    for (const warning of flowCoverageWarnings) {
      lines.push(`report:   ${String(warning)}`);
    }
  }

  if (componentFailures.length > 0) {
    lines.push(`report: Component failures (${componentFailures.length}):`);
    for (const failure of componentFailures) {
      lines.push(`report:   ${buildFailureLine(failure)}`);
    }
  }

  if (testFailures.length > 0) {
    lines.push(`report: Test failures (${testFailures.length}):`);
    for (const failure of testFailures) {
      lines.push(`report:   ${buildFailureLine(failure)}`);
    }
  }

  const errorSummaryLines = [];
  errorSummaryLines.push(`report: ********** Status: ${report.status || "Unknown"} **********`);
  errorSummaryLines.push(`report: Deploy ID: ${report.id || "Unknown"}`);
  errorSummaryLines.push(`report: Components: ${toInteger(report.numberComponentsDeployed)}/${toInteger(report.numberComponentsTotal)}`);
  errorSummaryLines.push(`report: Tests: ${toInteger(report.numberTestsCompleted)}/${toInteger(report.numberTestsTotal)}`);
  if (coverage) {
    errorSummaryLines.push(`report: Apex coverage: ${coverage.percent}% (${coverage.covered}/${coverage.total} locations)`);
  }
  if (componentFailures.length > 0) {
    errorSummaryLines.push(`report: Component failures (${componentFailures.length}):`);
    for (const failure of componentFailures) {
      errorSummaryLines.push(`report:   ${buildFailureLine(failure)}`);
    }
  }
  if (testFailures.length > 0) {
    errorSummaryLines.push(`report: Test failures (${testFailures.length}):`);
    for (const failure of testFailures) {
      errorSummaryLines.push(`report:   ${buildFailureLine(failure)}`);
    }
  }
  if (componentFailures.length === 0 && testFailures.length === 0 && warnings.length > 0) {
    errorSummaryLines.push(`report: Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      errorSummaryLines.push(`report:   ${String(warning)}`);
    }
  }

  return {
    status: String(report.status || "Unknown"),
    deployId: report.id || null,
    componentFailures,
    testFailures,
    warnings,
    coverageWarnings,
    flowCoverageWarnings,
    coverage,
    lines,
    hasFailures: componentFailures.length > 0 || testFailures.length > 0,
    errorMessage: errorSummaryLines.join("\n"),
  };
}

module.exports = {
  parseDeployIdFromText,
  summarizeDeployReport,
};
