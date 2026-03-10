const OPTIONAL_PROCESSING_DEFAULTS = Object.freeze({
  removeSiteUserDomains: true,
  removeProfileInactiveComponents: false,
  sortObjectActionOverrides: true,
  sortApplicationOverrides: true,
  sortLayoutPlatformActionListItems: true,
  sortGlobalValueSetInactiveValues: true,
  sortWorkflowTimeTriggers: true,
});

function resolveOptionalProcessing(config) {
  const configured =
    config &&
    config.processingRules &&
    config.processingRules.optionalProcessing &&
    typeof config.processingRules.optionalProcessing === "object"
      ? config.processingRules.optionalProcessing
      : {};
  const resolved = { ...OPTIONAL_PROCESSING_DEFAULTS };
  for (const key of Object.keys(OPTIONAL_PROCESSING_DEFAULTS)) {
    if (typeof configured[key] === "boolean") {
      resolved[key] = configured[key];
    }
  }
  return resolved;
}

module.exports = {
  OPTIONAL_PROCESSING_DEFAULTS,
  resolveOptionalProcessing,
};
