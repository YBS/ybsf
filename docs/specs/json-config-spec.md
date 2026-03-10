# JSON Config Specification

## Purpose
Define the single committed JSON configuration format used to control metadata selection and transformation behavior.

This config intentionally excludes auth/login/org-specific connection values.

## File Name
- Recommended default: `ybsf-metadata-config.json`

## File Location
- Recommended location: repository root.
- Commands should resolve this file from current working directory by default.
- Alternative locations are supported via explicit `--config` flag.

## Top-Level Structure
```json
{
  "version": 1,
  "apiVersion": "66.0",
  "metadataTypes": [],
  "packageRules": {},
  "processingRules": {
    "userPermissionsPolicy": {
      "mode": "all",
      "members": []
    },
    "excludeStandardFields": [],
    "optionalProcessing": {
      "removeSiteUserDomains": true,
      "removeProfileInactiveComponents": false,
      "sortObjectActionOverrides": true,
      "sortApplicationOverrides": true,
      "sortLayoutPlatformActionListItems": true,
      "sortGlobalValueSetInactiveValues": true,
      "sortWorkflowTimeTriggers": true
    },
    "includePseudoObjects": [
      "CaseClose",
      "CaseComment",
      "CaseInteraction",
      "Global"
    ]
  }
}
```

## Top-Level Fields
- `version` (integer, required): schema version, currently `1`.
- `apiVersion` (string, required): Salesforce API version string, e.g. `"66.0"`.
- `metadataTypes` (array, required): list of per-type rules.
- `packageRules` (object, required):
  - `includeManagedPackages` (boolean, required)
  - `includeUnlockedPackages` (boolean, required)
  - `namespaces` (array, required)
- `processingRules` (object, required):
  - `userPermissionsPolicy` (`MemberPolicy`, required in newly generated configs; defaults to `{"mode":"all","members":[]}` when omitted)
  - `excludeStandardFields` (string array, required in newly generated configs; defaults to `[]` when omitted for backward compatibility)
  - `optionalProcessing` (object, required in newly generated configs; defaults applied when omitted)
    - `removeSiteUserDomains` (boolean)
    - `removeProfileInactiveComponents` (boolean, default `false`)
    - `sortObjectActionOverrides` (boolean)
    - `sortApplicationOverrides` (boolean)
    - `sortLayoutPlatformActionListItems` (boolean)
    - `sortGlobalValueSetInactiveValues` (boolean)
    - `sortWorkflowTimeTriggers` (boolean)
  - `includePseudoObjects` (string array, required in newly generated configs; defaults to `["CaseClose","CaseComment","CaseInteraction","Global"]` when omitted)

## `packageRules` Shape
```json
{
  "includeManagedPackages": true,
  "includeUnlockedPackages": false,
  "namespaces": [
    {
      "namespace": "echosign_dev1",
      "metadataTypes": [
        {
          "metadataType": "CustomObject",
          "memberPolicy": {
            "mode": "include",
            "members": ["echosign_dev1__Agreement__c"]
          }
        }
      ]
    }
  ]
}
```

Semantics:
- Managed package metadata is excluded by default unless explicitly enabled by `packageRules.includeManagedPackages`.
- Unlocked package metadata is excluded by default unless explicitly enabled by `packageRules.includeUnlockedPackages`.
- If `includeManagedPackages=false`, `namespaces` must be empty.
- If `includeManagedPackages=true`, only listed `namespaces[].namespace` values are eligible.
- Within a listed namespace, only matching `metadataTypes` rules are eligible.
- If namespace is listed but no matching `metadataTypes` rule exists for a component type, exclude by default.
- `metadataTypes[]` uses the same rule shape and semantics as top-level `metadataTypes[]` entries (`metadataType`, conditional `folderPolicy`, conditional `memberPolicy`).

## `metadataTypes[]` Rule Shape
```json
{
  "metadataType": "ApexClass",
  "enabled": true,
  "memberPolicy": {
    "mode": "all",
    "members": []
  }
}
```

Fields:
- `metadataType` (string, required): Salesforce metadata type name.
- `enabled` (boolean, required): include this type in package generation.
- `memberPolicy` (object, conditional):
  - `mode` (enum, required): `all | include | exclude`.
  - `members` (string array, required): interpreted by `mode`.
  - Required for non-foldered types and when `folderPolicy.mode = memberPolicy`.
  - Must be omitted when `folderPolicy.mode = all|include|exclude`.
- `folderPolicy` (object, required for foldered types only):
  - `mode` (enum): `all | include | exclude | memberPolicy`
  - `folders` (array, required):
    - `folder` (string, required)
    - `memberPolicy` (object, optional; allowed for `include`, disallowed for `exclude`)

## Member Policy Semantics
- `all`: include all discovered members for the type. `members` must be empty.
- `include`: include only listed `members`.
- `exclude`: include all discovered members except listed `members`.

## Folder Policy Semantics
Foldered types are currently:
- `Report`
- `Dashboard`
- `Document`
- `EmailTemplate`

For foldered types, `folderPolicy` can be the primary selector model.

Modes:
1. `all`
- Candidate set: all discovered folder members.
- Includes all foldered members for the type.

2. `include`
- Candidate set: folders listed in `folderPolicy.folders`.
- Empty list is valid and means include no folders.
- Each folder can optionally define `memberPolicy`:
  - `all`: include all in that folder
  - `include`: include only listed member names within that folder
  - `exclude`: include all except listed member names within that folder
- `unfiled$public` is treated as a normal folder token and can be listed explicitly.

3. `exclude`
- Candidate set: all folders except listed folders.
- Folder entries in this mode are folder names only; per-folder `memberPolicy` is invalid.

4. `memberPolicy`
- Candidate set: all discovered folder members.
- Top-level `memberPolicy` is applied.

## Example: Include all reports except a few
```json
{
  "metadataType": "Report",
  "enabled": true,
  "folderPolicy": {
    "mode": "memberPolicy",
    "folders": []
  },
  "memberPolicy": {
    "mode": "exclude",
    "members": [
      "MyFolder/Report_To_Exclude_1",
      "Custom_Link_Reports/Report_To_Exclude_2"
    ]
  }
}
```

## Validation Rules
1. `version` must equal `1`.
2. `memberPolicy.mode` must be one of `all`, `include`, `exclude`.
3. If `memberPolicy.mode = all`, `memberPolicy.members` must be empty.
4. Foldered types must include `folderPolicy`.
5. Non-foldered types must not include `folderPolicy`.
6. If `folderPolicy.mode = include`, `folders` may be empty (include none) or contain explicit folder values.
7. If `folderPolicy.mode = exclude`, `folders[]` entries must not include `memberPolicy`.
8. If `folderPolicy.mode = all|include|exclude`, top-level `memberPolicy` must be omitted.
9. If `folderPolicy.mode = memberPolicy`, top-level `memberPolicy` is required.
10. `packageRules.namespaces[*].namespace` values must be unique.
11. `metadataTypes[].metadataType` must not be `InstalledPackage`.
12. Unknown keys are invalid (strict schema).

## Schema vs Semantic Validation
- JSON Schema enforces structure and value domains.
- Field-level uniqueness constraints are enforced by runtime semantic validation in config-loading logic:
  - unique `metadataTypes[].metadataType`
  - unique `packageRules.namespaces[].namespace`

## Converter Notes (`legacy -> json`)
- `sf.include*` values map to `enabled` by type.
- `includePackage.xml` maps to `memberPolicy.mode=include` + `memberPolicy.members`.
- `ignorePackage.xml` maps to `memberPolicy.mode=exclude` + `memberPolicy.members`.
- `ignorePackage.xml` `CustomField` entries that reference standard fields (for example `Asset.ExternalIdentifier`) map to `processingRules.excludeStandardFields` and are removed from `CustomField.memberPolicy`.
- `normalize-config` removes pseudo-object scope members listed in `processingRules.includePseudoObjects` from `CustomObject.memberPolicy.members` to avoid duplicate scope declarations.
- For foldered metadata types with include members, converter prefers `folderPolicy.mode=include`.
- `normalize-config` resolves mixed folder/member models:
  - `folderPolicy.mode=all` + top-level `memberPolicy.mode=include` + empty members is normalized to `folderPolicy.mode=include` with empty folders.
  - other `folderPolicy.mode=all` + top-level `memberPolicy` combinations are normalized to `folderPolicy.mode=memberPolicy`.
- When `normalize-config` runs with `--target-org`, object-scoped metadata selectors are pruned if their object is not included by effective `CustomObject` scope.
- If `convert-config` runs with `--target-org`, it performs org discovery via `sf project generate manifest` and can promote folder include lists to per-folder `memberPolicy.mode=all` when all discovered members in that folder are explicitly included.
- If `convert-config` runs with `--target-org`, `Document` include members are canonicalized to extensionless API-name form (`Folder/DocumentApiName`).
- Legacy `*UnfiledPublic=false` settings map to `folderPolicy.mode=exclude` with `folders=[{"folder":"unfiled$public"}]`.
- If both include and ignore exist for same type in legacy, converter selects `include` and emits warning (existing precedence).
- Legacy installed package settings should map into explicit `packageRules.namespaces[].metadataTypes[]`.
- Prefix-based selectors are deprecated and not represented in the new schema.

## Naming Standard
- Top-level sections use singular noun objects.
- Plural names are used for true collections/arrays (for example `metadataTypes`, `namespaces`, `members`, `folders`).
- Existing nested `*Policy` keys are retained in this phase (`memberPolicy`, `folderPolicy`, `userPermissionsPolicy`).
