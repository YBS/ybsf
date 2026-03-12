# ybsf

Yellow Brick Systems Salesforce metadata CLI for config-driven retrieve, manifest generation, transforms, and deploy workflows.

## Requirements
- Node.js 18+
- Salesforce CLI (`sf`) installed and authenticated
  - https://developer.salesforce.com/tools/salesforcecli
- Supported local development platforms: macOS and Windows

## Install
From the `ybsf` repository root:
```bash
npm install
```

## One-time Setup For Direct CLI Use
From the `ybsf` repository root:
```bash
npm link
```

## Run
After `npm link`, run from any directory:
```bash
ybsf <command> [options]
```

For full help on one command, run `ybsf <command> --help` or `ybsf help <command>`.

Show CLI version:
```bash
ybsf --version
```

Show detailed help for one command:
```bash
ybsf deploy --help
ybsf help deploy
```

Typical workflow:
```bash
ybsf init-project -o <org-alias> --debug
ybsf generate-manifest -o <org-alias>
ybsf retrieve -o <org-alias>
ybsf destructive-preview -o <org-alias>
ybsf validate-deploy -o <org-alias>
ybsf deploy -o <org-alias>
```

## Command Guides
- `init-project`: scaffold a repo and create or convert the metadata config.
  - Guide: [docs/init-project.md](docs/init-project.md)
- `convert-config`: convert legacy config files into `ybsf-metadata-config.json`.
  - Guide: [docs/convert-config.md](docs/convert-config.md)
- `normalize-config`: normalize config ordering and optionally reconcile it to org discovery.
  - Guide: [docs/normalize-config.md](docs/normalize-config.md)
- `generate-manifest`: build `manifest/package.xml` from config rules plus org discovery.
  - Guide: [docs/manifest-generation.md](docs/manifest-generation.md)
- `retrieve`: generate a manifest, retrieve metadata, and run post-retrieve transforms.
  - Guide: [docs/retrieve-process.md](docs/retrieve-process.md)
- `destructive-preview`: preview metadata that would be treated as destructive changes.
  - Guide: [docs/destructive-preview.md](docs/destructive-preview.md)
- `validate-deploy`: run a check-only deploy with optional destructive changes and test settings.
  - Guide: [docs/validate-deploy.md](docs/validate-deploy.md)
- `deploy`: run a deploy with optional destructive changes and test settings.
  - Guide: [docs/deploy-process.md](docs/deploy-process.md)
- `document`: generate CSV documentation from retrieved metadata and org describe data.
  - Guide: [docs/document-command.md](docs/document-command.md)
- `completion`: print the zsh completion script.
  - Example: `ybsf completion zsh > ~/.zfunc/_ybsf`
- `version`: print the CLI version.
  - Example: `ybsf --version`

## Metadata Selection
- How to decide what metadata should be tracked in the repository:
  - [docs/selecting-tracked-metadata.md](docs/selecting-tracked-metadata.md)

## Configuration
- Default config file: `ybsf-metadata-config.json`
- JSON schema: [docs/schemas/sf-metadata-config.schema.json](docs/schemas/sf-metadata-config.schema.json)
- User guide: [docs/selecting-tracked-metadata.md](docs/selecting-tracked-metadata.md)
- Technical spec: [docs/specs/json-config-spec.md](docs/specs/json-config-spec.md)

## Documentation
- User guides:
  - [docs/init-project.md](docs/init-project.md)
  - [docs/convert-config.md](docs/convert-config.md)
  - [docs/normalize-config.md](docs/normalize-config.md)
  - [docs/manifest-generation.md](docs/manifest-generation.md)
  - [docs/retrieve-process.md](docs/retrieve-process.md)
  - [docs/destructive-preview.md](docs/destructive-preview.md)
  - [docs/validate-deploy.md](docs/validate-deploy.md)
  - [docs/deploy-process.md](docs/deploy-process.md)
  - [docs/document-command.md](docs/document-command.md)
  - [docs/selecting-tracked-metadata.md](docs/selecting-tracked-metadata.md)
  - [docs/org-conversion-runbook.md](docs/org-conversion-runbook.md)
- Technical specs:
  - [docs/specs/runtime-command-spec.md](docs/specs/runtime-command-spec.md)
  - [docs/specs/manifest-generation-spec.md](docs/specs/manifest-generation-spec.md)
  - [docs/specs/transform-pipeline-spec.md](docs/specs/transform-pipeline-spec.md)
  - [docs/specs/conversion-command-spec.md](docs/specs/conversion-command-spec.md)
  - [docs/specs/json-config-spec.md](docs/specs/json-config-spec.md)
- Future ideas:
  - [docs/future-enhancements.md](docs/future-enhancements.md)

## Troubleshooting
Verify which local code the `ybsf` command resolves to.

macOS/Linux:
```bash
realpath "$(command -v ybsf)"
```

Windows (PowerShell):
```powershell
Get-Command ybsf
(Get-Command ybsf).Source
```

## License
MIT
