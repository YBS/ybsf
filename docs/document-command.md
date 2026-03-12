# `document`

Use `document` to generate CSV outputs from retrieved metadata, and for the `objectFields` task, supplemental org describe data.

## Command
```bash
ybsf document <task> [--object <ObjectApiName> | --all] [--source-dir <path>] [--output-dir <path>] [--target-org <org-alias>]
```

For full command help, run `ybsf document --help` or `ybsf help document`.

## Supported Tasks
- `objectFields`
- `picklistValues`
- `picklistValuesControllingField`
- `picklistValuesRecordTypes`

## Defaults
- source directory: `force-app/main/default`
- output directory: `doc`

## Object Selection
- use exactly one of `--object` or `--all`
- `objectFields` requires `--target-org`

## Examples
Document field-level details for one object:
```bash
ybsf document objectFields --object Account --target-org <org-alias>
```

Export picklist values for every retrieved object:
```bash
ybsf document picklistValues --all
```

Write output to a custom folder:
```bash
ybsf document picklistValuesRecordTypes --object Opportunity --output-dir tmp/doc
```

## Output Folders
- `doc/ObjectFields`
- `doc/PicklistValues`
- `doc/PicklistValuesControllingField`
- `doc/PicklistValuesRecordTypes`

## Related Docs
- Retrieve process: [retrieve-process.md](retrieve-process.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
