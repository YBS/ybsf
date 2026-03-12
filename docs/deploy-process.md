# Deploy Process

`ybsf deploy` uses the committed `manifest/package.xml` as the source of truth for what should be deployed from the repository. Before the deploy runs, `ybsf` computes destructive candidates by comparing that committed manifest to what the current config says exists in the target org.

## Command
```bash
ybsf deploy --config ybsf-metadata-config.json --target-org <org-alias> [--apply-destructive] [--test-level <level>] [--tests <comma-separated-test-names>]
```

For full command help, run `ybsf deploy --help` or `ybsf help deploy`.

## How Destructive Changes Are Identified
1. Load the committed `manifest/package.xml`.
2. Generate a target-org-scoped manifest from the current config and target org.
3. Compare the two manifests.
4. Treat members that exist in the target-org-scoped manifest but not in the committed deploy manifest as destructive candidates.
5. Write `destructiveChanges.xml` for those candidates when any exist.

Record type destructive candidates are excluded from automatic destructive output and require manual cleanup.

## Confirmation Prompts
Before deployment, `ybsf` shows the target alias, username, environment, endpoint, and org id, then asks for confirmation in an interactive terminal.

If destructive candidates exist:
- interactive terminal:
  - `ybsf` first prints the generated `destructiveChanges.xml` contents
  - then it prompts whether to include destructive changes in this run
- non-interactive terminal:
  - destructive changes are skipped unless `--apply-destructive` is provided

## Skipping The Destructive Prompt
Use `--apply-destructive` to include destructive changes automatically without the destructive follow-up prompt.

```bash
ybsf deploy --target-org <org-alias> --apply-destructive
```

This does not skip the target-org confirmation prompt in an interactive terminal.

## End-Of-Run Status Summary
After the deploy command finishes, `ybsf` calls `sf project deploy report --job-id <deploy-id> --target-org <org-alias> --json` and prints a structured summary.

That summary includes:
- final deploy status on its own highlighted line
- deploy id
- component counts
- test counts
- warnings, if any
- component failures or test failures, if any
- aggregate Apex coverage when coverage data is returned

## Test Run Controls
- `--test-level` supports:
  - `NoTestRun`
  - `RunSpecifiedTests`
  - `RunLocalTests`
  - `RunAllTestsInOrg`
  - `RunRelevantTests`
- `--tests` can only be used with `--test-level RunSpecifiedTests`
- each specified test is passed through as a separate deploy test argument

Example:
```bash
ybsf deploy --target-org <org-alias> --test-level RunSpecifiedTests --tests AccountTriggerTest,OpportunityServiceTest
```

## Typical Flow
1. Run `ybsf destructive-preview --target-org <org-alias>`.
2. Run `ybsf validate-deploy --target-org <org-alias>`.
3. Run `ybsf deploy --target-org <org-alias>`.

## `--debug` Troubleshooting
Add `--debug` to preserve both the preflight target-org lookup and deploy-preparation artifacts under `tmp/`.

`--debug` is not required to see the destructive manifest contents or the final deployment report summary in the console. It is only needed when you want to inspect the underlying artifact files on disk afterward.

Example:
```bash
ybsf deploy --target-org <org-alias> --apply-destructive --debug
```

Typical run directories:
```text
tmp/
├── ybsf-deploy-preflight-2026-03-10T14-43-55-881Z/
│   ├── deploy-target-org-display.cmd.txt
│   ├── deploy-target-org-display.stdout.txt
│   ├── deploy-target-org-organization.cmd.txt
│   └── ...
└── ybsf-deploy-2026-03-10T14-43-57-233Z/
    ├── deploy-prepare-debug.json
    ├── target-org-manifest/package.xml
    ├── destructiveChanges.xml
    ├── project-deploy-start.cmd.txt
    ├── project-deploy-start.stdout.txt
    ├── project-deploy-start.stderr.txt
    └── project-deploy-start.status.json
```

Useful files to inspect:
- preflight `deploy-target-org-*` artifacts: org detail queries used for the confirmation prompt
- `deploy-prepare-debug.json`: destructive candidate counts and the manifests used for comparison
- `target-org-manifest/package.xml`: current desired scope from config plus org discovery
- `destructiveChanges.xml`: destructive payload used when `--apply-destructive` is selected
- `project-deploy-start.*`: exact deploy command and Salesforce CLI output

## Related Docs
- Destructive preview: [destructive-preview.md](destructive-preview.md)
- Validate deploy: [validate-deploy.md](validate-deploy.md)
- Technical spec: [specs/runtime-command-spec.md](specs/runtime-command-spec.md)
