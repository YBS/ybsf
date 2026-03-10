# `init-project`

Use `init-project` to turn a repository into a `ybsf` workspace. It creates the SFDX project scaffold, creates a starter config when no legacy files exist, or converts legacy config files when they do.

## What It Does
- Creates `sfdx-project.json`
- Creates `force-app/main/default`
- Creates `manifest/`
- Creates or updates `ybsf-metadata-config.json`
- Runs `normalize-config` after config creation or conversion

## Command
```bash
ybsf init-project [--api-version 66.0] [--target-org <org-alias>] [--force] [--includeManagedPackages] [--includeUnlockedPackages]
```

## Common Uses
Initialize a new repo:
```bash
ybsf init-project
```

Initialize and reconcile the config to a target org:
```bash
ybsf init-project --target-org <org-alias>
```

Replace existing scaffold/config outputs:
```bash
ybsf init-project --force
```

## Key Flags
- `--api-version`: API version used for scaffolded config and project metadata
- `--target-org`: enables org-aware conversion or init-time reconciliation
- `--force`: overwrite generated scaffold/config outputs when applicable
- `--includeManagedPackages`: set `packageRules.includeManagedPackages=true`
- `--includeUnlockedPackages`: set `packageRules.includeUnlockedPackages=true`

## When To Use It
- Starting a new metadata repo
- Converting a legacy Ant-style repo
- Creating a clean starting point before selecting tracked metadata

## `--debug` Troubleshooting
`init-project` passes `--debug` through to the conversion and normalization steps it invokes. That is most useful when:
- converting a legacy repo with org-aware discovery
- initializing a new repo with `--target-org`

Example:
```bash
ybsf init-project --target-org <org-alias> --debug
```

When discovery is involved, inspect preserved subcommand artifacts under `tmp/`, such as:
- `tmp/ybsf-convert-config-discovery-.../org-discovery/package.xml`
- `tmp/ybsf-normalize-config-.../org-discovery/package.xml`

## Related Docs
- Metadata selection: [selecting-tracked-metadata.md](selecting-tracked-metadata.md)
- Normalize config: [normalize-config.md](normalize-config.md)
- Legacy conversion runbook: [org-conversion-runbook.md](org-conversion-runbook.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
