# Step 00B: Distill Canonical Information

- Status: ready for human review
- Program step: `00-document-consolidation`, PR 00B
- Target branch: `main`
- Planning base commit: `01e9506708c8692324943ea111b05a8f57da45e0`
- Branch: `codex/local-migration-00b-distillation`
- Branch and planning owner: primary Codex agent (`/root`), sole writer
- Implementation owner: primary Codex agent (`/root`), sole writer
- Change classification: `local-only` documentation
- Depends on: Step 00A PR
  [#153](https://github.com/loyalagents/context-router/pull/153)
- Plan reviewers: `/root/00b_current_docs_analysis` (Approved),
  `/root/00b_eval_docs_analysis` (Approved),
  `/root/00b_active_migration_analysis` (Approved)
- Coordinator approval: `/root`, approved 2026-09-14 after all blocking findings
  were resolved and re-reviewed
- Final implementation reviewers: `/root/00b_current_docs_analysis` (Approved),
  `/root/00b_eval_docs_analysis` (Approved),
  `/root/00b_active_migration_analysis` (Approved)
- Implementation PR: [#154](https://github.com/loyalagents/context-router/pull/154)
- Supported mode after merge: the existing hosted composition remains
  unchanged; all 35 approved 00B distillations and rehomes have canonical
  destinations while their legacy sources remain available for 00C comparison
- Last updated: 2026-09-14

## Outcome

Preserve the durable behavior, experiment guidance, and genuinely unfinished
work identified by the approved 00A inventory in the smallest appropriate
canonical locations. This PR creates every destination required by the 35
non-`DELETE` rows: 27 `DISTILL_AND_DELETE` and 8 `REHOME_ACTIVE`. The inventory's
owner-step field assigns the surviving work after distillation; it is not the
selector for this PR. This PR does not edit or remove any of the 88 legacy
source documents; that comparison and deletion gate remains PR 00C.

## Required Reading

- `AGENTS.md`
- repository `README.md`, `docs/README.md`, and every file in
  `docs/IMPORTANT/`
- `../orchestration.md`, `../decision-log.md`, and this step's `README.md`
- `inventory.md`, especially all 35 rows whose disposition is
  `DISTILL_AND_DELETE` or `REHOME_ACTIVE`
- each source document selected by those rows
- each existing destination document
- current source and tests for any behavior described as current
- runnable eval fixtures, scripts, and package documentation for evaluation
  claims

## Entry Criteria

- PR 00A is merged into `main` at
  `01e9506708c8692324943ea111b05a8f57da45e0`.
- The branch starts at that commit and has one writer.
- The inventory validator reports 88 approved rows and proves that all legacy
  source blobs still match its immutable base.
- Exactly 35 inventory rows require destinations in PR 00B: 27
  `DISTILL_AND_DELETE` and 8 `REHOME_ACTIVE`. Their surviving-work owners are
  00B (19), Step 01 (5), Step 02 (1), Step 06 (8), and Step 07 (2).
- Existing application behavior remains the supported hosted composition.
- Independent agents have inspected the current behavior and are available to
  review this plan and final diff.

## Current Evidence

- The approved inventory assigns the 35 rows to 23 exact section anchors: 12
  current-behavior sources, 8 migration-control inputs, 8 active evaluation
  sources, and 7 package-documentation sources.
- Existing `docs/current/` coverage does not yet consolidate audit/access
  history, reset behavior, document-analysis duplicate consolidation, or the
  current form-fill contract.
- Existing MCP, preference-schema, and workflow docs have the right canonical
  scope but omit specific shipped contracts selected by the inventory.
- `examples/eval/PLAYBOOK.md` and `examples/eval/README.md` are maintained
  package docs, but contain stale statements about document ingestion, form-map
  coverage, and the direct packet runner's storage boundary.
- The sensitive-policy tasks and scorers are runnable, but their approved
  historical `n=5` aggregates currently live only in a legacy results document;
  the raw temporary run roots are not checked in and cannot be recomputed from
  this checkout.
- The migration index, orchestration, and Step 00 README still describe PR 00A
  as awaiting review even though it has merged.

## Scope

- Add four focused current-behavior documents:
  `AUDIT_AND_ACCESS_HISTORY.md`, `DATA_RESET.md`, `DOCUMENT_ANALYSIS.md`, and
  `FORM_FILL.md`.
- Extend `MCP_AUTHORIZATION.md`, `PREFERENCE_SCHEMA.md`, and `WORKFLOWS.md` at
  their approved anchors.
- Add `examples/eval-harbor/PERMISSIONS_EVAL.md` and link it from the Harbor
  package README.
- Extend `examples/eval/README.md` and `examples/eval/PLAYBOOK.md` with the
  approved direct-runner and packet-family contracts, correcting nearby stale
  claims when required for internal consistency.
- Create one bounded active evaluation plan at
  `docs/plans/active/evaluation/README.md` with an owner, outcome, next action,
  and review date.
- Add the eight approved open migration inputs to the existing orchestration
  anchor, grouped by their owning roadmap steps rather than copied as legacy
  TODO lists.
- Correct Step 00 status metadata, including the 00A plan, to say PR 00A merged
  and PR 00B is active.
- Keep source-to-destination traceability in this temporary plan and the
  inventory rather than adding historical source links to lasting docs.

## Non-Goals

- Editing, moving, or deleting any legacy source document; PR 00C owns that.
- Changing application code, tests, dependencies, generated files, CI,
  deployment, environment configuration, or runtime defaults.
- Designing local identity, SQLite, local-model, MCP transport, UI, or
  packaging implementations.
- Migrating hosted users or data, preserving hosted backfill work, or adding
  cloud sync.
- Reproducing historical implementation diaries, temporary machine paths,
  hosted-provider administration, or superseded commands.
- Treating recorded historical eval aggregates as newly reproduced evidence.
- Expanding the active evaluation backlog with unapproved conditional ideas
  that lack an observed failure, owner, or migration decision point. This does
  not retire the inventory-approved evidence-confidence/abstention family or
  the failure-triggered exact-decoy scoring gate.

## Contracts And Compatibility

- Application/use-case, storage, identity/principal, model-provider, GraphQL,
  REST, MCP transport, and MCP tool/resource contracts are preserved. This PR
  only documents the current contracts and assigns future decisions.
- Configuration and filesystem behavior are preserved. New docs must use
  repository-relative links and must not contain machine-specific absolute
  paths or credentials.
- The current hosted runtime remains the only supported runtime after merge.
- The active evaluation plan makes hosted-model comparison explicit opt-in work
  for Step 06; it does not add a remote call to the product or test defaults.
- Canonical docs describe current behavior from code/tests. When a legacy
  summary conflicts with current implementation, current implementation wins
  and the correction is called out in the PR review evidence.

## Design

### Distillation rules

Each destination should answer one durable question, state important boundaries
and failure semantics, and point to current code/package entry points where that
helps maintenance. It should not preserve a chronology, branch-specific file
list, old verification log, or speculative wishlist.

The inventory remains the authoritative source-to-destination map. This plan
adds a compact completeness view; the source counts must total 35:

| Destination section | Sources | Durable responsibility |
| --- | ---: | --- |
| `docs/current/AUDIT_AND_ACCESS_HISTORY.md#mutation-audit-events-and-provenance` | 1 | Atomic mutation audit, normalized snapshots, provenance, and suggestion semantics |
| `docs/current/AUDIT_AND_ACCESS_HISTORY.md#mcp-access-history` | 1 | Request-level MCP history, outcomes, redaction, fail-open behavior, and exclusions |
| `docs/current/AUDIT_AND_ACCESS_HISTORY.md#live-preference-attribution` | 1 | `lastModifiedBy` versus value source and legacy-null behavior |
| `docs/current/AUDIT_AND_ACCESS_HISTORY.md#history-query-contract` | 1 | User scope, conjunctive filters, prefix matching, cursors, and raw snapshots |
| `docs/current/AUDIT_AND_ACCESS_HISTORY.md#dashboard-history` | 1 | Current history UI, masking, pagination, and absence of rollback |
| `docs/current/DATA_RESET.md#reset-modes-and-safety-semantics` | 1 | Reset boundaries, transactions, preserved identity, audit tradeoffs, and feature gate |
| `docs/current/DOCUMENT_ANALYSIS.md#duplicate-candidate-consolidation` | 1 | Duplicate grouping, stable IDs, evidence, fallback, and deferred validation |
| `docs/current/FORM_FILL.md#current-form-fill-contract` | 1 | No-retention PDF flow, model boundary, policies, validation, statuses, and XFA hybrid handling |
| `docs/current/MCP_AUTHORIZATION.md#mutation-tool-result-contract` | 1 | Mutation success/error/no-op envelope and value/evidence shapes |
| `docs/current/MCP_AUTHORIZATION.md#read-tool-result-contract` | 1 | Five read-tool output schemas, structured canonical data, and JSON text compatibility |
| `docs/current/PREFERENCE_SCHEMA.md#profile-memory` | 1 | Profile memory, account/contact distinction, grants/reset, and protected definitions |
| `docs/current/WORKFLOWS.md#surfaces-and-authorization` | 1 | First-party GraphQL/Search Lab and MCP authorization distinction |
| `docs/plans/active/local-migration/orchestration.md#planning-inputs-that-must-not-be-lost` | 8 | Assigned Step 01, 02, and 07 migration decisions |
| `docs/plans/active/evaluation/README.md#scoring-and-comparison-backlog` | 1 | Model metadata, comparable-run, repeatability, and demonstrated attribution work |
| `docs/plans/active/evaluation/README.md#corpus-and-extraction-benchmark` | 1 | Bounded corpus breadth and extraction-quality work |
| `docs/plans/active/evaluation/README.md#packet-benchmark-status-and-next-experiments` | 5 | Current packet status, known gaps, comparisons, and scoped next difficulty work |
| `docs/plans/active/evaluation/README.md#local-versus-hosted-model-and-agent-comparisons` | 1 | Direct/MCP and local/hosted comparison work |
| `examples/eval-harbor/PERMISSIONS_EVAL.md#scope-claims-and-unimplemented-variants` | 1 | Experiment taxonomy, paper-safe claims, and future variants |
| `examples/eval-harbor/PERMISSIONS_EVAL.md#continuous-session-storage-boundary-experiment` | 1 | Continuous-session contract, metrics, and limits |
| `examples/eval-harbor/PERMISSIONS_EVAL.md#fresh-session-readback-experiment` | 1 | Canary/readback contract, failures, supported claim, and cleanup limit |
| `examples/eval-harbor/PERMISSIONS_EVAL.md#validated-results-and-limitations` | 1 | Sanitized recorded aggregates, settings, claims, and evidence limits |
| `examples/eval/README.md#claude-code-direct-packet-baseline` | 1 | Direct extraction isolation, canonical backend-fill mode, metadata, outputs, and safety boundary |
| `examples/eval/PLAYBOOK.md#packet-benchmark-families` | 2 | Immutable family selection, score reading, and combination policy |
| **Total** | **35** | All approved 00B rows |

### Current behavior documents

The audit document separates domain mutation events from request-level MCP
access events and from denormalized live-row attribution. The form-fill document
uses current code/tests rather than the legacy summary: XFA presence does not by
itself reject a PDF when usable AcroForm fields exist; no AcroForm fields return
`no_fillable_fields`; otherwise-valid source-backed low-confidence actions are
applied and emit a diagnostic event.

The MCP document preserves the distinction between JSON-string preference
values and structured evidence on mutation input. It describes
`SUGGESTION_SUPPRESSED` as a successful unchanged result. Its read-result
section makes `structuredContent` canonical while retaining serialized JSON in
`content[0].text` for compatibility.

### Evaluation documentation

The package docs distinguish three separate questions: durable storage, memory-
mediated access after a fresh handoff, and behavioral refusal while forbidden
data remains available. Task-local CR allowlisting is enforcement, whereas
prompt-only conditions are advisory; neither substitutes for backend product
authorization tests.

Historical result tables are labeled recorded aggregates with their date,
model, effort, service tier, web-search setting, and sample count. The docs state
that ephemeral raw artifacts are absent and current static/soundness checks
validate the experiment shape, not those old outputs. Packet status copied from
legacy trackers receives the same directional/historical framing when its raw
artifacts are absent; temporary machine paths are omitted.

Packet guidance keeps small versioned baselines and separate difficulty
families. Direct extraction receives no MCP/backend-memory information. A
canonical backend-fill comparison may materialize extracted synthetic memory
only after extraction, must label that stage, mutates its dedicated eval user,
and is not a no-storage end-to-end run. Restricted Claude Code tools and config
are not an operating-system sandbox.

### Active work and migration inputs

The evaluation plan is owned by the local-migration coordinator until Step 06
activates, then by that step's coordinator. It preserves concise current packet
status, latest lessons, known gaps, pending repeat and combined-family work, and
the focused ownership direct-versus-MCP comparison. It also retains the
evidence-confidence/abstention family as a later experiment and exact-decoy
scoring as a decision triggered only by recurring observed failures, not as
scheduled work. Its next decision is a same-corpus, matched-configuration
direct-versus-MCP comparison using focused required-evidence and realistic
volume/noise packets for the first selected local model. Remote comparisons
remain explicit, synthetic-only opt-in runs.

Migration inputs are grouped under Step 01 product scope, Step 02 composition
and packaging, and Step 07 local MCP. They preserve decision questions and
observable contracts, not hosted vendor chores or presumed technical choices.

## Checkpoints

### Checkpoint 1: Plan and evidence review

- Three read-only agents inspect current-behavior, evaluation-package, and
  active/migration-control source groups against current code/tests.
- Independent reviewers check this plan for inventory completeness, claim
  accuracy, maintainability, and scope.
- `/root` resolves blocking findings and records plan approval before canonical
  destination edits begin.
- Checkpoint result: the plan covers exactly 35 approved rows and all lasting
  claims have a verifiable source or an explicit historical-evidence limit.

### Checkpoint 2: Current behavior destinations

- Add the four missing current docs and extend the three existing current docs.
- Keep prose focused on stable contracts, boundaries, failure behavior, and
  current limitations.
- Compare each section with current implementation/tests and its inventory
  sources.
- Run the documentation validator suites, inventory validation, link baseline
  gate, and `git diff --check`.
- Checkpoint result: all 12 `CURRENT` source rows have exact canonical anchors;
  runtime behavior and all legacy sources are unchanged.

### Checkpoint 3: Evaluation and migration destinations

- Add the sensitive-policy guide, direct-runner section, packet-family section,
  active evaluation plan, and assigned orchestration inputs.
- Correct stale adjacent package claims required to make those sections
  internally accurate.
- Link new package docs from their maintained package indexes.
- Run `pnpm eval:verify`, `pnpm eval-harbor:check`, the documentation validators,
  inventory validation, link baseline gate, and `git diff --check`.
- Checkpoint result: the 7 `PACKAGE_DOCS`, 8 `ACTIVE_PLAN`, and 8
  `MIGRATION_CONTROL` source rows have exact destinations without expanding
  runtime scope.

### Checkpoint 4: Independent implementation review and PR

- Update Step 00 metadata and this plan with validation and review results.
- Complete the explicit 23-row destination-heading checklist above and confirm
  the inventory validator still proves every legacy source blob unchanged.
- Audit changed paths to ensure only approved documentation files changed.
- Independent agents compare final destinations with the approved plan,
  current code/tests, and all 35 source rows. Resolve every blocking finding.
- Commit and push, open a draft PR using the local-migration template, record
  the PR number in a follow-up metadata commit, and mark it ready only after
  required checks and reviews pass. Do not merge automatically.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Documentation tooling | `node --test scripts/check-markdown-links.test.mjs scripts/check-doc-plan-inventory.test.mjs` | Confirm no validator behavior changed | Yes |
| Inventory/source integrity | `node scripts/check-doc-plan-inventory.mjs --expected-base c284ce3f07bc5414edf0ccc1e68d51a8e10a2013 --expected-count 88 docs/plans/active/local-migration/00-document-consolidation/inventory.md` | Complete the explicit 23-anchor checklist for all 35 non-`DELETE` rows; the validator proves all 88 legacy files are unchanged | Yes |
| Repository links | `node scripts/check-markdown-links.mjs --baseline docs/plans/active/local-migration/00-document-consolidation/link-check-baseline.json --expected-base c284ce3f07bc5414edf0ccc1e68d51a8e10a2013` | Strict mode may still report only the 27 approved legacy absolute-link findings until 00C | Yes |
| Eval fixtures and scripts | `pnpm eval:verify` | Review any pre-existing warnings separately from failures | Yes |
| Harbor eval harness | `pnpm eval-harbor:check` | Confirm claim boundaries match runnable task/scorer contracts | Yes |
| Runtime surfaces | Not applicable; no runtime file may change | Audit changed paths | Yes |
| Diff hygiene | `git diff --check` | Check canonical focus and source preservation | Yes |

### Recorded validation

- Documentation validator suites: 37 tests passed, 0 failed.
- Inventory/source integrity: all 88 rows passed; all legacy source blobs are
  unchanged; the 35 non-`DELETE` rows resolve to exactly 23 anchors.
- Link validation: baseline mode passed with 27 known legacy findings and 0
  unexpected findings; strict mode reported exactly those same 27 findings for
  PR 00C to remove.
- Eval package: `pnpm eval:verify` passed 364 tests with 0 failures; fixture
  validation reported 0 errors and 395 pre-existing warnings.
- Harbor package: `pnpm eval-harbor:check` passed 34 tests plus every task
  soundness, job-config, and JSON check.
- Diff hygiene: `git diff --check` passed; all 17 changed paths are Markdown and
  match this plan's reserved scope.
- Independent implementation review: all three named reviewers approved after
  blocking accuracy and status-coherence findings were corrected.

No backend, frontend, database, or build tests are required because the plan
forbids runtime changes. If implementation evidence suggests a runtime fix is
needed, stop and move it to its owning step/PR rather than widening 00B.

## Parallel Work And Conflict Surfaces

- `/root` is the sole writer for this branch and every destination in this plan.
- Analysis and review agents are read-only.
- Until 00B lands, this branch exclusively owns
  `docs/current/AUDIT_AND_ACCESS_HISTORY.md`, `DATA_RESET.md`,
  `DOCUMENT_ANALYSIS.md`, `FORM_FILL.md`, `MCP_AUTHORIZATION.md`,
  `PREFERENCE_SCHEMA.md`, and `WORKFLOWS.md`; `examples/eval/README.md` and
  `PLAYBOOK.md`; `examples/eval-harbor/README.md` and `PERMISSIONS_EVAL.md`;
  `docs/plans/active/evaluation/README.md`; the whole migration
  `orchestration.md`; the migration index; the 00A plan; this Step 00 README;
  and this plan.
- Step 01 may proceed in parallel only if it does not edit those exact files.
- PR 00C must start after 00B lands because it relies on every destination and
  performs source deletion.

## Privacy And Security

This PR does not read user data, change credentials, make model calls, or expose
a listener. Documentation examples use placeholders and synthetic fixtures.
Historical eval summaries omit machine paths. The form-fill doc must not imply
that in-memory handling alone makes uploaded sensitive files safe, and the
sensitive-policy guide must not turn a narrow synthetic evaluation result into
a general product privacy or authorization claim.

## Rollback Or Recovery

Before merge, abandon the branch. After merge, revert the documentation PR
normally. No persisted state, runtime configuration, hosted deployment, or user
data is affected. The legacy sources remain in the tree until 00C, so reviewers
can compare and correct any distillation before deletion.

## Risks And Open Questions

- Historical sensitive-policy raw artifacts are unavailable. Mitigation: label
  the numerical tables as recorded aggregates and separately validate the
  current task/scorer shape.
- Canonical docs can accidentally fossilize implementation details. Mitigation:
  describe boundaries and observable contracts, link current package entry
  points selectively, and omit file inventories and implementation chronology.
- Eval plans can become an unbounded wishlist. Mitigation: retain only work
  needed to validate Step 06 or justified by observed artifacts, with one owner
  and review date.

## Exit Criteria

- Every one of the 35 approved 00B inventory rows resolves to an existing exact
  path and heading.
- All 88 legacy planning blobs remain unchanged.
- Durable claims match current code/tests or are explicitly labeled historical
  recorded evidence with known limits.
- The active evaluation plan names an owner, concrete outcome, next action, and
  review date.
- Migration inputs name their owning roadmap step and do not prescribe
  unapproved implementation choices.
- Required validation and independent implementation review pass.
- The PR states that hosted behavior remains unchanged and that PR 00C still
  owns deletion and strict zero-link closeout.

## Closeout

After merge, PR 00C uses the inventory and these canonical destinations to
remove approved legacy sources, repair any remaining links, switch the link
checker to strict mode, and close Step 00. This plan and the rest of the Step 00
detail directory are deleted in 00C after lasting outcomes are recorded in
orchestration; Git and the merged PR remain the archive.
