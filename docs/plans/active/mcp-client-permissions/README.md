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
| Independent complete-diff reviewer | assigned after freeze | GPT-6 Astra/xhigh | pending |

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
