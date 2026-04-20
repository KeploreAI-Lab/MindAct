# R2 Bucket Layout Conventions

Bucket name: `mindact-registry-packages`

## Package Blobs

```
packages/{id}/v{version}/package.zip        — full package archive
packages/{id}/v{version}/SKILL.md           — entry doc (served directly by /registry/item/:id/content)
packages/{id}/v{version}/manifest.json      — normalized ManifestSchema JSON snapshot
```

## GitHub Import Cache

```
github-imports/{import_hash}/tree.json      — cached GitHub tree response
github-imports/{import_hash}/preview.json   — GitHubImportPreview JSON
```

## Notes

- `SKILL.md` is always stored separately for fast content fetches without extracting a ZIP.
- `manifest.json` is a snapshot of the full DecisionDependency at publish time. Authoritative version-specific data is in D1 `dependency_versions.manifest_json`; R2 is a secondary store for large blobs.
- `package.zip` is optional for knowledge/reference packages but required for `type: skill` with `executionPolicy.runtime != "none"`.
- Objects are immutable after upload. Versions are never mutated — only new versions are published.
- Access control: private/org visibility is enforced at the Worker layer; R2 itself is not publicly exposed.
