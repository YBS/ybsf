const sites = require("./sites");
const permissionSets = require("./permission-sets");
const profiles = require("./profiles");
const objects = require("./objects");
const applications = require("./applications");
const layouts = require("./layouts");
const globalValueSets = require("./global-value-sets");
const workflows = require("./workflows");

const TRANSFORMS = [
  sites,
  permissionSets,
  profiles,
  objects,
  applications,
  layouts,
  globalValueSets,
  workflows,
];

module.exports = {
  TRANSFORMS,
};
