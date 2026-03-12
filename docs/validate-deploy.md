# `validate-deploy`

Use `validate-deploy` for a check-only deployment using the committed manifest. It runs the same deploy preparation as `deploy`, including destructive-change detection and test option handling, but sends the deploy as a validation run.

## Command
```bash
ybsf validate-deploy --config ybsf-metadata-config.json --target-org <org-alias> [--apply-destructive] [--test-level <level>] [--tests <comma-separated-test-names>]
```

For full command help, run `ybsf validate-deploy --help` or `ybsf help validate-deploy`.

## What It Does
- confirms the target org details before running
- uses committed `manifest/package.xml` as the deploy manifest
- computes destructive candidates by comparing committed scope to target-org scope
- runs a check-only deploy with `--ignore-conflicts`

## Common Uses
Validate with Salesforce default test behavior:
```bash
ybsf validate-deploy --target-org <org-alias>
```

Validate and include destructive changes automatically:
```bash
ybsf validate-deploy --target-org <org-alias> --apply-destructive
```

Validate with specified tests:
```bash
ybsf validate-deploy --target-org <org-alias> --test-level RunSpecifiedTests --tests AccountTriggerTest,OpportunityServiceTest
```

## Test Options
- Valid `--test-level` values:
  - `NoTestRun`
  - `RunSpecifiedTests`
  - `RunLocalTests`
  - `RunAllTestsInOrg`
  - `RunRelevantTests`
- `--tests` can only be used with `--test-level RunSpecifiedTests`
- `--test-level RunSpecifiedTests` requires `--tests`

## Destructive Behavior
- interactive terminal:
  - `ybsf` first prints the generated `destructiveChanges.xml` contents
  - then you are prompted to include destructive changes unless `--apply-destructive` is already set
- non-interactive terminal:
  - destructive changes are skipped unless `--apply-destructive` is set

## End-Of-Run Status Summary
After validation finishes, `ybsf` calls `sf project deploy report --job-id <deploy-id> --target-org <org-alias> --json` and prints a structured summary.

That summary includes:
- final validation status on its own highlighted line
- deploy id
- component counts
- test counts
- warnings, if any
- component failures or test failures, if any
- aggregate Apex coverage when coverage data is returned

## `--debug` Troubleshooting
Add `--debug` to preserve both the preflight target-org lookup artifacts and the deploy preparation artifacts under `tmp/`.

`--debug` is not required to see the destructive manifest contents or the final validation report summary in the console. It is only needed when you want to inspect the artifact files on disk afterward.

Example:
```bash
ybsf validate-deploy --target-org <org-alias> --apply-destructive --debug
```

Typical run directories:
```text
tmp/
├── ybsf-validate-deploy-preflight-2026-03-10T14-40-01-120Z/
│   ├── validate-target-org-display.cmd.txt
│   ├── validate-target-org-display.stdout.txt
│   ├── validate-target-org-organization.cmd.txt
│   └── ...
└── ybsf-deploy-2026-03-10T14-40-02-448Z/
    ├── deploy-prepare-debug.json
    ├── target-org-manifest/package.xml
    ├── destructiveChanges.xml
    ├── project-validate-deploy.cmd.txt
    ├── project-validate-deploy.stdout.txt
    ├── project-validate-deploy.stderr.txt
    └── project-validate-deploy.status.json
```

Useful files to inspect:
- preflight `validate-target-org-*` artifacts: the org detail lookups shown before confirmation
- `deploy-prepare-debug.json`: destructive diff inputs and counts
- `project-validate-deploy.*`: exact Salesforce CLI validation command and output

## Related Docs
- Deploy process: [deploy-process.md](deploy-process.md)
- Destructive preview: [destructive-preview.md](destructive-preview.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
