const { isMemberIncluded } = require("./xml-utils");
const { normalizeActivityFieldName } = require("./field-scope");
const {
  parseXml,
  elementName,
  getFirstChildText,
  serializeXml,
} = require("./dom-xml");

function getDirectChildrenByTag(parentNode, tagName) {
  const out = [];
  if (!parentNode) {
    return out;
  }
  for (let child = parentNode.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) {
      continue;
    }
    if (elementName(child) === tagName) {
      out.push(child);
    }
  }
  return out;
}

function applyUserPermissionsPolicyNodes(root, policy) {
  const mode = policy && typeof policy === "object" ? policy.mode : "all";
  const members = Array.isArray(policy && policy.members) ? policy.members : [];
  if (mode === "all") {
    return { removedCount: 0 };
  }
  const policySet = new Set(members.map((value) => String(value || "").trim()).filter((value) => value.length > 0));
  let removedCount = 0;
  for (const node of getDirectChildrenByTag(root, "userPermissions")) {
    const permissionName = getFirstChildText(node, "name");
    if (!permissionName) {
      continue;
    }
    if (mode === "include") {
      if (!policySet.has(permissionName)) {
        root.removeChild(node);
        removedCount += 1;
      }
      continue;
    }
    if (mode === "exclude" && policySet.has(permissionName)) {
      root.removeChild(node);
      removedCount += 1;
    }
  }
  return { removedCount };
}

function removeOutOfScopeFieldPermissionNodes(root, manifestMembersByType) {
  if (!manifestMembersByType || typeof manifestMembersByType.get !== "function") {
    return { removedCount: 0 };
  }

  const objectMembers = manifestMembersByType.get("CustomObject") || [];
  const hasCustomObjectScope = manifestMembersByType.has("CustomObject");
  const includeAllObjects = objectMembers.includes("*");
  const objectAllowSet = includeAllObjects ? null : new Set(objectMembers);

  const customFieldMembers = manifestMembersByType.get("CustomField") || [];
  const hasCustomFieldScope = manifestMembersByType.has("CustomField");
  const includeAllCustomFields = customFieldMembers.includes("*");
  const customFieldAllowSet = includeAllCustomFields ? null : new Set(customFieldMembers);

  let removedCount = 0;
  for (const node of getDirectChildrenByTag(root, "fieldPermissions")) {
    const fullFieldName = getFirstChildText(node, "field");
    if (!fullFieldName.includes(".")) {
      continue;
    }
    const [objectName, fieldName] = fullFieldName.split(".", 2);
    const normalizedFieldName = normalizeActivityFieldName(fullFieldName);

    if (hasCustomObjectScope && !includeAllObjects && !objectAllowSet.has(objectName)) {
      root.removeChild(node);
      removedCount += 1;
      continue;
    }

    const isCustomField = fieldName.includes("__");
    if (!isCustomField) {
      continue;
    }

    if (!hasCustomFieldScope) {
      root.removeChild(node);
      removedCount += 1;
      continue;
    }

    if (!includeAllCustomFields && !customFieldAllowSet.has(normalizedFieldName)) {
      root.removeChild(node);
      removedCount += 1;
      continue;
    }
  }

  return { removedCount };
}

function removeExplicitlyExcludedStandardFieldPermissionNodes(root, excludedStandardFields) {
  if (!(excludedStandardFields instanceof Set) || excludedStandardFields.size === 0) {
    return { removedCount: 0 };
  }

  let removedCount = 0;
  for (const node of getDirectChildrenByTag(root, "fieldPermissions")) {
    const fullFieldName = getFirstChildText(node, "field");
    if (!fullFieldName) {
      continue;
    }
    const normalizedFieldName = normalizeActivityFieldName(fullFieldName);
    if (!excludedStandardFields.has(fullFieldName) && !excludedStandardFields.has(normalizedFieldName)) {
      continue;
    }
    root.removeChild(node);
    removedCount += 1;
  }

  return { removedCount };
}

function removePersonAccountDefaultNodes(root) {
  let removedCount = 0;
  for (const recordTypeVisibilityNode of getDirectChildrenByTag(root, "recordTypeVisibilities")) {
    for (const personAccountDefaultNode of getDirectChildrenByTag(recordTypeVisibilityNode, "personAccountDefault")) {
      recordTypeVisibilityNode.removeChild(personAccountDefaultNode);
      removedCount += 1;
    }
  }
  return { removedCount };
}

function removeOutOfScopeRecordTypeVisibilitiesNodes(root, manifestMembersByType) {
  let removedCount = 0;
  for (const node of getDirectChildrenByTag(root, "recordTypeVisibilities")) {
    const recordTypeName = getFirstChildText(node, "recordType");
    if (!recordTypeName) {
      continue;
    }
    const include = isMemberIncluded(manifestMembersByType, "RecordType", recordTypeName);
    if (!include) {
      root.removeChild(node);
      removedCount += 1;
    }
  }
  return { removedCount };
}

function removeOutOfScopeLayoutAssignmentsNodes(root, manifestMembersByType) {
  let removedCount = 0;
  for (const node of getDirectChildrenByTag(root, "layoutAssignments")) {
    const recordTypeName = getFirstChildText(node, "recordType");
    if (!recordTypeName) {
      continue;
    }
    const include = isMemberIncluded(manifestMembersByType, "RecordType", recordTypeName);
    if (!include) {
      root.removeChild(node);
      removedCount += 1;
    }
  }
  return { removedCount };
}

function hasDirectChildWithExactText(node, childName, expectedText) {
  const children = getDirectChildrenByTag(node, childName);
  if (children.length === 0) {
    return false;
  }
  return getFirstChildText(node, childName) === expectedText;
}

function removeProfileInactiveComponentsNodes(root) {
  let removedCount = 0;

  for (const node of getDirectChildrenByTag(root, "applicationVisibilities")) {
    if (
      hasDirectChildWithExactText(node, "default", "false") &&
      hasDirectChildWithExactText(node, "visible", "false")
    ) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "classAccesses")) {
    if (hasDirectChildWithExactText(node, "enabled", "false")) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "fieldPermissions")) {
    if (
      hasDirectChildWithExactText(node, "editable", "false") &&
      hasDirectChildWithExactText(node, "readable", "false")
    ) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "objectPermissions")) {
    const requiredFalseChildren = [
      "allowCreate",
      "allowDelete",
      "allowEdit",
      "allowRead",
      "modifyAllRecords",
      "viewAllFields",
      "viewAllRecords",
    ];
    const remove = requiredFalseChildren.every((childName) =>
      hasDirectChildWithExactText(node, childName, "false")
    );
    if (remove) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "recordTypeVisibilities")) {
    if (
      hasDirectChildWithExactText(node, "default", "false") &&
      hasDirectChildWithExactText(node, "visible", "false")
    ) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "tabVisibilities")) {
    if (hasDirectChildWithExactText(node, "visibility", "Hidden")) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  for (const node of getDirectChildrenByTag(root, "pageAccesses")) {
    if (hasDirectChildWithExactText(node, "enabled", "false")) {
      root.removeChild(node);
      removedCount += 1;
    }
  }

  return { removedCount };
}

function applyPermissionPolicies(
  xml,
  userPermissionsPolicy,
  manifestMembersByType,
  excludedStandardFields,
  options = {}
) {
  const originalXml = String(xml || "");
  const doc = parseXml(originalXml);
  const root = doc && doc.documentElement;
  if (!root) {
    return {
      cleaned: originalXml,
      removedCount: 0,
      removedUserPermissions: 0,
      removedRecordTypeVisibilities: 0,
      removedLayoutAssignments: 0,
      removedFieldPermissions: 0,
      changed: false,
    };
  }

  const applyProfileScopeCleanup = Boolean(options.applyProfileScopeCleanup);
  const removeProfileInactiveComponents = Boolean(options.removeProfileInactiveComponents);
  const { removedCount: removedUserPermissions } =
    applyUserPermissionsPolicyNodes(root, userPermissionsPolicy);
  const { removedCount: removedPersonAccountDefaults } =
    applyProfileScopeCleanup ? removePersonAccountDefaultNodes(root) : { removedCount: 0 };
  const { removedCount: removedRecordTypeVisibilities } =
    applyProfileScopeCleanup
      ? removeOutOfScopeRecordTypeVisibilitiesNodes(root, manifestMembersByType)
      : { removedCount: 0 };
  const { removedCount: removedLayoutAssignments } =
    applyProfileScopeCleanup
      ? removeOutOfScopeLayoutAssignmentsNodes(root, manifestMembersByType)
      : { removedCount: 0 };
  const { removedCount: removedObjectScopedFieldPermissions } =
    removeOutOfScopeFieldPermissionNodes(root, manifestMembersByType);
  const { removedCount: removedExplicitStandardFieldPermissions } =
    removeExplicitlyExcludedStandardFieldPermissionNodes(root, excludedStandardFields);
  const { removedCount: removedInactiveProfileComponents } =
    applyProfileScopeCleanup && removeProfileInactiveComponents
      ? removeProfileInactiveComponentsNodes(root)
      : { removedCount: 0 };
  const totalRemoved =
    removedUserPermissions +
    removedPersonAccountDefaults +
    removedRecordTypeVisibilities +
    removedLayoutAssignments +
    removedObjectScopedFieldPermissions +
    removedExplicitStandardFieldPermissions +
    removedInactiveProfileComponents;
  const cleaned = totalRemoved > 0 ? serializeXml(doc) : originalXml;
  return {
    cleaned,
    removedCount: totalRemoved,
    removedUserPermissions,
    removedRecordTypeVisibilities,
    removedLayoutAssignments,
    removedFieldPermissions: removedObjectScopedFieldPermissions + removedExplicitStandardFieldPermissions,
    changed: cleaned !== originalXml,
  };
}

module.exports = {
  applyPermissionPolicies,
};
