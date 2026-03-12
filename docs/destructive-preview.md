# `destructive-preview`

Use `destructive-preview` before validation or deploy when you want to see how much metadata exists in the target org but is no longer present in the committed repository manifest.

## Command
```bash
ybsf destructive-preview --config ybsf-metadata-config.json --target-org <org-alias>
```

For full command help, run `ybsf destructive-preview --help` or `ybsf help destructive-preview`.

## What It Compares
- committed `manifest/package.xml`
- a target-org-scoped manifest generated from the current config

Anything present in the target-org-scoped manifest but missing from the committed deploy manifest becomes a destructive candidate, except record types that are intentionally excluded from automatic destructive output.

## Example
```bash
ybsf destructive-preview --target-org <org-alias>
```

When destructive candidates exist, the command prints:
- the destructive candidate counts
- the path to the generated `destructiveChanges.xml`
- the actual XML contents of that destructive manifest

## When To Use It
- Before `validate-deploy`
- Before `deploy`
- After narrowing tracked metadata in the config

## `--debug` Troubleshooting
Add `--debug` to keep the destructive comparison artifacts under `tmp/`.

`--debug` is not required to see the destructive XML in the console. It is only needed when you want to inspect the generated files under `tmp/` after the command exits.

Example:
```bash
ybsf destructive-preview --target-org <org-alias> --debug
```

Typical run directory:
```text
tmp/
└── ybsf-deploy-2026-03-10T14-36-12-404Z/
    ├── deploy-prepare-debug.json
    ├── target-org-manifest/
    │   └── package.xml
    ├── destructiveChanges.xml
    └── ...
```

Useful files to inspect:
- `deploy-prepare-debug.json`: desired manifest path, target-org manifest path, destructive counts by type, and non-deletable record types
- `target-org-manifest/package.xml`: manifest generated from current config and org discovery
- `destructiveChanges.xml`: the destructive payload that would be applied if included

## Related Docs
- Validate deploy: [validate-deploy.md](validate-deploy.md)
- Deploy: [deploy-process.md](deploy-process.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
