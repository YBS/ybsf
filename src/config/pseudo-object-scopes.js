const DEFAULT_PSEUDO_OBJECT_SCOPES = [
  "CaseClose",
  "CaseComment",
  "CaseInteraction",
  "Global",
];

function normalizePseudoObjectScopes(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0)
    )
  ).sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}

module.exports = {
  DEFAULT_PSEUDO_OBJECT_SCOPES,
  normalizePseudoObjectScopes,
};
