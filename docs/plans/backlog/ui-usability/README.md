# Local UI Usability Follow-Up

- Status: other items remain backlog; item 7 is implemented in merged [PR #173](https://github.com/loyalagents/context-router/pull/173), with two scoped packaged D UI journeys passed in the pilot
- Outcome owner: product owner and next assigned UI coordinator
- Trigger: pilot triage; fixes for blocked tasks, false success or privacy outrank polish
- Source: [Step 08 user-run acceptance](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/08-local-ui/implementation.md#2026-10-04-user-run-browser-and-native-client-acceptance)
- Last reviewed: 2026-10-12

Keep this a focused cleanup of the existing dashboard and packaged menu:

1. Make rejected-grant feedback prominent and close to the attempted action.
   This is the strongest candidate for a small earlier follow-up.
2. Show configured MCP client labels prominently in history, retaining IDs for
   disambiguation and as a fallback when labels are missing.
3. Show concise before/after preference values in collapsed history rows, with
   full snapshots available on expansion.
4. Put recovery guidance beside the dashboard's AI status. Consider a
   **Restart local runtime** action for the packaged Mac app, requested during
   Step 09 sleep/wake acceptance on 2026-10-10 and explicitly deferred. It must
   require an authenticated browser and confirmation, reuse the native guardian's
   restart lifecycle, and explain interruption of UI/MCP work and fresh unlock.
   Keep menu instructions available when the runtime cannot be reached; do not
   automatically restart or replay interrupted work.
5. Make the model-download menu reflect an already installed model, instead of
   continuing to offer Download. The user explicitly deferred this during Step 09
   acceptance; preserve verified-asset checks and explicit download consent.
6. Distinguish an AI check that can be retried from terminal states requiring
   Restart, and avoid the sleep-related AI label when no model is installed.
   The Step 09 external review identified both conservative presentation cases;
   preserve unavailable states and explicit recovery requirements underneath.

7. Refresh confirmed applied preferences without requiring a manual page reload.
   Reproduce the Step 09 report and preserve partial/uncertain mutation outcomes;
   display refresh must not retry or duplicate writes. This is prioritized for
   pilot triage by the [stabilization brief](../stabilization/README.md).

Preserve truthful confirmed/uncertain mutation outcomes, per-instance authority,
and masking of sensitive or unknown-sensitivity history. Labels are display
metadata, never authority. A fix for false success, hidden failure, private-data
exposure or a blocked supported task should be brought forward.

The numbered migration is closed. The pilot coordinator chooses the smallest
useful slice, priority, ownership and checks; not every item blocks colleague testing.

Waiting/running feedback for overlapping AI requests belongs with the separate
[local AI scheduling follow-up](../local-ai-scheduling/README.md). Coordinate its
dashboard presentation there with the backend/MCP queue contract; this UI cleanup
does not introduce queues, retries or concurrent model execution independently.

Provider/model settings and local-versus-cloud destination/consent UX belong to
the separate [model provider selection follow-up](../model-provider-selection/README.md).
Coordinate presentation there; this cleanup does not activate provider support.

## Activated Slice: Refresh After Document Apply

Current disposition: source fix merged as `f310212`; D passed two response-injected
packaged UI journeys, while the final gate separately renewed real-backend/fake-model
source-browser coverage. See the [scoped pilot results](../../active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12);
those installed journeys do not themselves demonstrate actual import or persistence.
The following implementation checkpoints retain their historical scope. Their
old unmerged/pending wording does not override this current status, and merging
source does not establish installed acceptance.

The 2026-10-11 request activates only item 7: confirmed document CREATE/UPDATE
results must appear without navigation or loss of reviewed proposals. Backend,
model, grants, native lifecycle, dependencies and CI configuration are excluded.

- Base: verified remote main `7d2df8516115661d97287d34647f17e4a2e48701`;
  branch `codex/refresh-applied-preferences`, isolated `ff08/context-router`
  worktree. Integration follows merged PRs #170/#172; this UI slice is independent
  of the pilot interruption work and the separately owned CI work.
- Ownership: delegated sole writer owns source, tests, this record and commits;
  coordinator/reviewers remain read-only. Requested GPT-6 Astra High writer and
  Extra High review were explicitly supplied to the delegation API; the API
  accepted those settings, but execution-internal model/effort are not independently
  observable. Requested coordinator Astra Extra High is unverified.
- Owned paths: `PreferencesClient.tsx`, `SuggestionsList.tsx`,
  `PreferenceItem.tsx`, focused `ai-browser.test.mjs` coverage, this brief and
  the additive query-consumer row in the current contract baseline registry.
  Review follow-up also updates the current application's stale-display status
  and the stabilization entry to distinguish this unmerged fix from installed acceptance.
  Generated GraphQL types may change only as required by the new read query.
  No changes to LocalPage, authenticated helpers, contracts or browser fixture
  are planned. Existing fixture isolation provides fresh state, ephemeral UI/MCP
  ports, browser contexts and deterministic TLS model responses.

Checkpoints and proposed state rules (independent plan review precedes production
implementation):

1. Add a browser regression proving real persistence succeeds for CREATE/UPDATE
   while the visible saved list remains stale. Build only the isolated worktree
   prerequisites with Node 24.21.0/pnpm 10.25.0 and pinned Chromium 1243.
2. Keep active saved preferences in PreferencesContent. After each validated local
   result batch containing APPLIED, perform an authenticated authoritative read
   with complete preference identity/display fields. Keep hosted clear-and-reload
   behavior. Refresh must not modify proposals, selections, edits or outcomes;
   earlier success still triggers a read if a later batch is uncertain.
   Valid UNCERTAIN results and attempted batches whose response is lost also
   trigger a fresh read. A read never confirms the uncertain operation, and a
   missing value cannot prove it will not settle later.
3. Keep read loading/failure separate from mutation outcomes. A failed read retains
   the displayed list and offers read-only retry. Superseding reads abort/invalidate
   older reads. Confirmed manual save/delete/create or inbox acceptance invalidates
   an in-flight read and replaces it with a fresh read, so a stale snapshot cannot
   overwrite newer manual results. Unmount/token cleanup aborts and invalidates;
   existing session remount and transport generation checks retain lock boundaries.
4. PreferenceItem must initialize its edit buffer from the current authoritative
   value when entering Edit: same-ID refreshed UPDATE props otherwise retain its
   old initial buffer. Already-open unsaved drafts must survive a refresh.
5. Cover visible CREATE/UPDATE, identities, partial/mixed outcomes, later lost
   response, preserved proposal edits/selections, failed read/retry, exact mutation
   counts, superseded reads, concurrent manual changes and session/navigation
   cleanup. Run focused affected checks during correction.

Finalization milestone: focused coverage and review corrections resolved, then
freeze the candidate for fresh complete-diff review, all applicable local gates
and exact-head CI. One bounded PR, no merge or installed-app modification. The
pilot's main checkout, builds, personal data and client configuration remain
untouched. Broad gates need prerequisite/purpose reporting and scheduling around
the active pilot. Documentation validation includes Markdown links, whitespace
and affected reader discovery; no direct reader of this brief was found in
repository tests/scripts at activation.

Checkpoint evidence:

- Independent Extra High plan review approved the bounded design. Required
  dispositions implemented: clear the attempted mutation IDs before notifying
  refresh; keep refresh void/caught outside mutation error classification; guard
  read entry and publication after unmount; reseed a newly opened edit from current
  props while retaining an already-open draft.
- Before production edits, the CREATE/UPDATE regression confirmed both persisted
  values, then failed waiting for the updated value in Active Preferences (3-second
  timeout). This reproduced the reported display defect without live model calls.
- Isolated Prisma generation/backend build and web production build passed using
  the pinned toolchain. The web build includes type checking. No API, fixture,
  generated GraphQL or dependency changes were necessary.
- `node --unhandled-rejections=strict --test --test-concurrency=1
  apps/web/test/ai-browser.test.mjs`: 19/19 passed. The partial-batch case was then
  strengthened to retain a selected third, unattempted batch and passed its focused
  rerun. The changed test is rechecked by final qualification; unchanged cases carry
  forward their targeted evidence. CREATE/UPDATE and failed-read/retry each send
  exactly one apply mutation. Earlier success plus a later committed/lost response
  sends exactly two; its UNCERTAIN outcome remains even after an authoritative read.
- New browser coverage also verifies mixed outcomes, preserved proposal edits and
  selections, same preference/definition/location identity, an existing manual
  draft, fresh edit entry, newer reads, manual save/delete/create races and delayed
  response cleanup after lock, expiry and navigation. Existing transport checks
  passed 4/4. Fixture teardown passed with isolated state/process cleanup and no
  external browser requests, page errors or policy violations.
- Markdown checker tests passed 20/20; the repository link check passed across
  145 Markdown files; whitespace checks passed. No direct brief reader was found.

Targeted checks passed; final validation pending. Freeze after these checkpoints;
record fresh complete-diff review, final local gate and exact-head CI in the PR
handoff rather than modifying the frozen source solely to append receipts. No
installed artifact or personal client was changed, and Claude Desktop acceptance
is not repeated for this display-only slice.

Final qualification correction: the first full gate at `fed2a29` stopped at
contract-baseline because `LocalSavedPreferences` was absent from the exact
consumer census. The gate reported caller integrity intact, database removed,
administration clean and no cleanup errors. Independent review approved adding
only this query's path/kind/name/root-fields row to
[`local-migration-contract-baseline.json`](../../../current/local-migration-contract-baseline.json),
as required by the existing interface policy. This is an additive consumer
registration, with no schema/semantic fixture, fingerprint or gate change.
Application source, browser tests and build inputs remain unchanged, so their
targeted evidence and source review carry forward. Contract/registry checks,
documentation checks, the full final gate and exact-head CI must run on the
corrected frozen candidate; the registry delta also receives independent review.
The amended census passed the checker with a verified merge-base bundle
(`baseComparison=performed`, 58 consumers), its 55 existing tests, Markdown links
and whitespace checks. Full final qualification remains pending.

Review correction after `c1a8525`: that candidate passed full local qualification
and exact-head CI, but review found that the earlier read could finish before a
later uncertain batch settled. The strengthened browser regression first delivers
an authoritative snapshot excluding the later value, then commits the second
batch and loses its response; it failed waiting for that saved value without a
manual reload. The correction retains per-batch reads and starts one after valid
UNCERTAIN results or a failed attempted batch, without replaying mutations or
changing outcomes. Browser coverage also checks a single uncertain result,
an unforwarded write with successful/failed read and read-only retry, and positive
saved-value assertions after delayed snapshots settle. Backend/build dependencies
are unchanged; the existing backend output is reused only for targeted iteration.
The revised web build, affected checks and independent review precede a new freeze;
the original finalization milestone and full final gates remain required.
Targeted results: web build/typecheck passed; 24 affected browser/transport cases
passed initially, and the two new single-response-loss cases passed after fixing
only a punctuation mismatch in their warning assertion. Their read/mutation-count
and outcome assertions remain intact. Contract/document checker tests passed
75/75, the consumer census and 145 Markdown links passed, and whitespace is clean.
Targeted checks passed; final validation pending for this review correction.
