# Step 00C: Remove Reviewed Legacy Plans And Close Step 00

- Status: approved for implementation
- Program step: `00-document-consolidation`, PR 00C
- Target branch: `main`
- Planning base commit: `541df54cce514b2ce54842d7b61d05a50139f78f`
- Branch/PR owner and sole writer: primary Codex agent (`/root`)
- Change classification: `local-only` documentation/docs tooling
- Depends on: PR 00A [#153](https://github.com/loyalagents/context-router/pull/153)
  and PR 00B [#154](https://github.com/loyalagents/context-router/pull/154), both merged
- Planning and implementation owner: primary Codex agent (`/root`)
- Plan reviewers: `/root/00c_deletion_audit`,
  `/root/00c_link_active_audit`, and `/root/00c_process_review`
- Implementation reviewers: the same three read-only agents after plan approval;
  replace any unavailable reviewer with a fresh read-only agent
- Implementation PR: pending
- Supported mode after merge: the existing hosted composition remains unchanged;
  Step 01 becomes the sole active primary migration step
- Last updated: 2026-09-14

## Outcome

Remove the 88 legacy planning documents whose independently reviewed
dispositions were approved in PR 00A, after PR 00B preserved every identified
durable fact and unfinished outcome. Replace the temporary inventory/baseline
CI gate with strict repository-wide Markdown-link validation, leave only
genuinely unfinished active plans, record the completed Step 00 outcome, and
activate Step 01 without changing application behavior or its supported hosted
runtime.

## Required Reading

- `AGENTS.md`, root `README.md`, `docs/README.md`, and every file in
  `docs/IMPORTANT/`
- `../orchestration.md`, `../decision-log.md`, and `../step-template.md`
- `README.md`, `plan.md`, `00b-plan.md`, and `inventory.md` in this directory
- `.github/workflows/ci.yml`
- `scripts/check-markdown-links.mjs` and its test
- `scripts/check-doc-plan-inventory.mjs` and its test
- every one of the 23 exact canonical destination anchors named by the 35
  non-`DELETE` inventory rows

## Entry Criteria

- The sole-writer branch `codex/local-migration-00c-removal` was created from
  merged PR 00B commit `541df54cce514b2ce54842d7b61d05a50139f78f`;
  `HEAD`, local `main`, and `origin/main` all resolved to that commit when
  planning began.
- The worktree is clean after the approved planning commit and before the first
  deletion commit.
- The inventory validator proves that all 88 source files still match pinned
  inventory base `c284ce3f07bc5414edf0ccc1e68d51a8e10a2013`.
- All 88 rows are `Approved`, each has an independent reviewer, and the final
  dispositions total 53 `DELETE`, 27 `DISTILL_AND_DELETE`, and 8
  `REHOME_ACTIVE`.
- Every one of the 23 exact destinations for the 35 non-`DELETE` rows exists
  with its named heading before any source is deleted.
- Documentation-validator tests pass. Strict link mode has exactly the 27
  approved absolute-path findings inside two inventoried source files and no
  finding in a retained document.

If any entry criterion changes, stop deletion and return the affected row to
review rather than changing a reviewed source or destination silently.

## Current Evidence

- PR 00A's inventory covers exactly the 88 Markdown paths returned from its
  pinned base tree and records an evidence-backed, independently approved
  disposition for each one.
- PR 00B added the 23 canonical destination anchors without modifying any of
  the 88 legacy sources. It rehomed all eight retained active outcomes into
  `docs/plans/active/evaluation/README.md` and distilled the other 27 durable
  outcomes into current docs, package docs, or migration control.
- `node --test scripts/check-markdown-links.test.mjs
  scripts/check-doc-plan-inventory.test.mjs` passes 37 tests at the planning
  base.
- Strict `node scripts/check-markdown-links.mjs` reports 27 findings: 26 in
  `docs/plans/active/preference-extraction/audit-log/initial-implementation/implementation-summary.md`
  and one in
  `docs/plans/active/preference-extraction/audit-log/read-api/implementation-plan.md`.
  Both files have approved removal dispositions.
- A target-resolving scan of every retained tracked Markdown file finds zero
  links to any of the 88 legacy source files. The only retained links that will
  break when the Step 00 directory itself is deleted are the migration index's
  links to `00-document-consolidation/README.md` and `00b-plan.md`; its current
  step text and the orchestration status/roadmap also require closeout updates.
- The existing documentation CI job still validates the temporary inventory
  and permits only its pinned link baseline. Those Step 00-only controls expire
  in this PR.

## Scope

- Delete exactly the 88 source paths listed in the approved inventory; do not
  edit or move them first.
- Repair retained Markdown links and indexes that refer to a removed legacy
  source or to this Step 00 detail directory.
- Change the documentation CI job to test only the reusable Markdown-link
  validator and run it in strict zero-violation mode.
- Delete the Step 00-only inventory validator and its tests after the final
  source/destination proof. Keep the reusable Markdown-link validator and its
  baseline feature/tests; only this repository's temporary baseline artifact
  expires.
- Create
  `../01-contract-baseline-and-product-scope/README.md` as a concise activation
  charter with status, outcome owner, concrete planning action, review date,
  required inputs, boundaries, and acceptance outcome. Do not pre-decide Step
  01's retain/replace/remove/defer matrix.
- Update `../README.md` and `../orchestration.md` to record PRs 00A/00B/00C,
  the concise qualitative Step 00 result, and Step 01 as ready for planning.
  Remove the stale statement that Step 01 may run while Step 00 distillation and
  deletion continue. Give the
  orchestration program an explicit outcome owner and concrete next action to
  replace the Step 00 owner metadata that will be deleted.
- Make `../tracks/interface-evolution.md` unambiguously dormant until after Step
  01 establishes the contract baseline, and give the track an outcome owner,
  unfinished outcome, concrete next action, and review date. Mark
  `../step-template.md` as a template instead of a draft active plan.
- Confirm every remaining document presented as an active plan names an
  unfinished outcome, current status, owner, concrete next action, and review
  date.
- Delete this entire Step 00 detail directory, including this temporary plan,
  only after the durable closeout and Step 01 links exist. The planning commit
  and merged PR remain the archive.

## Non-Goals

- Changing application code, dependencies, generated files, deployment
  behavior, runtime defaults, public interfaces, or persisted data.
- Auditing or changing the current hosted product contract; Step 01 owns the
  capability and contract baseline.
- Choosing identity, persistence, local-model, MCP, UI, LAN, or packaging
  technology.
- Starting Step 01's detailed `plan.md` or implementing any Step 01 behavior.
- Creating a documentation archive directory or retaining duplicate summaries
  for historical interest.
- Removing baseline support from the general Markdown-link validator; it may be
  useful for future bounded migrations even though CI no longer uses it now.

## Contracts And Compatibility

- Application/use-case, storage, identity/principal, model-provider, GraphQL,
  REST, MCP transport, MCP tool/resource, configuration, and filesystem
  contracts: preserved unchanged.
- Documentation contributor contract: strengthened from a pinned temporary
  exception list to zero repository-local Markdown-link violations.
- Planning startup contract: the migration index links to the activated Step 01
  charter before all Step 00 detail links are removed.
- Supported runtime: unchanged hosted NestJS/PostgreSQL/Auth0/Vertex and Next.js
  composition. This documentation-only PR neither promises nor exposes a local
  runtime.

## Design

The approved inventory is the deletion manifest. Implementation uses the path
column exactly once and compares the final deleted path set mechanically with
the 88-row manifest from the pinned planning base. The 35 preservation rows are
checked against their 23 exact destination headings before deletion. No legacy
source is rewritten, relocated, or replaced by a tombstone.

The inventory checker, its test, and the checked-in link baseline are migration
scaffolding coupled to the expiring Step 00 inventory. Removing that dead
tooling keeps the repository smaller. The general link checker remains tested,
including its reusable baseline behavior, while CI calls it without baseline
arguments so any future violation fails.

The lasting Step 00 record is a short completed-checkpoint entry in
`orchestration.md`, including the three PR links and a qualitative outcome. The
88-row inventory and its counts are scoping evidence preserved in the 00C PR,
not durable program metrics. Step 01 receives only an activation README with
status `ready for planning`, an outcome owner, a concrete next action to create
`plan.md` from the template on its own branch and obtain independent review, a
review date, and the unchanged hosted composition as its supported mode. Its
outcome and scope
require the retain/replace/remove/defer matrix for current capabilities; public
HTTP, GraphQL, and MCP surfaces; local orchestrator; evaluation tooling;
seed/catalog behavior; and every normal-runtime outbound call, plus a named
aggregate migration gate and clean-restart smoke. The activation charter does
not choose implementation technology or answer the product classifications;
the assigned Step 01 planning agent owns those decisions.

After removal, the documents that represent unfinished active work are the
evaluation plan, Step 01 activation charter, and dormant interface-evolution
track, and all three must pass the active-plan metadata gate. The migration
README is a program index, the decision log is a decision record, the step
template is a template, and orchestration is the program control plane rather
than a separately executable active plan; their labels and metadata must make
those roles clear.

## Checkpoints

### Checkpoint 1: Approve the removal manifest

- Add this plan as a planning-only commit before implementation.
- Run the inventory validator at the exact pinned base/count and both
  documentation-validator test suites.
- Mechanically verify the 88 paths, 53/27/8 disposition counts, 35 preservation
  rows, 23 distinct destinations, and every exact destination heading.
- Have the three named read-only agents independently review deletion/tooling,
  retained links/active plans, and process/acceptance coverage.
- Resolve all findings in this plan and mark it approved before deleting a
  source file.
- Commit and push the approved planning-only state, open the draft 00C PR, and
  cite that exact planning commit SHA in the PR body before deleting a source.
  This preserves the reviewed plan even if the final PR is squash-merged.
- Confirm the approved planning commit leaves a clean worktree and retains the
  recorded PR-base fork point.

Checkpoint result: a pushed, independently approved deletion plan and draft PR
with the current hosted mode still untouched.

### Checkpoint 2: Remove reviewed sources and expire temporary tooling

- Delete exactly the 88 inventoried legacy Markdown sources.
- Update `.github/workflows/ci.yml` to remove the inventory-validation command,
  omit the inventory-checker test, and call the Markdown-link checker in strict
  mode.
- Delete `scripts/check-doc-plan-inventory.mjs`, its test, and the temporary
  `link-check-baseline.json` only after Checkpoint 1 evidence is recorded in Git.
- Run the surviving link-validator tests and strict repository link check.
- Compare the deleted legacy path set to the approved inventory and inspect all
  other deletions against this exact allowlist: the five pre-existing Step 00
  artifacts (`00b-plan.md`, `README.md`, `inventory.md`,
  `link-check-baseline.json`, and `plan.md`) plus the two inventory-validator
  files. The final base-to-head diff therefore has exactly 95 deleted paths: 88
  inventoried sources plus those seven scaffolding files. This temporary
  `00c-plan.md` is added and later deleted on the branch, so it does not appear
  as a base-to-head deletion.

Checkpoint result: obsolete sources and single-use tooling are absent, and
strict repository-wide links are green while the supported runtime remains
unchanged.

### Checkpoint 3: Close Step 00 and activate Step 01

- Add the Step 01 activation README before changing either startup index.
- Update the migration index and orchestration status/roadmap, retaining a
  concise Step 00 outcome and PR links.
- Update the interface track and step-template roles, audit remaining
  active-plan metadata, and repair the two known migration-index links plus any
  unexpected retained reference exposed by removal.
- Delete the rest of this Step 00 detail directory, including this plan, after
  the new startup path is valid.
- Run the full documentation gates and `git diff --check`.

Checkpoint result: a new agent can start Step 01 from canonical documents alone,
without any deleted implementation history or broken startup link.

### Checkpoint 4: Independent implementation and PR review

- Have the named read-only reviewers perform a fresh implementation-review pass
  over the complete diff, validate exact deletion and destination evidence from
  Git history, and review the Step 01 handoff.
- Confirm the existing draft PR uses the local-migration template and links the
  exact planning commit, then add its already-known number to the durable Step
  00 record during implementation.
- Re-run local checks after the final metadata update, inspect GitHub Actions,
  resolve findings, and mark the PR ready only when required checks are green.

Checkpoint result: a reviewable 00C PR whose Git history contains the temporary
plan and inventory evidence even though neither remains in the final tree.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Pre-deletion inventory | `node scripts/check-doc-plan-inventory.mjs --expected-base c284ce3f07bc5414edf0ccc1e68d51a8e10a2013 --expected-count 88 docs/plans/active/local-migration/00-document-consolidation/inventory.md` | Review all preservation destinations and independent approvals | Yes, before deletion |
| Pre-deletion tooling | `node --test scripts/check-markdown-links.test.mjs scripts/check-doc-plan-inventory.test.mjs` | Confirm strict findings are confined to the two approved sources | Yes, before deletion |
| Final documentation tooling | `node --test scripts/check-markdown-links.test.mjs` | Confirm CI invokes strict mode without an exception artifact | Yes |
| Repository links | `node scripts/check-markdown-links.mjs` | Inspect every repaired retained reference | Yes |
| Deletion manifest | Run the exact legacy-deletion gate below; then require the full deletion set to equal those 88 paths plus the seven named scaffolding paths | Inspect the seven non-inventory deletions separately | Yes |
| Scope/format | `git diff --check` | Confirm no application, dependency, generated, deployment, or runtime file changed | Yes |
| Runtime suites/builds | Not run: no runtime behavior or dependencies change | Verify the diff classification is documentation/docs tooling only | No |
| Clean install/restart and persisted-state recovery | Not applicable: no runtime or state change | Confirm hosted supported-mode wording remains explicit | No |

The exact legacy-deletion gate is:

```sh
diff -u \
  <(git ls-tree -r --name-only \
    c284ce3f07bc5414edf0ccc1e68d51a8e10a2013 -- docs/plans \
    | rg '\.md$' \
    | rg -v '^docs/plans/active/local-migration/' \
    | LC_ALL=C sort) \
  <(git diff --diff-filter=D --name-only \
    541df54cce514b2ce54842d7b61d05a50139f78f -- docs/plans \
    | rg -v '^docs/plans/active/local-migration/00-document-consolidation/' \
    | LC_ALL=C sort)
```

It must exit zero. Excluding only the Step 00 detail directory from the actual
side means an accidental deletion elsewhere in the migration tree still fails.

## Parallel Work And Conflict Surfaces

`/root` is the only writer on this branch. Review agents are read-only. Reserve
`.github/workflows/ci.yml`, `scripts/check-doc-plan-inventory*`, and
`docs/plans/active/local-migration/**` until 00C merges. Step 01 planning may
begin only in a separately assigned branch/worktree whose owner does not edit
those paths until this PR lands or a coordinator explicitly assigns a landing
order. Unrelated runtime and visual work is safe if it does not change retained
documentation links or the CI workflow.

## Privacy And Security

This PR changes no listener, identity boundary, credential, data location,
model call, or network behavior. Strict link validation prevents repository
documentation from accepting machine-specific absolute paths, `file://`
targets, or escaping links. No user data or hosted service is involved in the
cleanup.

## Rollback Or Recovery

Before merge, revert the affected commit through normal Git history rather than
reconstructing deleted files manually. After merge, a follow-up `git revert` of
the 00C merge commit restores the exact sources, Step 00 scaffolding, and CI
configuration. There is no persisted-state rollback and no runtime recovery
step because the PR changes neither.

## Risks And Open Questions

- A retained document may link to a deleted source using a form the checker
  does not parse. Owner: link reviewer; combine targeted path search with the
  strict checker before closeout.
- The deletion diff is large enough for an accidental extra removal to hide in
  summary output. Owner: implementation reviewer; compare the exact path set
  mechanically and review the small non-inventory deletion allowlist
  separately.
- The PR number is unavailable until the planning-only draft PR exists. Owner:
  `/root`; create it before deletion and use the implementation commit to record
  its number instead of leaving a durable placeholder.

## Exit Criteria

- All 88 approved source paths are deleted and no unapproved legacy source is
  removed.
- All 35 preserved outcomes remain available at their 23 reviewed destination
  headings.
- Strict repository-wide Markdown-link validation and its tests pass without a
  baseline file.
- No shipped, superseded, or ownerless legacy plan remains under
  `docs/plans/active/`; every remaining active plan passes the metadata gate.
- Orchestration records the qualitative Step 00 result and PRs 00A, 00B, and
  00C, while the migration index and roadmap point to Step 01 as ready for
  planning.
- The Step 00 detail directory and single-use inventory tooling are absent from
  the final tree. The pushed planning commit and draft/final PR preserve the
  reviewed plan and inventory evidence even if the merge is squashed.
- No application, dependency, generated, deployment, or runtime file changed.
- Required local checks and GitHub Actions pass, and all independent plan and
  implementation review findings are resolved.

## Closeout

After merge, Step 01's assigned planning agent starts from
`01-contract-baseline-and-product-scope/README.md`, creates a checkpointed
`plan.md` on its own branch, and obtains independent review before changing
runtime behavior. Git PR 00C is the archive for this temporary plan and the
deleted Step 00 evidence.
