# Conversion Command Spec (`convert-config`)

## Purpose
Convert legacy config inputs into the new JSON config format.

Legacy inputs:
- `salesforce.properties`
- `includePackage.xml`
- `ignorePackage.xml`

## Command
```bash
ybsf convert-config [--input-dir <path>] [--output-dir <path>] [--target-org <org-alias>] [--api-version <N.N>] [--force] [--includeManagedPackages] [--includeUnlockedPackages]
```

## Input Behavior
- Default input directory: current working directory (`.`).
- Input files:
  - `salesforce.properties`
  - `includePackage.xml`
  - `ignorePackage.xml`
- `salesforce.properties` is required.
- `includePackage.xml` and `ignorePackage.xml` are optional and treated as empty when absent.
- Optional flag:
  - `--input-dir <path>`: directory containing legacy input files.
  - `--target-org <org-alias>`: enable org-aware conversion adjustments using org metadata discovery.
  - `--api-version <N.N>`: API version written to config and used for org-aware discovery (default `66.0`).
  - `--includeManagedPackages`: set `packageRules.includeManagedPackages=true` in output config.
  - `--includeUnlockedPackages`: set `packageRules.includeUnlockedPackages=true` in output config.

## Output Behavior
- Default output directory: current working directory (`.`).
- Optional flag:
  - `--output-dir <path>`
- Default output filename:
  - `ybsf-metadata-config.json`
- Output overwrite behavior:
  - if file exists and `--force` is not set, command fails with clear message.
  - if `--force` is set, output file is overwritten.

## Initial Conversion Scope
- Generate config entries only for metadata types that are enabled by legacy inputs.
- Do not emit disabled placeholder entries for all known metadata types.
- Rationale: avoid creating entries for types unavailable in an org and avoid accidental enablement errors.

## Mapping Rules
- `sf.include*` properties map to:
  - `enabled=true` for corresponding `metadataType` entries.
- `includePackage.xml` type members map to:
  - `memberPolicy.mode = "include"`
  - `memberPolicy.members = [...]`
- `ignorePackage.xml` type members map to:
  - `memberPolicy.mode = "exclude"`
  - `memberPolicy.members = [...]`
- special case: `ignorePackage.xml` members under `CustomField` that represent standard fields
  (for example `Asset.ExternalIdentifier`) map to:
  - `processingRules.excludeStandardFields = [...]`
  - and are removed from `CustomField.memberPolicy.members`
- converter always seeds:
  - `processingRules.userPermissionsPolicy` from legacy user-permission exclusion properties as:
    - `mode = "exclude"`
    - `members = [...]`
  - `processingRules.optionalProcessing` with defaults:
    - `removeSiteUserDomains = true`
    - `removeProfileInactiveComponents = false`
    - `sortObjectActionOverrides = true`
    - `sortApplicationOverrides = true`
    - `sortLayoutPlatformActionListItems = true`
    - `sortGlobalValueSetInactiveValues = true`
    - `sortWorkflowTimeTriggers = true`
  - `processingRules.includePseudoObjects` from legacy `CustomObject` include/ignore behavior:
    - if `CustomObject` include members exist: include only pseudo objects explicitly included.
    - else if `CustomObject` ignore members exist: include all pseudo objects except explicitly ignored.
    - else include all default pseudo objects (`CaseClose`, `CaseComment`, `CaseInteraction`, `Global`).
- If neither include nor ignore list exists for an enabled type:
  - `memberPolicy.mode = "all"`
  - `memberPolicy.members = []`

Installed package mapping:
- Legacy namespace source:
  - `InstalledPackage` include/ignore members (namespace names) from package rules.
- Legacy managed type source:
  - `sf.includeManagedPackageTypes` (semicolon-delimited).
- Converter output:
  - populate `packageRules.includeManagedPackages` from legacy `sf.includeInstalledPackages` (or `--includeManagedPackages` override).
  - populate `packageRules.includeUnlockedPackages=true` for legacy conversion parity (or `--includeUnlockedPackages` override).
  - create `packageRules.namespaces[]` entries for explicitly included namespaces when `includeManagedPackages=true`.
  - create namespace `metadataTypes[]` rules using legacy managed type list with `memberPolicy.mode="all"` and empty members for initial conversion.
  - if no explicit managed namespace includes exist, emit no namespace entries (managed default deny).

## Include vs Ignore Conflict
- If both include and ignore are present for the same type:
  - include takes precedence (current legacy behavior parity)
  - emit warning in conversion report
  - command continues (no non-zero exit solely due to this conflict)

## Foldered Type Mapping
Foldered types:
- `Report`
- `Dashboard`
- `Document`
- `EmailTemplate`

Conversion should map legacy folder/unfiled settings to `folderPolicy`:
- if include members exist for foldered type -> prefer `folderPolicy.mode = "include"` with per-folder `memberPolicy`.
- if legacy `*UnfiledPublic=false` and no explicit folder includes -> map to:
  - `folderPolicy.mode = "exclude"`
  - `folderPolicy.folders = [{ "folder": "unfiled$public" }]`
- if no folder constraints are present -> `folderPolicy.mode = "memberPolicy"` and top-level `memberPolicy` (for foldered type) remains authoritative.
- if include resolution yields no valid folder members after normalization/discovery -> emit `folderPolicy.mode = "include"` with an empty `folders` array.

Org-aware conversion behavior (`--target-org`):
- primary discovery source: centralized `sf project generate manifest --from-org` helper.
- discovery call uses include-package flags derived from output config (`--include-packages managed` and/or `--include-packages unlocked`).
- fallback discovery for foldered types: `sf org list metadata` if primary source has no members for a foldered type.
- for `Document`, include members are canonicalized to extensionless API-name form (`Folder/DocumentApiName`).
- folder `include` rules are promoted to per-folder `memberPolicy.mode="all"` only when discovery proves full member coverage.
- after conversion, `init-project` runs `normalize-config` without init mode so missing org types are added as disabled placeholders and stale members are removed.

Level hierarchy reconciliation during conversion:
- if any Level 3 type is enabled, converter auto-enables its required Level 2 parent before semantic validation:
  - `SharingCriteriaRule`/`SharingOwnerRule` -> `SharingRules`
  - `AssignmentRule` -> `AssignmentRules`
  - `AutoResponseRule` -> `AutoResponseRules`
  - `WorkflowAlert`/`WorkflowFieldUpdate`/`WorkflowOutboundMessage`/`WorkflowRule`/`WorkflowTask` -> `Workflow`

## Conversion Report (stdout)
Minimum report:
- output file path
- number of metadata types written
- number of include/ignore conflicts resolved by include precedence
- warning list (if any)
- report detail level: summary-only (no per-type decision dump in initial implementation)
