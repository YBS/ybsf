const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { loadConfig } = require("../config/load-config");
const { writePackageXml } = require("../manifest/write-package-xml");
const { parseListMetadataJson } = require("../sf/parse-list-metadata-json");
const { safeFileSuffix, formatDuration } = require("./helpers/command-utils");
const { createRunArtifactsDir, cleanupRunArtifactsDir } = require("./helpers/run-artifacts");
const {
  writeDiscoveryProject,
  buildProjectGenerateManifestArgs,
  parseDiscoveredPackageXml,
} = require("./helpers/project-manifest-discovery");

const FOLDERED_TYPES = new Set(["Report", "Dashboard", "Document", "EmailTemplate"]);
const NON_DEPLOYABLE_FOLDER_MARKERS = new Set(["unfiled$public"]);
const FALLBACK_DISCOVERY_TYPES = new Set(["Settings", "StandardValueSet"]);
const OBJECT_HYPHEN_TYPES = new Set(["Layout", "CustomObjectTranslation"]);
const OBJECT_RELATED_TYPES = new Set([
  "Workflow",
  "SharingRules",
  "AssignmentRules",
  "AutoResponseRules",
  "TopicsForObjects",
  "CustomTab",
]);
const UNMANAGED_SUFFIX_TOKENS = new Set([
  "c",
  "mdt",
  "kav",
  "x",
  "b",
  "xo",
  "e",
  "p",
  "r",
]);
const OBJECT_SCOPE_FILTER_TYPES = new Set([
  "BusinessProcess",
  "CompactLayout",
  "CustomField",
  "FieldSet",
  "Layout",
  "ListView",
  "RecordType",
  "SharingReason",
  "Workflow",
  "SharingRules",
  "SharingCriteriaRule",
  "SharingOwnerRule",
  "AssignmentRule",
  "AutoResponseRule",
  "TopicsForObjects",
  "CustomTab",
  "ValidationRule",
  "WebLink",
  "CustomObjectTranslation",
  "QuickAction",
  "WorkflowAlert",
  "WorkflowFieldUpdate",
  "WorkflowOutboundMessage",
  "WorkflowRule",
  "WorkflowTask",
]);
const WORKFLOW_SUBTYPE_TYPES = [
  "WorkflowAlert",
  "WorkflowFieldUpdate",
  "WorkflowOutboundMessage",
  "WorkflowRule",
  "WorkflowTask",
];
const SHARING_GRANULAR_TYPES = ["SharingCriteriaRule", "SharingOwnerRule"];
const ASSIGNMENT_GRANULAR_TYPES = ["AssignmentRule"];
const AUTO_RESPONSE_GRANULAR_TYPES = ["AutoResponseRule"];
const LEVEL3_PARENT_RULES = [
  {
    parentType: "SharingRules",
    childTypes: SHARING_GRANULAR_TYPES,
  },
  {
    parentType: "AssignmentRules",
    childTypes: ASSIGNMENT_GRANULAR_TYPES,
  },
  {
    parentType: "AutoResponseRules",
    childTypes: AUTO_RESPONSE_GRANULAR_TYPES,
  },
  {
    parentType: "Workflow",
    childTypes: WORKFLOW_SUBTYPE_TYPES,
  },
];

function salesforceLexSort(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function addMembers(typeMembersMap, metadataType, members) {
  if (!typeMembersMap.has(metadataType)) {
    typeMembersMap.set(metadataType, new Set());
  }
  const set = typeMembersMap.get(metadataType);
  for (const m of members) {
    if (m === "*") {
      continue;
    }
    set.add(m);
  }
}

function inferFolderMarkerMode(discoveredMembers) {
  let sawPlainFolderMarker = false;
  let sawSlashFolderMarker = false;
  for (const member of discoveredMembers || []) {
    const text = String(member || "").trim();
    if (!text) {
      continue;
    }
    if (text.endsWith("/") && !text.slice(0, -1).includes("/")) {
      sawSlashFolderMarker = true;
      continue;
    }
    if (!text.includes("/")) {
      sawPlainFolderMarker = true;
    }
  }
  if (sawPlainFolderMarker && !sawSlashFolderMarker) {
    return "plain";
  }
  return "slash";
}

function includeFolderMembers(members, folderMarkerMode = "slash") {
  const folderMarker = (folderName) => (folderMarkerMode === "plain" ? folderName : `${folderName}/`);
  const out = new Set();
  for (const member of members) {
    const normalized = String(member || "").trim().replace(/\/$/u, "");
    if (!normalized) {
      continue;
    }
    if (NON_DEPLOYABLE_FOLDER_MARKERS.has(normalized)) {
      continue;
    }
    if (normalized.includes("/")) {
      out.add(normalized);
    } else {
      out.add(folderMarker(normalized));
    }
  }
  for (const member of members) {
    const normalized = String(member || "").trim();
    if (normalized.includes("/")) {
      const folderName = normalized.split("/", 1)[0];
      if (!NON_DEPLOYABLE_FOLDER_MARKERS.has(folderName)) {
        out.add(folderMarker(folderName));
      }
    }
  }
  return Array.from(out).sort(salesforceLexSort);
}

function normalizeDocumentMemberName(memberName) {
  const text = String(memberName || "").trim();
  if (!text) {
    return "";
  }
  if (!text.includes("/")) {
    return text.replace(/\/$/u, "");
  }
  const [folderName, memberTokenRaw] = text.split("/", 2);
  const memberToken = String(memberTokenRaw || "").replace(/\/$/u, "");
  if (!memberToken) {
    return folderName;
  }
  const base = memberToken.replace(/\.[^./]+$/u, "");
  return `${folderName}/${base}`;
}

function normalizeFolderedDiscoveredMembers(typeName, members) {
  const out = new Set();
  for (const member of members || []) {
    const text = String(member || "").trim();
    if (!text) {
      continue;
    }
    const normalized = typeName === "Document" ? normalizeDocumentMemberName(text) : text.replace(/\/$/u, "");
    if (!normalized) {
      continue;
    }
    out.add(normalized);
  }
  return Array.from(out).sort(salesforceLexSort);
}

function normalizeMemberForComparison(typeName, memberName) {
  const text = String(memberName || "").trim();
  if (typeName === "Document") {
    return normalizeDocumentMemberName(text);
  }
  if (FOLDERED_TYPES.has(typeName)) {
    return text.replace(/\/$/u, "");
  }
  return text;
}

function getObjectNamespace(objectName) {
  if (!objectName) {
    return null;
  }
  const cleanObjectName = objectName
    .replace(/__c$/i, "")
    .replace(/__kav$/i, "")
    .replace(/__x$/i, "")
    .replace(/__b$/i, "")
    .replace(/__xo$/i, "")
    .replace(/__e$/i, "")
    .replace(/__p$/i, "")
    .replace(/__mdt$/i, "");
  const parts = cleanObjectName.split("__");
  if (parts.length === 2 && parts[0]) {
    return parts[0];
  }
  return null;
}

function parseNamespacePrefix(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const match = text.match(/^([A-Za-z0-9_]+)__(.+)$/);
  if (!match) {
    return null;
  }
  const namespace = match[1];
  const rest = match[2];

  // Distinguish unmanaged API names like "Agreement__c" from namespaced names
  // like "ns__Object__c" or "ns__PermissionSetName".
  if (!rest.includes("__") && UNMANAGED_SUFFIX_TOKENS.has(rest.toLowerCase())) {
    return null;
  }
  return namespace;
}

function getMemberNamespace(typeName, memberName) {
  const full = String(memberName || "");
  if (!full) {
    return null;
  }

  // Dot-notation members can be namespaced on either side.
  // Example: Account/ns__Field__c or ns__Object__c/Field__c
  if (full.includes(".")) {
    const [objectToken, memberToken] = full.split(".", 2);
    if (typeName === "CustomMetadata" && objectToken.includes("__")) {
      const packageName = objectToken.split("__", 1)[0];
      if (packageName) {
        return packageName;
      }
    }
    const objectNs = parseNamespacePrefix(objectToken);
    if (objectNs) {
      return objectNs;
    }
    return parseNamespacePrefix(memberToken);
  }

  // Hyphen members use ObjectName-MemberName. Namespace can only come from ObjectName.
  if (OBJECT_HYPHEN_TYPES.has(typeName) && full.includes("-")) {
    const objectToken = full.split("-", 1)[0];
    return parseNamespacePrefix(objectToken);
  }

  if (full.includes("/")) {
    const [folderName, memberPart] = full.split("/", 2);
    const folderNs = parseNamespacePrefix(folderName);
    if (folderNs) {
      return folderNs;
    }
    const memberNs = parseNamespacePrefix(memberPart);
    if (memberNs) {
      return memberNs;
    }
  }

  const direct = parseNamespacePrefix(full);
  if (direct) {
    return direct;
  }

  const relatedObject = getObjectName(typeName, full);
  return getObjectNamespace(relatedObject);
}

function filterManagedMembers(typeName, members) {
  const kept = [];
  for (const member of members) {
    const namespace = getMemberNamespace(typeName, member);
    if (namespace) {
      continue;
    }
    kept.push(member);
  }
  return kept;
}

function filterMembersForNamespace(typeName, members, namespace) {
  return members.filter((member) => getMemberNamespace(typeName, member) === namespace);
}

function resolveMembersForType(rule, warnings, discoveredMembers) {
  const memberPolicy = rule.memberPolicy || { mode: "all", members: [] };
  const mode = memberPolicy.mode;
  const members = memberPolicy.members || [];
  if (!rule.enabled) {
    return [];
  }
  const discovered = (discoveredMembers || []).filter((m) => m !== "*");

  if (FOLDERED_TYPES.has(rule.metadataType)) {
    const fp = rule.folderPolicy;
    const getFolderName = (memberName) => memberName.split("/", 1)[0];
    const getMemberToken = (memberName) =>
      memberName.includes("/") ? memberName.split("/", 2)[1] : memberName;

    const folderMarkerMode = inferFolderMarkerMode(discovered);

    const includeByFolderPolicy = () => {
      const folderRules = Array.isArray(fp.folders) ? fp.folders : [];
      const folderRuleMap = new Map();
      for (const folderRule of folderRules) {
        if (folderRule && typeof folderRule === "object") {
          folderRuleMap.set(folderRule.folder, folderRule);
        }
      }
      const selected = normalizedDiscovered.filter((memberName) => {
        const folderName = getFolderName(memberName);
        const folderRule = folderRuleMap.get(folderName);
        if (!folderRule) {
          return false;
        }
        const memberPolicy = folderRule.memberPolicy || { mode: "all", members: [] };
        if (!memberName.includes("/")) {
          return true;
        }
        if (memberPolicy.mode === "all") {
          return true;
        }
        const memberToken = normalizeMemberForComparison(rule.metadataType, getMemberToken(memberName));
        const normalizedMemberName = normalizeMemberForComparison(rule.metadataType, memberName);
        const policyMembers = new Set(
          (memberPolicy.members || []).map((v) => normalizeMemberForComparison(rule.metadataType, v))
        );
        if (memberPolicy.mode === "include") {
          return policyMembers.has(memberToken) || policyMembers.has(normalizedMemberName);
        }
        return !policyMembers.has(memberToken) && !policyMembers.has(normalizedMemberName);
      });
      return includeFolderMembers(selected, folderMarkerMode);
    };

    const excludeByFolderPolicy = () => {
      const excludedFolders = new Set(
        (fp.folders || [])
          .map((folderRule) =>
            folderRule && typeof folderRule === "object" ? folderRule.folder : null
          )
          .filter((folderName) => typeof folderName === "string" && folderName.length > 0)
      );
      const selected = normalizedDiscovered.filter((memberName) => !excludedFolders.has(getFolderName(memberName)));
      return includeFolderMembers(selected, folderMarkerMode);
    };

    const normalizedDiscovered = normalizeFolderedDiscoveredMembers(rule.metadataType, discovered);
    if (normalizedDiscovered.length === 0) {
      // Discovery returned no members for this type.
      return [];
    }
    if (fp.mode === "include") {
      return includeByFolderPolicy();
    }
    if (fp.mode === "exclude") {
      return excludeByFolderPolicy();
    }
    if (fp.mode === "all") {
      return includeFolderMembers(normalizedDiscovered, folderMarkerMode);
    }
    if (mode === "all") {
      return includeFolderMembers(normalizedDiscovered, folderMarkerMode);
    }
    if (mode === "include") {
      const allow = new Set(members.map((m) => normalizeMemberForComparison(rule.metadataType, m)));
      return includeFolderMembers(
        normalizedDiscovered.filter((m) => allow.has(normalizeMemberForComparison(rule.metadataType, m))),
        folderMarkerMode
      );
    }
    const deny = new Set(members.map((m) => normalizeMemberForComparison(rule.metadataType, m)));
    return includeFolderMembers(
      normalizedDiscovered.filter((m) => !deny.has(normalizeMemberForComparison(rule.metadataType, m))),
      folderMarkerMode
    );
  }

  if (mode === "all") {
    return discovered;
  }
  if (mode === "include") {
    const allow = new Set(members.map((m) => normalizeMemberForComparison(rule.metadataType, m)));
    return discovered.filter((m) => allow.has(normalizeMemberForComparison(rule.metadataType, m)));
  }
  const deny = new Set(members.map((m) => normalizeMemberForComparison(rule.metadataType, m)));
  return discovered.filter((m) => !deny.has(normalizeMemberForComparison(rule.metadataType, m)));
}

function resolveInstalledPackageRules(config, typeMembersMap, warnings, discoveredByType) {
  if (!config.packageRules.includeManagedPackages) {
    return;
  }
  const namespaces = [];
  for (const nsRule of config.packageRules.namespaces) {
    namespaces.push(nsRule.namespace);
    for (const typeRule of nsRule.metadataTypes || []) {
      const fakeRule = {
        metadataType: typeRule.metadataType,
        enabled: true,
        memberPolicy: typeRule.memberPolicy,
        folderPolicy: typeRule.folderPolicy,
      };
      const discoveredMembers = discoveredByType.get(typeRule.metadataType) || [];
      const scopedMembers = filterMembersForNamespace(
        typeRule.metadataType,
        discoveredMembers,
        nsRule.namespace
      );
      const members = resolveMembersForType(fakeRule, warnings, scopedMembers);
      addMembers(typeMembersMap, typeRule.metadataType, members);
    }
  }
  addMembers(typeMembersMap, "InstalledPackage", namespaces);
}

async function runSfCommand({ cmdArgs, cwd, artifactsDir, artifactBaseName, streamLiveOutput }) {
  const commandText = `sf ${cmdArgs.join(" ")}`;
  const sfStartedAt = Date.now();
  const child = spawn("sf", cmdArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  let processError = null;

  const result = await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      stdout += value;
      if (streamLiveOutput) {
        process.stdout.write(value);
      }
    });
    child.stderr.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      stderr += value;
      if (streamLiveOutput) {
        process.stderr.write(value);
      }
    });
    child.on("error", (err) => {
      processError = err;
      reject(err);
    });
    child.on("close", (code, signal) => resolve({ status: code, signal }));
  }).catch((err) => {
    processError = err;
    return { status: null, signal: null };
  });

  const elapsedMs = Date.now() - sfStartedAt;

  const baseName = safeFileSuffix(artifactBaseName);
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.cmd.txt`), `${commandText}\n`, "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stdout.txt`), stdout || "", "utf8");
  fs.writeFileSync(path.join(artifactsDir, `${baseName}.stderr.txt`), stderr || "", "utf8");
  fs.writeFileSync(
    path.join(artifactsDir, `${baseName}.status.json`),
    `${JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        error: processError ? { message: processError.message, code: processError.code } : null,
        elapsedMs,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (processError) {
    const code = processError.code ? ` (${processError.code})` : "";
    const msg = processError.message || "unknown error";
    throw new Error(`sf command failed${code}: ${msg}`);
  }

  if (result.status !== 0) {
    const stderrMessage = (stderr || "").trim();
    const signalMessage = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(
      stderrMessage.length > 0
        ? stderrMessage
        : `sf command failed with status ${result.status}${signalMessage}`
    );
  }

  return stdout || "";
}

async function discoverFromOrg(config, targetOrg, warnings, step, runDir, debug = false) {
  const discoveryDir = path.join(runDir, "org-discovery");
  const outputDir = discoveryDir;
  try {
    writeDiscoveryProject(discoveryDir, config.apiVersion);
    const cmdArgs = buildProjectGenerateManifestArgs({
      targetOrg,
      apiVersion: config.apiVersion,
      outputDir,
      includeManagedPackages: Boolean(
        config.packageRules && config.packageRules.includeManagedPackages
      ),
      includeUnlockedPackages: Boolean(
        config.packageRules && config.packageRules.includeUnlockedPackages
      ),
    });
    const sfCallStartedAt = Date.now();
    const heartbeatMs = 15_000;
    const heartbeat = setInterval(() => {
      step(`Org discovery still running (${formatDuration(Date.now() - sfCallStartedAt)})`);
    }, heartbeatMs);
    try {
      await runSfCommand({
        cmdArgs,
        cwd: discoveryDir,
        artifactsDir: runDir,
        artifactBaseName: "project-generate-manifest",
        streamLiveOutput: Boolean(debug),
      });
    } finally {
      clearInterval(heartbeat);
    }
    const packagePath = path.join(outputDir, "package.xml");
    return parseDiscoveredPackageXml(packagePath);
  } catch (err) {
    throw new Error(`Org discovery failed for ${targetOrg}: ${err.message}`);
  }
}

function parseDataQueryJson(rawJson) {
  const parsed = JSON.parse(rawJson);
  const records = parsed?.result?.records;
  return Array.isArray(records) ? records : [];
}

async function discoverTypeFromListMetadata(targetOrg, apiVersion, metadataType, step, runDir) {
  const cmdArgs = [
    "org",
    "list",
    "metadata",
    "--metadata-type",
    metadataType,
    "--target-org",
    targetOrg,
    "--api-version",
    apiVersion,
    "--json",
  ];
  const output = await runSfCommand({
    cmdArgs,
    cwd: process.cwd(),
    artifactsDir: runDir,
    artifactBaseName: `org-list-metadata-${metadataType}`,
  });
  return parseListMetadataJson(output);
}

async function discoverPersonAccountRecordTypeNames(targetOrg, step, runDir) {
  const cmdArgs = [
    "data",
    "query",
    "--query",
    "SELECT DeveloperName FROM RecordType WHERE SobjectType = 'Account' AND IsPersonType = true",
    "--target-org",
    targetOrg,
    "--json",
  ];
  const output = await runSfCommand({
    cmdArgs,
    cwd: process.cwd(),
    artifactsDir: runDir,
    artifactBaseName: "data-query-recordtype-personaccount",
  });
  const rows = parseDataQueryJson(output);
  const names = new Set();
  for (const row of rows) {
    if (row && typeof row.DeveloperName === "string" && row.DeveloperName.length > 0) {
      names.add(row.DeveloperName);
    }
  }
  return names;
}

function applyPersonAccountRecordTypeTransform(members, personTypeNames) {
  if (!personTypeNames || personTypeNames.size === 0) {
    return members.slice();
  }
  const out = [];
  for (const member of members) {
    if (member.startsWith("Account.")) {
      const rtName = member.split(".", 2)[1];
      if (personTypeNames.has(rtName)) {
        out.push(`PersonAccount.${rtName}`);
        continue;
      }
    }
    out.push(member);
  }
  return Array.from(new Set(out));
}

function shouldTransformPersonAccounts(config, discoveredByType) {
  const customObjectRule = config.metadataTypes.find(
    (rule) => rule.enabled && rule.metadataType === "CustomObject"
  );
  if (!customObjectRule) {
    return false;
  }
  const discoveredCustomObjects = discoveredByType.get("CustomObject") || [];
  if (discoveredCustomObjects.length === 0) {
    return false;
  }
  const scopedCustomObjects = resolveMembersForType(customObjectRule, [], discoveredCustomObjects);
  return scopedCustomObjects.includes("PersonAccount");
}

function getObjectName(typeName, memberName) {
  if (OBJECT_HYPHEN_TYPES.has(typeName)) {
    return memberName.split("-", 2)[0];
  }
  if (OBJECT_RELATED_TYPES.has(typeName)) {
    if (typeName === "CustomTab") {
      return memberName.endsWith("__c") ? memberName : null;
    }
    return memberName;
  }
  if (memberName.includes(".")) {
    const objectName = memberName.split(".", 2)[0];
    if (typeName === "CustomMetadata") {
      return `${objectName}__mdt`;
    }
    return objectName;
  }
  return null;
}

function applyObjectScopeFilter(typeMembersMap, config) {
  const customObjectRule = config.metadataTypes.find((rule) => rule.enabled && rule.metadataType === "CustomObject");
  if (!customObjectRule) {
    return;
  }
  const selectedObjects = new Set(typeMembersMap.get("CustomObject") || []);
  const pseudoObjects = Array.isArray(config.processingRules && config.processingRules.includePseudoObjects)
    ? config.processingRules.includePseudoObjects
    : [];
  for (const pseudoObject of pseudoObjects) {
    const value = String(pseudoObject || "").trim();
    if (value) {
      selectedObjects.add(value);
    }
  }
  const filteredCounts = new Map();

  for (const [typeName, membersSet] of typeMembersMap.entries()) {
    if (typeName === "CustomObject") {
      continue;
    }
    if (!OBJECT_SCOPE_FILTER_TYPES.has(typeName)) {
      continue;
    }
    const keptMembers = new Set();
    let removed = 0;
    for (const member of membersSet) {
      const objectName = getObjectName(typeName, member);
      if (objectName && !selectedObjects.has(objectName)) {
        removed += 1;
        continue;
      }
      keptMembers.add(member);
    }
    if (removed > 0) {
      filteredCounts.set(typeName, removed);
    }
    if (keptMembers.size === 0) {
      typeMembersMap.delete(typeName);
    } else {
      typeMembersMap.set(typeName, keptMembers);
    }
  }

  return Object.fromEntries(filteredCounts.entries());
}

function applyObjectGateGranularSelections({
  config,
  typeMembersMap,
  discoveredByType,
  warnings,
  gateType,
  granularTypes,
}) {
  const selectedObjects = new Set(typeMembersMap.get(gateType) || []);
  const gateRule = config.metadataTypes.find((rule) => rule.enabled && rule.metadataType === gateType);
  if (gateType === "Workflow" && gateRule) {
    const policy = gateRule.memberPolicy || { mode: "all", members: [] };
    const policyMembers = new Set((policy.members || []).map((value) => String(value || "").trim()));
    const pseudoCandidates = Array.isArray(config.processingRules && config.processingRules.includePseudoObjects)
      ? config.processingRules.includePseudoObjects
      : [];
    const pseudoInScope = [];
    for (const candidate of pseudoCandidates) {
      const pseudoObject = String(candidate || "").trim();
      if (!pseudoObject) {
        continue;
      }
      if (policy.mode === "include") {
        if (!policyMembers.has(pseudoObject)) {
          continue;
        }
      } else if (policy.mode === "exclude") {
        if (policyMembers.has(pseudoObject)) {
          continue;
        }
      }
      pseudoInScope.push(pseudoObject);
      selectedObjects.add(pseudoObject);
    }
  }
  if (selectedObjects.size === 0) {
    for (const typeName of granularTypes) {
      typeMembersMap.delete(typeName);
    }
    return;
  }

  for (const typeName of granularTypes) {
    const discoveredMembers = (discoveredByType.get(typeName) || []).filter((member) => {
      const objectName = getObjectName(typeName, member);
      return objectName ? selectedObjects.has(objectName) : false;
    });
    const explicitRule = config.metadataTypes.find((rule) => rule.enabled && rule.metadataType === typeName);
    const selectedMembers = explicitRule
      ? resolveMembersForType(explicitRule, warnings, discoveredMembers)
      : discoveredMembers;
    const unmanagedMembers = filterManagedMembers(typeName, selectedMembers);
    if (unmanagedMembers.length === 0) {
      typeMembersMap.delete(typeName);
      continue;
    }
    typeMembersMap.set(typeName, new Set(unmanagedMembers));
  }
}

function applySharingRuleSelections(config, typeMembersMap, discoveredByType, warnings) {
  applyObjectGateGranularSelections({
    config,
    typeMembersMap,
    discoveredByType,
    warnings,
    gateType: "SharingRules",
    granularTypes: SHARING_GRANULAR_TYPES,
  });
}

function applyAssignmentRuleSelections(config, typeMembersMap, discoveredByType, warnings) {
  applyObjectGateGranularSelections({
    config,
    typeMembersMap,
    discoveredByType,
    warnings,
    gateType: "AssignmentRules",
    granularTypes: ASSIGNMENT_GRANULAR_TYPES,
  });
}

function applyAutoResponseRuleSelections(config, typeMembersMap, discoveredByType, warnings) {
  applyObjectGateGranularSelections({
    config,
    typeMembersMap,
    discoveredByType,
    warnings,
    gateType: "AutoResponseRules",
    granularTypes: AUTO_RESPONSE_GRANULAR_TYPES,
  });
}

function applyWorkflowSelections(config, typeMembersMap, discoveredByType, warnings) {
  applyObjectGateGranularSelections({
    config,
    typeMembersMap,
    discoveredByType,
    warnings,
    gateType: "Workflow",
    granularTypes: WORKFLOW_SUBTYPE_TYPES,
  });
  const workflowParents = new Set(typeMembersMap.get("Workflow") || []);
  for (const typeName of WORKFLOW_SUBTYPE_TYPES) {
    for (const member of typeMembersMap.get(typeName) || []) {
      const objectName = getObjectName(typeName, member);
      if (objectName) {
        workflowParents.add(objectName);
      }
    }
  }
  if (workflowParents.size > 0) {
    typeMembersMap.set("Workflow", workflowParents);
  }
}

function serializeMapOfSets(map) {
  const out = {};
  for (const [typeName, membersSet] of map.entries()) {
    out[typeName] = Array.from(membersSet).sort(salesforceLexSort);
  }
  return out;
}

function serializeMapOfArrays(map) {
  const out = {};
  for (const [typeName, members] of map.entries()) {
    out[typeName] = members.slice().sort(salesforceLexSort);
  }
  return out;
}

function buildExcludedTypeMembersMap(discoveredByType, typeMembersMap) {
  const excludedTypeMembersMap = new Map();
  for (const [typeName, discoveredMembersRaw] of discoveredByType.entries()) {
    const discoveredMembers = (discoveredMembersRaw || []).filter((member) => member !== "*");
    if (discoveredMembers.length === 0) {
      continue;
    }
    const selectedNormalizedMembers = new Set(
      Array.from(typeMembersMap.get(typeName) || []).map((member) =>
        normalizeMemberForComparison(typeName, member)
      )
    );
    const excludedMembers = discoveredMembers.filter(
      (member) => !selectedNormalizedMembers.has(normalizeMemberForComparison(typeName, member))
    );
    if (excludedMembers.length > 0) {
      excludedTypeMembersMap.set(typeName, new Set(excludedMembers));
    }
  }
  return excludedTypeMembersMap;
}

function validateLevel3ParentEnablement(config) {
  const enabledTypes = new Set(
    (config.metadataTypes || []).filter((rule) => rule && rule.enabled).map((rule) => rule.metadataType)
  );
  for (const mapping of LEVEL3_PARENT_RULES) {
    if (enabledTypes.has(mapping.parentType)) {
      continue;
    }
    const enabledChildren = mapping.childTypes.filter((typeName) => enabledTypes.has(typeName));
    if (enabledChildren.length === 0) {
      continue;
    }
    throw new Error(
      `Invalid config: ${mapping.parentType} must be enabled when enabled level-3 types exist (${enabledChildren.join(", ")}).`
    );
  }
}

async function runGenerateManifest({ configPath, outputPath, targetOrg, status, debug = false }) {
  const startedAt = Date.now();
  const step = (message) => {
    if (typeof status === "function") {
      status(`[generate-manifest] ${message}`);
    }
  };

  step(`Starting with config ${configPath}`);
  const runDir = createRunArtifactsDir("ybsf-generate-manifest", process.cwd());
  try {
  const { config, path: resolvedConfigPath } = loadConfig(configPath);
  validateLevel3ParentEnablement(config);
  if (!targetOrg || !String(targetOrg).trim()) {
    throw new Error("generate-manifest requires --target-org");
  }
  const warnings = [];
  const typeMembersMap = new Map();
  step(`Discovering org metadata from ${targetOrg}`);
  const discoverStartedAt = Date.now();
  const discoveredByType = await discoverFromOrg(config, targetOrg, warnings, step, runDir, debug);
  step(`Org discovery completed in ${formatDuration(Date.now() - discoverStartedAt)}`);

  const enabledConfigTypes = new Set(
    config.metadataTypes.filter((r) => r.enabled).map((r) => r.metadataType)
  );
  for (const metadataType of FALLBACK_DISCOVERY_TYPES) {
    if (!enabledConfigTypes.has(metadataType)) {
      continue;
    }
    const discoveredMembers = discoveredByType.get(metadataType) || [];
    if (discoveredMembers.length > 0) {
      continue;
    }
    try {
      step(`Running fallback discovery for ${metadataType}`);
      const fallbackMembers = await discoverTypeFromListMetadata(
        targetOrg,
        config.apiVersion,
        metadataType,
        step,
        runDir
      )
        .filter((m) => m !== "*")
        .sort(salesforceLexSort);
      discoveredByType.set(metadataType, fallbackMembers);
      step(`Fallback discovery for ${metadataType} returned ${fallbackMembers.length} members`);
    } catch (err) {
      warnings.push(
        `Type ${metadataType}: fallback discovery failed via sf org list metadata (${err.message}).`
      );
    }
  }

  if (enabledConfigTypes.has("RecordType")) {
    try {
      if (shouldTransformPersonAccounts(config, discoveredByType)) {
        step("Resolving PersonAccount record type mappings");
        const personTypeNames = await discoverPersonAccountRecordTypeNames(targetOrg, step, runDir);
        const recordTypeMembers = discoveredByType.get("RecordType") || [];
        if (recordTypeMembers.length > 0 && personTypeNames.size > 0) {
          discoveredByType.set(
            "RecordType",
            applyPersonAccountRecordTypeTransform(recordTypeMembers, personTypeNames).sort(salesforceLexSort)
          );
          step(`PersonAccount mapping applied for ${personTypeNames.size} Account record types`);
        } else {
          step("PersonAccount mapping not applied (no matching Account record types discovered)");
        }
      }
    } catch (err) {
      warnings.push(`RecordType PersonAccount mapping failed: ${err.message}`);
    }
  }

  step("Resolving metadata members from config and discovery");
  for (const rule of config.metadataTypes) {
    if (!rule.enabled) {
      continue;
    }
    const discoveredMembers = discoveredByType.get(rule.metadataType) || [];
    const members = resolveMembersForType(rule, warnings, discoveredMembers);
    const unmanagedMembers = filterManagedMembers(rule.metadataType, members);
    addMembers(typeMembersMap, rule.metadataType, unmanagedMembers);
  }

  applySharingRuleSelections(config, typeMembersMap, discoveredByType, warnings);
  applyAssignmentRuleSelections(config, typeMembersMap, discoveredByType, warnings);
  applyAutoResponseRuleSelections(config, typeMembersMap, discoveredByType, warnings);
  applyWorkflowSelections(config, typeMembersMap, discoveredByType, warnings);
  resolveInstalledPackageRules(config, typeMembersMap, warnings, discoveredByType);
  const objectScopeFilteredCounts = applyObjectScopeFilter(typeMembersMap, config);
  const excludedTypeMembersMap = buildExcludedTypeMembersMap(discoveredByType, typeMembersMap);

  step("Writing manifest/package.xml");
  const resolvedOutput = path.resolve(outputPath || "manifest/package.xml");
  writePackageXml({
    outputPath: resolvedOutput,
    apiVersion: config.apiVersion,
    typeMembersMap,
  });
  const excludedPackagePath = path.join(runDir, "excludedPackage.xml");
  if (debug) {
    writePackageXml({
      outputPath: excludedPackagePath,
      apiVersion: config.apiVersion,
      typeMembersMap: excludedTypeMembersMap,
    });
  }

  // Persist discovery and resolution details for troubleshooting.
  const debugPath = path.join(runDir, "debug.json");
  fs.writeFileSync(
    debugPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targetOrg,
        runDir,
        configPath: resolvedConfigPath,
        apiVersion: config.apiVersion,
        discoveredByType: serializeMapOfArrays(discoveredByType),
        selectedByType: serializeMapOfSets(typeMembersMap),
        excludedByType: serializeMapOfSets(excludedTypeMembersMap),
        excludedPackagePath: debug ? excludedPackagePath : null,
        objectScopeFilteredCounts,
        warnings,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  step(`Total time: ${formatDuration(Date.now() - startedAt)}`);

    return {
      configPath: resolvedConfigPath,
      outputPath: resolvedOutput,
      targetOrg,
      runDir: debug ? runDir : null,
      debugPath: debug ? debugPath : null,
      excludedPackagePath: debug ? excludedPackagePath : null,
      warnings,
      typeCount: typeMembersMap.size,
    };
  } finally {
    cleanupRunArtifactsDir(runDir, debug);
  }
}

module.exports = {
  runGenerateManifest,
};
