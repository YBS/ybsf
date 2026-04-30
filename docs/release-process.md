# Release Process

`ybsf` follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and tracks changes in [`CHANGELOG.md`](../CHANGELOG.md). While the project is pre-1.0 (`0.x.y`), the public API and behavior may change between minor versions; breaking changes are called out in the changelog.

## Versioning

Given a version `MAJOR.MINOR.PATCH`:

- **MAJOR (`x.0.0`)** — incremented when the project reaches public-stable (`1.0.0`) or for backwards-incompatible changes after that.
- **MINOR (`0.x.0`)** — feature additions, behavior changes, or non-trivial refactors. While `0.x`, this is also where breaking changes land.
- **PATCH (`0.x.y`)** — bug fixes, security patches, doc-only updates, dependency bumps with no behavior change.

Pre-1.0 guidance: bump MINOR for anything user-visible; reserve PATCH for fixes that do not change documented behavior.

## Branching Model

The project uses a lightweight trunk-based flow with release tags:

- **`main`** is the integration branch. All work lands here through pull requests. `main` should always be in a green, releasable state.
- **Feature / fix branches** are named with a short prefix and topic (`feature/retrieve-tracking-reset`, `fix/windows-quoting`, `chore/bump-xmldom`). Branch from `main`, open a PR back to `main`.
- **Release tags** are annotated git tags of the form `vMAJOR.MINOR.PATCH` (e.g., `v0.2.0`) created on `main` at the commit being released.
- **Release branches** (`release/0.x`) are optional and only used when a stabilization period is needed before tagging, or when patch fixes need to be issued against an older minor without pulling in newer `main` work.

Avoid committing directly to `main` for anything other than CHANGELOG/release-prep edits and tag creation.

## Cutting a Release

1. Open a PR from a `release/<version>` branch (or simply edit `CHANGELOG.md` on `main` if no stabilization is needed).
2. In `CHANGELOG.md`:
   - Promote `## [Unreleased]` to `## [<version>] - YYYY-MM-DD` using today's date.
   - Add a fresh empty `## [Unreleased]` section above it.
3. Merge to `main`.
4. Tag the merge commit:
   ```bash
   git tag -a v<version> -m "Release v<version>"
   git push origin v<version>
   ```
5. Create a GitHub release pointing at the tag and paste the relevant CHANGELOG section as the release notes.

## Patch Releases on Older Minors

If `0.3.x` is current and a critical fix is needed for `0.2.x` users:

1. Create a `release/0.2` branch from the `v0.2.x` tag (if it does not already exist).
2. Cherry-pick the fix onto that branch.
3. Update `CHANGELOG.md` on the release branch with a `## [0.2.x] - YYYY-MM-DD` entry.
4. Tag `v0.2.x` on the release branch and push.

## Commit Hygiene

- Commits on `main` should describe *why* the change is being made, not just *what*.
- Avoid mixing unrelated changes in a single commit (e.g., do not bundle a feature and a dependency bump).
- Security-relevant patches go under the `Security` heading in the changelog and should be called out explicitly in release notes.

## Public-Stable (`1.0.0`) Criteria

Tentative milestones for cutting `1.0.0`:

- Stable command surface for `retrieve`, `validate-deploy`, `deploy`, `generate-manifest`, `normalize-config`.
- Documented config schema with versioning policy.
- Test coverage on core command flows and transforms.
- No known critical bugs in the previous minor's release notes.
