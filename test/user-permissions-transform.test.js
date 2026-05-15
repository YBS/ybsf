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

test("profile cleanup keeps layout assignments for configured pseudo objects", () => {
  const xml = [
    '<Profile xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <layoutAssignments>",
    "        <layout>Case-Customer Case Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>CaseClose-Close Case Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>CaseClose-Close Case Layout</layout>",
    "        <recordType>Case.Default_Case</recordType>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>CaseInteraction-Case Feed Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>Global-Global Layout</layout>",
    "    </layoutAssignments>",
    "    <layoutAssignments>",
    "        <layout>conference360__Event__c-conference360__Event Layout</layout>",
    "    </layoutAssignments>",
    "</Profile>",
    "",
  ].join("\n");
  const manifestMembersByType = new Map([
    ["CustomObject", ["Case"]],
    ["RecordType", ["Case.Default_Case"]],
  ]);

  const result = applyPermissionPolicies(
    xml,
    { mode: "all", members: [] },
    manifestMembersByType,
    new Set(),
    {
      applyProfileScopeCleanup: true,
      includePseudoObjects: ["CaseClose", "CaseInteraction", "Global"],
    }
  );

  assert.equal(result.removedLayoutAssignments, 1);
  assert.match(result.cleaned, /Case-Customer Case Layout/);
  assert.match(result.cleaned, /CaseClose-Close Case Layout/);
  assert.match(result.cleaned, /Case\.Default_Case/);
  assert.match(result.cleaned, /CaseInteraction-Case Feed Layout/);
  assert.match(result.cleaned, /Global-Global Layout/);
  assert.doesNotMatch(result.cleaned, /conference360__Event__c/);
});

test("profile cleanup removes pseudo object layout assignments when pseudo object is not configured", () => {
  const xml = [
    '<Profile xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <layoutAssignments>",
    "        <layout>CaseClose-Close Case Layout</layout>",
    "    </layoutAssignments>",
    "</Profile>",
    "",
  ].join("\n");
  const manifestMembersByType = new Map([
    ["CustomObject", ["Case"]],
  ]);

  const result = applyPermissionPolicies(
    xml,
    { mode: "all", members: [] },
    manifestMembersByType,
    new Set(),
    {
      applyProfileScopeCleanup: true,
      includePseudoObjects: ["CaseInteraction", "Global"],
    }
  );

  assert.equal(result.removedLayoutAssignments, 1);
  assert.doesNotMatch(result.cleaned, /CaseClose-Close Case Layout/);
});

test("profile cleanup removes flow accesses outside flow scope", () => {
  const xml = [
    '<Profile xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <flowAccesses>",
    "        <enabled>false</enabled>",
    "        <flow>sfdc_default_ReportExport_Protection_Flow</flow>",
    "    </flowAccesses>",
    "    <flowAccesses>",
    "        <enabled>true</enabled>",
    "        <flow>Included_Flow</flow>",
    "    </flowAccesses>",
    "</Profile>",
    "",
  ].join("\n");
  const manifestMembersByType = new Map([
    ["Flow", ["Included_Flow"]],
  ]);

  const result = applyPermissionPolicies(
    xml,
    { mode: "all", members: [] },
    manifestMembersByType,
    new Set(),
    { applyProfileScopeCleanup: true }
  );

  assert.equal(result.removedFlowAccesses, 1);
  assert.match(result.cleaned, /Included_Flow/);
  assert.doesNotMatch(result.cleaned, /sfdc_default_ReportExport_Protection_Flow/);
});
