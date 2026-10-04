# Step 07: Local MCP

- Document status: approved plan P2; implementation in progress
- Program step: `07-local-mcp`; target branch: `main`
- Planning base commit: `cf18207e1197d0a1ffe5f598b5828c77c4711ad5`
- Branch/PR owner: `/root`, `codex/local-migration-07-local-mcp`; PR not yet opened
- Change classification: `shared` for explicit least-privilege scope normalization and redaction; additive `local-only` listener, credentials and composition
- Depends on: merged Steps 03, 05 and 06
- Planning owner, implementation owner, coordinator and sole repository writer: `/root`
- Risk profile: sensitive; a new authenticated listener, durable credentials/schema upgrade, disclosure and cancellation boundaries
- Plan reviewers: fresh architecture/lifecycle, security/persistence, and compatibility/tests/scope agents
- Intended PR count: one cohesive draft PR with three testable checkpoints
- Supported mode after merge: explicit `local-mcp` (no-model or selected manual model); all four existing modes retained
- Last updated: 2026-09-29

## Outcome

Claude Code and Codex CLI connect directly over Streamable HTTP to one manually started backend on literal `127.0.0.1`. Each configuration/instance has independent revocable authority for the same stable human principal. Existing six tools, schema resource and application services use SQLite; model-backed tools reuse Step 06 without hosted fallback. The backend survives either client's disconnection. Real assistant compatibility and selected-model acceptance are bounded user-run checks after automated validation.

## Required Reading

Follow root AGENTS startup. Read [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md), [workflow](../../../../useful/AGENT_WORKFLOW.md), [interface policy](../tracks/interface-evolution.md), [baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md) and its [registry](../../../../current/local-migration-contract-baseline.json). Preserve Step 05 [plan](../05-local-database-runtime/plan.md), Step 06 [plan](../06-local-model/plan.md), [selection](../06-local-model/selection.md), [implementation evidence](../06-local-model/implementation.md), [storage](../../../../current/STORAGE_BOUNDARIES.md), [identity administration](../../../../useful/LOCAL_IDENTITY_ADMIN.md), [model operation](../../../../useful/LOCAL_MODEL.md) and [MCP setup](../../../../useful/MCP_LOCAL_SETUP.md).

Inspect local/hosted compositions and entrypoints; MCP authorization, dispatch, tools/resources/access logs; SQLite schema/admission/backup; identity state coordination; AI ports/workflows/model owner; actual HTTP, local-database/model tests; baseline collector, gate manifest, CI and source/package smoke policies. No production dependency on historical feasibility code.

## Agent Allocation

All repository changes, including plans, Git and PR, belong to `/root`. Reviewers may read but cannot edit or run competing builds, databases, listeners or inference. Explicit child launch settings are observable; underlying serving internals are not independently exposed.

| Role/agent | Mandate and owned paths | Requested model/effort | Verified setting or limitation | Independent parallel work |
| --- | --- | --- | --- | --- |
| `/root` | Coordination, plan, implementation, tests, docs, Git; all changed paths | GPT-6 Astra Extra High | Parent model/effort not exposed by tools; no in-turn change claimed | Sole writer; checks serialized where resources overlap |
| `authority_discovery` | Read-only composition, identity, security, persistence | GPT-6 Astra Extra High | Explicit launch accepted; serving internals unknown | Completed discovery |
| `client_contract_discovery` | Read-only clients, consumers, compatibility | GPT-6 Astra High | Explicit launch accepted; serving internals unknown | Completed discovery; CLI help/version only |
| `lifecycle_discovery` | Read-only AI execution, HTTP cancellation, gate/lifecycle | GPT-6 Astra Extra High | Explicit launch accepted; serving internals unknown | Completed discovery and bounded transport follow-up |
| Plan/final review waves | Separate architecture/lifecycle; credentials/privacy/persistence; compatibility/tests/scope | Extra High; Extra High; High respectively | Plan wave: fresh `plan_architecture` plus independent prior discovery readers reused due thread capacity; none authored plan. Explicit launch settings retained; serving internals unknown | Read-only review; no shared test execution |

## Entry Criteria

Verified 2026-09-29: PR [#165](https://github.com/loyalagents/context-router/pull/165) is merged at the planning base, mergedAt `2026-09-29T00:18:59Z`. Final source head `f004702ef07df59f3cece36e0db0a79aea7055b7` passed [standard CI](https://github.com/loyalagents/context-router/actions/runs/36487182884) and [migration CI](https://github.com/loyalagents/context-router/actions/runs/36487183214). Refreshed `origin/main` equals the base; history is non-shallow and `git fsck --connectivity-only --no-dangling` passed. The original checkout was clean; this new branch starts exactly there. No development worktree/clone was created.

The full activation command was `MIGRATION_GATE_BASE_SHA=cf18207e1197d0a1ffe5f598b5828c77c4711ad5 pnpm migration:gate`, with Node **24.21.0**, pnpm **10.25.0**, Python **3.12.8** and an owned loopback PostgreSQL **15.19** container. The first attempt failed in phase 1 because installed dependencies lacked the pinned `pdfjs-dist` package. Its receipt remains `/private/tmp/step07-activation.qsTJ7X/local-migration-gate-summary.json`; no activation edits followed that failure. `pnpm install --frozen-lockfile --offline` restored the lockfile's dependencies without source/lock changes. The complete rerun passed before activation edits.

Passing receipt: `/private/tmp/step07-activation.z1gpFW/local-migration-gate-summary.json`; source/base both the exact SHA above, dirty=false; copied-input digest `01df8b3f6e2512193623f6d8f15d03da13b2f3f6df60a979aa7acfa218363e88`; baseComparison=performed; callerIntegrity=true; full mode; total **766,901 ms**. Owned database removed, administration clean, cleanupErrors empty. No production/shared database or unrelated process touched. Temporary paths are local receipts, not durable product inputs.

| Manifest phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | passed | 27,511 |
| documentation | passed | 1,424 |
| backend-unit-build | passed | 63,209 |
| backend-database | passed | 222,649 |
| local-orchestrator | passed | 6,340 |
| eval-fixtures | passed | 35,900 |
| eval-deterministic-scenarios | passed | 7,567 |
| web-production-build | passed | 28,117 |
| harbor-static | passed | 2,423 |
| restart-smoke | passed | 71,723 |
| packaged-composition-smoke | passed | 260,399 |
| repository-integrity | passed | 1,973 |

## Current Evidence

The local preview initializes Nest without listening; its graph includes unrelated APIs. Hosted McpModule imports Auth0/OAuth/DCR. Existing SQLite MCP tests use an in-memory transport and supplied authority; hosted HTTP tests override authentication. Neither proves this boundary. Empty/unknown scopes normalize to absent restrictions. AI workflows accept controls, but MCP tools do not pass them. Per-POST SDK servers cannot route later cancellation notifications to previous requests; SDK 1.27.1 also has falsy-ID/duplicate-ID hazards and pending JSON-response cleanup behavior that must not govern local cancellation.

CLI versions observed via help/version only: Claude Code **2.1.284**, Codex CLI **0.142.3**. Installed SDK **1.27.1** remains pinned by the existing lockfile; no upgrade. Support the SDK's HTTP-era protocol revisions **2025-06-18** and **2025-11-25** with negotiated version recorded per session. Override SDK initialize negotiation so older/unknown requested versions negotiate 2025-11-25, never the SDK default 2025-03-26; reject unsupported version headers and JSON-RPC batches. The older revision requires batching and is deliberately excluded locally; hosted behavior is unchanged. Test negotiation and rejection explicitly. These are not a claim of latest protocol support. [OpenAI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), [Claude HTTP MCP](https://code.claude.com/docs/en/mcp), [pinned transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [pinned cancellation specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation) were checked. Actual CLI negotiation remains manual acceptance.

## Scope

Add a narrow local composition, explicit CLI/admin entrypoint, real loopback HTTP authorization, durable per-instance credentials/policy, shared provider registration and bounded session/request ownership. Extend tests, LM-008 baseline/consumer records, CI/gate source and relocated smoke, canonical runbooks and one final manual checklist.

## Non-Goals

No stdio/bridge, LAN/tunnel, UI/OAuth cutover, installer/updater, automatic model installation/supervision, new runtime/model, cloud sync, hosted deployment changes or native Windows/Linux qualification. No broad domain redesign, generic transport framework, mutation retries or additional native experiments. Steps 08–11 remain inactive.

## Contracts And Compatibility

| Interface | Disposition and consumers |
| --- | --- |
| Application/use cases | Preserve definition/value resolution, validation, scope, provenance and atomic mutation/audit via existing services; no alternative business logic |
| Storage | Explicit exact SQLite v1→v2 adds only client credentials/policy; retain v1 and v2 admission for existing local previews, MCP requires v2; backup/restore includes v2 |
| Identity | Same verified stable local principal; MCP instance IDs distinct from product labels, human/inference tokens and session IDs |
| Model provider | Preserve Step 06 singleton aliases, one active operation/no queue, prerequisites, 180s workflow/120s operation/5s settlement, permanent uncertainty latch, E/H |
| GraphQL/REST | Hosted schemas/routes preserved; local listener exposes only exact `/mcp`, no GraphQL/upload/form/health/OAuth/DCR routes |
| MCP transport | Add local Streamable HTTP (JSON results, empty SSE on explicit cancellation), POST plus session DELETE, GET 405; hosted transport unchanged; no replay/resumption or server-initiated streams |
| MCP tools/resource | Preserve all six descriptors, six mutation operations and `schema://graphql`; add local-only `context-router://capabilities` with truthful static capability and bounded status, never paths/secrets |
| Authorization | Empty/missing/unrecognized token scopes intentionally become explicit empty capabilities; trusted internal optional narrowing remains optional. Local credentials always provide explicit policy and grants |
| Configuration/files | Explicit private database/identity roots and local port; optional explicit model selection only for `serve-model`; no ambient dotenv/hosted selection; new token exports exclusively created private files |

Move/check consumers together: hosted guard and scope tests, MCP descriptor collector and fixtures, actual HTTP clients, local identity/backup/schema tests, eval MCP agents, Harbor static policies, local-orchestrator contracts, web generated schema/history clients, fingerprint/dynamic/outbound baseline inventories, gate manifest/runner tests, CI and source/package smokes. Retain hosted configuration docs separately and give least-privilege migration guidance; no removal grace period for accidentally elevated unknown/empty scopes.

Minimal Step 07 dispositions: define-and-set remains two calls with explicit partial success; no combined transaction. Preserve envelopes and existing changed/no-op semantics (identical SET/UPDATE may still report changed). No restore or revalidation/migration of existing values after definition shape edits. Archive/replacement stays existing behavior. No rollback API; audit is atomic provenance, not undo. Access history keeps known operation, outcome, duration, correlation and opaque actor plus bounded counts/fixed codes only locally, never query/value/evidence/token/raw exception or attacker-chosen operation names. Per-call/session narrowing is deferred; persisted authority is reread per request. Database ALLOW cannot override capability/static/sensitivity denial. Rejected DCR redirect diagnostics become count/outcome only, with canary tests; DCR is unreachable locally.

## Design

### Composition and authority

Create a dedicated Nest application context with existing local configuration/identity/storage/model ports and only required preference/definition/workflow/grant/access providers. It does not install an HTTP API/GraphQL driver. A small `node:http` boundary owns the single literal-loopback listener and exact route. Extract the six tool/resource providers for reuse, not a plugin system. Package the tracked SDL as an asset; schema introspection does not imply a reachable GraphQL endpoint.

Authenticate before parsing a body. Require exact canonical `Host: 127.0.0.1:<bound-port>`, one Authorization header with strict token grammar, no duplicate security headers, no Origin (including `null`), no cookies/forwarded identity or browser CORS. Reject absolute/query/encoded route aliases. Bound body to 128 KiB, headers/timeouts/sockets and unauthenticated work. Reject incorrect origins/hosts with fixed responses and no diagnostics containing input.

Local credentials have random immutable instance IDs, random 32-byte secret, stored digest only, principal FK, positive generation, terminal revoked flag, validated bounded policy and optional nonauthoritative label. Use a distinct `cr_mcp_` token grammar and `local:` actor keys. Constant-time secret-digest comparison follows bounded exact lookup. Product names, initialize metadata, arguments, session IDs and human/inference tokens cannot confer authority. Verify local identity/target at startup/admin operations; each HTTP admission reads current credential/policy and verifies the stored principal belongs to this local identity. No session authority cache.

Administrative commands: `upgrade`, `provision`, `list`, `rotate`, `revoke`, `permissions`, `grant`, plus thin `backup <new-bundle>` and `restore <bundle> <new-root>` wrappers around the existing SqliteBackup mechanism; `serve` and `serve-model` start the listener. Default READ capability has **empty target allowlist** and `allowSensitive=false`. Assign explicit targets/capabilities through local admin; WRITE implies SUGGEST/READ, DEFINE remains independent. Static targets apply to each chained action; database grants narrow further. Sensitive definitions/values are excluded before AI and output. Value/suggestion/delete/result filtering checks the actual stored `definitionId`, including archived definitions, and fails closed if the definition is missing; a current slug winner or replacement never substitutes for this check. Catalog/AI schema filtering conservatively denies duplicate visible slugs if any included definition is sensitive. Mutation checks cover actual previous definitions and requested sensitive flags, so declassification cannot bypass denial. Tests cover archived-sensitive values, nonsensitive replacements with the same slug, global/personal collisions, suggestions, writes and AI outputs. Admin can explicitly permit sensitive access. Keep hosted policy unchanged when local-only fields are absent.

### Persisted state and races

Keep immutable v1 DDL. Define exact v2=v1 plus one credentials table; reject mixed/unknown schemas. `upgrade` verifies initialized identity, then executes one zero-wait `BEGIN EXCLUSIVE`, revalidates v1 under the lock, adds table and sets user_version=2 atomically; repeat on valid v2 reports already upgraded. No automatic conversion at listen. Never read/hash/copy the main database through raw filesystem descriptors while native handles or coordination workers exist.

Provision/rotate creates and fsyncs a fresh exclusive 0600 token file under validated pinned 0700 private ancestry, then fsyncs its directory **before** committing the digest/generation. Never overwrite an export. Export failure leaves old authority unchanged; failed commit may leave an inert private file. After lost acknowledgement, list generation/status and retry using a fresh export path; no secret prints. Rotation retains instance identity and database grants; revocation is terminal/idempotent. Rotation/revocation condition their single update on the observed active generation; successful credential changes increment it monotonically. A concurrent loser cannot overwrite a winner or reuse its generation and receives a fixed conflict without retry, leaving any export inert. Policy/grant commits likewise condition active generation in the same transaction and cannot revive revoked clients. Test independent-process rotate/rotate, rotate/revoke and policy/revoke races with deterministic barriers. Existing live sessions reauthenticate every request.

Admission linearizes at the final successful credential read. A committed rotate/revoke rejects subsequent admissions; already-admitted bounded work may finish and commit its audit. Do not hold a SQL transaction across model/HTTP awaits, claim rollback after disconnect, or cancel/undo committed mutations. Test ordered barriers around admission, revocation and commit. The supported backup/restore CLI wrappers require all original runtime/admin processes stopped and reaped, invoke the existing SqliteBackup implementation, and restore only to a fresh absent root. Source and relocated tests prove pre-upgrade v1 backup and v2 backup/new-root restore. Matching-pair backup/restore captures credentials, policies and revocations; restoration revives the authority in that backup and requires subsequent rotation/revocation review. Old binaries reject v2. Rollback uses compatible code or a pre-upgrade matching backup restored into new private roots; never downgrade/delete live data.

### Protocol, cancellation and lifecycle

Use the SDK Server for validation/dispatch with fresh immutable context per POST. A small local HTTP adapter will implement the SDK Transport callbacks directly to avoid SDK HTTP pending-response/cancellation bugs; this is the only local transport, not an extensibility framework. Independent plan review must approve this boundary. Session registry issues random IDs on initialize, binds each to verified instance/generation/principal and negotiated protocol, requires them subsequently, and reserves requests before dispatch. Limits: 64 sessions total/8 per client, 32 active requests total/8 per client, 4096 seen request IDs per session, 30-minute idle expiry; never evict active work or clear seen-ID history to reuse a session. Retained IDs are safe integers (including zero) or strings of at most 128 UTF-8 bytes (including empty); reject overflow/fractions/nonfinite numbers before retention. Session IDs are exactly 43 base64url characters; total HTTP headers are capped at 16 KiB. Tests include boundary lengths, overflow and numeric/string distinction. Cancellation notifications and authenticated DELETE retain a control path when normal execution quotas are saturated, while still enforcing ingress/auth/body bounds. Exact typed IDs preserve `0`, empty strings and numeric/string distinction. Duplicate or reused IDs reject; foreign/unknown/completed cancellations and attempts to cancel initialization do nothing. Overflow requires new initialization.

Cancellation notification, authenticated DELETE and shutdown abort only the matching local execution controller. Explicit cancellation completes the original POST with HTTP 200 and an empty `text/event-stream` response, emitting no JSON-RPC result; its notification POST returns 202. Ordinary responses remain JSON. Request ownership remains until the matching terminal SDK result/error witnesses handler settlement; late output is discarded. This witness does not prove native model settlement: the existing adapter retains its admission/latch independently, and shutdown also awaits adapter destruction. Never close the SDK server before this witness. Validate Accept/Content-Type, envelope, negotiated version and initialized session state explicitly. Reject unsupported outgoing SDK requests; outgoing notifications do not count as settlement. Test empty-SSE EOF, client onerror silence, HTTP reader completion and cancellation/publication races. Track and test actual handler completion, response/socket close and session retirement, not just client rejection. Disconnection alone retains the admitted deadline and discards undeliverable results under the pinned protocol; it never stops the shared app or inference process. Deadline controls flow via McpContext to existing workflows only when the local model supports strict controls; hosted and no-model calls preserve existing behavior. A bounded outer request watchdog handles failed dispatch without implying mutation rollback: abort its execution controller, end the response with a fixed failure, and retain ownership until an actual terminal handler witness. Never free quota or reuse IDs merely because the watchdog fired. Shutdown waits within its outer bound and exits with fixed failure if live work cannot be accounted for.

One shared Step 06 model owner serves every client and both AI tools. Busy is immediate, never queued; no cancellation/reconnect/revoke clears claims/latches. No-model remains usable for non-AI work and reports fixed unavailable when inference is needed. Capabilities resource does not probe at initialization; status checks obey manual readiness prerequisites and bounded controls. SIGINT/SIGTERM stop admissions, abort active AI, await settlement/close with a ten-second outer shutdown bound, then report fixed failure if incomplete. Never signal the manually launched inference process. Port-conflict/startup failures close acquired resources. E accepts only the known email omission; H may require stopping and reaping both old processes and creating fresh model-session credentials, preserving database/identity/MCP data.

## Checkpoints

### Post-acceptance amendment: bounded session recovery

External review of `d7e9d65` found that abandoned same-generation sessions can block initialization for 30 minutes, and retained-ID exhaustion returns an unrecoverable sequence of HTTP 400 responses. Keep all existing numeric bounds, authentication and admission linearization. Under either the global or per-client session limit, a valid initialize may retire only its own credential's least-recently-used session with no active work. Retire the complete session and its ID history; the old session ID subsequently returns 404 and the replacement gets a fresh random ID. Never evict another credential's session or a session with active work. If no eligible session exists, return 429. Check active-request capacity before reclaiming an idle session, so a rejected initialize does not evict usable state.

Within a live session, duplicate IDs still return 400. A new ID beyond the 4096 retained-ID bound marks the session closing and returns 404, signaling fresh initialization. The rejected request is never dispatched. Keep already-admitted work and all its quota until terminal handler settlement, then prune the closed session. Retirement does not cancel or retry admitted work; its original response may finish normally. Subsequent requests, cancellation notifications and DELETE using the retired ID return 404. Cancellation/DELETE remain available on live sessions under ordinary request-quota saturation. Recovery does not guarantee automatic reinitialization by every client, nor does it imply rollback or authorize retrying an uncertain mutation.

Checkpoints: (1) obtain affected architecture/lifecycle, authority and compatibility review of this amendment; (2) write failing real-HTTP regressions for same-client LRU recovery, global-limit isolation, active-quota rejection without eviction, and retained-ID retirement with concurrent active work; (3) implement the narrow transport changes, run the focused lifecycle suite and complete local-MCP suite, and update operator guidance; (4) freeze the candidate, obtain affected independent implementation verdicts, run the complete exact-base migration gate and Markdown/diff checks, and renew both exact-head CI workflows. Carry forward unchanged full-diff reviews and prior manual acceptance with their original revision and limitations. These transport-boundary changes do not require another native-model experiment; deterministic tests must demonstrate the new lifecycle behavior without claiming new Claude/Codex recovery observations. Preserve the user's unrelated acceptance-checklist edit.

All checkpoints belong to the same PR. A material deviation requires affected independent review before further implementation.

### Checkpoint 1: Listener, durable credentials and negative authority

Write failing compiled/local-database tests first for absent admin/upgrade/guard/listener. Implement explicit schema upgrade/export and narrow local assembly, auth boundary, bounded sessions and least-privilege token normalization. Prove two same-product clients, missing/wrong/malformed/revoked tokens, route/Host/Origin/body negatives, rotation/revocation/policy persistence, upgrade interruption/lock/unknown schema and identity preservation. Run targeted unit suites, backend build and new compiled `test:local-mcp` with isolated owned fixtures. Existing previews stay runnable; local read-only discovery works after explicit upgrade/provision.

### Checkpoint 2: Non-AI vertical contracts and history

Tests first for all six mutations, read/search/schema, capability/target/grant/sensitivity combinations, audit rollback/access-log failure, actor/correlation isolation, revocation admission races, restart and v2 backup/restore. Reuse services and descriptors, add safe logs and DCR redaction. Run affected MCP/auth contracts, local-database and compiled real-HTTP suite. Preserve LM-008 fixtures and record local additions/intentional normalization change. Supported no-model local read/write is now demonstrated.

### Checkpoint 3: AI controls, packaging and closeout

Tests first using deterministic authenticated fake peers for actual HTTP AI, filtered input, busy cross-client/tool admission, control propagation, IDs/cancellation/deadlines/disconnect, latch/non-AI survival and shutdown. Add source and sealed relocated smoke with exact-loopback-only policy, DNS/nonloopback/provider-import negative controls in CJS/ESM/workers, hostile CWD/dotenv, two generations and lifecycle journal cleanup checks. Extend existing twelve gate phases/CI with explicit local-mcp suite and mode; retire no coverage. Update canonical docs and one user-run acceptance checklist. Freeze complete diff, independent final reviews, full final local gate, Markdown and diff checks, push one draft PR and verify both exact-head workflows.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Unit/authorization | Targeted Jest MCP/auth suites; `pnpm --filter backend test:unit` | None | Yes |
| HTTP/state/AI | Built `pnpm --filter backend test:local-mcp`, real production guard and file-backed SQLite; deterministic TLS model peer | Real clients after agent gates | Yes |
| Retained database/model | `pnpm --filter backend test:local-database`, `test:local-model`; gate PostgreSQL/e2e | No repeated native benchmark | Yes |
| Contracts/consumers/build | Full `pnpm migration:gate`, all 12 phases and manifest modes; baseline/Markdown/CI filters | No Vercel substitute | Yes |
| Clean install/restart | Source and sealed relocated smoke; owned resource journal; two generations | Same-checkout command checklist | Yes |
| Upgrade/recovery | Populated v1 upgrade, pre/postcommit interruption, busy/schema/corruption, v2 matching backup/restore, old-code rejection | No real user data | Yes |
| Final evidence | Exact-base local gate, `git diff --check`, Markdown link check, standard and migration CI on final pushed/tested candidate | Claude/Codex simultaneous reads/writes/denials/revoke/restart; bounded model/unavailable/H | Yes |

## Independent Review And Evidence

Bind review verdicts to a SHA-256 of this plan and described changed areas; retain affected rechecks, explicit impact assessments and fresh final complete-base-to-candidate reviews. Documentation approval is not product implementation approval until all blocking plan findings resolve.

| Revision | Reviewer/mandate | Finding and disposition/evidence | Approval or required recheck |
| --- | --- | --- | --- |
| P1 `191a716b…` | `client_contract_discovery`, High | REQUEST CHANGES: 2025-03-26 batching unsupported by the single-request design. P2 restricts local versions and requires explicit negotiation override/tests. Other compatibility/scope areas approved. | Affected P2 protocol recheck required |
| P1 `191a716b…` | `authority_discovery`, Extra High | REQUEST CHANGES: actual-definition sensitivity, concurrent admin generation rules, runnable backup prerequisite. P2 adds exact checks, CAS/race evidence and existing-mechanism CLI wrappers. Other security/authority areas acceptable. | Affected P2 recheck required |
| P1 | `plan_architecture`, Extra High | REQUEST CHANGES: protocol batching gap and retained-ID byte bound. P2 addresses both, ignores initialize cancellation, retains ownership on watchdog expiry and keeps saturated cancellation control available. | Affected P2 recheck required |

P2 SHA-256 `6f387e31b88c2b9dbb076ba8ad33f8fd05e276a6ecb54a2752ee70ca57e8283c` received explicit **APPROVE** from `plan_architecture` (Extra High, architecture/protocol/lifecycle), `authority_discovery` (Extra High, credentials/privacy/persistence) and `client_contract_discovery` (High, compatibility/tests/scope). Each rechecked the affected amendments and explicitly carried forward unaffected areas. All were read-only with no test execution. This evidence-only status update does not change the reviewed design. Product implementation may proceed; final implementation reviews remain required.

Implementation checkpoint evidence and spot-review dispositions are in [implementation.md](implementation.md); the consolidated final user-run checklist is [acceptance.md](acceptance.md). Final complete-diff verdicts and gate/CI receipts belong in the draft PR against its exact candidate.

## Parallel Work And Conflict Surfaces

Only read-only investigation/review is parallel. Root owns schema/credentials, composition/MCP, tests, gate/CI, baseline and all docs/Git. Serialize shared builds; every test fixture owns private roots, ports and database. Final reviews may overlap validation only on a frozen candidate. Gate-managed validation copies are allowed; development stays in the user's existing checkout and branch.

## Privacy And Security

Loopback alone is insufficient: exact Host, rejected Origin, strict bearer, no cookies/CORS, route and input bounds are tested. Local administrator/filesystem ownership remains the platform trust boundary; this is not protection against the same OS user's unrestricted process access. Tokens are never printed, passed as CLI arguments or stored in Git. Human and inference credentials never become MCP tokens. Logs and access metadata exclude query/value/evidence/redirect/secret canaries. Application egress is independently instrumented; cloud-backed Claude/Codex may send synthetic tool results to their providers, so compatibility is not an offline-assistant claim.

## Rollback Or Recovery

Stop the backend normally; retain identity/database roots and client export files. Before schema upgrade take the existing matching-pair backup with originals stopped/reaped. v2-aware code can run old no-listener modes; pre-step code requires a matching pre-upgrade backup in new roots, losing only post-backup changes by explicit operator choice. Never delete/downgrade canonical state. Restore may revive old credentials; review/rotate them before exposing MCP. Uncertain token publication is resolved by listing generation/status and fresh-path rotation. Model H recovery replaces only fresh model-session credentials after both processes are stopped/reaped, never claims/latches in place.

## Risks And Open Questions

Root must demonstrate the small HTTP transport's standards/lifecycle behavior through independent review and actual SDK HTTP tests; if that design changes, re-review it. Claude/Codex actual negotiation/assistant behavior cannot be inferred from help or SDK tests and remains the final manual check. No unresolved product decision blocks the agreed scope.

## Exit Criteria

Reviewed implementation, tests, all gate phases, fresh full-diff reviews and exact-head CI pass. Canonical runbooks and the consolidated synthetic acceptance checklist are complete. Keep draft/status **automated validation passed; manual acceptance pending** until user evidence arrives; then resolve defects and rerun affected checks/reviews before ready-for-human-review. Step 07 is not complete until required acceptance and human merge. No automatic merge.

## Closeout

After human merge, update orchestration with PR/outcome and retain only downstream-needed planning material. Step 09 owns platform packaging, managed lifecycle and cancellation-reliability follow-up; Step 08 owns UI, Step 10 LAN. Do not activate them here.
