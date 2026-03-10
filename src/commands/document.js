const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { parseXml, elementName } = require("../transforms/helpers/dom-xml");

const OBJECT_FIELDS_TASK = "objectFields";
const PICKLIST_VALUES_TASK = "picklistValues";
const PICKLIST_VALUES_CONTROLLING_TASK = "picklistValuesControllingField";
const PICKLIST_VALUES_RECORD_TYPES_TASK = "picklistValuesRecordTypes";
const DOCUMENT_TASKS = new Set([
  OBJECT_FIELDS_TASK,
  PICKLIST_VALUES_TASK,
  PICKLIST_VALUES_CONTROLLING_TASK,
  PICKLIST_VALUES_RECORD_TYPES_TASK,
]);
const TYPE_MAPPING = new Map([
  ["string", "Text"],
  ["picklist", "Picklist"],
  ["multipicklist", "MultiselectPicklist"],
  ["combobox", "Picklist"],
  ["reference", "Reference"],
  ["base64", "Blob"],
  ["boolean", "Checkbox"],
  ["currency", "Currency"],
  ["textarea", "TextArea"],
  ["int", "Number"],
  ["double", "Number"],
  ["percent", "Percent"],
  ["phone", "Phone"],
  ["id", "Id"],
  ["date", "Date"],
  ["datetime", "DateTime"],
  ["time", "DateTime"],
  ["url", "URL"],
  ["email", "Email"],
  ["location", "Location"],
  ["address", "Address"],
  ["long", "Number"],
]);

function salesforceLexSort(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function stripAnsi(input) {
  const text = String(input || "");
  const noCsi = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return noCsi.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function xmlElementChildren(node) {
  const out = [];
  for (let child = node ? node.firstChild : null; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      out.push(child);
    }
  }
  return out;
}

function xmlDirectChildrenByName(parent, childName) {
  return xmlElementChildren(parent).filter((child) => elementName(child) === childName);
}

function xmlFirstDirectChild(parent, childName) {
  const children = xmlDirectChildrenByName(parent, childName);
  return children.length > 0 ? children[0] : null;
}

function xmlFirstDirectChildText(parent, childName) {
  const child = xmlFirstDirectChild(parent, childName);
  if (!child) {
    return "";
  }
  return String(child.textContent || "").trim();
}

function xmlDescendantsByName(parent, childName) {
  const out = [];
  const visit = (node) => {
    for (const child of xmlElementChildren(node)) {
      if (elementName(child) === childName) {
        out.push(child);
      }
      visit(child);
    }
  };
  visit(parent);
  return out;
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function csvWrite(filePath, headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function formatDateMDY(dateLike) {
  if (!dateLike) {
    return "";
  }
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function normalizeBooleanText(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function listObjectApiNames(sourceDir) {
  const objectsDir = path.join(sourceDir, "objects");
  if (!fs.existsSync(objectsDir)) {
    return [];
  }
  return fs
    .readdirSync(objectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(salesforceLexSort);
}

function resolveObjectList({ sourceDir, object, all }) {
  const available = listObjectApiNames(sourceDir);
  if (all) {
    if (available.length === 0) {
      throw new Error(`No objects found under ${path.join(sourceDir, "objects")}`);
    }
    return available;
  }
  if (!object) {
    throw new Error("document requires --object unless --all is provided");
  }
  if (!available.includes(object)) {
    throw new Error(`Object not found in source directory: ${object}`);
  }
  return [object];
}

function collectLayoutFieldUsage(sourceDir, objectName) {
  const layoutsDir = path.join(sourceDir, "layouts");
  const layoutNames = new Set();
  const fieldsByApiNameLower = new Map();
  if (!fs.existsSync(layoutsDir)) {
    return {
      layoutNames: [],
      fieldsByApiNameLower,
    };
  }
  const relatedObjects = new Set([objectName]);
  if (objectName === "Account") {
    relatedObjects.add("PersonAccount");
  }

  const layoutFiles = fs
    .readdirSync(layoutsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".layout-meta.xml"))
    .map((entry) => entry.name)
    .sort(salesforceLexSort);

  for (const layoutFile of layoutFiles) {
    const dashIndex = layoutFile.indexOf("-");
    if (dashIndex <= 0) {
      continue;
    }
    const layoutObject = layoutFile.slice(0, dashIndex);
    if (!relatedObjects.has(layoutObject)) {
      continue;
    }
    const layoutName = layoutFile.slice(dashIndex + 1, -".layout-meta.xml".length);
    layoutNames.add(layoutName);
    const fullPath = path.join(layoutsDir, layoutFile);
    const doc = parseXml(fs.readFileSync(fullPath, "utf8"));
    const layoutItems = xmlDescendantsByName(doc.documentElement, "layoutItems");
    for (const layoutItem of layoutItems) {
      const fieldApiName = xmlFirstDirectChildText(layoutItem, "field");
      if (!fieldApiName) {
        continue;
      }
      const key = fieldApiName.toLowerCase();
      if (!fieldsByApiNameLower.has(key)) {
        fieldsByApiNameLower.set(key, new Set());
      }
      fieldsByApiNameLower.get(key).add(layoutName);
    }
  }
  return {
    layoutNames: Array.from(layoutNames).sort(salesforceLexSort),
    fieldsByApiNameLower,
  };
}

function parseLocalFieldMetadata(sourceDir, objectName) {
  const fieldsDir = path.join(sourceDir, "objects", objectName, "fields");
  const fieldMetaByApiNameLower = new Map();
  if (!fs.existsSync(fieldsDir)) {
    return fieldMetaByApiNameLower;
  }
  const fieldFiles = fs
    .readdirSync(fieldsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".field-meta.xml"))
    .map((entry) => path.join(fieldsDir, entry.name))
    .sort(salesforceLexSort);

  for (const filePath of fieldFiles) {
    const doc = parseXml(fs.readFileSync(filePath, "utf8"));
    const root = doc.documentElement;
    const fullName = xmlFirstDirectChildText(root, "fullName");
    if (!fullName) {
      continue;
    }
    const valueSet = xmlFirstDirectChild(root, "valueSet");
    const metadata = {
      fieldApiName: fullName,
      type: xmlFirstDirectChildText(root, "type"),
      description: xmlFirstDirectChildText(root, "description"),
      trackHistory: normalizeBooleanText(xmlFirstDirectChildText(root, "trackHistory")),
      trackFeedHistory: normalizeBooleanText(xmlFirstDirectChildText(root, "trackFeedHistory")),
      required: normalizeBooleanText(xmlFirstDirectChildText(root, "required")),
      formula: xmlFirstDirectChildText(root, "formula"),
      helpText: xmlFirstDirectChildText(root, "inlineHelpText"),
      length: xmlFirstDirectChildText(root, "length"),
      precision: xmlFirstDirectChildText(root, "precision"),
      scale: xmlFirstDirectChildText(root, "scale"),
      referenceTo: xmlFirstDirectChildText(root, "referenceTo"),
      controllingField: valueSet ? xmlFirstDirectChildText(valueSet, "controllingField") : "",
      valueSet,
    };
    fieldMetaByApiNameLower.set(fullName.toLowerCase(), metadata);
  }
  return fieldMetaByApiNameLower;
}

function mapDataType({ describeField, localField }) {
  const localType = String(localField && localField.type ? localField.type : "").trim();
  const describeTypeRaw = String(describeField && describeField.type ? describeField.type : "").trim();
  const describeType = describeTypeRaw.toLowerCase();
  let mapped = TYPE_MAPPING.get(describeType) || describeTypeRaw || localType || "";

  if (localType) {
    const localLower = localType.toLowerCase();
    if (localLower === "masterdetail" || localLower === "lookup") {
      mapped = localType;
    } else if (mapped === "" || mapped === "Reference" || mapped === "TextArea") {
      mapped = localType;
    }
  }

  if (describeType === "reference" || mapped === "Lookup" || mapped === "MasterDetail") {
    const referenceTargets = Array.isArray(describeField && describeField.referenceTo)
      ? describeField.referenceTo.filter((item) => item)
      : [];
    if (mapped === "Reference") {
      mapped = "Lookup";
    }
    if (referenceTargets.length === 1) {
      return `${mapped}(${referenceTargets[0]})`;
    }
    return mapped;
  }

  if (describeType === "textarea") {
    if (localType === "Html") {
      return "RichTextArea";
    }
    if (Number(describeField && describeField.length) > 255) {
      return "LongTextArea";
    }
    return mapped;
  }

  return mapped;
}

function inferTypeLength({ describeField, localField }) {
  const describeLength = Number(describeField && describeField.length);
  if (Number.isFinite(describeLength) && describeLength > 0) {
    return String(describeLength);
  }
  const precision = Number(describeField && describeField.precision);
  const scale = Number(describeField && describeField.scale);
  if (Number.isFinite(precision) && precision > 0) {
    return `${precision}, ${Number.isFinite(scale) ? scale : 0}`;
  }
  const digits = Number(describeField && describeField.digits);
  if (Number.isFinite(digits) && digits > 0) {
    return String(digits);
  }
  if (localField) {
    if (localField.length) {
      return localField.length;
    }
    if (localField.precision) {
      return `${localField.precision}, ${localField.scale || "0"}`;
    }
  }
  return "";
}

function ensureObjectFieldTargetOrg(task, targetOrg) {
  if (task === OBJECT_FIELDS_TASK && !String(targetOrg || "").trim()) {
    throw new Error("document objectFields requires --target-org");
  }
}

function runSfJsonCommand({ cmdArgs, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn("sf", cmdArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const message = stripAnsi(stderr || stdout || "").trim();
        reject(new Error(message || `sf command failed with status ${code}`));
        return;
      }
      let json;
      try {
        json = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`sf command returned invalid JSON: ${err.message}`));
        return;
      }
      resolve(json);
    });
  });
}

function runSfCommand({ cmdArgs, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn("sf", cmdArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const message = stripAnsi(stderr || stdout || "").trim();
        reject(new Error(message || `sf command failed with status ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function createDefaultSfClient(targetOrg) {
  const cwd = process.cwd();
  return {
    async describeObject(objectName) {
      const json = await runSfJsonCommand({
        cwd,
        cmdArgs: ["sobject", "describe", "--target-org", targetOrg, "--sobject", objectName, "--json"],
      });
      return json && json.result ? json.result : {};
    },
    async toolingQuery(query) {
      const json = await runSfJsonCommand({
        cwd,
        cmdArgs: ["data", "query", "--target-org", targetOrg, "--json", "--use-tooling-api", "--query", query],
      });
      const records = json && json.result && Array.isArray(json.result.records) ? json.result.records : [];
      return records;
    },
    async retrieveObjectMetadataXml(objectName) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybsf-document-mdapi-"));
      try {
        await runSfCommand({
          cwd,
          cmdArgs: [
            "project",
            "retrieve",
            "start",
            "--target-org",
            targetOrg,
            "--metadata",
            `CustomObject:${objectName}`,
            "--target-metadata-dir",
            tempDir,
            "--single-package",
            "--unzip",
            "--wait",
            "20",
          ],
        });
        const objectFile = path.join(tempDir, "unpackaged", "objects", `${objectName}.object`);
        if (!fs.existsSync(objectFile)) {
          return "";
        }
        return fs.readFileSync(objectFile, "utf8");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

async function getCustomFieldCreatedDateMap({ objectName, sfClient }) {
  let tableEnumOrId = objectName;
  if (objectName.endsWith("__c")) {
    const developerName = objectName.slice(0, -3);
    const customObjectRecords = await sfClient.toolingQuery(
      `SELECT Id FROM CustomObject WHERE DeveloperName = '${developerName.replace(/'/g, "\\'")}'`
    );
    if (customObjectRecords.length > 0 && customObjectRecords[0].Id) {
      tableEnumOrId = customObjectRecords[0].Id;
    }
  } else if (objectName === "Task" || objectName === "Event") {
    tableEnumOrId = "Activity";
  }
  const records = await sfClient.toolingQuery(
    `SELECT DeveloperName, CreatedDate FROM CustomField WHERE TableEnumOrId = '${String(tableEnumOrId).replace(/'/g, "\\'")}'`
  );
  const map = new Map();
  for (const row of records) {
    const developerName = String(row.DeveloperName || "").trim();
    if (!developerName) {
      continue;
    }
    map.set(`${developerName}__c`.toLowerCase(), formatDateMDY(row.CreatedDate || ""));
  }
  return map;
}

function getFieldTrackingMapFromMdapiXml(objectXml) {
  const map = new Map();
  if (!String(objectXml || "").trim()) {
    return map;
  }
  const doc = parseXml(objectXml);
  const root = doc.documentElement;
  const fieldNodes = xmlDirectChildrenByName(root, "fields");
  for (const fieldNode of fieldNodes) {
    const fieldApiName = xmlFirstDirectChildText(fieldNode, "fullName");
    if (!fieldApiName) {
      continue;
    }
    map.set(fieldApiName.toLowerCase(), {
      trackHistory: normalizeBooleanText(xmlFirstDirectChildText(fieldNode, "trackHistory")),
      trackFeedHistory: normalizeBooleanText(xmlFirstDirectChildText(fieldNode, "trackFeedHistory")),
    });
  }
  return map;
}

function makeObjectFieldsHeaders(layoutNames) {
  return [
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
    ...layoutNames,
  ];
}

async function generateObjectFieldsCsv({
  objectName,
  sourceDir,
  outputDir,
  sfClient,
}) {
  const localFieldMetaMap = parseLocalFieldMetadata(sourceDir, objectName);
  const describe = await sfClient.describeObject(objectName);
  const describeFields = Array.isArray(describe.fields) ? describe.fields : [];
  const createdDateMap = await getCustomFieldCreatedDateMap({
    objectName,
    sfClient,
  });
  const objectMdapiXml = await sfClient.retrieveObjectMetadataXml(objectName);
  const fieldTrackingMap = getFieldTrackingMapFromMdapiXml(objectMdapiXml);
  const { layoutNames, fieldsByApiNameLower } = collectLayoutFieldUsage(sourceDir, objectName);

  const rows = [];
  const merged = [];
  for (const describeField of describeFields) {
    const fieldApiName = String(describeField.name || "").trim();
    if (!fieldApiName) {
      continue;
    }
    const localField = localFieldMetaMap.get(fieldApiName.toLowerCase()) || null;
    merged.push({
      fieldApiName,
      fieldLabel: String(describeField.label || ""),
      createdDate: createdDateMap.get(fieldApiName.toLowerCase()) || "",
      dataType: mapDataType({ describeField, localField }),
      dataTypeLength: inferTypeLength({ describeField, localField }),
      required: Boolean(localField ? localField.required : false),
      externalId: Boolean(describeField.externalId),
      unique: describeField.unique
        ? describeField.caseSensitive
          ? "Case Sensitive"
          : "Case Insensitive"
        : "",
      trackHistory: fieldTrackingMap.has(fieldApiName.toLowerCase())
        ? Boolean(fieldTrackingMap.get(fieldApiName.toLowerCase()).trackHistory)
        : Boolean(localField ? localField.trackHistory : false),
      trackFeedHistory: fieldTrackingMap.has(fieldApiName.toLowerCase())
        ? Boolean(fieldTrackingMap.get(fieldApiName.toLowerCase()).trackFeedHistory)
        : Boolean(localField ? localField.trackFeedHistory : false),
      formula: String(localField && localField.formula ? localField.formula : describeField.calculatedFormula || ""),
      description: String(localField && localField.description ? localField.description : ""),
      helpText: String(localField && localField.helpText ? localField.helpText : describeField.inlineHelpText || ""),
      layoutNames: fieldsByApiNameLower.get(fieldApiName.toLowerCase()) || new Set(),
    });
  }

  merged.sort((a, b) => salesforceLexSort(a.fieldApiName.toLowerCase(), b.fieldApiName.toLowerCase()));
  for (const field of merged) {
    const row = [
      objectName,
      field.fieldLabel,
      field.fieldApiName,
      field.createdDate,
      field.dataType,
      field.dataTypeLength,
      field.required ? "X" : "",
      field.externalId ? "X" : "",
      field.unique,
      field.trackHistory ? "X" : "",
      field.trackFeedHistory ? "X" : "",
      field.formula,
      field.description,
      field.helpText,
      String(field.layoutNames.size),
    ];
    for (const layoutName of layoutNames) {
      row.push(field.layoutNames.has(layoutName) ? "X" : "");
    }
    rows.push(row);
  }

  const outFile = path.join(outputDir, "ObjectFields", `${objectName}.csv`);
  csvWrite(outFile, makeObjectFieldsHeaders(layoutNames), rows);
}

function iterPicklistFieldValues(fieldMeta) {
  const rows = [];
  const valueSet = fieldMeta.valueSet;
  if (!valueSet) {
    return rows;
  }
  const valueSetDefinition = xmlFirstDirectChild(valueSet, "valueSetDefinition");
  if (!valueSetDefinition) {
    return rows;
  }
  const controllingField = xmlFirstDirectChildText(valueSet, "controllingField");
  const valueNodes = xmlDirectChildrenByName(valueSetDefinition, "value");
  for (const valueNode of valueNodes) {
    rows.push({
      fieldName: fieldMeta.fieldApiName,
      picklistValue: xmlFirstDirectChildText(valueNode, "fullName"),
      apiName: xmlFirstDirectChildText(valueNode, "label"),
      defaultValue: xmlFirstDirectChildText(valueNode, "default"),
      controllingField,
    });
  }
  return rows;
}

function iterPicklistControllingValues(fieldMeta) {
  const rows = [];
  const valueSet = fieldMeta.valueSet;
  if (!valueSet) {
    return rows;
  }
  const controllingField = xmlFirstDirectChildText(valueSet, "controllingField");
  const valueSettingsNodes = xmlDirectChildrenByName(valueSet, "valueSettings");
  for (const valueSettingsNode of valueSettingsNodes) {
    const valueName = xmlFirstDirectChildText(valueSettingsNode, "valueName");
    const controllingNodes = xmlDirectChildrenByName(valueSettingsNode, "controllingFieldValue");
    for (const controllingNode of controllingNodes) {
      rows.push({
        fieldName: fieldMeta.fieldApiName,
        picklistValue: valueName,
        controllingField,
        controllingFieldValue: String(controllingNode.textContent || "").trim(),
      });
    }
  }
  return rows;
}

function generatePicklistValuesCsv({ objectName, sourceDir, outputDir }) {
  const fieldMetaMap = parseLocalFieldMetadata(sourceDir, objectName);
  const rows = [];
  for (const fieldMeta of fieldMetaMap.values()) {
    const values = iterPicklistFieldValues(fieldMeta);
    for (const value of values) {
      rows.push([
        `${objectName}.object`,
        value.fieldName,
        value.picklistValue,
        value.apiName,
        value.defaultValue,
        value.controllingField,
      ]);
    }
  }
  rows.sort((a, b) =>
    salesforceLexSort(
      `${a[1].toLowerCase()}|${a[2].toLowerCase()}|${String(a[4]).toLowerCase()}`,
      `${b[1].toLowerCase()}|${b[2].toLowerCase()}|${String(b[4]).toLowerCase()}`
    )
  );
  csvWrite(
    path.join(outputDir, "PicklistValues", `${objectName}.csv`),
    ["File", "FieldName", "PicklistValue", "API Name", "Default", "ControllingField"],
    rows
  );
}

function generatePicklistControllingValuesCsv({ objectName, sourceDir, outputDir }) {
  const fieldMetaMap = parseLocalFieldMetadata(sourceDir, objectName);
  const rows = [];
  for (const fieldMeta of fieldMetaMap.values()) {
    const values = iterPicklistControllingValues(fieldMeta);
    for (const value of values) {
      rows.push([
        `${objectName}.object`,
        value.fieldName,
        value.picklistValue,
        value.controllingField,
        value.controllingFieldValue,
      ]);
    }
  }
  rows.sort((a, b) =>
    salesforceLexSort(
      `${a[1].toLowerCase()}|${a[2].toLowerCase()}|${a[4].toLowerCase()}`,
      `${b[1].toLowerCase()}|${b[2].toLowerCase()}|${b[4].toLowerCase()}`
    )
  );
  csvWrite(
    path.join(outputDir, "PicklistValuesControllingField", `${objectName}.csv`),
    ["File", "FieldName", "PicklistValue", "ControllingField", "ControllingFieldValue"],
    rows
  );
}

function generatePicklistRecordTypeValuesCsv({ objectName, sourceDir, outputDir }) {
  const recordTypesDir = path.join(sourceDir, "objects", objectName, "recordTypes");
  const rows = [];
  if (fs.existsSync(recordTypesDir)) {
    const recordTypeFiles = fs
      .readdirSync(recordTypesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".recordType-meta.xml"))
      .map((entry) => path.join(recordTypesDir, entry.name))
      .sort(salesforceLexSort);
    for (const filePath of recordTypeFiles) {
      const doc = parseXml(fs.readFileSync(filePath, "utf8"));
      const root = doc.documentElement;
      const recordType = xmlFirstDirectChildText(root, "fullName");
      const picklistValuesNodes = xmlDirectChildrenByName(root, "picklistValues");
      for (const picklistValuesNode of picklistValuesNodes) {
        const picklistFieldName = xmlFirstDirectChildText(picklistValuesNode, "picklist");
        const valueNodes = xmlDirectChildrenByName(picklistValuesNode, "values");
        for (const valueNode of valueNodes) {
          rows.push([
            `${objectName}.object`,
            recordType,
            picklistFieldName,
            xmlFirstDirectChildText(valueNode, "fullName"),
            xmlFirstDirectChildText(valueNode, "default"),
          ]);
        }
      }
    }
  }
  rows.sort((a, b) =>
    salesforceLexSort(
      `${a[1].toLowerCase()}|${a[2].toLowerCase()}|${a[3].toLowerCase()}`,
      `${b[1].toLowerCase()}|${b[2].toLowerCase()}|${b[3].toLowerCase()}`
    )
  );
  csvWrite(
    path.join(outputDir, "PicklistValuesRecordTypes", `${objectName}.csv`),
    ["File", "RecordType", "FieldName", "PicklistValue", "Default"],
    rows
  );
}

async function runDocument({
  task,
  object,
  all,
  sourceDir = path.resolve("force-app/main/default"),
  outputDir = path.resolve("doc"),
  targetOrg,
  status,
  createSfClient = createDefaultSfClient,
}) {
  const step = (message) => {
    if (typeof status === "function") {
      status(`[document] ${message}`);
    }
  };

  if (!DOCUMENT_TASKS.has(task)) {
    throw new Error(
      `Unknown document task: ${task}. Supported tasks: ${Array.from(DOCUMENT_TASKS).join(", ")}`
    );
  }
  if (all && object) {
    throw new Error("Use either --object or --all, not both");
  }
  ensureObjectFieldTargetOrg(task, targetOrg);
  const objects = resolveObjectList({
    sourceDir,
    object,
    all,
  });
  const warnings = [];
  step(`Task: ${task}`);
  if (all || objects.length > 1) {
    step(`Objects to process: ${objects.length}`);
  }

  let sfClient = null;
  if (task === OBJECT_FIELDS_TASK) {
    sfClient = createSfClient(targetOrg);
  }

  for (const objectName of objects) {
    step(`Processing ${objectName}`);
    if (task === OBJECT_FIELDS_TASK) {
      await generateObjectFieldsCsv({
        objectName,
        sourceDir,
        outputDir,
        sfClient,
      });
      continue;
    }
    if (task === PICKLIST_VALUES_TASK) {
      generatePicklistValuesCsv({
        objectName,
        sourceDir,
        outputDir,
      });
      continue;
    }
    if (task === PICKLIST_VALUES_CONTROLLING_TASK) {
      generatePicklistControllingValuesCsv({
        objectName,
        sourceDir,
        outputDir,
      });
      continue;
    }
    if (task === PICKLIST_VALUES_RECORD_TYPES_TASK) {
      generatePicklistRecordTypeValuesCsv({
        objectName,
        sourceDir,
        outputDir,
      });
    }
  }

  step("Complete");
  return {
    task,
    sourceDir,
    outputDir,
    targetOrg: task === OBJECT_FIELDS_TASK ? targetOrg : null,
    objectsProcessed: objects.length,
    warnings,
  };
}

module.exports = {
  runDocument,
  DOCUMENT_TASKS,
  OBJECT_FIELDS_TASK,
  PICKLIST_VALUES_TASK,
  PICKLIST_VALUES_CONTROLLING_TASK,
  PICKLIST_VALUES_RECORD_TYPES_TASK,
  _private: {
    parseLocalFieldMetadata,
    collectLayoutFieldUsage,
    iterPicklistFieldValues,
    iterPicklistControllingValues,
    generatePicklistValuesCsv,
    generatePicklistControllingValuesCsv,
    generatePicklistRecordTypeValuesCsv,
    generateObjectFieldsCsv,
    createDefaultSfClient,
    resolveObjectList,
    getFieldTrackingMapFromMdapiXml,
  },
};
