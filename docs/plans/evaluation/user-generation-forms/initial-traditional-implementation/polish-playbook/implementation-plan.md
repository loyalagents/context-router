# Batch 5 Polish And Playbook Implementation Plan

## Summary

Batch 5 is a focused polish PR for `examples/eval/`. Batches 0-4 are complete, so the prior deferral condition is satisfied.

Scope:
- Do not add real LLM calls.
- Do not add UI/browser automation.
- Do not add document-analysis ingestion.
- Do not add new schemas, forms, scenarios, or snapshot types.
- Do not add archetypes/factories in this batch.
- Focus on verification ergonomics, no-DB CI readiness, contributor guidance, and small runner diagnostics.

Decisions:
- Add `eval:verify` as the local combined gate: `pnpm eval:test && pnpm eval:validate`.
- Add a dedicated no-DB CI job that runs `pnpm eval:test` and `pnpm eval:validate` as separate steps.
- Keep DB-backed `eval:run` manual/optional in Batch 5 CI.
- Add documented `--verbose` support to `eval:run` for unexpected runner failures.
- Mark optional LLM polish and archetypes/factories as deferred future work in orchestration docs.
- Next expansion after Batch 5 should be a second I-9 user, not W-4 for Elena.

## Key Changes

- Update root `package.json`:
  - Add `eval:verify`.
  - No dependency or lockfile change expected.

- Add dedicated `.github/workflows/ci.yml` job `eval-fixture-checks`:
  - `runs-on: ubuntu-latest`.
  - No `services`.
  - No `needs`.
  - No `defaults.run.working-directory`; all commands run from repo root.
  - Steps mirror existing jobs: `actions/checkout@v4`, `pnpm/action-setup@v4` with `version: 9`, `actions/setup-node@v4` with `node-version: '20'` and `cache: 'pnpm'`, root `pnpm install --frozen-lockfile`.
  - Run `pnpm eval:test` and `pnpm eval:validate` as separate steps.
  - Do not run Prisma generate, backend build, or DB-backed runner.

- Add `--verbose` to `pnpm eval:run`:
  - `args.mjs` parses `verbose: false` by default and documents the flag in `usage()`.
  - `run.mjs` threads `verbose` from `parsed.options` into the catch block.
  - `backend.mjs` exports `harnessError(parts)`, which returns `new Error(formatHarnessFailure(parts))` tagged with `error.isHarnessFailure = true`.
  - All current `formatHarnessFailure(...)` throw sites use `harnessError(...)`.
  - Catch behavior:
    - tagged harness error: print the rich message only, even in verbose mode.
    - untagged error with `--verbose`: print `error.stack` if available.
    - untagged error without `--verbose`: print `error.message`.
  - Validation failures are unchanged because validator output is already structured.

- Add `examples/eval/PLAYBOOK.md`:
  - Follow `examples/eval/README.md` style; no `docs/` status header.
  - Link it only from `examples/eval/README.md`.
  - README remains concise command reference; PLAYBOOK holds workflows and review guidance.

## Playbook Coverage

Start with a short pipeline orientation:

`profile.yaml -> pnpm eval:derive-seeds -> pnpm eval:scaffold -> pnpm eval:validate -> pnpm eval:run -> expected snapshots`

Document workflows for:
- Adding a user: edit `profile.yaml`, regenerate seeds with `pnpm eval:derive-seeds`, validate.
- Adding or refreshing a corpus: use scaffold for generated corpora; do not hand-edit generated seed output.
- Adding/editing templates: `templates/<category>/<slug>.mjs`, `meta`, `render(helpers)`, declared fact keys, deterministic `choose()`, and byte-stable rerenders.
- Report-driven repair: run validation, inspect `validation-report.json`, patch only listed profiles/templates/manifests/documents/field maps, rerun validation.
- Adding a field map: keep it form-scoped; use profile nulls and corpus `intentionallyMissing[]` for user-specific absence; use `render` hints where a PDF field needs a specific representation.
- Adding a scenario: scaffold can create a first-time skeleton; existing scenarios are runner-owned.
- Reviewing snapshots: inspect `filled-form.json` summary, changed fields, `expected`, `actual`, and classifications before using `--update-snapshots`.
- Optional DB smoke: link the existing README command sequence instead of duplicating it.

Document ownership:
- `profile.yaml` is the source of truth.
- `seed-preferences.generated.json`, `fields.generated.json`, and `validation-report.json` are generated.
- Scaffold owns generated corpora and first-time scenario skeletons.
- Runner owns expected snapshots after a scenario exists.

Document V1 limitations:
- Deterministic hydration only.
- No document ingestion, real LLM, or UI automation.
- Only `filled-form` snapshots.
- Only I-9 has a field map today.
- I-9 citizenship and alternative-procedure checkboxes are a named future hardening task because current field metadata does not expose reliable labels.

## Checkpoints

1. Verification Ergonomics
   - Add `eval:verify`.
   - Confirm `pnpm-lock.yaml` is unchanged.
   - Run `pnpm eval:verify`.

2. CI Readiness
   - Add dedicated no-DB `eval-fixture-checks` CI job with the pinned setup above.
   - Run `pnpm eval:test` and `pnpm eval:validate` as separate CI steps.
   - Do not add DB-backed runner to required CI.

3. Runner Diagnostics
   - Add `--verbose` parsing and usage text.
   - Add exported `harnessError(...)` helper and route harness failures through it.
   - Thread `verbose` into `runEval` catch handling.
   - Update existing `parseRunArgs` deep-equality tests for `verbose: false`.
   - Test plain unexpected errors and tagged harness-style multiline errors.
   - Run `pnpm eval:test`.

4. Playbook Docs
   - Add `examples/eval/PLAYBOOK.md`.
   - Update README with a short playbook link and command distinction:
     `eval:test` = script tests, `eval:validate` = fixture integrity, `eval:verify` = local combined gate.
   - Run `pnpm eval:validate`.

5. Completion Docs
   - Mark Batch 5 `in-progress` when implementation starts, then `complete` after verification.
   - Add `implementation-summary.md`.
   - Update both the orchestration status table and Batch 5 section status.
   - Record that optional LLM polish and archetypes/factories were intentionally excluded from Batch 5 and deferred to future optional expansion.

## Verification Commands

Required:
```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional DB-backed readiness:
```bash
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario elena-marquez-i9-template-smoke
```

## Assumptions

- CI’s separate eval steps are for clearer failure attribution; no special continue-on-error behavior is required.
- The CI job is lightweight in execution, not necessarily install cost, because root `pnpm install --frozen-lockfile` installs the workspace.
- `--verbose` is a supported diagnostic flag documented in usage.
- The next expansion should be a second I-9 user, likely with a different work-authorization profile, because it tests repeatability without first building W-4 mapping and tax templates.
