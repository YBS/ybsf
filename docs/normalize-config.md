# `normalize-config`

Use `normalize-config` to make the config deterministic, valid, and optionally aligned to what actually exists in a target org.

## Command
```bash
ybsf normalize-config [--config ybsf-metadata-config.json] [--target-org <org-alias>] [--init-mode] [--includeManagedPackages] [--includeUnlockedPackages]
```

For full command help, run `ybsf normalize-config --help` or `ybsf help normalize-config`.

## What It Does
- Sorts metadata rules and member lists into canonical order
- Ensures required config sections exist
- Applies schema and semantic validation
- Removes impossible or stale members when org discovery is enabled
- Adds missing org metadata types as enabled defaults in init mode or disabled placeholders otherwise

## Common Uses
Normalize the default config:
```bash
ybsf normalize-config
```

Normalize and reconcile to an org:
```bash
ybsf normalize-config --target-org <org-alias>
```

Normalize a config in a non-default path:
```bash
ybsf normalize-config --config config/my-org.json
```

## Key Flags
- `--config`: alternate config path
- `--target-org`: remove invalid members and add missing metadata types based on org discovery
- `--init-mode`: add discovered metadata types as enabled defaults
- `--includeManagedPackages`: turn on managed package inclusion
- `--includeUnlockedPackages`: turn on unlocked package inclusion

## When To Run It
- Right after manual config edits
- After conversion from legacy inputs
- Before reviewing a config diff for commit

## `--debug` Troubleshooting
Add `--debug` when you also use `--target-org` and want to preserve org-discovery artifacts under `tmp/`.

Example:
```bash
ybsf normalize-config --target-org <org-alias> --debug
```

Typical run directory:
```text
tmp/
└── ybsf-normalize-config-2026-03-10T14-24-06-517Z/
    └── org-discovery/
        └── package.xml
```

Useful files to inspect:
- `org-discovery/package.xml`: raw discovered metadata used to add missing types and remove stale members

If `normalize-config` receives discovery results from a previous step, it may not create a new run directory.

## Related Docs
- Metadata selection: [selecting-tracked-metadata.md](selecting-tracked-metadata.md)
- Manifest generation: [manifest-generation.md](manifest-generation.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
