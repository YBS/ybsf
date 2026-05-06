# Runtime Command Spec

## Purpose
Define runtime commands used after config conversion and manifest compilation.

## CLI Name
- CLI binary name: `ybsf`

## Common Flags
- `--config <path>`: path to config file (default: `ybsf-metadata-config.json` in repo root).
- `--target-org <alias>`: required for org-connected commands.
- Note: `retrieve` intentionally does not accept `--config`; it always reads `ybsf-metadata-config.json` from repo root.
- Structured machine-readable command output (`--json`) is deferred; see [future-enhancements.md](/Users/jeff/git/ybsf/docs/future-enhancements.md).

## `init-project`
```bash
ybsf init-project [--api-version 66.0] [--target-org <org-alias>] [--force] [--includeManagedPackages] [--includeUnlockedPackages]
```
- Behavior:
  - initializes SFDX project scaffold (`sfdx-project.json`, `force-app/main/default`, `manifest/`).
  - detects legacy metadata config layout:
    - `sfdc/salesforce.properties` + include/ignore package XML, or
    - legacy files at repo root.
  - when legacy config is detected, runs conversion to `ybsf-metadata-config.json` automatically.
  - `--includeManagedPackages` and `--includeUnlockedPackages` set corresponding `packageRules` flags when creating/converting config.
  - runs `normalize-config` after conversion.
    - legacy conversion path uses non-init mode.
  - if `--target-org` is provided, conversion runs in org-aware mode (manifest discovery/canonicalization).
  - when no legacy config exists, creates a basic `ybsf-metadata-config.json` and runs `normalize-config` in init mode.
- Exit:
  - non-zero on scaffold/conversion errors.
  - zero on success.

## `completion`
```bash
ybsf completion zsh
```
- Behavior:
  - print zsh completion script to stdout.
  - intended usage:
    - `ybsf completion zsh > ~/.zfunc/_ybsf`
    - ensure `~/.zfunc` is in `fpath`, then run `compinit`.
- Exit:
  - non-zero for unsupported shell value.
  - zero on success.

## `generate-manifest`
```bash
ybsf generate-manifest --config ybsf-metadata-config.json --target-org <org-alias> [--output manifest/package.xml]
```
- Behavior:
  - generate `package.xml` from config rules.
  - uses org metadata discovery to resolve include/exclude/member subtraction behavior.
  - output includes explicit members only (no wildcard `*` entries).
  - default output: `manifest/package.xml`.
  - with `--debug`, emits `excludedPackage.xml` in the command run artifact directory for discovered members filtered out by config.
- Exit:
  - non-zero if `--target-org` is missing.
  - non-zero on generation errors.
  - zero on success.

## `normalize-config`
```bash
ybsf normalize-config [--config ybsf-metadata-config.json] [--target-org <org-alias>] [--init-mode] [--includeManagedPackages] [--includeUnlockedPackages]
```
- Behavior:
  - normalize and validate config ordering/shape:
    - sort `metadataTypes` by `metadataType`.
    - rewrite each `metadataTypes[]` rule in canonical key order: `metadataType`, `enabled`, `folderPolicy`, `memberPolicy`.
    - normalize conflicting foldered selection models:
      - `folderPolicy.mode=all` with top-level `memberPolicy.mode=include` and empty members becomes `folderPolicy.mode=include` with empty folders.
      - other `folderPolicy.mode=all` + top-level `memberPolicy` combinations become `folderPolicy.mode=memberPolicy`.
    - sort all `memberPolicy.members` arrays.
    - sort folder arrays by `folder`.
    - ensure `packageRules` exists; default `includeManagedPackages=false`, `includeUnlockedPackages=false`, `namespaces=[]`.
    - sort processing rules arrays.
    - ensure `processingRules.optionalProcessing` exists and normalize supported action keys:
      - `removeSiteUserDomains`
      - `removeProfileInactiveComponents`
      - `sortObjectActionOverrides`
      - `sortApplicationOverrides`
      - `sortLayoutPlatformActionListItems`
      - `sortGlobalValueSetInactiveValues`
      - `sortWorkflowTimeTriggers`
      - `sortPicklistDependencies`
    - migrate legacy `processingRules.excludeUserPermissions` to `processingRules.userPermissionsPolicy` (`mode=exclude`) and remove legacy key.
    - remove any `CustomObject.memberPolicy.members` entries that are present in `processingRules.includePseudoObjects` (pseudo object scope is controlled in `processingRules`).
    - fail-fast if duplicate `metadataType` rules exist.
    - run both schema and semantic validation; fail-fast on validation errors.
    - fail when a Level 3 type is enabled but its required Level 2 parent type is disabled (same constraints as manifest generation).
    - if `--includeManagedPackages` is passed, set `packageRules.includeManagedPackages=true`.
    - if `--includeUnlockedPackages` is passed, set `packageRules.includeUnlockedPackages=true`.
  - if `--target-org` is provided:
    - run org discovery via centralized `sf project generate manifest --from-org`.
    - apply include-package flags from `packageRules` (`--include-packages managed` and/or `--include-packages unlocked`).
    - add any missing org metadata types to config:
      - with `--init-mode`: `enabled=true`, `mode=all` defaults.
      - without `--init-mode`: `enabled=false`, `mode=all` placeholder defaults.
    - remove include/exclude members (top-level, folder-level, and installed package type rules) that are not present in org discovery.
    - for object-scoped metadata types (for example `ListView`, `RecordType`, `Layout`), remove include/exclude members whose object is not included by effective `CustomObject` scope.
    - for Level 3 object-scoped types, remove include/exclude members whose object is not included by effective Level 2 scope:
      - `SharingRules` -> `SharingCriteriaRule`, `SharingOwnerRule`
      - `AssignmentRules` -> `AssignmentRule`
      - `AutoResponseRules` -> `AutoResponseRule`
      - `Workflow` -> `WorkflowAlert`, `WorkflowFieldUpdate`, `WorkflowOutboundMessage`, `WorkflowRule`, `WorkflowTask`
      - for `Workflow` parent scope, treat `processingRules.includePseudoObjects` as in-scope parent objects.
    - `processingRules.includePseudoObjects` remains user-controlled and is not pruned by org discovery.
    - output removals as one line per removed member.
- Exit:
  - non-zero on discovery/validation errors.
  - zero on success.

## `retrieve`
```bash
ybsf retrieve --target-org <org-alias> [--clean]
```
- Behavior:
  - always generate `manifest/package.xml` from `ybsf-metadata-config.json`.
  - resolve target-org identifiers and `instanceUrl` via `sf org display`; classify the org as sandbox-like (sandbox or scratch) when the host contains `.sandbox.` or matches legacy `cs<N>.*` instances, else production-like.
  - by default, leave existing `force-app/` contents in place and let Salesforce retrieve layer retrieved source over the tree.
  - on sandbox-like orgs, always clear matching Salesforce CLI tracking state under `.sf/orgs/<id>/` and `.sfdx/orgs/<id>/` before retrieve so the SF CLI rebuilds a fresh `isomorphic-git` index. Project-local config (`.sf/config.json`) is preserved.
  - on production-like orgs, skip all tracking-related steps (no cleanup, no reset, no log lines) since source tracking is unavailable there.
  - when `--clean` is provided, additionally clear existing contents under `force-app/` before retrieve.
  - run `sf project retrieve start --ignore-conflicts` using the generated manifest and target org. `--ignore-conflicts` is passed unconditionally so source-tracking divergence never blocks the manifest-driven retrieve.
  - always execute post-retrieve transform pipeline after retrieve.
  - on sandbox-like orgs, run `sf project reset tracking --no-prompt` after transforms so the post-transform state becomes the new tracking baseline.
  - post-retrieve transforms are modular, process only components included by the generated manifest, and consume `processingRules.optionalProcessing` for optional sort/remove actions.
  - object transform stage removes out-of-scope object subcomponents/files from SFDX layout to enforce manifest parity.
- Artifacts:
  - all `sf` invocations that capture stdout/stderr to `tmp/ybsf-retrieve-*/` apply credential redaction (`accessToken`, `refreshToken`, `clientSecret`, `password`) before writing to disk.
- Exit:
  - non-zero on retrieval errors.
  - zero on success.

## `destructive-preview`
```bash
ybsf destructive-preview --config ybsf-metadata-config.json --target-org <org-alias>
```
- Behavior:
  - compute destructive candidate set.
  - output summary only (counts/warnings).
  - no apply.
- Exit:
  - non-zero on preview generation errors.
  - zero on successful preview.

## `validate-deploy`
```bash
ybsf validate-deploy --config ybsf-metadata-config.json --target-org <org-alias> [--apply-destructive] [--skip-destructive] [--test-level <level>] [--tests <comma-separated-test-names>]
```
- Behavior:
  - run validate/check-only deploy using committed `manifest/package.xml`.
  - use committed `manifest/package.xml` only for destructive-diff computation.
  - `--skip-destructive` skips destructive-diff computation entirely.
  - deploy command is invoked with `--ignore-conflicts` to overwrite source-tracking conflict state in target org.
  - before running deploy, show target alias/username/endpoint/environment and require interactive confirmation.
  - test execution:
    - if `--test-level` is omitted, Salesforce default test behavior is used.
    - `--tests` is valid only with `--test-level RunSpecifiedTests`.
  - when destructive candidates exist:
    - interactive runs prompt to include or skip destructive changes for this run.
    - `--apply-destructive` includes destructive changes without prompting.
    - non-interactive runs skip destructive changes unless `--apply-destructive` is set.
    - `--skip-destructive` suppresses destructive generation and takes precedence over `--apply-destructive`.
- Exit:
  - non-zero on validation failure.
  - zero on validation success.

## `deploy`
```bash
ybsf deploy --config ybsf-metadata-config.json --target-org <org-alias> [--apply-destructive] [--skip-destructive] [--test-level <level>] [--tests <comma-separated-test-names>]
```
- Behavior:
  - run deploy using committed `manifest/package.xml`.
  - use committed `manifest/package.xml` only for destructive-diff computation.
  - `--skip-destructive` skips destructive-diff computation entirely.
  - deploy command is invoked with `--ignore-conflicts` to overwrite source-tracking conflict state in target org.
  - before running deploy, show target alias/username/endpoint/environment and require interactive confirmation.
  - test execution:
    - if `--test-level` is omitted, Salesforce default test behavior is used.
    - `--tests` is valid only with `--test-level RunSpecifiedTests`.
  - destructive apply safety:
    - when destructive candidates exist, interactive runs prompt to include or skip destructive changes.
    - `--apply-destructive` includes destructive changes without prompting.
    - non-interactive runs require explicit `--apply-destructive` to include destructive changes.
    - `--skip-destructive` suppresses destructive generation and takes precedence over `--apply-destructive`.
- Exit:
  - non-zero on deployment failure.
  - zero on deployment success.

## `document`
```bash
ybsf document <task> [--object <ObjectApiName> | --all] [--source-dir <path>] [--output-dir <path>] [--target-org <org-alias>]
```
- Supported tasks:
  - `objectFields`
  - `picklistValues`
  - `picklistValuesControllingField`
  - `picklistValuesRecordTypes`
- Behavior:
  - default source directory is `force-app/main/default`.
  - default output directory is `doc`.
  - `--object` is required unless `--all` is provided.
  - `--object` and `--all` are mutually exclusive.
  - output folders are task-specific:
    - `doc/ObjectFields`
    - `doc/PicklistValues`
    - `doc/PicklistValuesControllingField`
    - `doc/PicklistValuesRecordTypes`
  - `objectFields` is org-backed and requires `--target-org`.
    - uses org describe data and tooling queries for field attributes and custom-field created dates.
    - uses raw MDAPI retrieve of `CustomObject:<Object>` to source `trackHistory` and `trackFeedHistory` values.
  - picklist tasks are local-metadata-only and do not require org access.
- Exit:
  - non-zero on validation or processing errors.
  - zero on success.

## Notes
- This spec defines runtime command behavior only; exact `sf` subcommands are implementation details.
