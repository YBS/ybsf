# Selecting Tracked Metadata

The goal of `ybsf` configuration is not to describe every metadata component in the org. The goal is to define the smaller subset that your repository intentionally tracks.

<img src="assets/tracked-metadata-scope.svg" alt="Tracked metadata scope" width="680" />

## Start With The Smallest Useful Scope
- Track metadata that your team owns and expects to deploy from source control.
- Exclude metadata owned by other teams, managed packages, and temporary org-only setup unless it is intentionally part of the repo.
- Prefer explicit include lists when only a small subset should be tracked.
- Prefer broader `exclude` rules only when most of a type belongs in the repo.

## The Main Config Controls
### Enable or disable whole metadata types
Use `metadataTypes[].enabled` to decide whether a type participates at all.

### Select members within a type
Use `memberPolicy` when a type is not foldered:
- `all`: track every discovered member of that type
- `include`: track only the listed members
- `exclude`: track everything except the listed members

### Select folders for foldered metadata
Use `folderPolicy` for:
- `Report`
- `Dashboard`
- `Document`
- `EmailTemplate`

This lets you include or exclude entire folders, then optionally refine members inside included folders.

### Control package metadata
Use `packageRules` to decide whether managed or unlocked package metadata is eligible at all. If managed packages are enabled, only listed namespaces and listed metadata types are tracked.

### Keep unwanted standard fields out
Use `processingRules.excludeStandardFields` when Salesforce retrieve behavior brings standard-field references you do not want in the repo.

### Keep pseudo-object scope explicit
Use `processingRules.includePseudoObjects` to control pseudo-object scope such as `CaseClose`, `CaseComment`, `CaseInteraction`, and `Global`.

## Practical Workflow
1. Enable the metadata types your team actually owns.
2. For broad source-owned types, start with `mode: "all"`.
3. For noisy types, narrow them with `include` or `exclude`.
4. For foldered types, decide whether the repo tracks all folders or only named folders.
5. Run `ybsf normalize-config --target-org <org-alias>` to remove stale selectors.
6. Run `ybsf generate-manifest --target-org <org-alias>` and inspect the resulting scope.
7. Adjust the config until the manifest matches the repository boundary you want.

## Example Pattern
Track all Apex classes, only selected custom objects, and a subset of reports:
```json
{
  "metadataType": "ApexClass",
  "enabled": true,
  "memberPolicy": {
    "mode": "all",
    "members": []
  }
}
```

```json
{
  "metadataType": "CustomObject",
  "enabled": true,
  "memberPolicy": {
    "mode": "include",
    "members": ["Account", "Opportunity", "Project__c"]
  }
}
```

```json
{
  "metadataType": "Report",
  "enabled": true,
  "folderPolicy": {
    "mode": "include",
    "folders": [
      {
        "folder": "Executive_Reports",
        "memberPolicy": {
          "mode": "all",
          "members": []
        }
      }
    ]
  }
}
```

## Related Docs
- Manifest generation: [manifest-generation.md](manifest-generation.md)
- Normalize config: [normalize-config.md](normalize-config.md)
- Technical spec: [specs/json-config-spec.md](specs/json-config-spec.md)
