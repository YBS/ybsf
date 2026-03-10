const propertyTypeMap = require("./legacy-property-type-map.json");

function parseLegacyPropertyTypeMap() {
  return new Map(Object.entries(propertyTypeMap));
}

module.exports = {
  parseLegacyPropertyTypeMap,
};
