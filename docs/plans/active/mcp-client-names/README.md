# MCP Client Names

- Status: integrating requested main/demo work; renewed final qualification pending
- Priority: bounded UI usability slice supporting the assisted pilot
- Base: `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c`; branch `codex/mcp-client-names`
- Workspace: isolated `1487/context-router`; one cohesive PR, no automatic merge
- Parent item: [UI usability item 2](../../backlog/ui-usability/README.md)

## Outcome And Ownership

Reuse the existing `local_mcp_clients.label` as the current human-readable name
throughout local client management, authority/permissions, preference attribution,
audit history and MCP access history. Add browser Rename, installed/source CLI
rename commands and View activity for the exact instance. Names may repeat;
identity and authority remain tied to the full stable ID. Renaming changes the name displayed
on old history without rewriting events, snapshots or actor keys.

Exclude last-activity aggregation, live badges, reported clientInfo/version,
bridge changes, automatic detection, onboarding, issuance/rotation redesign,
schema migrations and new dependencies. The approved HTML prototype is visual
guidance, not an implementation or a new dashboard architecture.

Sensitive/quality-first profile applies to the small credential-administration,
transaction and browser-session boundary; presentation receives compatibility
and accessibility review. Follow [agent workflow](../../../useful/AGENT_WORKFLOW.md),
[interface evolution](../../../useful/INTERFACE_EVOLUTION.md),
[current application](../../../current/LOCAL_APPLICATION.md),
[history](../../../current/AUDIT_AND_ACCESS_HISTORY.md), and the
[UI](../../../useful/LOCAL_UI.md), [MCP](../../../useful/MCP_LOCAL_SETUP.md) and
[installed](../../../useful/INSTALLED_MAC_APP.md) runbooks.

| Role | Owner | Requested setting | Verified setting |
| --- | --- | --- | --- |
| Read-only coordinator | `/root` | inherited | runtime model/effort unverified |
| Sole plan writer | `/root/client_names_plan` | GPT-6 Astra Extra High | delegation accepted; execution internals unverified |
| Read-only plan security reviewer | `/root/plan_security` | GPT-6 Astra Extra High | delegation accepted; execution internals unverified |
| Read-only plan compatibility reviewer | `/root/plan_compatibility` | GPT-6 Astra High | delegation accepted; execution internals unverified |
| Initial implementation writer/integrator (idle after transfer) | `/root/client_names_writer` | GPT-6 Astra Extra High | delegation accepted; execution internals unverified |
| Sole correction/main-integration writer | `/root/claude_review_fixes` | GPT-6 Astra Extra High | delegation accepted; execution internals unverified |
| Read-only complete-diff security reviewer | `/root/code_security_review` | GPT-6 Astra Extra High | delegation accepted; execution internals unverified |
| Read-only complete-diff UI/compatibility reviewer | `/root/code_ui_review` | GPT-6 Astra High | delegation accepted; execution internals unverified |

Plan security and compatibility reviewers approved SHA-256
`b1381bfb2bde7e9eb7b9e76b32530cc8d21a04d9ae832bb66c8113e189b90365`
with no blocking findings. The coordinator transferred writing ownership on
2026-10-13. A nonblocking factual correction records that SuggestionInbox is a
separate component: this slice does not add attribution UI there. The approved
contracts and review dimensions are unchanged.

Only the named writer edits this branch, including docs, fixtures, staging and
commits. Ownership transfers explicitly after the planning reviews. Coordinator
and reviewers stay read-only. No parallel writers, shared build outputs or test
databases. Keep the user's main checkout, running application, managed envelope,
personal data, model assets and client configuration untouched. No commits/push
in the planning checkpoint.

## Smallest Design And Contracts

### Rename Is Metadata

Add `rename(id, label, expected?)` to the concrete SQLite administration store.
Only `label` and `updated_at` may change. Preserve ID, principal, token digest,
credential generation, revoked flag, maximum policy, grants, identity and active
MCP sessions. No new audit event is needed for this display-only metadata change;
existing audit/access/attribution rows remain byte-for-byte unchanged.

For a new name, require a string of at most 64 UTF-16 code units, no C0/DEL control
characters and a nonempty trimmed result; save its trimmed form. Validate the raw
length before trimming. Keep provision's existing accepted-input behavior and
legacy labels readable. Render names as escaped text, with wrapping; never as
HTML, authority, route identifiers or grant keys. Empty legacy labels fall back
to the full stored key/ID.

Browser rename supplies exact `{id, label, expectedLabel, generation}`. Validate
the expected label against the bounded existing-label domain, without trimming
it. In the existing `BEGIN IMMEDIATE` transaction, compare both expected label
and credential generation before updating. A stale mismatch is a conflict, with
no write. Same-name submission is a successful no-op after the expected-state
check. An A-to-B-to-A name cycle may pass expected-label comparison: that is
acceptable because only current display metadata is being replaced. No new
revision column or generic idempotency framework is justified.

Permit renaming a revoked instance so retained history can still be identified;
it stays revoked. Rotation/revocation races fail a stale generation comparison.
Policy/grant changes can coexist because rename never writes those columns.
Keep the current authority revision `digest({client, grants})`: it includes label,
so a rename conservatively invalidates an open grant editor. Do not remove label
from the revision contract or increment generation. A fresh authority read is
required before the next grant edit; effective permissions remain identical.

The additive browser endpoint is `POST /api/local/mcp/rename`, under the existing
exact local route, Host/Origin, browser header, session, JSON and body-size checks.
Return a small confirmed current-client identity/name response, not secrets.
Reject extra/missing/wrongly typed fields and unknown IDs; classify stale state
as 409. A failed/lost HTTP response is unconfirmed, never automatic retry. Read
the current name to reconcile; a read establishes present state, not whether the
particular unacknowledged submission committed. A transaction exception before
commit rolls back; an interrupted reply after commit leaves the new name durable.

Source CLI adds `local-mcp rename --id CLIENT_ID --label 'Name'`. It reads the
current expected label/generation then calls the same transactional method;
overlapping changes fail instead of retrying. Preserve generic failure output,
summary-only stdout and IDs beginning with hyphens. Installed CLI adds `mcp rename`
through both native and runtime allowlists/help. It retains Quit/exclusive-owner
requirements and managed admission, including explicit pending-store selection.
The installed wrapper retains its broader Unicode control/format argument
restriction, including rejection of joiner emoji; browser/source rename only
rejects C0/DEL. Command support does not imply identical Unicode acceptance.

### Resolve Only Visible Names

Add `POST /api/local/mcp/labels` with exact `{ids}`: 1–100 distinct valid 22-character
base64url IDs, bounded JSON input, and a bounded response of `{items: [{id,label}]}`.
Use a dedicated principal-scoped, parameterized SQL projection with SQL-level
type/byte bounds before materialization. Include revoked rows. Missing rows are
omitted; malformed/unusable label rows fall back to the caller's stable ID rather
than requiring an authority snapshot. Return no token/digest, generation, grants,
maximum policy, timestamps or history payload. This lookup must work even when
grants exceed the authority-inspection bound. It must not call list/inspect or
crawl the complete client registry.

Use one local presentation helper/component for label + an 8-character stable ID
suffix, with the complete stable key available in accessible text/details. Short
IDs are a visual aid, never a key or uniqueness claim; full-ID inspection must
remain usable for same-label/same-prefix clients. With missing, blank, malformed
or unavailable names, display the full original ID/key. Preserve hosted client
labels and non-MCP attribution behavior; only exact `local:<valid ID>` actors
participate in this lookup. Do not add GraphQL label fields or change existing
history/attribution query shapes.

A small local-only shared hook/map batches IDs from loaded rows and active filter
chips. Request at most 100 per batch, fetching only additional IDs as pages load;
never one request per row. Its cache belongs to the mounted authenticated view,
not persistent storage or a module-global cross-session cache. Clear/abort it on
lock, expiry, logout and unmount; discard late reads by generation. Invalidate
on management BroadcastChannel messages, focus/pageshow and confirmed rename,
so another window/CLI rename is seen on refresh. Refresh names without replacing
event payloads, changing filters, revealing masked snapshots or replaying writes.
Failed name reads retain usable history with full-ID fallback and read-only retry.

Use this presentation for client rows, selected authority, action context,
history rows/filter chips and existing visible live preference attribution in
PreferenceItem. Do not nest a new interactive control inside
the existing expandable history row button. The outcome panel keeps the captured
attempted ID/name/new name so a later refresh cannot misattribute a mutation.

### Rename And View Activity UX

Provide an inline Rename form with explicit Save/Cancel, associated label,
64-character limit, error/status announcement and keyboard focus. Save disables
duplicate submissions. Cancel only discards an unsubmitted draft. Capture the
selected instance when opening; never retarget a draft after paging/selection.
Passive invalidation must not cancel a submitted operation or erase its outcome.
Preserve a draft on a failed submission; require a fresh read before resubmitting
stale/uncertain state. On lock/expiry/navigation, abort and discard all private
view/draft state; late responses cannot repopulate it. Apply current client names
after confirmed save and broadcast invalidation. Keep existing grant/revoke
outcome visibility, focus protection and authority-unavailable behavior intact.

View activity links to `/dashboard/history#mcp-client=<full ID>`. Strictly parse
that one fragment format and derive `local:<ID>`; reject malformed/duplicate or
unexpected fragments. Do not widen the HTTP page-query allowlist (currently only
the Next `_rsc` query is accepted). Show MCP Access initially and initialize both
history streams' exact-client filters, preserving the instance when switching
tabs or when HistoryTabs remounts children after focus/clear. The visible filter
chip shows name + ID while requests always use the exact full actor/client key.
Reset/removing or manually changing the client filter updates/clears the fragment
and shared selection so a later remount cannot silently restore it. Back/forward
and navigation between client links must update the selected filter, reset the
cursor and cancel stale history reads. Empty activity still identifies the client.

## Owned Files And Compatibility Work

| Surface | Expected production paths | Focused evidence |
| --- | --- | --- |
| SQLite metadata and projection | `apps/backend/src/infrastructure/storage/sqlite/sqlite-mcp-credentials.ts`; small shared types in `apps/backend/src/mcp/local/local-mcp-credentials.ts` if needed | `test/local-mcp/credentials.test.mjs`, real SQLite concurrency fixture; `test/local-ui/management.test.mjs` |
| Browser administration boundary | `apps/backend/src/local-ui/local-ui-management.ts`, `local-ui-http.ts`; `apps/web/lib/local-transport.ts` | backend `test/local-ui/http.test.mjs`, web `test/transport.test.mjs` |
| CLI/native parity | `apps/backend/src/local-mcp.ts`; `apps/desktop/native/maintenance.m`, `guardian.m`; `apps/desktop/runtime/maintenance.mjs` | backend `test/local-mcp/admin.test.mjs`; desktop `test/native/maintenance.test.mjs` and actual wrapper/runtime forwarding coverage |
| Shared labels and editor | new bounded helper/hook/presentation under `apps/web/components/local/` or `apps/web/lib/`; `McpClients.tsx`, `LocalPage.tsx`; `app/dashboard/preferences/components/PreferenceItem.tsx` and its data-owning consumers as required | `apps/web/test/browser.test.mjs`, focused helper tests if behavior warrants |
| History/filter routing | `apps/web/app/dashboard/history/HistoryTabs.tsx`, `McpAccessHistoryTab.tsx`; `app/dashboard/preferences/components/AuditHistoryTab.tsx` | real-backend browser journeys; exact GraphQL filter assertions |
| Operator/contract guidance | UI/MCP/installed runbooks, current application/history docs; this plan and portfolio routing | Markdown checker and discovered doc readers; contract checker |

Local permissions already renders McpClients through LocalPage. The hosted
`PermissionsClient.tsx` uses product buckets and should not acquire local lookup
behavior. Backend history storage/resolvers, MCP transport/bridge, GraphQL schema,
generated types, database schema and dependency files should remain unchanged.

Add the two HTTP endpoints and bounds/auth/envelopes to
`apps/backend/test/contracts/fixtures/http-contracts.v1.json`. They are additive;
existing route contracts, browser boundary, MCP descriptors and semantic fixtures
stay unchanged. Update `docs/current/local-migration-contract-baseline.json` only
for the exact new public-reference/outbound/consumer census rows and any affected
curated fingerprints identified by the checker. No blanket fixture refresh,
baseline weakening or migration-record invention. Review the explicit semantic
addition; `--update-derived-fixtures` is not approval. The plan/runbook route
references themselves are census inputs. Run the checker against a verified base;
do not assume a GraphQL operation is exempt if implementation later adds one.

## Tests-First Checkpoints

1. **Characterize and implement metadata/store/CLI.** Before production edits,
   add failing backend tests for durable rename, trimming/bounds/control input,
   same-name no-op, revoked rename, same-label isolation, exact-label/generation
   conflict and unknown/wrong-principal IDs. Assert unchanged digest/generation,
   policy/grants/identity/history and an already initialized MCP session still
   authenticates/calls with its existing token after rename. Prove rollback on
   injected precommit failure, persistence after reopen, and serialized competing
   rename/rotate/revoke/policy/grant writes using isolated SQLite connections or
   child processes. Test narrow label projection, unknown/revoked IDs, 100-ID
   bounds, corrupt/oversized labels and oversized grants. Add CLI tests before
   plumbing it; no token export or new files for rename. Run affected tests after
   each small production change; report results before proceeding.
2. **Browser edge and installed forwarding.** Add HTTP/transport regressions
   before implementing routes: authentication separation (MCP/human tokens fail),
   missing/expired sessions, exact Host/Origin/header/method/content-type, unknown
   routes and invalid bodies, bounds, 409 and secret-free responses. Prove both
   native and JS wrapper forwarding, help text, invalid command rejection and
   running-app exclusion using synthetic managed fixtures. Do not weaken owner
   locks or introduce personal installed-app testing.
3. **Presentation and interaction.** Add browser regressions, then integrate the
   helper/editor/filter. Cover two same-label instances; name + full-ID access on
   all surfaces; old events adopting a renamed label with raw payload/key intact;
   unknown/revoked/fallback and hostile-looking names; empty history; pagination
   and bounded lookup counts; exact View activity filters on both tabs; invalid
   fragment, reset/remove/manual edit, back/forward and focus remount. Cover
   save/cancel/validation, conflict, passive invalidation during save, committed
   lost response with exactly one write, read failure/retry, superseded reads,
   cross-window/CLI refresh, and late replies after lock/expiry/navigation. Keep
   sensitive/UNKNOWN masking, clear-history invalidation, grant/revoke focus and
   preference edit/proposal behavior. Browser fixture remains synthetic with no
   live model/provider. Run affected existing browser cases, not only new ones.
4. **Reconcile and freeze.** Update durable operator guidance and exact contract
   registrations, resolve both review areas, then freeze the complete candidate
   for two independent complete-diff reviews and final validation below. Record
   finding dispositions and targeted evidence here until freeze; final receipts
   can live in the handoff/PR without changing frozen inputs merely to add prose.

### Implementation Checkpoint Record

The approved scope is implemented in the isolated worktree. No schema, GraphQL
operation shape, dependency version or generated output changed. New browser
journeys live in `apps/web/test/client-names.test.mjs`; the existing wildcard
`test:local-ui` script includes them in the full gate. Installed smoke now covers
actual native `mcp rename`, restart with the existing token, and current labels on
old access/audit/live-attribution records. That artifact-bound proof remains a
final qualification item until executed on the reviewed source.

- Before production changes, new store/projection/CLI regressions failed for
  missing rename/lookup behavior; the new HTTP route failed with 404, native and
  JS forwarding rejected rename, and the first browser journey could not find
  Rename. Subsequent focused checks passed after each implementation checkpoint.
- The affected backend run passed 74 of 75 tests, including real initialized SDK
  session continuity, durable metadata, unchanged authority, process races,
  crash/rollback and bounded corrupted-column reads. The remaining raw HTTP
  request hit a client EPIPE when the server rejected its declared oversized
  body early. Its fixture now streams the actual oversized payload like the
  existing boundary tests, retaining the strict 413 assertion; the route test
  passes. Backend production inputs were unchanged by this fixture correction.
- All 29 pre-existing browser cases passed, including masking/history clear,
  grant/revoke outcome and focus behavior. The same run passed the first 11 new
  name journeys and transport/parser checks. A newly added delayed Read current
  name regression reproduced the coordinator's draft-overwrite finding before
  correction. Its functional state update preserves later typing for the same
  captured instance. All 19 name-browser/parser/transport checks passed on rebuilt
  output, including actual cross-window broadcast refresh; the subsequently
  extended keyboard/mobile history journey also passed independently.
- Native maintenance forwarding/help/exclusion passed 7 tests, and the runtime
  maintenance forwarding regression passed. Node 24.21.0/pnpm 10.25.0 and frozen
  workspace dependencies are verified. Backend and web production builds pass.
- Markdown/contract checker unit tests passed 75 tests, repository Markdown links
  passed, and the direct contract checker passed with base comparison explicitly
  skipped. Only the two additive HTTP envelopes and six exact reference rows
  were added; final merge-base compatibility remains part of the full gate.
- Coordinator review corrections: screenshot export is optional and uses a
  caller-selected directory plus process-specific filename, keeping normal
  tests portable; full IDs are visible in management, active filters, preference
  attribution and expanded history details. Keyboard/mobile history inspection
  and cross-window rename invalidation have dedicated browser assertions.

Both complete-diff reviewers approved candidate
`5b4c1b5f051ca64c480f55c00bc1d0d631257a77`. The security reviewer reported no
findings; the UI/compatibility reviewer reported no blockers and two P3 findings
accepted by the coordinator: Cancel rename lost keyboard focus, and the provider
retained IDs after their last visible row/filter consumer disappeared. Browser
regressions reproduced both findings before the correction. Cancel now restores
focus to the captured instance's Rename button after form unmount; reference
counted registration removes inactive IDs from future invalidation reads while
retaining page-local cached results and bounded batching. Forward history
navigation has an explicit assertion alongside the existing back-navigation one.

Only the two web components, their browser regressions and this record change in
the correction batch. The original backend/authentication, persistence, native,
CLI, schema, contract and other unaffected review/test evidence carries forward.
The rebuilt UI passed all 49 existing/new browser, parser and transport checks,
including both corrected regressions, loaded-page batching, focus/broadcast
eviction, lock/expiry cleanup and backward/forward history navigation. Markdown
links, direct contract census and whitespace checks also pass. Both affected
reviewer rechecks subsequently approved `a29cd31650234d14b929b488f2d210541358c2d7`
without findings, carrying forward their original complete-diff coverage.
No user app, personal state, client configuration, live model or provider was used.

### Main Integration

The user requested integration of main at
`b5bc3aeb453bc020f0d7ed11e989402b643aa488` (PRs #179 and #180). Local main was
already fast-forwarded to that revision by another agent; the feature merge has
no file conflicts. Incoming changes affect CI qualification orchestration,
workflow/documentation and browser test harnesses, with no feature production,
native, backend test, schema or dependency changes. The same writer owns this
merge and narrow plan reconciliation; both existing reviewers assess integration
and carry forward their unaffected feature review coverage.

The prior full local gate, native suite and isolated package/installed receipts
remain bound to `a29cd31`; receipt paths and preserved failure/retry outcomes live
in the existing PR evidence. Carry forward the native 200-test and focused backend
results by unchanged implementation/test/dependency input identity. Renew the full
twelve-phase local gate on the frozen merged source. Packaging imports the changed
gate workspace helper and binds all copied source inputs, so build/seal/verify a
new isolated Mac artifact instead of relabelling the old artifact. Renew installed
smoke with the updated mock-Keychain browser harness, sequentially after the full
local gate to avoid the resource overlap observed during prior qualification.

### External Review Follow-up

The user requested an Extra High follow-up to Claude's review of `b412ef9`.
The coordinator transferred sole writing ownership to `/root/claude_review_fixes`;
the original writer is idle and the coordinator/reviewers remain read-only.
Both independent reviewers agreed the bounded correction scope before production
edits. The existing finalization milestone and one draft PR remain in force.

- Fix duplicate browser history entries on unchanged-client Apply/Reset in both
  history tabs. Compare the complete intended pathname/search/hash before pushing;
  preserve the permitted `_rsc` query and Next history handling. Clearing an actual
  client fragment creates one entry; repeated Reset creates none. Malformed
  fragments clear once, while manual non-local exact keys remain in view state.
- Preserve the native argument guard. Document Unicode control/format restrictions
  and the browser alternative, and characterize actual native rejection before
  maintenance plus ordinary non-ASCII forwarding. No backend, provision or native
  production input rules change.
- Isolate shared display names and stable suffix/full/fallback IDs for bidi text.
  Keep raw labels, stored IDs and accessible identity unchanged; add no controls
  inside expandable row buttons.
- Defer retaining stale names during cache refresh: clearing avoids stale-name
  display and a different policy needs separate cache/race review. Defer the
  conservative non-409 unconfirmed-write message: unclassified server exceptions
  can map to 400, so that status alone does not prove precommit rejection.
  The coordinator owns either future activation; neither is part of this slice.

All six new browser regressions failed against the original production build for
duplicate history, dropped search or reversed stable suffix order. The rebuilt UI
passes all 55 affected browser/parser/transport cases, including existing actual
client Back/Forward, masking, grant/revoke, cache and session cleanup journeys.
All eight native maintenance cases pass, including the new unchanged-boundary
characterization. Markdown/contract checker tests pass 75 cases, all 148 Markdown
files pass links, and the direct contract census and whitespace checks pass.
Targeted checks passed; final validation pending. External logs retain the earlier
selector corrections and sandbox startup failures as well as the confirmed red/
green results; no failure was counted as a production regression without evidence.

Only web presentation/navigation, focused browser/native tests and these runbooks/
plan change. Backend, schema, credentials, native production, runtime and dependency
inputs remain unchanged; prior unaffected review coverage can carry forward after
explicit reviewer assessment. Changed web/source inputs require renewed full gate,
Mac artifact/installed smoke and exact-head CI after freeze. Run installed smoke
sequentially after the full local gate, preserving the existing 360-second deadline.

### Demo Main Integration

After the external-review candidate `c21d84c` passed its full gate, isolated Mac
package/installed smoke, both reviews and exact-head CI, the user requested a
fetch and merge of main into the same PR. The frozen incoming revision is
`3bc606ffb9d90ab364d26f6bea5977be30f31b13` (standalone demo PR #182 and persistent
native demo PR #183), with common base `b5bc3aeb453bc020f0d7ed11e989402b643aa488`.
The existing writer/settings above remain in force; both independent reviewers
approved the integration plan and the coordinator remains read-only.

The merge retains both features in four textual conflicts: HTTP test groups,
guardian help, native maintenance test groups and the shared LocalPage provider
plus optional demo guide. The native and JS maintenance allowlists retain rename;
offline administration defaults to personal, with explicit `--mode demo` for the
demo store. The provider stays keyed to page/browser session, while incoming
session teardown disposes authenticated children on runtime/session changes.
The exact contract registration union keeps both additive name routes and all
incoming demo references, outbound inventory and scanner changes. No rename
backend/store behavior, schema or credential contract is adapted by this merge.

Focused integration coverage exercises native default/explicit store targeting
and seeded-demo rename through the real browser/MCP/history paths. Only runtime
presentation metadata is injected in that source browser fixture; actual native
switching remains a separate artifact proof. The existing full demo artifact
cycle additionally checks native rename, wrong-domain rejection, preserved token,
receipt and authority, reopen and helper status in owned synthetic state.

Carry forward only unchanged rename transaction/authentication invariants and
explicitly unaffected prior review coverage. Incoming admitted metadata, epoch,
native/runtime, package, session and CI changes require fresh native validation,
the full local gate and a newly sealed Mac artifact. After the gate completes,
run the existing installed smoke and full demo cycle sequentially on that artifact;
preserve all deadlines. Review the integrated diff and require both exact-head CI
lanes and standard CI. No live provider/client login, personal configuration,
real model retention or replacement rehearsal is activated by this integration.
Keep final source/artifact receipts in the PR/external evidence without pass-only
source commits.

Focused checks passed: merged HTTP suite 28/28; rebuilt native/runtime maintenance
10/10; browser/parser/transport 29/29 across the unchanged 28 passing cases and
the corrected demo test; checker tests 75/75; 151 Markdown links, exact contract
union and whitespace. The new browser test initially selected the wrong Audit
field, then omitted its existing More filters interaction; both test-only failures
are retained. The first native attempt used the previous binary with incoming
fixtures and failed before readiness; rebuilding the matching native source
resolved it. No production guards or assertions were weakened. Targeted checks
passed; final validation pending.

## Validation And Finalization

Planning edits require Markdown links, whitespace and reader discovery only.
At activation, searches across tests/scripts found no direct reader of this plan,
portfolio or UI-usability brief. The general Markdown checker reads them; public
route census may read this plan. Do not build the app for plan review.

Iteration commands, from the appropriate package directory or using `pnpm --filter`:

```sh
pnpm check:toolchain
pnpm --filter backend prisma:generate
pnpm --filter backend build
pnpm --filter backend exec node --unhandled-rejections=strict --test --test-concurrency=1 test/local-mcp/credentials.test.mjs test/local-mcp/admin.test.mjs test/local-ui/management.test.mjs test/local-ui/http.test.mjs
pnpm --filter web build
pnpm --filter web exec node --unhandled-rejections=strict --test --test-concurrency=1 test/browser.test.mjs test/transport.test.mjs
pnpm --filter desktop exec node --test --test-concurrency=1 test/native/maintenance.test.mjs
node --test scripts/check-markdown-links.test.mjs scripts/local-migration/check-contract-baseline.test.mjs
node scripts/check-markdown-links.mjs
node scripts/local-migration/check-contract-baseline.mjs
git diff --check
```

Use name filters while iterating; rebuild affected output before tests importing
`dist` or `.next`. Include HTTP session continuity tests and any additional native
forwarding file introduced above in the affected commands. Record which checks
ran, code/test inputs and failures; tests-first evidence must show the regression
before the implementation. The direct contract checker is useful but its default
`baseComparison=skipped` does not replace the final merge-base comparison.

Finalization milestone: reviewed implementation and targeted corrections are
resolved, then freeze one source candidate. No installed replacement or exploratory
live-client round is part of this request. Once related source/docs and focused
checks are ready, push the stable candidate to the existing draft PR promptly;
run remote CI, independent integration review and required local qualification
concurrently with isolated resources under the updated agent workflow. Keep final
receipts in the PR/evidence record without pass-only source commits. Final acceptance
requires:

- Two independent fresh reviews of the entire base-to-candidate diff, covering
  security/persistence/recovery and UI/compatibility/maintainability. Any changes
  after freeze renew affected tests/reviews and all required final gate evidence;
  explicitly carry forward only unaffected coverage.
- Full `MIGRATION_GATE_BASE_SHA=<verified merge base> pnpm migration:gate` on the
  final source, all twelve existing phases/modes intact. It includes backend
  unit/build/integration/e2e/local suites, desktop non-native tests, web browser
  tests, source and sealed packaged-composition restart proofs, docs/contracts,
  eval/Harbor and generated/caller integrity. This is not installed-native proof.
- Native macOS validation (`pnpm --filter desktop test:native`) and an isolated
  packaged-artifact smoke covering actual `mcp rename`, persistence and browser
  presentation from the same source. Use owned synthetic state and the existing
  packaging/installed-smoke harness; no replacement of the user's app. An artifact
  change requires normal seal/manifest verification. General distribution, live
  model quality and new third-party-client qualification are not claimed.
- Required standard and dedicated exact-head CI before merge readiness, following
  the existing triggers. Dedicated CI runs independent `source-qualification` and
  `packaging-qualification` lanes; the stable `local-migration-baseline` combined
  check requires both successful lanes and their current-run/current-attempt
  receipts. A required rerun must rerun all jobs to preserve that binding. Record
  actual local source separately from PR head and CI test-merge checkout identities.
  This CI partition does not replace the default full local gate. Human merge only.
  If publishing/PR work is not yet
  authorized or a prerequisite is unavailable, report the exact pending gate.

Before broad runs, explain changed inputs/purpose and check Node **24.21.0**, pnpm
**10.25.0**, installed locked workspace dependencies and Corepack cache, Python
**3.12**, Playwright **1.63.0** with Chromium **1243**, Git/OpenSSL/lsof, and isolated
loopback PostgreSQL administration (or the supported owned Docker fallback).
The aggregate gate creates/disposes its own workspace and database; never target
personal state. The Mac artifact/native proofs additionally need Apple compiler
tools and the approved cached Node/model-runtime archives and model license.
No weights/live inference/download is needed for this feature. At planning time,
the coordinator verified pinned Node/pnpm and cached Chromium; this worktree has
no node_modules. Remaining prerequisites are preflight work, not assumed passes.

Bind evidence to Git HEAD, dirty status/copied-input identity, commands/toolchain,
fixture state and artifact identity. Prior pilot evidence does not qualify changed
sources. A trial, if later requested, must say “Targeted checks passed; final
validation pending.” Failure/uncertainty stays visible; no hidden retries, gate
retirement, arbitrary cleanup, off-device data submission or automatic merge.

The rename feature keeps the v2 SQLite schema and stable client identity, so
existing MCP clients continue working. This does not authorize an older packaged
binary against upgraded managed state: demo mode upgrades installation metadata
to v2/security epoch 2, which older apps must refuse. Any app replacement must
satisfy the installed runbook's compatible-artifact and security-floor checks
after owned processes stop; never launch an older source binary against managed
roots. To undo a name use another explicit rename after a fresh read, not a backup
restore or history rewrite. Older backups naturally contain older labels.
