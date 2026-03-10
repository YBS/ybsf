const fs = require("fs");
const path = require("path");

const schemaPath = path.resolve(__dirname, "../../docs/schemas/sf-metadata-config.schema.json");
let validateFn = null;

function getValidator() {
  if (validateFn) {
    return validateFn;
  }
  let Ajv2020 = null;
  try {
    // Lazy load so commands that do not load config can still run without deps installed.
    Ajv2020 = require("ajv/dist/2020");
  } catch (err) {
    throw new Error("Missing dependency: ajv. Run `npm install` in the ybsf project.");
  }
  const raw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validateFn = ajv.compile(schema);
  return validateFn;
}

function validateConfigSchema(config) {
  const validate = getValidator();
  const valid = validate(config);
  if (valid) {
    return;
  }
  const messages = (validate.errors || []).map((err) => {
    const pathText = err.instancePath || "/";
    const propertyName =
      err &&
      err.keyword === "additionalProperties" &&
      err.params &&
      typeof err.params.additionalProperty === "string"
        ? ` (${err.params.additionalProperty})`
        : "";
    return `- ${pathText} ${err.message}${propertyName}`;
  });
  throw new Error(`Schema validation failed:\n${messages.join("\n")}`);
}

module.exports = {
  validateConfigSchema,
};
