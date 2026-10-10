# Step 09 Consumer And Provisioning Inventory

- State: P2 map captured before edits; managed admission/build/P1 sources now registered, remaining product entrypoints added with implementation
- Owner and sole writer: `/root`
- Baseline: six supported modes, twelve phases, 41 capability decisions, 57
  static GraphQL consumers, 9 dynamic consumers, 31 fingerprint consumers,
  136 contract references and 58 outbound sink source files before Step 09
- Gate: register actual new paths/fingerprints with their implementation and pass
  the baseline checker; this document does not claim implementation is complete

## Existing Consumers Preserved

| Boundary | Existing consumers | Treatment |
| --- | --- | --- |
| Shared local UI/MCP | `apps/web/local-ui.mjs`, backend local UI/MCP compositions and application services | Managed mode adds inherited control/admission; ordinary manual mode preserves behavior |
| Local identity/storage | `local-identity`, `local-mcp`, `local-ui`, direct SQLite/identity/backup entrypoints and coordination worker | Preserve unmanaged roots and tests; reject reserved managed roots without the role-bound inherited capability |
| Model | LocalModelService shared by both AI tokens, UI capability/status and MCP tools/resources | Gate loading before claim; keep one owner, irreversibility, deadlines and E/H |
| PDF parser | LocalModelService/PdfProcess and its actual staged worker | Managed FD3 inheritance only; existing file formats/limits/cancellation unchanged |
| Browser | Existing dashboard, one-use unlock, independent browser session, Host/Origin/CSRF checks | Native display/copy transports only the existing unlock code; no new HTTP lifecycle endpoint |
| External MCP clients | Manual Claude Code/Codex setup and other least-privilege HTTP clients | Endpoint/tool/resource/credential contracts retained; no personal config edits or automatic setup |
| Hosted/operator | Hosted composition, deployment runbooks, Auth0 and PostgreSQL references | Retained source/operator reference coverage; absent from managed runtime selection |
| Developer/evaluation | Local orchestrator manifest v3/filter/reconciliation tests, deterministic eval, Harbor static checks | Source/reference tools retained; no installed product exposure or opt-in policy expansion |
| History/reset | Event-time masking, whole-history clear, Clear memory and audit atomicity | Preserved; no new reset, record rollback or retention scheduler |

Current source/manual binaries gain an admission denial only for the newly reserved
managed namespace. Historical binaries do not enforce this guard; never use them
concurrently on managed data. Do not silently adopt/move an existing manual pair.
An explicit quiescent matching backup and restore into a new managed store is the
supported import route. Preserve external state and all previous evidence limits.

The Candidate 12 upload correction adds `POST /api/local/session` alongside the
unchanged capabilities route. Its sole consumer is automatic dashboard session
revalidation on focus/pageshow/visibility; it returns only non-renewing remaining
lifetime through the same browser security boundary. The central frontend
transport registers that exact destination. Initial/restored sessions and explicit
model checks retain capabilities qualification; completion/cancellation no longer
launch background model checks. This is an additive private browser contract, with
no GraphQL/MCP/schema or native lifecycle API change. A complete app replacement
updates backend/frontend together; code rollback restores the prior pair without
changing stored state or browser credential format.

## New Entry Points And Trust Inputs

Proposed concrete sources are `apps/desktop/native/menu.m`,
`apps/desktop/native/guardian.m`, `apps/desktop/src/prepare.mjs`,
`apps/desktop/src/download.mjs`, `apps/desktop/src/admin.mjs`,
`apps/desktop/src/package.mjs`, and the backend shared managed-admission module.
Their final source fingerprints and actual call counts belong in the registry.
Do not create a new public GraphQL/MCP contract simply to represent native control.

| New actor | Inputs/authority | Allowed effects |
| --- | --- | --- |
| AppKit menu | Fixed user actions, validated guardian status and private unlock export | Open literal-loopback dashboard; deliberate display/copy; private lifecycle pipe |
| Guardian/installed CLI | Own bundle metadata, explicit canonical root, fixed modes/validated admin arguments | Bundle verification, lifetime lock/journal, exact child spawn/signal/reap, role capabilities |
| Finite prepare | Fresh role-bound FD4 message plus lifetime FD3 | Classified first run or verify existing pair, explicit accepted upgrade, fresh session material |
| Combined application | Selected-pair capability; private generation control | Existing UI/MCP services, scoped storage; public TLS readiness before model claim |
| Coordination worker | Explicit validated workerData/admission plus shared FD and atomic stop flag | Existing scoped identity/SQLite coordination; no environment authorization |
| Model and PDF children | FD3 only plus existing private credential/file inputs | Existing inference/parser behavior; no storage capability or native lifecycle command |
| Downloader | Fixed pinned asset descriptor, explicit consent, FD3 and owned stage | One bounded HTTPS transfer, exact digest/size verification, no-clobber publication |
| Offline admin | Same guardian exclusion, selected or specifically pending pair | Existing credential/backup/recovery operations and explicit restore cutover |
| Packaging | Trusted checkout/source receipt and authenticated pinned runtime inputs | Absent output `.app`, complete inventory/licenses and external artifact digest |

## New Outbound And Process Sinks

- Native fork/exec/posix_spawn and any Foundation task launch: fixed bundle entrypoints,
  no shell, no arbitrary browser command, exact retained child authority.
- Native browser URL opening: validated `http://127.0.0.1:<owned-port>` only, no
  secrets/credentials in URL. Browser itself is a separate user application.
- Download HTTPS: pinned immutable Hugging Face model URL and explicitly allowlisted
  redirects; payload is only normal artifact request metadata, never user state.
  No request before explicit model consent, no fallback provider, no automatic retry.
- Public readiness and existing authenticated inference requests: literal-loopback
  pinned TLS only. Reuse existing client; register added readiness source references.
- Packaging/build subprocesses: contributor/CI activity, not installed runtime
  network traffic. No user Node/pnpm/compiler/OpenSSL requirement in the artifact.

Extend collector roots and native sink vocabulary as specified by P2. A negative
fixture must fail for a newly unregistered native spawn/network call or JavaScript
download. Preserve previous discovery scopes; generated native output alone is
excluded. Offline installed proof and source review supplement this bounded scanner.

## Step 09 Dispositions

Retain hosted/operator and developer/evaluation code as explicit references while
removing them from the installed product selection/payload. Their existing commands,
manifest-v3/correlation/dry-run/partial-reconciliation and deterministic tests remain.
No separate product bulk-import format is justified by packaging: matching-pair
backup/restore fulfills this step; future bulk import remains a separately scoped
product decision. No new dedupe/resume/retry/run-history framework is inherited.

Preserve existing history and reset decisions. Retain no product telemetry by default;
resolve transitive offline audit through actual packaged network denial and inventory.
Do not mark that audit passed from an empty PATH or source-only inspection. Harbor
live evaluation stays explicit contributor opt-in and outside the installed app.

The implementation updates corresponding evidence/dispositions and adds its registry
migration record with before/after fingerprints, compatibility window and rollback
procedure. Existing public contracts are preserved, so any unexpected GraphQL/HTTP/
MCP fingerprint change must be investigated rather than accepted as packaging churn.
