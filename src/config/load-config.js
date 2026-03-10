const fs = require("fs");
const path = require("path");
const { validateConfigSchema } = require("./schema-validate");
const { validateConfigSemantics } = require("./semantic-validate");

function migrateInstalledNamespaceRules(config) {
  if (
    !config ||
    typeof config !== "object" ||
    !config.packageRules ||
    typeof config.packageRules !== "object" ||
    !Array.isArray(config.packageRules.namespaces)
  ) {
    return;
  }
  for (const namespaceRule of config.packageRules.namespaces) {
    if (!namespaceRule || typeof namespaceRule !== "object") {
      continue;
    }
    if (!Array.isArray(namespaceRule.metadataTypes) && Array.isArray(namespaceRule.typeRules)) {
      namespaceRule.metadataTypes = namespaceRule.typeRules;
    }
    delete namespaceRule.typeRules;
  }
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath || "ybsf-metadata-config.json");
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config file ${resolved}: ${err.message}`);
  }
  migrateInstalledNamespaceRules(parsed);
  validateConfigSchema(parsed);
  validateConfigSemantics(parsed);
  return {
    path: resolved,
    config: parsed,
  };
}

module.exports = {
  loadConfig,
};
