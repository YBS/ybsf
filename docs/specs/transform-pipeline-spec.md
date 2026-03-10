# Transform Pipeline Spec

## Purpose
Define the post-retrieve transformation pipeline contract for the modernized tool.

## Scope (v1)
- Full parity with current transformation behavior is required in v1.
- Includes filtering, cleanup, and sorting behaviors currently implemented in legacy post-retrieve processing.

## Execution Order (v1)
Run transforms in this order:
1. `sites`
2. `permissionSets`
3. `profiles`
4. `objects`
5. `applications`
6. `layouts`
7. `globalValueSets`
8. `workflows`

## Object Transform Rules (SFDX Layout)
- The `objects` transform must enforce manifest-scoped cleanup after retrieve.
- Rationale: retrieving `CustomObject` members pulls additional object internals that may be outside explicit manifest scope.
- Required behavior:
  - delete `force-app/main/default/objects/<Object>/` directories for objects not included in `CustomObject`.
  - within included object folders, delete child files not included by manifest for:
    - `fields`, `businessProcesses`, `compactLayouts`, `fieldSets`, `listViews`, `recordTypes`, `sharingReasons`, `validationRules`, `webLinks`.
  - delete object-scoped files outside object folders when object/member is out of scope:
    - `layouts/*.layout-meta.xml`
    - `quickActions/*.quickAction-meta.xml` (object-scoped actions)
    - `objectTranslations/*.objectTranslation-meta.xml`
    - `sharingRules/*.sharingRules-meta.xml`
    - `topicsForObjects/*.topicsForObjects-meta.xml`
    - `tabs/*.tab-meta.xml` (object tabs)
    - `workflows/*.workflow-meta.xml` (object workflow files)
- Any manifest-excluded object-scoped file must be removed from `force-app`.
- Sharing rule scoping model:
  - `SharingRules` is the object-scope gate.
  - `SharingCriteriaRule` and `SharingOwnerRule` are optional granular filters within each in-scope object.
  - If granular types are omitted but `SharingRules` is enabled, default behavior is include all criteria/owner rules for in-scope objects.
  - In `sharingRules/*.sharingRules-meta.xml`, out-of-scope `<sharingCriteriaRules>` / `<sharingOwnerRules>` nodes must be removed when corresponding granular types are present.
- Assignment/AutoResponse scoping model:
  - `AssignmentRules` and `AutoResponseRules` are object-scope gates.
  - `AssignmentRule` and `AutoResponseRule` are optional granular filters inside each in-scope object.
  - If granular types are omitted but object-level types are enabled, default behavior is include all rules for in-scope objects.
  - In `assignmentRules/*.assignmentRules-meta.xml` and `autoResponseRules/*.autoResponseRules-meta.xml`, out-of-scope rule nodes must be removed when corresponding granular types are present.

## Module Architecture
- Implement transforms as modular, named transform components.
- Use an ordered transform registry to control execution order.
- New transform/sorting rules should be added by registering a new module (or extending an existing module) without pipeline redesign.

## Gating Rules
- Transform execution is driven by metadata type `enabled` flags and existing transform-related config.
- For retrieve-driven execution, transforms must scope processing to components included in the generated `manifest/package.xml`.
- Optional transform actions are controlled by `processingRules.optionalProcessing` in config (no command-line overrides).
  - supported optional actions:
    - `removeSiteUserDomains`
    - `removeProfileInactiveComponents`
    - `sortObjectActionOverrides`
    - `sortApplicationOverrides`
    - `sortLayoutPlatformActionListItems`
    - `sortGlobalValueSetInactiveValues`
    - `sortWorkflowTimeTriggers`
  - `removeProfileInactiveComponents` is profile-only and defaults to `false` because it can create large one-time compaction diffs.

## Idempotence Requirement
- Pipeline must be idempotent:
  - running transforms repeatedly on already-transformed files must produce identical output.

## File Write Behavior
- Always write processed XML files (even if no semantic change detected).
- Rationale:
  - enforce consistent XML structure/formatting
  - reduce repository noise from inconsistent parser/serializer whitespace and ordering
- XML transforms that remove blocks (for example permissions/fieldPermissions filtering) must not leave empty placeholder lines.
- Normalized output should remove blank/whitespace-only lines so repeated runs remain stable and do not introduce spacing-only diffs.
- XML serialization style is standardized to Salesforce-style two-line declaration/root output:
  - line 1: `<?xml version="1.0" encoding="UTF-8"?>`
  - line 2: metadata root element (for example `<Layout ...>`, `<Profile ...>`).
- Repository migration note:
  - moving from legacy one-line declaration/root formatting to this style is an expected one-time diff during tool/repo upgrade.

## Error Handling
- Continue processing on per-file/per-transform errors.
- Do not fail-fast entire run on first error.
- Report all errors in end-of-run summary.
- Exit status policy for initial implementation:
  - non-zero exit if any errors occurred
  - zero exit if no errors

## Reporting
- Summary-only output (no verbose per-file diff dump in v1).
- Required summary fields:
  - total files scanned
  - total files written
  - unchanged count (if tracked)
  - warning count
  - error count
  - list of error identifiers/paths

## Compatibility Notes
- This pipeline consumes:
  - metadata type enablement from `ybsf-metadata-config.json`
  - `processingRules` section values (for example `userPermissionsPolicy`)
- Profile/PermissionSet `fieldPermissions` filtering rules:
  - remove entries for objects outside manifest `CustomObject` scope;
  - remove custom-field entries outside manifest `CustomField` scope;
  - remove any entries listed in `processingRules.excludeStandardFields` (supports standard-field rollout drift handling).
- Object `recordType` filtering rules:
  - for retained `objects/*/recordTypes/*.recordType-meta.xml` files, remove `picklistValues` entries whose backing custom fields are outside manifest `CustomField` scope;
  - remove `picklistValues` entries for standard fields listed in `processingRules.excludeStandardFields`.
- API drift policy:
  - do not add transforms that strip Salesforce-introduced metadata fields solely to reduce diffs (for example default/false fields introduced in newer API versions).
  - retain Salesforce-retrieved metadata values unless there is a functional/parity reason to transform them.
- The pipeline does not consume auth/org connection settings.
- Legacy `preDeploy` behavior is a no-op; modern implementation should keep an extension hook point for pre-deploy processing even if no custom pre-deploy modules are shipped in v1.
