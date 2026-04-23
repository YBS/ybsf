# Changelog

All notable changes to this project should be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public repository scaffold with runtime CLI code, schema, and public-facing docs.
- `--version` / `-v` / `version` command support in CLI.
- `ybsf retrieve --clean` for opt-in source cleanup with paired Salesforce CLI tracking-state reset.
- MIT license and baseline repository metadata.

### Changed
- `ybsf retrieve` now leaves `force-app/` in place by default to avoid corrupting local Salesforce CLI source tracking during iterative retrieves.

## [0.1.0] - 2026-03-04

### Added
- Initial public baseline cut for `ybsf`.
