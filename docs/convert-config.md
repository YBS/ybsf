# `convert-config`

Use `convert-config` when you already have legacy metadata selection inputs and want to convert them into `ybsf-metadata-config.json` without running the full `init-project` scaffold flow.

## Command
```bash
ybsf convert-config [--input-dir <path>] [--output-dir <path>] [--target-org <org-alias>] [--api-version <N.N>] [--force] [--includeManagedPackages] [--includeUnlockedPackages]
```

## Inputs
- `salesforce.properties` is required
- `includePackage.xml` is optional
- `ignorePackage.xml` is optional

## Common Uses
Convert legacy files in the current directory:
```bash
ybsf convert-config
```

Convert files in another folder and write the new config to the repo root:
```bash
ybsf convert-config --input-dir sfdc --output-dir .
```

Run org-aware conversion:
```bash
ybsf convert-config --input-dir sfdc --output-dir . --target-org <org-alias>
```

## Key Flags
- `--input-dir`: folder containing the legacy files
- `--output-dir`: folder where `ybsf-metadata-config.json` should be written
- `--target-org`: use org discovery to improve foldered metadata and member canonicalization
- `--api-version`: API version written into the new config
- `--force`: overwrite an existing output config
- `--includeManagedPackages`: enable managed package support in `packageRules`
- `--includeUnlockedPackages`: enable unlocked package support in `packageRules`

## What To Review After Conversion
- Warnings about include/exclude conflicts
- Managed-package namespace rules
- Foldered metadata selection
- `processingRules.excludeStandardFields`
- `processingRules.includePseudoObjects`

## `--debug` Troubleshooting
`--debug` matters when conversion uses org-aware discovery with `--target-org`. In that mode it preserves the temporary org-discovery workspace under `tmp/`.

Example:
```bash
ybsf convert-config --input-dir sfdc --output-dir . --target-org <org-alias> --debug
```

Typical run directory:
```text
tmp/
└── ybsf-convert-config-discovery-2026-03-10T14-20-11-991Z/
    └── org-discovery/
        └── package.xml
```

Useful files to inspect:
- `org-discovery/package.xml`: raw org discovery manifest used to canonicalize and prune converted members

Without `--target-org`, `convert-config` does not create a preserved debug run directory.

## Related Docs
- Normalize config: [normalize-config.md](normalize-config.md)
- Metadata selection: [selecting-tracked-metadata.md](selecting-tracked-metadata.md)
- Technical spec: [specs/conversion-command-spec.md](specs/conversion-command-spec.md)
