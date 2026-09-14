# Step 00: Document Consolidation

- Status: ready for planning
- Outcome owner: unassigned
- Target branch: `main`
- Expected change classification: `local-only` documentation/docs tooling
- Last reviewed: 2026-09-13

## Outcome

Create a trustworthy, compact planning set as the first migration control gate.
After PR 00A approves the inventory, Step 01 may begin while the remaining
distillation/deletion work continues by explicitly owned topic. Durable facts
from old plans move to canonical locations, relevant unfinished work is assigned
to a migration or independent active plan, and shipped, superseded, duplicate,
or obsolete planning documents are deleted.

This step changes documentation and, if needed, dependency-free documentation
validation tooling only. It must not change application behavior, dependencies,
generated code, deployment configuration, or runtime defaults.

## Why This Step Exists

Before this migration control tree was added, the tracked legacy planning set
contained 88 Markdown files, including 46 under `docs/plans/active/`. The active
tree includes implementation plans, implementation summaries, brainstorming
notes, TODOs, and documents explicitly marked shipped, implemented, or
superseded. That conflicts with `docs/README.md`, which reserves
`docs/plans/active/` for unfinished work and uses Git history as the archive.

The counts are evidence for scoping, not durable metrics. The Step 00 planning
agent must regenerate the inventory from the current branch.

A bootstrap repository-wide link scan found two stale source-code targets in
`docs/plans/active/preference-extraction/audit-log/initial-implementation/implementation-summary.md`.
They predate this scaffold and are Step 00 inventory evidence: repair or remove
them according to the reviewed disposition before claiming the final link gate.

## Required Reading

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- every file in `docs/IMPORTANT/`
- `../orchestration.md`
- `../decision-log.md`
- the README or canonical current/useful doc for each topic being classified

Do not assume that an implementation summary is accurate merely because it says
work shipped. Verify a claim against current code, tests, and canonical package
documentation when it is being distilled. A complete technical-behavior audit
belongs to Step 01, not this cleanup step.

## Scope

- Record a full base commit SHA, then inventory the tracked legacy planning set
  directly from that commit by:

  ```sh
  git ls-tree -r --name-only <FULL_BASE_SHA> -- docs/plans \
    | rg '\.md$' \
    | rg -v '^docs/plans/active/local-migration/'
  ```

- Include legacy files outside `docs/plans/active/`; exclude this migration
  control tree so the inventory cannot recursively include itself.
- Assign a reviewed disposition from the vocabulary below.
- Identify durable facts and their canonical destination before deletion.
- Give migration-relevant unfinished work an exact durable file and section
  anchor, not only a future step number.
- Keep unrelated, genuinely active research or product work separate from the
  local migration.
- Repair repository-local links affected by moves or deletions.
- Update documentation indexes or startup guidance only where the final tree
  requires it.

## Non-Goals

- Designing or implementing identity, SQLite, model, MCP, UI, or packaging work.
- Auditing every implemented contract; Step 01 owns that baseline.
- Rewriting all canonical documentation for style.
- Creating a historical archive directory.
- Preserving implementation diaries solely because they may be interesting.
- Deleting an unresolved idea without assigning it a disposition and reviewer.
- Changing application code, dependencies, CI, deployment, or environment files.

## Disposition Vocabulary

Each inventory row has exactly one final disposition:

- `KEEP_ACTIVE`: keep an unfinished plan at its existing path. It qualifies only
  when it is already under `docs/plans/active/` and names a current owner,
  concrete outcome, next action, and review date.
- `REHOME_ACTIVE`: move or merge unfinished work into one exact active-plan path
  that meets the `KEEP_ACTIVE` requirements. The old path does not remain as a
  second copy.
- `DISTILL_AND_DELETE`: verify and place the identified durable fact or open
  migration input at an exact canonical destination, then delete the source.
- `DELETE`: remove a duplicate, superseded, incorrect, or no-longer-useful file
  with no information that needs promotion.

The destination kind is recorded separately as `ACTIVE_PLAN`,
`MIGRATION_CONTROL`, `CURRENT`, `USEFUL`, `PACKAGE_DOCS`, or `NONE`. `COPY` and
`ARCHIVE` are not final dispositions; Git and the merged PR are the archive.

| Final disposition | Allowed destination kind | Path rule |
| --- | --- | --- |
| `KEEP_ACTIVE` | `ACTIVE_PLAN` | Existing source path |
| `REHOME_ACTIVE` | `ACTIVE_PLAN` | Different exact active-plan path |
| `DISTILL_AND_DELETE` | `MIGRATION_CONTROL`, `CURRENT`, `USEFUL`, or `PACKAGE_DOCS` | Exact existing path and section when applicable |
| `DELETE` | `NONE` | Destination remains empty |

For `MIGRATION_CONTROL`, the row must name an existing file and section anchor,
such as the roadmap/input note in `orchestration.md` or an entry in
`decision-log.md`. A future step number alone is not durable because future
step folders do not yet exist. If the detail cannot be represented safely in a
compact control document, keep or rehome the active plan until its step begins.

## Expected PR Shape

### PR 00A: Inventory and approved classification

- Create `plan.md` from `../step-template.md`.
- Record the branch's full base commit and populate `inventory.md` with every
  file returned by the legacy-set command at that commit.
- Review the evidence, disposition, and destination for every row.
- Establish one exact, repository-wide Markdown-link validation command. A
  dependency-free script may be added if the repository has no suitable check.
- Do not delete or move existing planning documents.

### PR 00B: Distill canonical information

- Add or update the smallest canonical current/useful/package documents.
- Incorporate migration-relevant open work into exact migration-control anchors.
- Keep source plans temporarily so reviewers can compare them with the result.

This may be split by topic when smaller PRs are materially easier to verify.

### PR 00C: Remove and validate

- Delete approved obsolete source plans.
- Repair links and indexes.
- Confirm every remaining active plan has an unfinished outcome, current status,
  owner, concrete next action, and review date.
- Record the Step 00 outcome and merged PRs in `../orchestration.md`.
- Ensure Step 01 is activated in the migration index/orchestration and its README
  exists before removing the Step 00 README, so startup links remain valid. The
  assigned Step 01 branch owner is its sole writer. If Step 01 began after 00A,
  00C verifies that owned file but does not edit it without coordination.
- Delete this detailed step directory, including `plan.md`, `inventory.md`, and
  this README, once its lasting results are recorded. Git remains the archive.

The migration index, orchestration, decision log, step template, and interface
track remain only while the migration program is active. Program closeout must
distill any lasting behavior and remove the remaining active planning tree.

## Validation

- No application or dependency file changed.
- Every path returned by the recorded legacy-set command at the recorded base
  commit has exactly one reviewed inventory row.
- Every distillation identifies its source and canonical destination during PR
  review.
- No shipped or superseded document remains presented as active work.
- No new in-repo archive directory was created.
- The exact link-check command chosen in PR 00A scans every tracked Markdown file
  in the repository, not only `docs/plans/`, and reports no broken local target.
  It rejects `file://` and machine-specific absolute link targets instead of
  treating a path as valid merely because it exists on the reviewer's machine.
- `git diff --check` passes.
- An independent reviewer verifies every `DELETE` and `DISTILL_AND_DELETE` row.
- A new agent can understand the remaining active work without reading deleted
  implementation histories.

## Step Start

The next planning agent should copy `../step-template.md` to `plan.md`, regenerate
the document counts from a recorded full base SHA, populate `inventory.md`, and
propose the PR 00A review plan. No existing planning document should be deleted
during that planning turn.
