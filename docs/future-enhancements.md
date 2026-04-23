# Future Enhancements

This document tracks out-of-scope items that are intentionally deferred from day-1 implementation.

## 1) CI/CD-Oriented JSON Output
- Add structured `--json` output support for `ybsf` commands.
- Define a stable JSON contract per command (success and error envelopes).
- Ensure machine-readable output is deterministic and suitable for CI/CD orchestration and reporting.
- Update command docs and add tests for both text and JSON output modes.

## 2) Opt-in `--clean` retrieve with paired source-tracking reset

**Status:** Implemented.

### Background
`ybsf retrieve` previously deleted the entire `force-app/` directory before calling `sf project retrieve start`. This sidestepped the historical Salesforce limitation that retrieves do not remove local files for metadata components that have been deleted from the org or dropped from the manifest.

The wipe-and-retrieve pattern had a side effect: it could corrupt the Salesforce CLI's local source-tracking state. The CLI keeps a database of file hashes and revision IDs under `.sf/orgs/<orgId>/` (backed in part by `isomorphic-git` pack files). After `force-app/` was removed, every entry in that database pointed to a file that no longer existed. The subsequent retrieve then reconciled thousands of tracking-state changes in one batch. Any interruption or concurrent access during that batch (IDE polling, a killed process, antivirus/cloud-sync scanning) could leave the pack files in a half-written state. The next CLI invocation failed with:

```text
Metadata API request failed: An internal error caused this command to fail. isomorphic-git error: ...
```

Recovery was manual: delete `.sf/` and `.sfdx/` and retrieve again.

### Implemented behavior
- **Default `ybsf retrieve` behavior:** does not delete `force-app/`. The retrieve layers the org's content over the existing tree, keeping source-tracking state coherent across iterative retrieves and eliminating the isomorphic-git corruption class for the common case.
- **`--clean` flag:** when specified, removes `force-app/` contents and matching tracking state under `.sf/orgs/` and `.sfdx/orgs/` together, then retrieves. The two deletions stay paired because wiping sources without wiping tracking state is what produced the corruption.
- **Documentation:** retrieve docs and command help describe the tradeoff. Non-`--clean` is fast and safe but will not remove files that have been deleted in the org since the last retrieve; `--clean` gives a cleaner baseline but costs a tracking rebuild on the next retrieve.

### Rationale for keeping `--clean`
- Catching deletions in the org (components removed from the manifest or deleted in Setup) still requires a full reset for correctness.
- Drift reconciliation after a manifest reorg.
- A clean baseline before a release branch cut.

## 3) Delta-applied retrieve cleanup
- Retrieve into a temporary source directory, diff against `force-app/`, and apply only the resulting delta, including explicit deletes.
- This would preserve the current `--clean` correctness goal without wiping source up front or forcing broad Salesforce CLI source-tracking rebuilds.
- Treat as a larger retrieve refactor separate from the `--clean` baseline behavior.
