# MCP Client Permissions

- Status: reviewed implementation active; final validation pending
- Base: `071b329731103ef3be5113ff79faf12b856aa68e`; branch `codex/mcp-client-permissions`
- Outcome: understandable client cards and authenticated human editing of maximum policy plus related grants in one atomic Save.
- Owner: `/root/permissions_implementer` is the sole source, tests, docs, staging, commit and PR writer in the isolated permissions worktree. Coordinator and reviewers are read-only.

## Roles And Review

| Role | Agent | Requested | Verified |
| --- | --- | --- | --- |
| Coordinator | `/root` | inherited | actual model/effort unverified |
| Planner | `/root/permissions_planner` | GPT-6 Astra/xhigh | explicit spawn API accepted; execution internals unobservable |
| Independent plan reviewer | `/root/permissions_plan_review` | GPT-6 Astra/xhigh | explicit spawn API accepted; execution internals unobservable |
| Sole implementer | `/root/permissions_implementer` | GPT-6 Astra/high | explicit spawn API accepted; execution internals unobservable |
| Independent complete-diff reviewer | `/root/permissions_implementation_review` | GPT-6 Astra/xhigh | explicit spawn API accepted; execution internals unobservable |

The independent plan review approved implementation with the amendments below.
The coordinator showed the compact UI preview and presented the finalization
milestone within the user-authorized scope. No routine reconfirmation is required. Substantive deviation returns
to the existing plan reviewer through the coordinator.

## Scope And Invariants

Keep the existing permissions page, shared ClientName, Rename and exact activity.
Cards show maximum value level, scope, DEFINE, sensitivity, rule count and truthful
current effective summary. The panel offers Blocked, Read, Suggest changes, Write,
independent DEFINE (create/update/archive definitions), searchable explicit slug
prefixes and readable fields, sensitive access, preserved exceptions, server
before/after access and widening, collapsed advanced rules, Cancel and one Save.
Opening or saving unrelated fields must not normalize existing capability arrays
or custom targets/rules. Changing value level replaces only value capabilities.
Reduced maxima retain inert ALLOWs and explain possible later reactivation.

Presets write all three explicit READ/SUGGEST/WRITE rows at the chosen target:
Blocked D/D/D, Read A/D/D, Suggest A/A/D, Write A/A/A. Preserve descendant rules
and DEFINE; label this a scope default with exceptions, not a uniform promise.
Removal/inherit is an explicit advanced action. Test the broad Blocked plus exact
READ ALLOW case without inadvertently deleting SUGGEST/WRITE denies.

No issuance, token delivery, rotation UI, external configuration, onboarding,
native lifecycle changes, schema migration or second permission engine. Reuse the
policy validator, credential records, McpAuthorizationService and PermissionGrantService.
Human local administration alone can edit maxima. MCP and human browser credentials
remain distinct. Hosted GraphQL continues rejecting `local:<id>` grant mutation.
Local composition keeps `enableDemoReset=false`; memory reset and grant clearing
stay separate. No live models/providers, personal app/state or primary checkout
resources. Test only isolated synthetic personal/demo fixtures.

## Persistence, Concurrency And Admission

Validate the complete proposed policy and bounded unique target/action edits.
Async preflight evaluates a detached snapshot with existing permission services.
One synchronous BEGIN IMMEDIATE compares authority and catalog revisions, requires
an active client, invokes the browser UI_REVALIDATE callback immediately before
first write, applies the policy/edits and commits once. Late failure rolls back.
New ALLOWs must fit the proposed final maximum; unchanged inert ALLOWs survive.
Preserve untouched rule IDs, stable client ID/name/token digest/generation,
identity, history and attribution. Already admitted MCP operations retain their
existing completion contract.

The content revision binds store/principal/client summary and all stored grant
content. Compute it in a consistent SQLite snapshot using deterministic SQL-bounded
row and byte chunks, never an unbounded materialization/aggregate or weak checksum.
CLI policy/grant commands snapshot before BEGIN then compare atomically. Rotation
snapshots before export and compares before replacing authority; a losing export
may remain inert and is never replayed. Browser grant/Save/revoke use the stronger
revision. Preserve generation-only legacy terminal revoke and recovery for more
than 512 or corrupt grants: the browser editable cap is not a CLI/revoke limit.
Exact content A→B→A is accepted; this is a content CAS, not an event counter.
Policy/grant/name/generation/revocation mismatches conflict; no revoked revival.

A deterministic SHA-256 previewKey binds versioned canonical store/principal/client
identity, authority/catalog revisions, validated final policy and sorted unique
edits. It is a consistency checksum, not authority. Save recomputes, validates and
evaluates independently; no token registry, HMAC or schema. Draft edits invalidate
preview immediately and late replies cannot reenable Save.

Catalog metadata includes owned and global, active and archived rows, preserving
slug collisions; fingerprint ID, namespace/ownership, slug, archive and sensitivity.
Cap at 2048 rows and 2 MiB projected bytes, bounding variable columns in SQL before
materializing. Corrupt/oversized metadata means Catalog unavailable and no summary,
preview or Save, while CLI/revoke remain usable. Search and illustrative previews
have at most 32 results and responses at most 256 KiB. Summary covers all current
active fields in its named scope. Mixed/Custom/unavailable replaces unjustified
uniform labels. Explain future prefixes and actual stored-definition sensitivity;
DEFINE maximum is not an unrestricted effective promise. Widening includes effective
before/after, broader capabilities/ranges/sensitivity/future fields and retained
ALLOW reactivation.

## HTTP And Browser Outcomes

Add narrow local target discovery, preview and save contracts; retain old routes
and add optional revoke revision. Preserve exact Host/Origin/browser header/session,
POST/content-type/body limits, strict keys, no supplied store/principal selectors,
metadata-only projections and fixed errors. No MCP tool/GraphQL mutation additions.

Capture client/draft/revisions, prevent duplicates and require the latest exact
preview. Confirmed means commit acknowledgement plus result revision followed by
authoritative state. A 409 is definite precommit conflict: preserve draft separately
and require fresh inspect/preview. Only proven fixed prewrite failures claim unsaved;
transport, malformed and generic failures are UNCERTAIN. Never retry mutations.
Reconciliation reads describe present state without proving whether an earlier
attempt committed/rolled back or can still settle. Preserve uncertainty beside
refreshed state, with read-only retry. Focus/broadcast/CLI invalidation preserves
drafts/outcomes. Lock/expiry/navigation/session replacement clears private drafts,
search, preview and outcomes and invalidates late replies. No persistent editor
state or cross-store state; retain focus, name/activity and masking protections.

## Checkpoints And Validation

1. **Persistence (tests first):** credentials/admin/management CAS, actual independent
   process barriers for policy/grant/rotation/revoke, same-generation edits, ABA,
   preservation/no revival/late rollback/crash durability, oversized/corrupt recovery
   and actual CLI commands. Run focused tests after changes.
2. **Human API and enforcement (tests first):** strict bounds/keys/authentication,
   principal-token separation, stale authority/catalog/unavailable states and admission
   expiration/logout/cancellation/runtime replacement during async preflight. Exercise
   real guard/tools after browser saves: expansion/reduction, hierarchy/fallback,
   broad DENY/specific ALLOW, independent DEFINE, out-of-maximum ALLOW, sensitivity,
   global/personal collisions and archived values, rotation/revoke. Assert returned
   data, durable writes and audits, not merely preview booleans.
3. **Browser and isolation:** real backend search, levels, DEFINE, custom/Mixed,
   widening, stale preview, request counts, confirmed/committed-lost/unforwarded
   uncertainty, delayed reconciliation/read retry, focus/keyboard/mobile/name/activity,
   late lock/expiry/navigation. Demo selected client only; peer and separate personal
   store and demo receipt/IDs unchanged. Session replacement clears editor. Capture
   synthetic panel screenshot outside repository if practical.
4. **Docs/freeze:** update runbooks, current application/authorization, portfolio and
   exact additive contract rows. Discover affected readers and run checker tests,
   verified-base census, Markdown links and whitespace. Record dispositions/evidence.
5. **Frozen final qualification:** promptly commit/push one draft PR, provide SHA
   for independent complete base-to-head review, then run isolated required full
   `MIGRATION_GATE_BASE_SHA=<merge-base> pnpm migration:gate`, exact-head CI and Mac
   package/seal plus installed-artifact browser Save, durable enforcement/restart,
   CLI compatibility and personal/demo isolation. Run relevant native maintenance/demo
   coverage. No automatic merge.

Before expensive runs explain purpose, changed inputs and the applicable plan
requirement; verify pinned Node 24.21.0/pnpm 10.25.0, browser, Python and database.
Focused iteration is not final qualification. Freeze only after checkpoint
corrections and affected review are resolved. Changes after freeze renew affected
evidence/review and required final gates, carrying forward only unaffected coverage.
Keep final receipts/log links in PR/external evidence, not pass-only commits.

## Evidence And Dispositions

- Independent plan reviewer approved the recorded plan without material omissions.
  The five mandatory amendments above and the coordinator's wording correction
  are incorporated. No unresolved design decision remains.
- Backend tests were written and observed failing before persistence/API changes.
  Added process races, complete-content/ABA recovery, atomic rollback and crash
  tests, detached evaluator/admission barriers, strict HTTP envelopes and real MCP
  returned data/write/audit enforcement. Focused final backend batch: 102/102 passed.
- Original crash assertions remain. The fixture fault hook now recognizes COMMIT
  only after BEGIN IMMEDIATE, because new read snapshots also COMMIT. Otherwise
  the old fault would kill a read before the intended write-transaction barrier.
  Both pre-COMMIT rollback and post-COMMIT durable Save tests passed.
- Browser final focused compatibility: 44/44 passed (permissions, existing names,
  demo and transport); screenshot capture: 1/1. Covers uncertain/lost/malformed
  acknowledgements, stale reads, future-rule widening, explicit preset hierarchy,
  new login/late-preview cleanup and separate seeded stores. Session presentation
  metadata is injected only in the source replacement test; native mode/store
  switching is reserved for the installed demo qualification.
- Iteration failures were retained: initial new tests failed before implementation;
  one MCP synthetic writer lacked sensitivity authority, then was corrected;
  browser label/route-settlement fixture issues were corrected. Coordinator review
  regressions for future/archived widening and stale confirmed-read display failed
  first and passed after fixes. None required weakening product assertions.
- Backend and web production builds passed. Contract/Markdown checker tests:
  75/75; Markdown links: 152 files; exact verified-base census passed. Added only
  three local HTTP contracts, seven consumer references and the demo harness's
  single synthetic loopback fetch sink; no hosted/schema baseline changes.
- Native focused prerequisite failure retained: 12 passed/39 failed because the
  new worktree lacked its native build. Built its own binary; rerun passed
  51/51 tests. No other task's build/runtime resources were used.
- New modules/components and newly added persistence/API blocks are formatted.
  Installed smoke adds browser Save, real write denial, durable restart and CLI
  assertions without changing its 360-second deadline. Demo smoke adds selected
  client Save, peer/personal/receipt preservation and real MCP tool visibility.
- Evidence root: `/private/tmp/mcp-permissions-final-bo5ROW`; focused logs are
  `/private/tmp/mcp-permissions-{backend-compat,browser-compat,doc-checks,native-focused-built}.log`.
  Failed runs remain under their original distinct paths. Final receipts belong
  in the draft PR/external evidence rather than pass-only commits.
- Final validation remains pending: frozen full migration gate, exact-head CI,
  complete-diff independent review, isolated Mac package/seal, installed Save and
  restart/CLI compatibility, and full installed personal/demo cycle. No merge.

## Complete-Diff Review Correction Batch

The independent reviewer requested changes on `3a3db649ce618bedf9c21a17d4b75a8b801d663d`
for two P2 findings, accepted by the coordinator. The rest of the reviewed scope
carries forward subject to the focused delta review and renewed final gates.

- The enriched client list duplicated maximum targets in `summary.scope`, exceeding
  the 512 KiB response bound for 32 valid maximal policies. A boundary regression
  failed first. The card projection now omits that redundant scope while retaining
  every client and its complete policy, counts and effective summary.
- Permissions Save settlement refreshed only its own window. Two authenticated
  window regressions failed first for confirmed and committed-lost responses. The
  existing management broadcast now publishes settlement, refreshing other cards
  and invalidating their previews while preserving drafts/outcomes without retries.
- The prior frozen gate passed contract, documentation and backend unit/build
  phases, then was deliberately interrupted during database integration for this
  correction batch. Exit 130 is not a gate pass. Its lifecycle receipt confirms the
  owned database/container were removed; diagnostics remain at
  `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/context-router-lmbg-7SVDv0`.
  Remote CI was not cancelled. No package was built from the superseded candidate.
- Regression logs: `review-list-red.log` and `review-broadcast-red.log` under the
  task evidence root. Corrected-candidate focused results, review disposition and
  final gate/package/installed/CI receipts will be recorded in PR #187.

## External review follow-up (2026-10-15)

Claude reviewed clean `b33a1bae0cb5a205e63c697f2d38e57486112b26` and
reported stale full-policy overwrite, valid catalog metadata rejected by narrower
reader limits, repeated catalog/evaluator work blocking the shared process, and
race/disconnect/boundary coverage gaps. The coordinator accepted these findings;
the existing independent plan reviewer approved the following scoped amendment.
Earlier final receipts remain evidence for that earlier candidate only. All final
gates, package/installed/demo qualification and exact-head CI must be renewed after
this correction batch. Follow-up evidence is retained outside the repository at
`/private/tmp/mcp-permissions-followup-t4MJAi`.

1. Tests first: valid long labels/slugs through MCP create/archive, cosmetic label
   edits versus authority revisions, exact catalog limits and giant dotted slugs;
   strengthen process races to prove conflict classification and durable winner,
   and exercise a real disconnected Save during asynchronous preflight.
2. Keep exact full definition slugs within the existing complete 2048-row/2 MiB
   budget; check SQL lengths/remaining budget before materialization. Bound and
   flag display labels, exclude them from catalog authority revisions, keep
   archived definitions, and never use shortened display strings as selectors.
   Long exact slugs are not selectable; only legal prefixes of at most 128
   characters may be offered. No definition-write/schema cap or new recovery path.
3. Read the client page, bounded grants and catalog in one consistent snapshot;
   keyset reads, request-local indexes and evaluator reuse remove repeated scans.
   Only the card path may omit unused complete administration digests. Shared
   evaluator optional indexed readers retain repository fallbacks and exact,
   wildcard and dot-prefix matching semantics. Yield outside SQLite transactions;
   prove timer fairness and query bounds at 32 clients/2048 definitions/512 grants.
   No persistent cache. Enforce final list/search/preview response byte limits.
4. Three-way draft reconciliation preserves untouched current dimensions and
   exact arrays, replays deliberate target add/remove intent, and requires an
   explicit choice for concurrent changes to the same dimension or grant key
   before Preview/Save. Preserve uncertain outcomes and late-response guards.
   Preview discloses narrowing as well as widening, including future/archived
   scope, value level, DEFINE, sensitivity and grant changes.
5. Update affected contracts/runbooks, batch focused checks, freeze/push the same
   draft PR, obtain the existing independent reviewer's affected-diff review, then
   renew required final qualification. Keep complete CLI CAS, definition counts,
   fail-closed oversized/corrupt metadata and revoke/CLI recovery. A known legacy
   precommit 409 may say not saved; generic/malformed/transport failures remain
   uncertain. No merge.

Sole writer and requested/verified model roster remain unchanged: implementer
Astra/high, independent plan/implementation reviewer Astra/xhigh; explicit spawn
settings accepted, execution internals independently unobservable.

### Follow-up implementation checkpoints

- Valid catalog metadata tests first failed with `CATALOG_UNAVAILABLE` for a
  129-character slug/513-character label and a deeply dotted exact slug. Bounded
  exact reading, presentation flags and label-independent revisions then passed.
  Authoritative corruption and true row/byte overflow still disable complete
  claims; oversize exact text is rejected before materialization.
- The maximum fixture (32 clients, 2048 definitions, 512 grants/client) first
  failed because its zero-delay timer ran only after list completion. Query-plan
  tests separately caught namespace-union sorting and a projected-ID alias sort.
  The corrected query seeks the existing primary-key ID index, snapshots one
  catalog, omits card-only unused digests and yields outside transactions.
  Timings are retained with fixture scope in external logs, not compared as a
  controlled benchmark against another reviewer's machine/run.
- Six process races now classify only the expected conflict as conflict, assert
  the exact durable winner and unchanged rows after the loser, and allow only an
  inert losing rotation export. Real socket disconnect waits for the server abort
  and full handler settlement before proving unchanged policy/grants/revision.
  Real MCP long-label/slug create/update/archive retains editor availability;
  Save accepts the exact preview across a cosmetic rename and rejects it across
  archive changes.
- Browser stale-draft regressions first reproduced missing same-setting choices
  and lost untouched scope on refresh. Three-way intent tests cover preserved
  exact arrays, explicit choices, repeated reads, convergence and absent-rule
  baselines. Existing uncertain-Save coverage additionally caught explicit
  reversion being dropped while a read was pending; the original expectation is
  retained, with a value/rule regression and corrected intent retention.
- A combined affected-backend run reported 106/107 passing and an HTTP client
  `EPIPE` during the existing oversized-body endpoint test. Two isolated repeats
  passed without runtime changes; the original failure is retained for final
  qualification scrutiny. This is not recorded as a clean combined pass.
- Shared evaluator unit consumers passed 30/30; management and actual CLI
  compatibility passed 29/29. The final maximum fixture measured list 3184 ms,
  inspect 684 ms and preview 763 ms, with one catalog read, no card-only digest
  and timer progress before completion. These are fixture measurements, not a
  controlled comparison with the external review timings.
- The affected real-backend permissions browser suite and draft units passed
  25/25 after correcting the long-field disabled button's accessible name. A
  separate demo assertion initially started CLI inspection immediately after Save
  acknowledgement, overlapping reconciliation. Its unchanged isolated repeat
  passed; it now waits for both actual reconciliation responses before the CLI
  isolation assertions. No read retry, sleep or storage behavior change was added.
  Both earlier failure logs remain retained.
- Documentation reader tests passed 75/75, links passed for 152 Markdown files,
  and the verified-base contract census passed. Renewed independent review and
  full local/CI/package/installed/demo qualification remain pending for the next
  frozen candidate; final exact-head receipts belong in PR evidence.

Disposition: accepted findings 1, 2, 3 and gaps 4(a–e). Retained complete CLI CAS,
active/archived catalog membership, definition counts (including slug collisions),
2048-row/2 MiB fail-closed limits and terminal recovery. Rejected suggestions to
add write-side definition caps, drop archived authority metadata or introduce a
persistent cache. These would alter authority/contracts unnecessarily.


## Main integration checkpoint (2026-10-16)

The user requested refreshing main, integrating its recent merges and checking
for justified follow-up changes in the existing PR. The sole writer and review
roles/settings above remain unchanged. Fetch verified `origin/main` at
`20d1fe7b2767e654bfc764326c547571d8b87062`; local main fast-forwarded from
`601737a94d5f63f696818026f6694de494f8865c` only after proving ancestry and that no
worktree had main checked out. The primary demo-assistant checkout was untouched.

The previous permissions head was `256ec09ac4f4322c867b7f4ca0516185b120c86f`, with
merge base `071b329731103ef3be5113ff79faf12b856aa68e`. Main contributed PRs #185,
#186, #188 and #189: bounded startup guidance/overview, explicit nonruntime CI
selection and more precise SQLite/HTTP timing tests. The only shared file was
`apps/backend/test/local-ui/http.test.mjs`; its independent changes merged cleanly.
All upstream changes are retained unchanged. No production integration correction
was identified in the initial assessment; dependency/toolchain pins are unchanged.

Focused integration checks cover the complete local-UI HTTP suite, changed SQLite
coordination/recovery suites, overview/CI-selection/documentation/contract readers,
verified latest-base census and whitespace. This runtime feature remains subject
to full CI qualification under the new selection policy. The default local gate
is unchanged. The independent plan reviewer approved renewing the frozen merge
head's full 12-phase local gate and full exact-head CI, with this bounded artifact
carry-forward amendment:

- The merge changes guidance, documentation, test assertions and CI selection.
  Product source, dependency/lockfile/toolchain pins, packaging code and both
  installed qualification harnesses are byte-unchanged from `256ec09`.
- Retain the existing artifact's package/seal, installed and full-demo evidence
  under `/private/tmp/mcp-permissions-followup-t4MJAi`. Its source remains
  `256ec09ac4f4322c867b7f4ca0516185b120c86f`, manifest
  `c3ed08728ec55d51deb95fae8ca5a87a96caeeb5322882f9066fc32fa2722953`, and archive
  SHA-256 `3fc3e8d2990f566eb7e389afe216b8c8544c9f58b68220c25c9a339fa21a845a`.
  This is qualification of that unchanged artifact, not a merge-head artifact.
- Packaging hashes all copied tracked inputs; a build from the merge head would
  therefore have a different source/manifest identity even with unchanged runtime
  content. Any new merge-head build/distribution requires fresh seal/manifest and
  installed/demo qualification. No rebuild is required solely to rename the old
  artifact or its valid evidence.

Source stays frozen for independent integration review after the focused
checkpoint. No merge of PR #187 to main is authorized.

Ref, merge-preview and focused evidence are retained at
`/private/tmp/mcp-permissions-main-sync-3tvua6x4`; final results belong in PR evidence
rather than pass-only commits.

### Integration gate diagnostic and test correction

The first frozen merge candidate, `2ef010dc`, passed independent complete-diff
review and focused checks. Its full local gate stopped in the local-model suite
(144/145 passed), after backend unit tests passed (1125/1125). The unchanged
`deadline includes admission and leaves an unwitnessed dispatch latched` test
observed zero peer requests: local dispatch had latched unavailable, but its
50 ms wall-clock deadline could destroy TLS transport before peer receipt. The
failed run and successful database/container cleanup remain in
`context-router-lmbg-9eo6Wf`; this is diagnostic evidence, not a passing gate.

The approved correction changes only that test: establish actual TLS receipt
under an independent captured real-time watchdog, then advance controlled time
past the unchanged 50 ms logical deadline. Require exactly one request, the
unwitnessed write observation, no admission progress, the exact deadline error,
permanent unavailable state and no second-attempt request/control-evidence change.
Restore time mocks before fixture cleanup. The adjacent readiness-expiry test is
unchanged. The affected client suite passed 32/32; external fault variants for a
wrong deadline error and missing unavailable latch both failed as intended.
Logs are retained in the integration evidence directory above.

Independent affected review precedes the corrected freeze; renew the complete
local gate and exact-head CI on that freeze. Production, dependency/toolchain,
packaging and installed/demo harness inputs remain unchanged, so the explicitly
source-bound `256ec09` artifact carry-forward amendment still applies.
