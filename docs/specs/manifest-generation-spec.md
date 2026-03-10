# Manifest Generation Spec

## Purpose
Compile `ybsf-metadata-config.json` into a Salesforce `package.xml` manifest for retrieve/deploy workflows.

## Inputs
- Required config file: `ybsf-metadata-config.json`
- Required target org alias and API access to org metadata for discovery/listing (same functional role as current dynamic package creation).

## Outputs
- Output artifact: `package.xml` only.
- Primary output path (SFDX target): `manifest/package.xml`
- Secondary temporary output path for destructive-change flow is allowed by implementation as an internal working file.

## Excluded-Member Visibility (Legacy `excludedPackage.xml` Replacement)
- `generate-manifest --debug` emits `excludedPackage.xml` under that run's debug artifact directory.
- `excludedPackage.xml` contains members discovered from the org but excluded from the final `package.xml` by config-driven filtering.
- When `--debug` is not set, this artifact is not written.
- When `--debug` is not set, command output should suppress tmp/debug artifact paths.

## Ordering Rules
- Strict deterministic sort:
  - metadata types sorted by type name ascending.
  - members sorted lexicographically ascending within each type.
- No wildcard (`*`) members in final output; only explicit members are emitted.

## Compiler Behavior

## Target org requirement
- `generate-manifest` requires `--target-org`.
- Command fails if target org is not provided.
- Manifest members are derived from org discovery and filtered by config.

## Type inclusion
- Only process `metadataTypes[]` entries where `enabled=true`.
- If a type is disabled but referenced by related include/exclude logic, emit warning (initial behavior).

## Invalid type names
- Fail-fast on invalid/unknown metadata type names in config.

## API version
- `<version>` in generated `package.xml` comes from `apiVersion` in config only.
- No CLI override in initial implementation.

## Installed package handling
- `packageRules` remains part of config and is required.
- Initial behavior:
  - org discovery includes managed/unlocked package metadata only when enabled via:
    - `packageRules.includeManagedPackages`
    - `packageRules.includeUnlockedPackages`
  - if `packageRules.includeManagedPackages=false`, managed package namespace rules are not allowed.
  - if `packageRules.includeManagedPackages=true`, only namespaces explicitly listed in `packageRules.namespaces[]` are eligible.
  - within each listed namespace, only explicitly listed `metadataTypes[]` rules are eligible.
  - default for managed metadata is deny unless explicitly matched by namespace + type rule.
  - `metadataTypes[]` uses the same rule shape and semantics as top-level `metadataTypes[]` entries.
  - `InstalledPackage` is generated from `packageRules.namespaces[]` and must not be listed in `metadataTypes[]`.
  - `packageRules` governs inclusion/exclusion of metadata discovered from installed managed/unlocked package contexts.
  - `CustomMetadata` namespace detection rule:
    - members are formatted as `<TypeApiName>.<RecordApiName>`.
    - if `<TypeApiName>` contains `__`, treat the token before the first `__` as the managed namespace for filtering.

## Member policy semantics
- `memberPolicy.mode=all`
  - include all discovered members for that type.
- `memberPolicy.mode=include`
  - include only listed `memberPolicy.members`.
- `memberPolicy.mode=exclude`
  - include all discovered members except listed `memberPolicy.members`.

## Foldered type semantics
Foldered types:
- `Report`
- `Dashboard`
- `Document`
- `EmailTemplate`

`folderPolicy.mode` behavior:
- `all`: all discovered folders in scope; include all members.
- `include`: only listed folders in scope; each folder entry may define `memberPolicy` (`all|include|exclude`).
- `include` with an empty folder list is valid and results in no members selected.
- `exclude`: all folders except listed folders in scope; folder entries are folder names only.
- `memberPolicy`: all discovered folders in scope; top-level `memberPolicy` applies.

Top-level `memberPolicy` rule for foldered types:
- required when `folderPolicy.mode=memberPolicy`
- must be omitted when `folderPolicy.mode=all|include|exclude`

Folder naming notes:
- `unfiled$public` is treated as a normal folder token.
- generated folder marker format is discovery-driven per type:
  - if discovery uses `Folder/`, generated folder markers use trailing `/`.
  - if discovery uses `Folder`, generated folder markers omit trailing `/`.

## Warnings and Errors
- Warnings (non-fatal, initial):
  - disabled-type references encountered during compile.
- Errors (fatal):
  - invalid metadata type names.
  - invalid folder policy shape/values for foldered types.
  - enabled Level 3 type with disabled Level 2 parent:
    - `SharingCriteriaRule`/`SharingOwnerRule` require `SharingRules`
    - `AssignmentRule` requires `AssignmentRules`
    - `AutoResponseRule` requires `AutoResponseRules`
    - `WorkflowAlert`/`WorkflowFieldUpdate`/`WorkflowOutboundMessage`/`WorkflowRule`/`WorkflowTask` require `Workflow`

## Notes
- `processingRules.userPermissionsPolicy`, `processingRules.excludeStandardFields`, and `processingRules.optionalProcessing` are consumed by post-retrieve processing.
- `processingRules.includePseudoObjects` is consumed by manifest compilation object-scope filtering to keep pseudo object scopes (for example `CaseClose`, `CaseComment`, `CaseInteraction`, `Global`) explicitly user-controlled.
- Object-scope hierarchy is top-down:
  - Level 1: `CustomObject` gates object-scoped Level 2/Level 3 members.
  - Level 2 gates Level 3 for paired types:
    - `SharingRules` -> `SharingCriteriaRule`, `SharingOwnerRule`
    - `AssignmentRules` -> `AssignmentRule`
    - `AutoResponseRules` -> `AutoResponseRule`
    - `Workflow` -> `WorkflowAlert`, `WorkflowFieldUpdate`, `WorkflowOutboundMessage`, `WorkflowRule`, `WorkflowTask`
- For `Workflow`, pseudo objects listed in `processingRules.includePseudoObjects` are treated as in-scope parent objects for Level 3 workflow selection.
- When a `Workflow*` Level 3 member is selected for an object, that object is emitted in Level 2 `Workflow` members so parent workflow containers are present for retrieve/deploy consistency.
