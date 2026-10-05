# Step 08: Local UI

- Document status: technical plan revision P3; approved P2 product scope retained; validation-budget addendum requires affected approval before implementation
- Program step: `08-local-ui`; sole active primary step
- Target branch: `main`; implementation branch: `codex/local-migration-08-local-ui`
- Planning base commit: `5e2a67dd785500ba053b2e836c47166e8adeada8`
- Branch/PR owners, planning owner, implementation owner: `/root`
- Coordinator and sole repository writer: the same agent, `/root`
- Change classification: shared (new explicit local UI; additive shared history/workflow contracts and web integration)
- Depends on: merged Steps 03, 05, 06 and 07, including preserved recovery/E/H contracts
- Risk profile: sensitive; browser authentication, credential authority, atomic deletion and historical privacy
- Plan reviewers: fresh independent architecture/scope, security/privacy, persistence/recovery, compatibility/tests/usability reviewers; assignments and verdicts recorded below
- Implementation PR: pending; one cohesive draft PR with testable checkpoints
- Supported mode after merge: explicit browser-first local UI plus MCP in one process, with no-model or the existing manually selected local model; retained hosted/reference and existing MCP-only modes
- Last updated: 2026-10-04

## Outcome

The existing dashboard works on loopback without Auth0 or required hosted services.
One launcher serves inert Next page shells, authenticated application APIs and the
existing separately authenticated MCP listener, sharing one stable principal,
SQLite database, application services and model/admission owner. Users can edit
memory/schema/profile, review document proposals, use useful search and form fill,
manage real MCP instances and clear retained history separately from memory.

## Required Reading

The coordinator completed AGENTS startup and the full [handoff](../step-08-handoff.md).
Authoritative constraints are [orchestration](../orchestration.md),
[decisions LM-008/015/019–022](../decision-log.md),
[agent execution](../agent-execution.md), [workflow guide](../../../../useful/AGENT_WORKFLOW.md),
[interface evolution](../tracks/interface-evolution.md), the
[baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md), its
[registry](../../../../current/local-migration-contract-baseline.json), and
[Step 01 scope](../01-contract-baseline-and-product-scope/plan.md).
Retain Step 03 recovery/R1, Step 05 upgrade/backup, Step 06 selection/plan/evidence/E/H,
and Step 07 plan/closeout/acceptance. Current storage, history/reset, MCP authorization,
document-analysis/form-fill/workflow docs and local identity/model/MCP runbooks remain
required for their affected boundaries. No historical model experiment is reauthorized.

Source inspection covers `apps/backend/src/composition`, `bootstrap`, local identity,
SQLite UoW/credentials, local MCP guards, shared AI ports, resolvers/controllers,
all `apps/web/app`, auth/middleware/client libraries, backend tests, and migration
scripts/CI. Reviewers must inspect actual relevant source, not only this narrative.

## Agent Allocation

Only root edits files, plans, generated output, dependencies, Git or PR content.
The available runtime advertises the requested Astra High/xhigh settings and accepted
explicit dispatches. It does not independently expose serving internals; do not claim
more verification than this. Root's requested Astra/xhigh is not relabeled High.

| Role/agent | Mandate and ownership | Requested model/effort | Observable setting | Parallel work |
| --- | --- | --- | --- | --- |
| `/root` | Coordinator and sole writer, all repository paths | gpt-6-astra/xhigh | Requested; serving internals not exposed | Integrates all changes |
| `ui_inventory` | Read-only UI, consumers, tests, usability | gpt-6-astra/high | Explicit dispatch accepted | Completed |
| `session_inventory` | Read-only composition, browser security and model ownership | gpt-6-astra/xhigh | Explicit dispatch accepted | Completed investigation; concrete composition follow-up |
| `history_inventory` | Read-only history, transactions, existing data/recovery | gpt-6-astra/xhigh | Explicit dispatch accepted | Completed |
| Fresh architecture reviewer | Trust-boundary architecture and scope | gpt-6-astra/xhigh | Pending dispatch | Frozen plan/diff |
| Fresh security reviewer | Browser/session, credential authority, privacy and auth-contract evolution | gpt-6-astra/xhigh | Pending dispatch | Frozen plan/diff |
| Fresh persistence reviewer | History semantics, upgrade, concurrency and recovery | gpt-6-astra/xhigh | Pending dispatch | Frozen plan/diff |
| Fresh compatibility reviewer | Consumers, test adequacy, usability/accessibility | gpt-6-astra/high | Pending dispatch | Frozen plan/diff |

## Entry Criteria And Current Evidence

[Activation evidence](activation.md) records exact clean base, prerequisite GitHub
metadata, all twelve passing phases, toolchain, caller integrity, cleanup, timing
and byte-identical restoration of all twelve preparation docs. The recovery stash
remains. This checkout and branch are the only implementation location.

Observed current behavior:

- Existing local MCP starts a narrow Nest application context; the local database
  preview starts another, broader non-listening root. Importing both roots would
  risk duplicate provider/model ownership. Browser composition must be explicit.
- Seven retained dashboard page wrappers and root/navigation currently depend on
  Auth0 and pass raw hosted access tokens into clients. Clients already implement
  most interactions; preserve their layout/forms rather than build a second UI.
- Web has no working test script or authenticated browser suite. Existing smoke
  covers unauthenticated chat/debug and Auth0 redirects, plus builds.
- Permission UI hardcodes product names. SQLite credential operations already
  identify real instances and recheck generation/revocation transactionally.
- Audit masking uses today's slug catalog; archived, renamed/recreated and older
  records cannot safely derive event sensitivity that way. Audit snapshots already
  retain old values. Both history streams are already stored indefinitely.
- AI workflow ports have bounded execution options; browser controllers/resolvers
  do not consistently pass cancellation/deadlines or present error categories.

## Scope And Non-Goals

Reuse dashboard, profile, preferences/suggestions/manual definitions, schema export,
history and form-fill components. Retain useful literal and AI search in preferences.
Add separate browser unlock/logout, basic MCP management and whole-history clearing.
Local product navigation excludes Search Lab, generic hosted chat, debug-token and
demo/full reset. Retain their hosted/reference implementations and tests through
LM-008; local route omission is explicit, not a global deletion. No new location UI.

Definition shape edits retain the later approved Steps 04/07 behavior: they affect
subsequent validation but do not revalidate, migrate or rewrite existing values.
The Step 01 unsafe-shape rejection aspiration was not implemented by those steps;
record this existing limitation explicitly in schema documentation. Do not claim
unsafe edits reject, add UI-only rejection, or expand shared definition semantics
without a separately reviewed decision.

No C/C+ onboarding, issuance/rotation/maximum-policy UI, installers, desktop shell,
model supervision/downloads, new native benchmark, other-platform qualification,
LAN, stdio, cloud sync, redesign, TTL, undo or per-record history deletion. Step 09,
Steps 10–11 and the separate onboarding follow-up remain inactive.

## Contracts And Compatibility

| Family | Decision and consumers |
| --- | --- |
| Application | Preserve preference/definition/profile and six MCP tool behavior. Add atomic `clearMyHistory`; add reviewed per-item document-apply result instead of silently dropping failures. Preserve legacy apply mutation for orchestrator/eval/external callers. |
| Storage | No new SQLite/Prisma schema version. Store server-authored versioned event-sensitivity metadata in existing audit JSON; absent/malformed legacy metadata means UNKNOWN. Add transaction-scoped definition-read facet and a clear-history use case over existing reset storage delete methods. |
| Identity | Preserve stable principal/human-file preview identity. New browser-only random session token and strategy; no human-file, MCP or inference secret reaches web code. `me` preserved. |
| Model | Same selected Step 06 adapter and no-model adapter, singleton across UI+MCP. Existing E/H/recovery unchanged. Add execution propagation at browser edges, no fallback. |
| GraphQL | Preserve existing fields including `user(id)` as compatibility alias; mark deprecated with `me` guidance after capture tests. Add history sensitivity projection/clear result and versioned per-item apply mutation; regenerate SDL and web clients together. |
| REST | Preserve hosted upload paths/payloads, allow additive safe status fields. Local same-origin POST `/graphql`, `/api/preferences/analysis`, `/api/form-fill/pdf`; new POST `/api/local/unlock`, `/api/local/logout`, `/api/local/capabilities`, `/api/local/mcp/list`, `/api/local/mcp/inspect`, `/api/local/mcp/grant`, `/api/local/mcp/revoke`. No broad Nest proxy. |
| MCP | Existing separate 127.0.0.1 listener and `/mcp` transport, six tools/resources/credential policy/Origin guard unchanged. Browser token is invalid there. No OAuth/DCR added locally. |
| Config/filesystem | New explicit `pnpm --filter web local-ui` launcher with `serve`/`serve-model`, UI/MCP ports and private unlock export directory; existing identity/database/model configuration reused. No implicit upgrade/bootstrap/reset. Local mode is selected by launcher before Next loads; cannot be toggled by request headers. |

Consumer inventory: all retained web pages and direct fetch/Apollo callers; web
middleware/Auth0 library/root layout; generated GraphQL documents; `test-auth.sh`,
`test-graphql.sh`; backend identity/application/contract tests; local orchestrator
analysis/apply clients and its command runbook; eval ingestor/exporter/snapshot and
form-fill clients; source/packaged restart probes; CLI credential operations;
Claude Code/Codex CLI and unknown external GraphQL/REST clients in the registry.
`user(id)` has no web caller but does have shell/e2e/fixture and assumed external
callers. No removal is approved here. Compatibility lasts through this Step 08
release and until a later reviewed LM-008 removal gate with release notice and
consumer migration; do not invent an elapsed-time removal date. Old clients remain
tested. Deprecated UI destinations remain hosted-only reference surfaces; document
local alternatives and keep hosted smoke. Update registry consumer evidence and
migration records without weakening baseline checks.

## Design

### One runtime owner

Create an explicit local UI Nest root with local configuration/storage, browser auth,
GraphQL/retained application features and the same narrow MCP providers. Extract a
small reusable MCP feature module instead of importing both full roots. Register
only one HUMAN_AUTH_STRATEGY in this root; no LocalAuthModule human-file strategy.
Register the configured model module once; both AI ports resolve to the same owner.
All local sensitive API requests are globally authenticated, including resolvers with
optional guards in hosted mode.
Use application services from this Nest instance for both edges.

Prepare production Next in a small web launcher, then create Nest's HTTP application.
Install the browser dispatcher before `app.init()` and parser registration: allowed
protected API routes pass into Nest; explicit page/static paths go to Next's handler;
all other routes fail closed. Independently reject and close raw HTTP upgrade and
CONNECT traffic before any Next forwarding, including after Next initializes its
own upgrade listener. Unsupported sockets must never bypass admission or remain
open; prove this with raw-socket requests after loading a page and at shutdown.
Use Nest's own HTTP server so Apollo's drain plugin
owns the actual listener. Existing LocalMcpHttpServer gets `app.get(McpService)` from
this same application. No second listening Nest backend or proxy credential.
Bind both listeners exactly to 127.0.0.1. Defaults UI 3002/MCP 8787; port zero is
supported in owned tests. Readiness is emitted only after both listeners are ready.

Validate configuration, prepared web build, identity/schema-v2 and distinct ports
before acquiring model resources where possible. Startup failure closes only owned
listeners/application resources; it never stops the manually operated model or
reuses a consumed claim. Closing a browser has no backend/model lifecycle effect.
Signals close browser sessions, drain/cancel bounded requests and shut down the
application/MCP server with bounded settlement. Model E/H latches and fresh-session
manual recovery remain authoritative.

The web package gains a production `backend: workspace:*` dependency; its launcher
loads built backend through that package rather than sibling source paths. Include a
production-loadable Next configuration that does not need TypeScript dev dependencies.
The custom server must be included explicitly in the local runtime closure: Next
standalone tracing does not automatically package it. Extend the existing packaging
smoke to relocate backend dist/dependency closure, web production output/static
assets, Next runtime and the launcher, run with source unavailable and ambient
NODE_PATH disabled. Preserve the hosted standalone entry and its coverage.

### Browser trust and sessions

Do not use authentication cookies on plain HTTP loopback: host-only, HttpOnly and
SameSite do not isolate ports. Another-UID listener at another loopback port can
receive cookies and replay them with forged native Host/Origin. A dedicated random
browser bearer, explicitly attached by origin-bound code, avoids that cross-port
ambient authority. Cookie-plus-tab-secret adds complexity with the same no-SSR
requirement and is rejected here.

Launcher exports a fresh 32-byte one-use `cr_ui_unlock_…` token to an exclusive
0600 file in an explicitly configured 0700 owned, nonsymlink, disjoint export root.
Use the existing secure root/file validation primitives; never export under state,
database or model roots, never overwrite or use a credential URL/fragment. Print
only the file path and UI origin. A simple stdin command `unlock` reissues while the
same backend/model owner runs; EOF disables that command but does not shut down.
Failed export leaves the old bootstrap usable; successful export invalidates the
old bootstrap only. Bootstrap expires after five monotonic minutes. Browser accepts
paste/file content into a password-style input, POSTs it once, then clears input.
Atomic synchronous consumption admits at most one concurrent exchange.

Exchange returns an independent random `cr_ui_session_…` token. Store only its digest,
principal, absolute monotonic eight-hour expiry and request ownership in bounded
server memory (maximum 32 sessions). Reject exhaustion, never evict an active session
silently. Browser stores only its session in `sessionStorage`, never localStorage,
URL, cookie, HTML/SSR/RSC or logging. Restart invalidates all sessions/bootstrap.
Expiry actively aborts owned AI requests and cleans session state. Reserve bounded
authenticated control capacity for logout even while ordinary requests are saturated;
revocation cannot depend on obtaining a normal work slot.
SessionStorage can be cloned by auxiliary/duplicated tabs; do not promise one-tab
uniqueness. Server logout revokes that session, aborts its AI requests, and browser
clears storage, query caches, uploads/results and in-memory sensitive state. Expiry
and 401 do the same. Each session generation discards older async responses.
Storage-disabled browsers fail with a clear message; no insecure fallback.

API admission requires exact literal Host with selected port, exact Origin with
selected UI port, expected method/content type and one correctly formed Authorization
header; reject duplicate security headers, absolute-form/noncanonical paths, foreign
or null Origin, cross-origin preflight and Origin-less sensitive requests. Unlock
requires its bootstrap instead of session and JSON plus fixed custom UI header.
No cookie auth/fallback, CORS, GraphQL GET, URL tokens, redirects, session recovery
endpoint or trusted forwarded headers. Native callers can forge Host/Origin and
still need the bearer. Validate again after slow body parsing before use-case entry.

Centralize browser API calls at fixed allowlisted destinations, with
`credentials: 'omit'`, `mode: 'same-origin'`, `redirect: 'error'`, `cache: 'no-store'`.
Existing hosted calls retain their explicit hosted mode; a browser session token
cannot be sent to configured hosted URLs, arbitrary URLs or redirect destinations.
All retained local pages are public inert shells with client data loading; no private
SSR, page props, metadata, RSC/prefetch payload or service credential injection.
Local Auth0 construction/middleware/network use is bypassed before initialization.

Bound headers, JSON bodies (256 KiB), upload bytes (configured 10 MiB file bound plus
bounded multipart fields/overhead), incomplete body time (15 seconds), active API
requests and session count. Check body/content limits before unbounded buffering;
Multer memory storage remains bounded. No request-body/access-token logging. Use
no-store, nosniff, Referrer-Policy no-referrer, frame-ancestors none, COOP same-origin,
and a tested production Next nonce CSP (`connect-src 'self'`, no third-party scripts,
no raw HTML). Verify actual hydration; a nominal header alone is not evidence.

Plain HTTP does not authenticate a malicious replacement/preexisting listener or
service worker at the exact same origin. Document this residual and exclusive-port
startup failure; no certificate/trust installer is introduced. Same-user filesystem
compromise and arbitrary same-origin XSS exceed token separation. React encoding,
CSP, no user HTML, fixed destinations and canary tests are required defenses.

### Retained UI and client management

Convert only local page data-load wrappers to client loading; reuse existing component
forms, typography/navigation and validation. Show clear loading/error/retry states;
never treat a failed fetch as an empty successful result. Reset state on logout and
avoid automatic retries of mutations with uncertain outcomes. Add keyboard-operable
history tabs, labeled controls and focused confirmations; no broader redesign.

List each persisted MCP ID and label, revoked state, maximum capabilities/targets/
sensitivity, database narrowing grants and resulting access. Use the existing
permission evaluator, including default-sensitive deny and exact/wildcard precedence,
for per-definition/action explanations; do not infer authority from labels or merely
union ALLOW rows. Same-product instances are distinct. Display stale-reload errors
for concurrent authority changes.

Client listing returns pages of at most 32 summaries, with a canonical instance-ID
cursor and a 512-KiB serialized response ceiling. Inspect one selected instance
through a separate fixed route. Read at most 513 grant rows: at most 512 complete
rows and a 256-KiB projected JSON ceiling are usable. Select bounded columns and
check lengths before materializing arbitrarily large stored strings. Inspection
may evaluate at most 32 exact requested targets against the complete captured
grant set and existing authority evaluator. Row/byte/malformed-state overflow
returns a fixed authority-too-large/unavailable result, no partial effective-access
claim or revision, and disables grant edits. Never truncate a DENY or compute a
revision from a partial set. Existing data is unchanged and remains manageable
through CLI. Revocation can still narrow authority using expected credential
generation without a grant revision. Boundary/overflow tests include an omitted
DENY and a concurrent transition into overflow.

Local list/inspect/grant/revoke routes call the same SQLite authority operations
as CLI. Add optional
expected generation/current-policy-and-grants revision validation under the same
transaction for UI stale-edit protection; CLI's existing signatures remain compatible.
Grant edits re-read the complete bounded set and validate its revision within the
write transaction, rejecting overflow rather than editing against partial state.
Do not add schema columns: compute a canonical bounded authority revision from fresh
persisted client and grant data. Recheck revocation/rotation/maxima within mutation.
Grant effects remain ALLOW/DENY/REMOVE and only narrow the credential ceiling; disallow
or clearly report an ALLOW with no authority under maxima. No endpoint accepts a
policy edit, export path, issue or rotate request. All responses exclude digests/secrets.

### History, state transitions and recovery

Create versioned server-owned audit metadata for event-time sensitivity with explicit
SENSITIVE/NON_SENSITIVE/UNKNOWN projection. Derive it from actual definition IDs in
the mutation transaction, including archived definitions; do not trust caller metadata
or today's slug. For events containing before/after/consumed-suggestion values, a
sensitive member makes the whole value payload sensitive. Unknown/unresolvable data
is UNKNOWN. Never backfill legacy records as nonsensitive from current state. A
current sensitivity upgrade must not unmask an older sensitive snapshot; a downgrade
must not erase historical classification. Definition snapshots already carry their
own isSensitive value; preserve and combine both sides safely.

Add the minimal definition-read method to StorageScope and both adapters so capture
and mutation share the UoW. SQLite BEGIN IMMEDIATE serializes definition writers.
For PostgreSQL, define event time as the definition version observed by the mutation
inside its transaction; test this ordering with a concurrent definition update rather
than asserting SQLite locking semantics apply. All newly created markers are derived
from transaction-consistent server reads. No new SQLite schema version or migration.
Older v1/v2 records retain all bytes and default to masked UNKNOWN in the UI. Archived
or missing catalog data cannot unmask values. Sensitive/unknown details and values
are hidden by default behind deliberate reveal, including evidence/before/after/
consumed suggestions; reveal state is cleared on invalidation. Access history continues
to store bounded metadata, never preference values or raw prompts/files.

Add `clearMyHistory` as a human-authenticated use case with a separately confirmed UI
mutation (`CLEAR HISTORY`). Use one existing single-attempt serializable
StorageUnitOfWork, giving PostgreSQL both deletes one consistent snapshot. Delete
this principal's
mutation events and access events and return bounded counts only after commit. Use
existing scoped reset-storage delete methods; never invoke ResetService or FULL mode.
Failure of either delete rolls back both. A known serialization failure is a
confirmed rollback; report it distinctly from an uncertain commit acknowledgement.
There is no automatic retry in either case. Test ordered concurrent audit/access
inserts between deletes, not just concurrent clear calls. No receipt event: clearing preferences did
not occur, so no PREFERENCES_RESET event. Keep principal, users, definitions including
archives, locations, values/suggestions, live provenance, identity mapping, credentials,
policies/grants and operation/candidate recovery rows unchanged.

Linearization is the clear transaction. Concurrent committed/in-flight operations may
append after it, including best-effort MCP access logging; a successful clear does not
promise indefinite emptiness or disable logging. No timestamp cutoff and no automatic
retry of a lost response, which could delete later events. Explain refresh/review before
retry if the outcome is uncertain. Clear memory remains history-preserving; confirmation
explicitly says old values remain in history until this separate action.

HistoryTabs owns a shared invalidation generation and abort controllers for both tabs:
clear rows/cursors/retry/expanded/reveal state, reject all pre-clear responses, then
reload. Hidden tabs follow the same generation. Broadcast invalidation to other same-
origin windows without data or credentials; windows also invalidate/refetch on focus
and pageshow, so missed broadcasts do not establish durable cached truth. Browser cache
is no-store; other clients/transcripts and already viewed data cannot be recalled.
Logical deletion is not secure disk, WAL or backup erasure. Restoring older backups
restores their history and credential authority under the existing runbook warning.

### AI, proposals and forms

Capabilities come from the same actual selected AI ports, not environment guesses or
model-name labels. No-model disables AI affordances with a useful explanation while
CRUD/export/history/client management still work. Show configured capability versus
runtime availability distinctly; busy/latched unavailable never triggers fallback or
implicit reset/retry. Qualified inputs retain all selected text MIME variants: `text/plain`,
`text/markdown`, `application/json`, `application/x-yaml`, `application/yaml`,
`text/yaml`, and text-extractable `application/pdf`. UI and server use the actual
selected capability/configuration intersection; test every retained variant. Local
images/OCR are unsupported. Preserve Step 06 E's known email omission and H's inconclusive native
cancellation evidence. No native quality claim comes from deterministic fixtures.

Propagate one per-request AiExecutionOptions with AbortSignal and a monotonic deadline
(default 180 seconds, matching MCP, bounded client shortening) through REST controllers,
DocumentAnalysisService/extraction, form fill, and GraphQL search/consolidation. Bind
disconnect/logout/cancel to that request only using an immutable symbol-keyed request
field: `req.aborted` or premature `res.close`, never normal post-body `req.close`.
Only adapters declaring strict execution controls receive these options. GraphQL
reads the same field from its request context; no singleton mutable request options.
Keep one adapter admission across UI and MCP. A canceled caller returns promptly while
existing settlement/latch rules continue to own potentially running model work.

Browser allows one upload workflow per view, includes cancel, rejects oversized files
before reading, revalidates content/type and size server-side, checks PDF signature
and rejects images/binary masquerading as text. Secret-looking filenames/content
require explicit review/consent before upload. Files remain in bounded memory, are
not logged/stored, and are released after finish/cancel/logout; no raw-file retention.

Proposal review keeps domain validation authoritative. Add versioned per-item apply
results with item identity, success/validation failure/conflict; do not silently lose
partial failure. V2 requires CREATE absence
or UPDATE matching reviewed state, bound to the exact definition/row/location
identity. Revalidate the definition observed inside the transaction, then compare,
write and append audit in one existing single-attempt serializable UoW. Add minimal
transaction-scoped reads/CAS rather than ordinary read-then-upsert. Millisecond
updatedAt is not a guaranteed row version: promise canonical state comparison,
not detection of all historical ABA edits. Test stale CREATE, intervening UPDATE,
deletion/recreation and controlled PostgreSQL concurrent writers. Known conflict
or serialization rollback is per-item failure; uncertain acknowledgement is not
a successful or safely retryable item. Keep the old apply mutation
for compatibility, and document its older semantics. No retry on uncertain apply.
At the existing form-fill REST route, add `fieldPolicies.schemaVersion: 2`. Local
UI always sends v2 (an empty fields array is valid); v2 preserves existing nonempty
fields by default and supports an explicit per-field overwrite flag. Preserve
absent/v1 policy semantics and the existing response envelope for eval and external
clients through the LM-008 window. Capture existing field occupancy/value internally
in the PDF extractor, reuse validator/filler and show reviewable per-field skipped/
conflicting outcomes. Test legacy absent/v1 overwrite and v2 preserve/explicit
overwrite across text, checkbox, radio, dropdown and single-list fields. Update
consumer/registry documentation; do not silently reinterpret v1. Add safe local failure
categories without leaking provider/configuration details. Literal preference search
is non-AI; useful smart search sits in preferences, replacing local Search Lab navigation.

## Checkpoints

Every checkpoint belongs to the same PR and ends with targeted green checks. Write
backend behavioral tests first, observe the intended failure, then make small changes;
do not rewrite existing tests merely to accept regressions. New scripts below are
planned commands, not claims that they already exist.

1. **Browser/session and shared composition.** Add adversarial HTTP/session unit and
   integration tests first; expected failures are missing separate session admission,
   token leakage prevention and combined listener. Implement secure bootstrap/session,
   root composition/launcher and bounded route dispatch. Target new
   `pnpm --filter backend test:local-ui` (Node test runner over built backend), existing
   `test:local-mcp`, `test:local-model`, backend build and root script unit tests.
2. **History and concurrent application contracts.** Add populated SQLite/PostgreSQL
   tests for event classification, legacy/archived data, transaction ordering, atomic
   clear rollback/preservation/concurrent append; then implement narrow UoW/service
   changes, GraphQL additions and document-apply conflicts/results. Run exact targeted
   Jest unit/local-database/integration files and schema generation/check; record file
   paths/commands in implementation evidence after tests are created.
3. **Existing UI and MCP management.** First add credential store/service stale-revision
   tests, maxima/revocation/secret-response assertions, then connect reusable clients/
   wrappers and confirmations. Add `pnpm --filter web test:local-ui` using real Chromium
   Playwright against owned production processes; no mocked authentication or DOM-only
   assertion substitutes. Run backend local-UI/credential tests, web build/codegen and
   authenticated no-model browser flows, shared UI/MCP reads/writes, history and grants.
4. **AI controls and retained workflows.** Add tests for options propagation, upload
   boundaries, preserve-existing form fill and error categories before implementation;
   then UI capability/cancel/status behavior. Use deterministic real HTTP inference
   fixtures for busy, unavailable/latch, deadline/disconnect, simultaneous UI/MCP and
   proposal validation. Run local model/MCP/UI suites and authenticated browser suite.
5. **Source/relocated, CI and closeout.** Extend gate phase/path-filter/ownership tests
   first, integrate Chromium installation/version and production browser suite into
   applicable standard CI and full gate. Exercise both source and relocated custom
   server from outside source with denied hosted egress. Update canonical docs/registry,
   freeze full diff, obtain fresh complete independent final reviews, resolve findings,
   run full gate/doc checks, push one draft PR and check both workflows on final head.

If a checkpoint exposes a material design change, pause affected implementation and
renew those reviews. Unaffected approved contracts are carried forward explicitly.

## Validation Matrix

All commands use Node 24.21.0/pnpm 10.25.0 and required Python 3.12. Activation was
`MIGRATION_GATE_BASE_SHA=5e2a67dd785500ba053b2e836c47166e8adeada8 pnpm migration:gate`.
The same exact-base command is required on the final candidate; export final JSON with
both a private owned RUNNER_TEMP and MIGRATION_GATE_CI_SUMMARY_PATH beneath it.

| Surface | Automated evidence | Manual evidence | Merge gate |
| --- | --- | --- | --- |
| Browser boundary | Real HTTP duplicate headers/Host/Origin/rebinding, absent/replayed/expired tokens, limits, session fixation/logout/restart, unauthorized shell/RSC canaries; two-port hostile page/cookie-native replay tests | Synthetic unlock/reissue/logout | Required |
| Offline/UI | Real Chromium on built Next with denied Auth0/hosted egress and absent hosted env, manual CRUD/schema/profile/search/export, accessible tabs/confirmations, no-model usability | Visual/keyboard acceptance of retained flows | Required |
| UI plus MCP | Same principal/state and model owner; cross-credential rejection; same-product instance IDs, effective limits, narrowing/stale grants and immediate revoke/rotate behavior | Bounded Claude Code/Codex CLI configuration using separate synthetic files | Required |
| Persistence/privacy | SQLite + PostgreSQL transaction tests, legacy v1→v2 preserving explicit upgrade, old audit records/archived definitions, clear second-delete failure, concurrent writers/append, live-state/provenance snapshots, restart/backup compatibility | History/memory distinction and restart | Required |
| Stale browser state | Delayed responses on both hidden/visible tabs, clear/logout/cross-window focus invalidation, no reappearance, uncertain mutation response with no automatic retry | Two-window synthetic check | Required |
| AI | Deterministic inference over real local adapter: supported formats, typed failures, document per-item conflicts, preserve-existing form fields, pre-read size, consent, cancel/deadline, one admission owner across UI/MCP, latch and non-AI use | Existing qualified model only with explicit user authorization; preserve E/H limits | Required where applicable |
| Runtime/build | Existing backend `test:unit`, `test:local-database`, `test:local-model`, `test:local-mcp`, schema check, web build/codegen; new `test:local-ui` commands; production source and relocated custom-server/browser evidence | Supported launch command | Required |
| Contracts/CI | Baseline checker and all affected manifest/filter/smoke tests; `node scripts/check-markdown-links.mjs`; `git diff --check`; full migration gate; standard CI and dedicated workflow final head | Human PR review, no merge by agent | Required |

Browser tooling adds a pinned Playwright development dependency and bounded browser
installation in CI, never a required installed-product network dependency. Browser
test network observations must fail on unexpected outbound URLs, plus backend/provider
network denial hooks; request interception alone is not proof of backend isolation.
Use owned ports/state/credentials/fixtures with lifecycle cleanup receipts and no
competing builds. Preserve historical tests until replacement is reviewed, not deleted
to make gates pass. Record actual source hash, commands, failure and pass evidence.

## Independent Review And Evidence

P2 is frozen for affected re-review once its SHA-256 is recorded in `reviews.md`.
P1 received changes-required findings A1 (raw upgrades), S1 (bounded authority),
PERSIST-01/02 (proposal and clear ordering) and C1 (form-fill versioning). P2
resolves these in the design and clarifies retained text formats and definition
semantics. No product code changed during review. Explicit
revision-bound approval is needed in all four dimensions before product edits.
Reviewer findings require behavior/trigger/consequence/source and disposition.
Implementation final review uses fresh agents and the full base-to-candidate diff.
Approval scope survives only documented unaffected deltas; security/persistence changes
require renewed review. Root does not approve its own work on reviewers' behalf.

| Revision | Reviewer/mandate | Finding/disposition | Approval |
| --- | --- | --- | --- |
| P1 | Four fresh reviewers; full verdicts in reviews.md | A1, S1, PERSIST-01/02, C1 accepted and amended in P2 | Changes required |
| P2 | Same reviewers, affected dimensions plus explicit carry-forward | Recheck pending | None |

## Parallel Work And Conflict Surfaces

Read-only review/investigation is parallel up to available slots. Root serializes all
repository writes, lockfile, schemas/generated clients, composition/strategy/module
registration, gate manifests/fixtures and CI. Tests own distinct resources; concurrency
tests intentionally share only their one isolated fixture. No development worktree.

## Privacy And Security

Browser bootstrap, browser session, local human-file identity credential, MCP instance
credentials and model bearer are five separate authorities. Only bootstrap and browser
session can reach browser memory by explicit exchange. No private credential in SSR,
RSC, URL, logs, error messages, telemetry or screenshots. Bind literal loopback and
validate both origin and bearer; MCP retains its independent browser-Origin rejection.
No required external DNS/Auth0/provider requests in local mode. Cloud MCP clients may
send selected retrieved data to their providers; manual acceptance must explain that
and use synthetic data. History is retained until explicitly cleared, not silently
aged; logical clear does not erase backups, transcripts or disk remnants.

## Rollback Or Recovery

Before any real-data operation the existing runbook's paired offline backup/recovery
rules apply. No automatic schema upgrade or reset. SQLite v2 remains required for MCP;
existing v1 uses the already-reviewed explicit preserving upgrade. New JSON metadata
is backward-compatible with Step 07, which will ignore it; legacy UI's older masking
is not a privacy-preserving replacement for this UI. Stop and await only the exact
owned application process; return to documented MCP-only/no-model or preview commands
using unchanged roots. Do not run competing model owners. A consumed inference claim
requires existing Step 06 manual recovery: stop/await both old processes, fresh model
session credentials, retain data/identity/MCP credentials. No browser action clears
that latch. Failed clear rolls back; committed clear is irreversible except an older
backup, which also restores old data and authority. No blind retries of lost writes.
Preparation recovery remains in the named stash; do not pop/reset/clean user changes.

## Risks And Open Questions

Review gates own unresolved issues: architecture reviewer verifies custom-server/drain
and module singleton closure; security reviewer verifies bearer/bootstrap/CSP and
cross-port threat; persistence reviewer verifies transactional event sensitivity and
clear ordering; compatibility reviewer verifies preserved baseline outcomes and actual
browser coverage. A blocker is resolved before affected implementation. Defaults in
this plan are proposals for review, not implicit prior approval.

## Exit Criteria And Closeout

All checkpoints/tests/reviews and final local gate pass on their documented inputs;
standard CI and dedicated migration workflow pass on final pushed head. One draft PR
contains preparation, plan, implementation, tests and docs. Provide a consolidated
bounded synthetic acceptance checklist only after automation/reviews are green, with
exact launch/stop/recovery instructions. Required human acceptance stays visibly pending;
no personal-client edits or live-model operations without authorization. Resolve manual
defects and renew affected evidence before readiness; never merge. Update orchestration
with observed merge only after a human merges. Retain this plan while downstream steps
need its contracts; do not activate those steps or create a receipt-only closeout PR.

## P3 Validation Budget Addendum

R8 head `1b86b68f0442d3e6dd311770a01761c30358dc15` passed standard CI and
the full local gate. Dedicated Linux run `37199274659` passed phases 1–10, then
the packaging command reached its exact `899999ms` effective phase timeout and
exited 124 after SIGTERM/cleanup. The log does not identify its last completed
internal boundary. Earlier R7 reached the final private-tree assertion near
855 seconds; R8's local complete packaging run took 477,811 ms. Step 08 adds a
web build/deployment, a larger sealed payload and authenticated browser generations.
The inherited Step 02 fifteen-minute bound needs explicit bounded headroom;
increasing it alone is not evidence of successful Linux behavior.

This is a shared validation-tooling deviation only. It does not change product
contracts, application persistence, browser/MCP authority, ownership, or supported
modes. P2's approved product scope and unaffected review coverage carry forward;
architecture, security/cancellation/privacy and compatibility/test reviews own
this addendum. Root remains sole writer with the previously recorded allocations.

| Bound | Revised value | Preserved margin |
| --- | --- | --- |
| Packaging phase | 1,500,000 ms / 25 minutes | All assertions remain; no retry |
| Sum of active phases | 104 minutes | Other phase allowances unchanged |
| Absolute preflight / phase cancellation | 3 / 107 minutes | Preflight plus phase sum |
| Absolute child settlement / final cleanup | 110 / 113 minutes | Three minutes each |
| Workflow gate step | 118 minutes | Five-minute hard-process fail-safe |
| Sum of workflow steps / job | 173 / 185 minutes | Twelve-minute overhead |

The manifest, semantic validator, exported packaging constant, monotonic timeline,
workflow and current documentation change atomically. Retain exact-value validation,
the 180-second packaging termination grace, 120-second packaging cleanup signal,
lazy three-minute final cleanup, all child-operation deadlines and non-cooperative
work retention. Do not widen by environment override, skip checks or retry failures.

Add at most one diagnostic line per member of a finite approved milestone set:
context preparation, build, seal, startup probes, each hosted generation, each
local mode, final runtime verification, cleanup start/completion, finalization,
and failure. Output only a fixed label and monotonic nonnegative integer elapsed
milliseconds. Reject unknown/duplicate labels and invalid clocks without echoing
input. A reporting failure must not bypass cleanup. No paths, identifiers, arguments,
payloads, error text or raw child output. Keep the bounded existing sanitized
capture; these lines aid the final failure tail, not live streaming or pass receipts.

Checkpoints:

1. Freeze this P3 revision and obtain affected, revision-bound approval. Update
   exact budget and near-deadline tests first; observe failure on the old bounds.
2. Apply the atomic budget changes and test the same deadlines, clamping,
   cancellation/settlement ordering and cleanup margins. Add milestone privacy,
   cardinality, clock and reporting-failure regressions before implementation.
3. Run the affected gate runner/phase/packaging/UI suites and Markdown checks;
   freeze R9 and obtain affected final reviews. Preserve unchanged application
   persistence and prior complete-diff review coverage explicitly.
4. Run the full local gate on frozen R9, record exact source/base/caller/cleanup
   evidence, push the same draft PR, and verify both workflows on the replacement
   head. Inspect packaging milestone timings in the Linux result. A further
   failure requires diagnosis rather than an automatic retry or another increase.

Required human acceptance remains pending; no ready-for-review or merge action is
authorized. Steps 09–11 and full MCP onboarding remain inactive.
