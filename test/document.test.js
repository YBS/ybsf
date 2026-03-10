const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runCli } = require("../src/cli");
const {
  runDocument,
  OBJECT_FIELDS_TASK,
  PICKLIST_VALUES_TASK,
  PICKLIST_VALUES_CONTROLLING_TASK,
  PICKLIST_VALUES_RECORD_TYPES_TASK,
} = require("../src/commands/document");

const FIXTURE_SOURCE_DIR = path.resolve(__dirname, "fixtures/document/source");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-document-test-"));
}

function readCsvRows(filePath) {
  const lines = fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  return lines.map((line) => {
    const cells = [];
    const re = /"((?:[^"]|"")*)"(?:,|$)/g;
    let match = null;
    while ((match = re.exec(line)) !== null) {
      cells.push(match[1].replace(/""/g, '"'));
    }
    return cells;
  });
}

test("document task validation errors", async () => {
  await assert.rejects(
    () =>
      runDocument({
        task: "badTask",
        object: "TestObj__c",
        sourceDir: FIXTURE_SOURCE_DIR,
        outputDir: createTempDir(),
      }),
    /Unknown document task/
  );

  await assert.rejects(
    () =>
      runDocument({
        task: PICKLIST_VALUES_TASK,
        sourceDir: FIXTURE_SOURCE_DIR,
        outputDir: createTempDir(),
      }),
    /requires --object unless --all/
  );

  await assert.rejects(
    () =>
      runDocument({
        task: OBJECT_FIELDS_TASK,
        object: "TestObj__c",
        sourceDir: FIXTURE_SOURCE_DIR,
        outputDir: createTempDir(),
      }),
    /requires --target-org/
  );
});

test("document picklistValues creates deterministic CSV", async () => {
  const outputDir = createTempDir();
  await runDocument({
    task: PICKLIST_VALUES_TASK,
    object: "TestObj__c",
    sourceDir: FIXTURE_SOURCE_DIR,
    outputDir,
  });

  const rows = readCsvRows(path.join(outputDir, "PicklistValues", "TestObj__c.csv"));
  assert.deepEqual(rows[0], ["File", "FieldName", "PicklistValue", "API Name", "Default", "ControllingField"]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[1], ["TestObj__c.object", "Dependent__c", "One", "One", "false", "Status__c"]);
  assert.deepEqual(rows[4], ["TestObj__c.object", "Status__c", "Open", "Open", "true", ""]);
});

test("document picklistValuesControllingField creates deterministic CSV", async () => {
  const outputDir = createTempDir();
  await runDocument({
    task: PICKLIST_VALUES_CONTROLLING_TASK,
    object: "TestObj__c",
    sourceDir: FIXTURE_SOURCE_DIR,
    outputDir,
  });

  const rows = readCsvRows(path.join(outputDir, "PicklistValuesControllingField", "TestObj__c.csv"));
  assert.deepEqual(rows[0], ["File", "FieldName", "PicklistValue", "ControllingField", "ControllingFieldValue"]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["TestObj__c.object", "Dependent__c", "One", "Status__c", "Open"]);
  assert.deepEqual(rows[2], ["TestObj__c.object", "Dependent__c", "Two", "Status__c", "Closed"]);
});

test("document picklistValuesRecordTypes creates deterministic CSV", async () => {
  const outputDir = createTempDir();
  await runDocument({
    task: PICKLIST_VALUES_RECORD_TYPES_TASK,
    object: "TestObj__c",
    sourceDir: FIXTURE_SOURCE_DIR,
    outputDir,
  });

  const rows = readCsvRows(path.join(outputDir, "PicklistValuesRecordTypes", "TestObj__c.csv"));
  assert.deepEqual(rows[0], ["File", "RecordType", "FieldName", "PicklistValue", "Default"]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["TestObj__c.object", "Default", "Status__c", "Closed", "false"]);
  assert.deepEqual(rows[2], ["TestObj__c.object", "Default", "Status__c", "Open", "true"]);
});

test("document objectFields creates near-legacy CSV without Field Trip columns", async () => {
  const outputDir = createTempDir();
  const createSfClient = () => ({
    async describeObject() {
      return {
        fields: [
          {
            name: "Name",
            label: "Name",
            type: "string",
            externalId: false,
            unique: false,
            caseSensitive: false,
            length: 80,
            precision: 0,
            scale: 0,
            digits: 0,
            calculatedFormula: null,
            inlineHelpText: null,
          },
          {
            name: "Custom_Text__c",
            label: "Custom Text",
            type: "string",
            externalId: false,
            unique: false,
            caseSensitive: false,
            length: 80,
            precision: 0,
            scale: 0,
            digits: 0,
            calculatedFormula: null,
            inlineHelpText: "Describe help",
          },
          {
            name: "Status__c",
            label: "Status",
            type: "picklist",
            externalId: false,
            unique: false,
            caseSensitive: false,
            length: 0,
            precision: 0,
            scale: 0,
            digits: 0,
            calculatedFormula: null,
            inlineHelpText: null,
          },
          {
            name: "Dependent__c",
            label: "Dependent",
            type: "picklist",
            externalId: false,
            unique: false,
            caseSensitive: false,
            length: 0,
            precision: 0,
            scale: 0,
            digits: 0,
            calculatedFormula: null,
            inlineHelpText: null,
          },
        ],
      };
    },
    async toolingQuery(query) {
      if (query.includes("FROM CustomObject")) {
        return [{ Id: "01Ixx0000001234AAA" }];
      }
      return [
        { DeveloperName: "Custom_Text", CreatedDate: "2024-01-01T12:00:00.000Z" },
        { DeveloperName: "Status", CreatedDate: "2024-02-02T12:00:00.000Z" },
        { DeveloperName: "Dependent", CreatedDate: "2024-03-03T12:00:00.000Z" },
      ];
    },
    async retrieveObjectMetadataXml() {
      return `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
  <fields>
    <fullName>Name</fullName>
    <trackHistory>true</trackHistory>
    <trackFeedHistory>false</trackFeedHistory>
  </fields>
  <fields>
    <fullName>Custom_Text__c</fullName>
    <trackHistory>true</trackHistory>
    <trackFeedHistory>true</trackFeedHistory>
  </fields>
</CustomObject>`;
    },
  });

  await runDocument({
    task: OBJECT_FIELDS_TASK,
    object: "TestObj__c",
    sourceDir: FIXTURE_SOURCE_DIR,
    outputDir,
    targetOrg: "stub-org",
    createSfClient,
  });

  const rows = readCsvRows(path.join(outputDir, "ObjectFields", "TestObj__c.csv"));
  assert.deepEqual(rows[0].slice(0, 15), [
    "Object",
    "Field Label",
    "Field API Name",
    "Created Date",
    "Data Type",
    "Length",
    "Required",
    "External Id",
    "Unique",
    "Track History",
    "Track Feed History",
    "Formula",
    "Description",
    "Help Text",
    "# Layouts",
  ]);
  assert.equal(rows[0].includes("# Populated"), false);
  assert.equal(rows[0].includes("% Populated"), false);
  assert.equal(rows[0][15], "Test Layout");

  const customTextRow = rows.find((row) => row[2] === "Custom_Text__c");
  assert.ok(customTextRow);
  assert.equal(customTextRow[6], "X");
  assert.equal(customTextRow[9], "X");
  assert.equal(customTextRow[10], "X");
  assert.equal(customTextRow[12], "Custom text description");
  assert.equal(customTextRow[13], "Enter custom text");
  assert.equal(customTextRow[14], "1");
  assert.equal(customTextRow[15], "X");

  const nameRow = rows.find((row) => row[2] === "Name");
  assert.ok(nameRow);
  assert.equal(nameRow[9], "X");
});

test("cli document validation for objectFields requires target org", async () => {
  const outputDir = createTempDir();
  await assert.rejects(
    () =>
      runCli([
        "document",
        "objectFields",
        "--object",
        "TestObj__c",
        "--source-dir",
        FIXTURE_SOURCE_DIR,
        "--output-dir",
        outputDir,
      ]),
    /requires --target-org/
  );
});
