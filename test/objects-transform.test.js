const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const objectsTransform = require("../src/transforms/objects");

function writeFieldFile(rootDir, objectName, fieldName, xml) {
  const fieldsDir = path.join(rootDir, "main", "default", "objects", objectName, "fields");
  fs.mkdirSync(fieldsDir, { recursive: true });
  const filePath = path.join(fieldsDir, `${fieldName}.field-meta.xml`);
  fs.writeFileSync(filePath, xml, "utf8");
  return filePath;
}

function buildManifestMembers(fieldNames) {
  return new Map([
    ["CustomObject", ["TestObj__c"]],
    ["CustomField", fieldNames.map((fieldName) => `TestObj__c.${fieldName}`)],
  ]);
}

const unsortedPicklistXml = [
  '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
  "    <fullName>Dependent__c</fullName>",
  "    <label>Dependent</label>",
  "    <type>Picklist</type>",
  "    <valueSet>",
  "        <controllingField>Controller__c</controllingField>",
  "        <valueSettings>",
  "            <controllingFieldValue>Zeta</controllingFieldValue>",
  "            <controllingFieldValue>Alpha</controllingFieldValue>",
  "            <valueName>Beta</valueName>",
  "        </valueSettings>",
  "        <valueSettings>",
  "            <controllingFieldValue>Gamma</controllingFieldValue>",
  "            <valueName>Alpha</valueName>",
  "        </valueSettings>",
  "    </valueSet>",
  "</CustomField>",
  "",
].join("\n");

test("objects transform leaves picklist dependency order unchanged by default", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-objects-transform-"));
  try {
    const filePath = writeFieldFile(tempDir, "TestObj__c", "Dependent__c", unsortedPicklistXml);

    await objectsTransform.run({
      config: { processingRules: { optionalProcessing: {} } },
      manifestMembersByType: buildManifestMembers(["Dependent__c"]),
      forceAppDir: tempDir,
    });

    assert.equal(fs.readFileSync(filePath, "utf8"), unsortedPicklistXml);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("objects transform sorts picklist valueSettings and controlling values when enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-objects-transform-"));
  try {
    const filePath = writeFieldFile(tempDir, "TestObj__c", "Dependent__c", unsortedPicklistXml);

    const summary = await objectsTransform.run({
      config: { processingRules: { optionalProcessing: { sortPicklistDependencies: true } } },
      manifestMembersByType: buildManifestMembers(["Dependent__c"]),
      forceAppDir: tempDir,
    });

    const cleaned = fs.readFileSync(filePath, "utf8");
    assert.match(cleaned, /<valueName>Alpha<\/valueName>[\s\S]*<valueName>Beta<\/valueName>/);
    assert.match(
      cleaned,
      /<controllingFieldValue>Alpha<\/controllingFieldValue>[\s\S]*<controllingFieldValue>Zeta<\/controllingFieldValue>/
    );
    assert.equal(summary.changedFiles, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("objects transform does not rewrite picklist files without dependency settings", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-objects-transform-"));
  const independentPicklistXml = [
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <fullName>Independent__c</fullName>",
    "    <label>Independent</label>",
    "    <type>Picklist</type>",
    "    <valueSet>",
    "        <valueSetDefinition>",
    "            <sorted>false</sorted>",
    "            <value>",
    "                <fullName>Beta</fullName>",
    "                <default>false</default>",
    "                <label>Beta</label>",
    "            </value>",
    "            <value>",
    "                <fullName>Alpha</fullName>",
    "                <default>false</default>",
    "                <label>Alpha</label>",
    "            </value>",
    "        </valueSetDefinition>",
    "    </valueSet>",
    "</CustomField>",
    "",
  ].join("\n");
  try {
    const filePath = writeFieldFile(tempDir, "TestObj__c", "Independent__c", independentPicklistXml);

    const summary = await objectsTransform.run({
      config: { processingRules: { optionalProcessing: { sortPicklistDependencies: true } } },
      manifestMembersByType: buildManifestMembers(["Independent__c"]),
      forceAppDir: tempDir,
    });

    assert.equal(fs.readFileSync(filePath, "utf8"), independentPicklistXml);
    assert.equal(summary.writtenFiles, 0);
    assert.equal(summary.changedFiles, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("objects transform writes already sorted picklist dependencies for consistent formatting", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-objects-transform-"));
  const sortedPicklistXml = [
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <fullName>Dependent__c</fullName>",
    "    <label>Dependent</label>",
    "    <type>Picklist</type>",
    "    <valueSet>",
    "        <controllingField>Controller__c</controllingField>",
    "        <valueSettings>",
    "            <controllingFieldValue>Alpha</controllingFieldValue>",
    "            <controllingFieldValue>Zeta</controllingFieldValue>",
    "            <valueName>Alpha</valueName>",
    "        </valueSettings>",
    "        <valueSettings>",
    "            <controllingFieldValue>Gamma</controllingFieldValue>",
    "            <valueName>Beta</valueName>",
    "        </valueSettings>",
    "    </valueSet>",
    "</CustomField>",
    "",
  ].join("\n");
  try {
    const filePath = writeFieldFile(tempDir, "TestObj__c", "Dependent__c", sortedPicklistXml);

    const summary = await objectsTransform.run({
      config: { processingRules: { optionalProcessing: { sortPicklistDependencies: true } } },
      manifestMembersByType: buildManifestMembers(["Dependent__c"]),
      forceAppDir: tempDir,
    });

    assert.equal(fs.readFileSync(filePath, "utf8"), sortedPicklistXml);
    assert.equal(summary.writtenFiles, 1);
    assert.equal(summary.changedFiles, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("objects transform does not rewrite non-picklist field files for picklist dependency sorting", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-objects-transform-"));
  const textXml = [
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    "    <fullName>Text__c</fullName>",
    "    <label>Text</label>",
    "    <type>Text</type>",
    "    <length>255</length>",
    "</CustomField>",
    "",
  ].join("\n");
  try {
    const filePath = writeFieldFile(tempDir, "TestObj__c", "Text__c", textXml);

    const summary = await objectsTransform.run({
      config: { processingRules: { optionalProcessing: { sortPicklistDependencies: true } } },
      manifestMembersByType: buildManifestMembers(["Text__c"]),
      forceAppDir: tempDir,
    });

    assert.equal(fs.readFileSync(filePath, "utf8"), textXml);
    assert.equal(summary.writtenFiles, 0);
    assert.equal(summary.changedFiles, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
