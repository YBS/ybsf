# Retrieve Process

`ybsf retrieve` is a three-stage workflow: generate the manifest, retrieve metadata from Salesforce, and normalize the retrieved source so the repository only contains the metadata that should be tracked.

## Command
```bash
ybsf retrieve --target-org <org-alias> [--clean]
```

For full command help, run `ybsf retrieve --help` or `ybsf help retrieve`.

## End-To-End Flow
1. Read `ybsf-metadata-config.json` from the repo root.
2. Generate `manifest/package.xml`.
3. Resolve target-org metadata (`sf org display`) to determine identifiers and whether the org is sandbox-like (sandbox or scratch) based on its `instanceUrl`.
4. On sandbox-like orgs, clear matching Salesforce CLI source-tracking state under `.sf/orgs/<id>/` and `.sfdx/orgs/<id>/`. If `--clean` is set, also clear `force-app/` contents.
5. Run `sf project retrieve start --ignore-conflicts` against the generated manifest. `--ignore-conflicts` is passed unconditionally so source-tracking divergence never blocks a manifest-driven retrieve.
6. Run the post-retrieve transform pipeline.
7. On sandbox-like orgs, run `sf project reset tracking --no-prompt` so the post-transform state becomes the new tracking baseline. On production-like orgs, this step is skipped because source tracking is not available there.

Manifest generation is described in [manifest-generation.md](manifest-generation.md).

## Source-Tracking Behavior
`ybsf retrieve` is manifest-driven, so source-tracking state is treated as derived. By default, on sandbox and scratch orgs, the command:

- wipes `.sf/orgs/<id>/` and `.sfdx/orgs/<id>/` before retrieve so the SF CLI rebuilds a fresh `isomorphic-git` index and avoids checksum-corruption errors that accumulate over iterative runs;
- passes `--ignore-conflicts` to the retrieve so org state always wins over local tracking diffs;
- resets tracking after post-retrieve transforms so files removed by transforms are not flagged as pending local changes.

Sandbox-like detection uses the org's `instanceUrl`: hosts containing `.sandbox.` (modern enhanced domains for sandboxes and scratch orgs) and legacy `cs<N>.*` instances are treated as sandbox-like. Other URLs (production, dev edition, Trailhead playgrounds) are treated as production-like, and tracking-related steps are skipped silently.

Project-local SF CLI configuration in `.sf/config.json` (default org alias and similar) is preserved — only per-org subdirectories under `orgs/` are removed.

## Clean Retrieves
Use `--clean` when you also need a fresh `force-app/` baseline:

```bash
ybsf retrieve --target-org <org-alias> --clean
```

`--clean` clears `force-app/` contents in addition to the tracking-dir cleanup that runs by default. This catches files for metadata that was deleted from the org or dropped from the manifest. Close IDE extensions that poll the org during a clean retrieve when possible.

## Required Object Transformations
Salesforce retrieve behavior is broader than the manifest boundary for object metadata. When a `CustomObject` member is retrieved, Salesforce also brings along related object internals and object-scoped files. `ybsf` cleans those extras back down to manifest scope after retrieve.

Required object cleanup includes:
- removing whole object folders that are out of scope
- removing object child files that are out of scope within kept objects
- removing out-of-scope object-scoped files such as layouts, quick actions, object translations, sharing rules, topics, tabs, and workflows
- trimming granular sharing, assignment, auto-response, and workflow nodes when their parent object stays in scope but the granular member does not

These required transforms are always on because they restore manifest parity.

## Always-On Normalization
In addition to object cleanup, the pipeline always applies the normalization needed to keep retrieved metadata consistent with config scope:
- permission set and profile cleanup tied to object scope, pseudo-object scope, layout scope, record type scope, field scope, and user-permission policy
- record type picklist cleanup for excluded custom fields and excluded standard fields
- deterministic XML formatting and ordering

## Optional Transformations
Optional transformations are controlled by `processingRules.optionalProcessing`.

### `removeSiteUserDomains`
- Transform: `sites`
- Effect: removes site user domain noise that Salesforce can add during retrieve
- XML elements removed from `*.site-meta.xml`:
  - `<siteAdmin>`
  - `<subdomain>`
  - `<siteGuestRecordDefaultOwner>`

### `removeProfileInactiveComponents`
- Transform: `profiles`
- Effect: removes inactive profile component entries
- Default: `false`
- XML elements removed from `*.profile-meta.xml` when they are effectively inactive:
  - `<applicationVisibilities>` where `<default>false</default>` and `<visible>false</visible>`
  - `<classAccesses>` where `<enabled>false</enabled>`
  - `<fieldPermissions>` where `<editable>false</editable>` and `<readable>false</readable>`
  - `<objectPermissions>` where all CRUD/view flags are `false`
  - `<recordTypeVisibilities>` where `<default>false</default>` and `<visible>false</visible>`
  - `<tabVisibilities>` where `<visibility>Hidden</visibility>`
  - `<pageAccesses>` where `<enabled>false</enabled>`

### `sortObjectActionOverrides`
- Transform: `objects`
- Effect: sorts object action overrides deterministically
- XML elements sorted in `objects/*/*.object-meta.xml`:
  - `<actionOverrides>`
- Sort key fields:
  - `<actionName>`, `<formFactor>`, `<pageOrSobjectType>`, `<recordType>`, `<profile>`, `<type>`

### `sortApplicationOverrides`
- Transform: `applications`
- Effect: sorts application overrides deterministically
- XML elements sorted in `*.app-meta.xml`:
  - `<actionOverrides>`
  - `<profileActionOverrides>`
- Sort key fields:
  - `<actionName>`, `<content>`, `<formFactor>`, `<pageOrSobjectType>`, `<recordType>`, `<profile>`
- Additional cleanup:
  - removes `<profileActionOverrides>` entries when the referenced FlexiPage, RecordType, or Profile is out of scope

### `sortLayoutPlatformActionListItems`
- Transform: `layouts`
- Effect: sorts layout platform action list items deterministically
- XML elements sorted in `*.layout-meta.xml`:
  - `<platformActionListItems>` inside each `<platformActionList>`
- Sort key field:
  - `<sortOrder>`

### `sortGlobalValueSetInactiveValues`
- Transform: `globalValueSets`
- Effect: sorts inactive global value set entries deterministically
- XML elements reordered in `*.globalValueSet-meta.xml`:
  - inactive `<customValue>` entries where `<isActive>false</isActive>`
- Sort key field:
  - `<fullName>`
- Behavior:
  - active values stay in place ahead of the inactive group
  - inactive values are sorted only when `<sorted>` is not `true`

### `sortWorkflowTimeTriggers`
- Transform: `workflows`
- Effect: sorts workflow time triggers deterministically
- XML elements sorted in `*.workflow-meta.xml`:
  - `<workflowTimeTriggers>` inside each `<rules>` block
- Sort key fields:
  - `<timeLength>`
  - `<workflowTimeTriggerUnit>`
- Additional cleanup:
  - removes an entire `workflows/<Object>.workflow-meta.xml` file when the workflow object is out of scope

### `sortPicklistDependencies`
- Transform: `objects`
- Effect: sorts dependent picklist value settings deterministically
- Default: `false`
- XML elements sorted in `objects/*/fields/*.field-meta.xml` for `Picklist` and `MultiselectPicklist` fields:
  - `<valueSettings>` inside `<valueSet>`
  - repeated `<controllingFieldValue>` entries inside each `<valueSettings>`
- Sort key fields:
  - `<valueName>` for `<valueSettings>`
  - controlling field value text for `<controllingFieldValue>`

## Example
```bash
ybsf retrieve --target-org <org-alias>
```

If you are tuning config scope, a common loop is:
1. `ybsf normalize-config --target-org <org-alias>`
2. `ybsf generate-manifest --target-org <org-alias>`
3. `ybsf retrieve --target-org <org-alias>`

## `--debug` Troubleshooting
Add `--debug` to keep the command run artifacts under `tmp/` instead of deleting them after the command finishes.

Example:
```bash
ybsf retrieve --target-org <org-alias> --debug
```

Retrieve creates a run directory like:
```text
tmp/
└── ybsf-retrieve-2026-03-10T14-32-18-123Z/
    ├── debug.json
    ├── org-display-for-clean.cmd.txt
    ├── project-retrieve-start.cmd.txt
    ├── project-retrieve-start.stdout.raw.txt
    ├── project-retrieve-start.stdout.txt
    ├── project-retrieve-start.stderr.raw.txt
    ├── project-retrieve-start.stderr.txt
    ├── project-retrieve-start.status.json
    └── ...
```

Useful files to inspect:
- `debug.json`: manifest path, config path, timings, manifest-generation warnings, transform summary, tracking-reset outcome (`succeeded` / `skipped` / `not-applicable`), and any tracking-reset error message
- `org-display-for-clean.*`: always present; resolves target-org identifiers and `instanceUrl` used for tracking-dir cleanup and sandbox-like detection. Sensitive fields (`accessToken`, `refreshToken`, `clientSecret`, `password`) are redacted before artifact files are written, so `--debug` bundles can be shared safely.
- `project-retrieve-start.*`: the exact `sf project retrieve start` command, raw terminal output, sanitized output, and exit status
- `project-reset-tracking.*`: present on sandbox-like orgs only; captures the post-retrieve `sf project reset tracking` invocation
- a separate sibling `tmp/ybsf-generate-manifest-.../` run directory preserved when retrieve calls `generate-manifest` with `--debug`

## Related Docs
- Manifest generation: [manifest-generation.md](manifest-generation.md)
- Metadata selection: [selecting-tracked-metadata.md](selecting-tracked-metadata.md)
- Technical specs:
  - [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
  - [specs/transform-pipeline-spec.md](specs/transform-pipeline-spec.md)
