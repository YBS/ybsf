# Changelog

All notable changes to this project should be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release process and branching conventions are described in [docs/release-process.md](docs/release-process.md).

## [Unreleased]

## [0.2.0] - 2026-04-30

### Added
- `ybsf retrieve --clean` for opt-in source cleanup with paired Salesforce CLI tracking-state reset.
- `ybsf retrieve` now resets Salesforce CLI source tracking after post-retrieve transforms on sandbox-like orgs so the post-transform state becomes the new tracking baseline. Skipped silently on production-like orgs.
- Sandbox-like org detection from `instanceUrl` (modern `.sandbox.` enhanced domains and legacy `cs<N>.*` instances), used to gate all tracking-related steps.
- Credential redaction (`accessToken`, `refreshToken`, `clientSecret`, `password`) applied to `tmp/ybsf-retrieve-*/` artifact files so `--debug` bundles can be shared safely.

### Changed
- `ybsf retrieve` always passes `--ignore-conflicts` to `sf project retrieve start` so manifest-driven retrieves are never blocked by source-tracking divergence.
- `ybsf retrieve` now clears matching Salesforce CLI tracking-state directories (`.sf/orgs/<id>/` and `.sfdx/orgs/<id>/`) by default on sandbox-like orgs to prevent `isomorphic-git` index corruption across iterative runs. Project-local config in `.sf/config.json` is preserved.
- `--clean` now means "also clear `force-app/`" since tracking-dir cleanup is the default on sandbox-like orgs.
- Production retrieves emit no tracking-related log lines (cleanup, conflict-handling, and reset are all unavailable there).

### Security
- Bump `@xmldom/xmldom` from `0.8.11` to `0.8.13` via `npm audit fix`.

## [0.1.0] - 2026-03-23

Final commit included in this release: [`967ecad`](https://github.com/yellowbricksystems/ybsf/commit/967ecad).

### Added
- Public repository scaffold with runtime CLI code, schema, and public-facing docs.
- `--version` / `-v` / `version` command support in CLI.
- `ybsf validate-deploy --skip-destructive` flag.
- MIT license and baseline repository metadata.
- Windows support: command quoting/verbatim handling and node command-line parameter fixes.
- `generate-manifest` excludes disabled metadata types to speed up org discovery.
- Improved help system: both `ybsf help <command>` and `ybsf <command> --help` are supported.
- Deploy command messaging improvements.
