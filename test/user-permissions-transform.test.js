const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPermissionPolicies } = require("../src/transforms/helpers/user-permissions");

test("profile cleanup removes layout assignments outside layout and object scope", () => {
  const xml = [
    '<Profile xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <layoutAssignments>",
    "        <layout>Website__c-Website Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>conference360__Event__c-conference360__Event Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>Website__c-Website Alternate Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>Website__c-Website Layout</layout>",
    "        <recordType>Website__c.Default</recordType>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>Website__c-Website Layout</layout>",
    "        <recordType>Website__c.Obsolete</recordType>",
    "    </layoutAssignments>",
    "</Profile>",
    "",
  ].join("\n");
  const manifestMembersByType = new Map([
    ["CustomObject", ["Website__c"]],
    ["Layout", ["Website__c-Website Layout"]],
    ["RecordType", ["Website__c.Default"]],
  ]);

  const result = applyPermissionPolicies(
    xml,
    { mode: "all", members: [] },
    manifestMembersByType,
    new Set(),
    { applyProfileScopeCleanup: true }
  );

  assert.equal(result.removedLayoutAssignments, 3);
  assert.match(result.cleaned, /Website__c-Website Layout/);
  assert.match(result.cleaned, /Website__c\.Default/);
  assert.doesNotMatch(result.cleaned, /conference360__Event__c/);
  assert.doesNotMatch(result.cleaned, /Website Alternate Layout/);
  assert.doesNotMatch(result.cleaned, /Website__c\.Obsolete/);
});
