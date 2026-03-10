# Org Conversion Runbook (Legacy -> Modern Tool)

## Purpose
Convert one existing org repository from the legacy Ant-based process to the new JSON-config + CLI process.

## CLI Name
- Commands below use the CLI binary name `ybsf`.

## Inputs
- Existing repo with legacy files:
  - `salesforce.properties`
  - `includePackage.xml`
  - `ignorePackage.xml`
- New tool available with:
  - `convert-config`
  - `normalize-config`
  - `generate-manifest`
  - retrieve/transform commands

## Output
- New config file:
  - `ybsf-metadata-config.json`
- Generated manifest:
  - `manifest/package.xml`

## Step 1: Create a Conversion Branch
```bash
git checkout -b codex/org-conversion-<org-name>
```

## Step 2: Run Config Conversion
From org repo root, initialize project and convert config in one step:
```bash
ybsf init-project --force
```

Alternative (manual conversion-only path):
```bash
ybsf convert-config --input-dir <legacy-dir> --output-dir .
```

If output exists and should be replaced:
```bash
ybsf convert-config --force
```

Expected output:
- `ybsf-metadata-config.json` created in target output directory.
- Summary report with warnings (if any).

## Step 3: Resolve Conversion Warnings
Review converter summary warnings and adjust `ybsf-metadata-config.json`.

Common warning to resolve:
- include/ignore conflict for same type:
  - converter keeps include behavior.
  - confirm this is intended for this org.

## Step 4: Validate JSON Config
`ybsf` validates config automatically (schema + semantic validation) when commands load `ybsf-metadata-config.json`.

Optional external schema validation (if `ajv-cli` is installed):
```bash
ajv validate -s docs/schemas/sf-metadata-config.schema.json -d ybsf-metadata-config.json
```

Confirm specifically:
- `memberPolicy` objects are valid (`mode` + `members`).
- foldered types have valid `folderPolicy`.
- `packageRules` explicitly lists only intended namespaces and metadata type rules.

## Step 5: Compile Manifest
Generate package manifest from new config:
```bash
ybsf generate-manifest --config ybsf-metadata-config.json --target-org <org-alias>
```

Expected output:
- `manifest/package.xml`
- types/members sorted deterministically.

## Step 6: Compare Against Legacy Behavior
Use the same org and compare legacy vs modern outputs:
1. legacy-generated package contents vs `manifest/package.xml`
2. key type/member counts
3. managed package inclusions
4. foldered metadata scoping behavior

Adjust config until expected parity is reached for this org.

## Step 7: Run Retrieve + Transform with New Tool
```bash
ybsf retrieve --target-org <org-alias>
```

Verify:
- retrieve summary includes post-retrieve transform results with expected warnings/errors.
- transformed metadata is stable on repeat run (idempotence check).

## Step 8: Validate Destructive Changes Preview
```bash
ybsf destructive-preview --config ybsf-metadata-config.json --target-org <org-alias>
```

Review summary only:
- deletion counts by type
- flagged high-risk deletes (if supported)

Adjust config if preview does not match expectations.

## Step 9: Deploy Validation
```bash
ybsf validate-deploy --config ybsf-metadata-config.json --target-org <org-alias>
```

If validation passes, org is ready for big-bang cutover to the modern process.

## Step 10: Cut Over This Org
- Switch this org’s operational runbook to new tool commands.
- Stop using legacy Ant commands for this org.
- Keep legacy files temporarily only if needed for audit/reference.

## Troubleshooting Quick Guide
- Manifest missing expected members:
  - check `enabled` and `memberPolicy.mode`.
  - check foldered `folderPolicy` scope.
- Unexpected managed-package members:
  - check `packageRules.includeManagedPackages`.
  - verify namespace and `metadataTypes` rules are explicit and minimal.
- Too many deletes in preview:
  - inspect `memberPolicy.exclude` and type enablement.
  - verify foldered/member scoping for reports/dashboards/templates/documents.

## Operational Note: `tmp/` Cleanup
- Commands create run artifacts under `tmp/ybsf-*`.
- By default (no `--debug`), per-command run artifact directories are deleted automatically.
- With `--debug`, run artifact directories are preserved for troubleshooting.
- Any preserved debug artifact directories are safe to delete periodically:
```bash
rm -rf tmp/ybsf-*
```
