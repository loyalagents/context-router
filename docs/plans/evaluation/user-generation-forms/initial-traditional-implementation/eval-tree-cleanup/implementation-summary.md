# Eval Tree Cleanup Implementation Summary

- Status: complete
- Date: 2026-05-17

## What Changed

- Created `examples/eval/` as the active evaluation fixture home.
- Moved the fillable PDF fixtures, generated field manifests, form notes, and manifest generator into `examples/eval/`.
- Moved Elena Marquez into `examples/eval/users/elena-marquez/` as the first migrated synthetic user.
- Added `examples/eval/README.md` with the current Batch 0 shape, a short manual smoke check, and a note that schemas, validation, templates, scaffold generation, scenarios, and the eval runner are future work.
- Replaced the root `demo:form-fill:manifests` script with `eval:manifests`.
- Removed the root `demo:memory:verify` script; no validator exists again until the validator batch adds `eval:validate`.
- Updated the field manifest generator to use `examples/eval` as its root and emit `examples/eval/scripts/generate-field-manifests.mjs` in generated metadata.
- Regenerated all form field manifests and fake-user requirements.
- Updated active TODO docs so they no longer point contributors at the retired memory-demo fixture tree.
- Updated the orchestration plan to use unnumbered batch folder names and the `eval:<verb>` script namespace.

## Deleted Or Not Migrated

- Deleted `examples/form-fill-demo/` after moving the selected form-fill assets and Elena.
- Deleted `examples/memory-demo/`.
- Deleted `examples/memory-demo-simple/`.
- Did not migrate Alex Rivera, Maya Chen, Diana Mercer, old HTML forms, old scenarios, old templates, old local agent docs, old READMEs, old schemas, or `verify.mjs`.
- Deleted the old memory-demo schemas with the retired tree. Schema decisions restart in the schema-contract batch.

## Intentional Carry-Forwards

- Elena's `simple/seed-preferences.json` and `realistic/manifest.json` remain legacy-shaped.
- Elena's realistic corpus is only path-migrated in this batch. Contract normalization is deferred to Batch 1.
- All migrated PDFs remain in place, including weak or XFA fixtures. Scenario suitability is deferred to later batches.

## Verification

Ran:

```bash
pnpm eval:manifests
```

Result:

- `2026-27-fafsa-form`: 463 fields
- `fw4`: 48 fields
- `i-9`: 48 fields
- `rental-app-fillable`: expected extraction failure retained from the legacy fixture
- `saws-1-snap`: 115 fields
- `sf86-16a-nat-security-questionare`: 6197 fields

Ran path checks:

```bash
test ! -e examples/form-fill-demo
test ! -e examples/memory-demo
test ! -e examples/memory-demo-simple
```

All passed.

Ran active-reference checks against `package.json`, `examples/`, `docs/plans/demo/TODO.md`, and `docs/plans/active/memory-management/TODO.md`; no stale `demo:*` scripts or removed example paths were found.

Ran generated-manifest check under `examples/eval/forms/`; no `examples/form-fill-demo` references were found.

Ran Elena manifest path verification; all 100 document paths resolved under `examples/eval/users/elena-marquez/realistic/`.

Confirmed top-level `AGENTS.md` and `CLAUDE.md` do not reference the retired example trees.

Per user request, no final Git command was run. Review the worktree status separately.
