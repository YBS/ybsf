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
3. If `--clean` is set, clear `force-app/` and matching Salesforce CLI tracking state.
4. Run `sf project retrieve start`.
5. Run the post-retrieve transform pipeline.

Manifest generation is described in [manifest-generation.md](manifest-generation.md).

## Clean Retrieves
By default, `ybsf retrieve` does not delete `force-app/` before retrieving. This keeps Salesforce CLI source-tracking state coherent across iterative retrieves and avoids local `isomorphic-git` tracking corruption caused by deleting source files while tracking data still points at them.

Use `--clean` when you need a fresh local baseline:

```bash
ybsf retrieve --target-org <org-alias> --clean
```

Clean retrieve removes `force-app/` contents and matching local tracking state under `.sf/orgs/` and `.sfdx/orgs/` before calling Salesforce retrieve. This catches files for metadata that was deleted from the org or dropped from the manifest, but the next retrieve rebuilds tracking state and can take longer. Close IDE extensions that poll the org during a clean retrieve when possible.

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
- permission set and profile cleanup tied to object scope, field scope, and user-permission policy
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
- `debug.json`: manifest path, config path, timings, manifest-generation warnings, and transform summary
- `org-display-for-clean.*`: only present for `--clean`; resolves target org identifiers used to find matching local tracking state
- `project-retrieve-start.*`: the exact `sf project retrieve start` command, raw terminal output, sanitized output, and exit status
- a separate sibling `tmp/ybsf-generate-manifest-.../` run directory preserved when retrieve calls `generate-manifest` with `--debug`

## Related Docs
- Manifest generation: [manifest-generation.md](manifest-generation.md)
- Metadata selection: [selecting-tracked-metadata.md](selecting-tracked-metadata.md)
- Technical specs:
  - [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
  - [specs/transform-pipeline-spec.md](specs/transform-pipeline-spec.md)
