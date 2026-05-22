# Batch 0 Implementation Plan: Eval Tree Cleanup

## Goal

Establish `examples/eval/` as the only active evaluation fixture home. Move the useful form-fill assets and Elena corpus into it, delete the old demo fixture trees, and update active docs/scripts so future work starts from a clean layout.

Backwards compatibility is intentionally broken for simplicity. Do not keep `demo:*` aliases, symlinks, compatibility READMEs, placeholder legacy directories, or old demo examples.

## Context And Relevant Source Files

- `examples/form-fill-demo/` contains the form-fill PDFs, field manifest generator, forms notes, and Elena.
- `examples/memory-demo/` and `examples/memory-demo-simple/` are retired and should be deleted.
- `package.json` owns root script names.
- `docs/plans/evaluation/user-generation-forms/orchestration-plan.md` tracks this six-batch initiative.
- `docs/plans/demo/TODO.md` and `docs/plans/active/memory-management/TODO.md` are active TODO docs that should not point contributors at deleted fixture trees.

## Non-Goals

- Do not define the new schemas.
- Do not normalize Elena into `profile.yaml`, `corpora/`, `factKeys`, or final `manifest.json` shape.
- Do not build validation, templates, scaffold generation, scenarios, or the eval runner.
- Do not change backend, web, Prisma, GraphQL, MCP, local-orchestrator, or product behavior.

## Expected Moves, Deletes, And Edits

- Standardize planning folder names in `orchestration-plan.md`:
  - Batch 0: `eval-tree-cleanup/`
  - Batch 1: `schema-contract/`
  - Batch 2: `validator/`
  - Batch 3: `templates-scaffold/`
  - Batch 4: `eval-runner/`
  - Batch 5: `polish-playbook/`
  - Add one convention note: all evaluation fixture scripts use the `eval:<verb>` namespace.

- Create the canonical fixture tree:
  - `examples/form-fill-demo/forms/` -> `examples/eval/forms/`
  - `examples/form-fill-demo/scripts/generate-field-manifests.mjs` -> `examples/eval/scripts/generate-field-manifests.mjs`
  - `examples/form-fill-demo/forms-notes.md` -> `examples/eval/forms-notes.md`
  - `examples/form-fill-demo/users/elena-marquez/` -> `examples/eval/users/elena-marquez/`
  - The user asked to run any Git commands later, so this execution uses filesystem moves rather than `git mv`.

- Add `examples/eval/README.md`:
  - Describe only the Batch 0 state: forms, generated field manifests, forms notes, generator script, and Elena.
  - Do not carry over the old `examples/form-fill-demo/README.md`.
  - Include only a short new manual smoke-check section using the new paths.
  - State that schemas, validator, templates, scaffold, scenarios, and runner do not exist yet.
  - State that Elena is migrated as-is from legacy form-fill demo shape and will be normalized in Batch 1.

- Delete retired fixture trees:
  - Remove remaining `examples/form-fill-demo/`.
  - Remove `examples/memory-demo/`.
  - Remove `examples/memory-demo-simple/`.
  - Delete old `examples/memory-demo/schemas/` with the tree; schema decisions restart in Batch 1.
  - Do not migrate Alex, Maya, Diana, old HTML forms, old memory-demo scenarios, old templates, local `AGENTS.md`/`CLAUDE.md`, old READMEs, or `verify.mjs`.

- Update scripts and generated metadata:
  - Replace root `demo:form-fill:manifests` with `eval:manifests`.
  - Remove root `demo:memory:verify`; no replacement exists until Batch 2.
  - In the generator script, update both the resolved root constant and embedded generated `generator` string to `examples/eval`.
  - Run `pnpm eval:manifests` so regenerated JSON/Markdown reflects the new path.

- Update active docs:
  - Edit `examples/eval/forms-notes.md` to remove references to deleted Alex/Maya users.
  - In `docs/plans/demo/TODO.md`, delete bullets that directly name `memory-demo`; keep unrelated reset/search/demo TODOs; add one redirect line to `docs/plans/evaluation/user-generation-forms/orchestration-plan.md`.
  - In `docs/plans/active/memory-management/TODO.md`, replace memory-demo fixture wording with eval fixture wording.
  - Leave historical completed implementation plans/summaries unchanged, even if they mention old paths.

## Checkpoints

1. Orchestration checkpoint:
   - Update Batch 0 path/status references.
   - Rename future batch plan folders in the table to the unnumbered convention.
   - Add the `eval:<verb>` script convention.
   - Verify no active orchestration entry points to `00-canonical-eval-tree/`.

2. Forms checkpoint:
   - Move forms, forms notes, and generator.
   - Update `package.json` script to `eval:manifests`.
   - Update generator path constants/strings.
   - Run `pnpm eval:manifests`.
   - Verify generated files under `examples/eval/forms/` do not contain `examples/form-fill-demo`.

3. Elena checkpoint:
   - Move Elena.
   - Update Elena README path references.
   - Verify `examples/eval/users/elena-marquez/realistic/manifest.json` exists.
   - Verify every `documents[].path` in that manifest resolves under the moved `realistic/` directory.
   - Do not rewrite Elena's manifest schema in this batch.

4. Deletion checkpoint:
   - Delete old demo trees.
   - Verify `examples/form-fill-demo`, `examples/memory-demo`, and `examples/memory-demo-simple` no longer exist.
   - Confirm no top-level `AGENTS.md` or `CLAUDE.md` depends on the deleted example-local agent files.

5. Docs checkpoint:
   - Add the honest eval README with a new smoke-check section, not old demo-flow carryover.
   - Clean active TODOs and forms notes.
   - Verify `package.json`, `examples/`, and the active TODO docs do not point users at removed paths.
   - Accept old path mentions only in historical planning docs, brainstorming motivation, and feedback files.

6. Final checkpoint:
   - Write `implementation-summary.md`.
   - Mark Batch 0 `complete` in `orchestration-plan.md`.
   - Summary must record what moved, what was deleted, what was intentionally not migrated, commands run, and that validator coverage is absent until Batch 2.

## Verification Commands

```bash
pnpm eval:manifests

test ! -e examples/form-fill-demo
test ! -e examples/memory-demo
test ! -e examples/memory-demo-simple

rg "demo:memory|demo:form-fill|examples/(form-fill-demo|memory-demo|memory-demo-simple)" \
  package.json \
  examples \
  docs/plans/demo/TODO.md \
  docs/plans/active/memory-management/TODO.md

rg "examples/form-fill-demo" examples/eval/forms

node -e "
const fs = require('fs');
const path = require('path');
const root = 'examples/eval/users/elena-marquez/realistic';
const manifestPath = path.join(root, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('missing manifest: ' + manifestPath);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const missing = manifest.documents
  .filter((doc) => !fs.existsSync(path.join(root, doc.path)))
  .map((doc) => doc.path);
if (missing.length) {
  console.error(missing.join('\n'));
  process.exit(1);
}
console.log('ok ' + manifest.documents.length);
"
```

The two `rg` commands should return no matches.

The final worktree status check is intentionally left for the user because they asked to run Git commands later.

## Risks And Rollback

- Risk: generated form manifests keep stale generator paths. Mitigation: rerun `pnpm eval:manifests` and grep under `examples/eval/forms`.
- Risk: Elena manifest paths break during the move. Mitigation: run the Node manifest path check before writing the summary.
- Risk: active docs still point contributors at deleted trees. Mitigation: run scoped `rg` checks over `package.json`, `examples`, and active TODO docs.
- Risk: removing `demo:memory:verify` temporarily removes validator-like coverage. Mitigation: call this out in the README and summary; Batch 2 restores validation as `eval:validate`.
- Rollback: this batch is only file moves, deletes, script edits, generated fixture metadata, and docs. No backend behavior, database migration, or user data change is involved. Reverting the cleanup commit restores the previous tree.
