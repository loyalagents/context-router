# Step 04: Storage Boundaries

- Document status: implementation complete and independently approved; final-head aggregate evidence tracked with the implementation PR
- Program step: `04-storage-boundaries`
- Target branch: `main`
- Planning base commit: `311f5a09b9b1ee5d43717296fbb49e7d45feda5e`
- Working branch: `codex/local-migration-04-storage-boundaries`
- Planning and implementation owner / sole repository writer: `/root/storage_writer`
- Coordinator: `/root`, repository-read-only
- Change classification: `local-only`; `hosted-v1-maintenance` is untouched
- Depends on: human-merged Step 03 PR [#162](https://github.com/loyalagents/context-router/pull/162), merge `1b35c7c513b01a183bb740f0596273baf7620a10`
- Risk profile: sensitive / quality-first because transaction ownership, persisted identity, concurrency, and crash recovery must survive a cross-cutting refactor
- Plan reviewers: fresh independent architecture/scope, persistence/recovery, security/privacy, compatibility/consumers, and test/gate reviewers; approved on draft A
- Implementation PR: [#163](https://github.com/loyalagents/context-router/pull/163), the single Step 04 implementation PR
- Intended PR count: one, with five internal testable checkpoints
- Supported modes after merge: retained `hosted-baseline` and explicit non-listening `local-identity-preview`, both backed by the PostgreSQL reference adapter
- Last updated: 2026-09-23

## Outcome

Application services, domain data, and transport DTOs depend on application-owned storage behavior and transaction scope rather than Prisma, PostgreSQL query shapes, generated enums, or driver errors. PostgreSQL remains the working reference adapter behind those contracts. Reusable real-adapter tests preserve existing mutations, audit, identity, reset, catalog, and recovery behavior so Step 05 can implement a second adapter against observable requirements. The production seed entrypoint creates catalog definitions only and no longer creates sample users.

## Required Reading

- Root [`AGENTS.md`](../../../../../AGENTS.md), [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md), every file in [`docs/IMPORTANT/`](../../../../IMPORTANT/), and `./print-repo-structure.sh`
- [`../orchestration.md`](../orchestration.md), [`../decision-log.md`](../decision-log.md), [`../agent-execution.md`](../agent-execution.md), [`../step-template.md`](../step-template.md), [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md), and [agent workflow](../../../../useful/AGENT_WORKFLOW.md)
- Step 03 [`README.md`](../03-local-identity/README.md) and complete retained [`plan.md`](../03-local-identity/plan.md), including R1
- [Human contract baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md) and [executable registry](../../../../current/local-migration-contract-baseline.json)
- [Preference schema](../../../../current/PREFERENCE_SCHEMA.md), [audit/access history](../../../../current/AUDIT_AND_ACCESS_HISTORY.md), [reset](../../../../current/DATA_RESET.md), [MCP authorization](../../../../current/MCP_AUTHORIZATION.md), and [local identity administration](../../../../useful/LOCAL_IDENTITY_ADMIN.md)
- Actual backend repositories/services, local identity state/codec/filesystem/adapter, hosted/local composition, Prisma schema/migrations/seed, relevant unit/integration/e2e/contract tests, and the migration gate/manifest/package/restart scripts

Historical documents do not override landed code. Step 03's full recovery plan remains because Steps 04–05 depend on it.

## Agent Allocation

| Role / agent | Mandate and ownership | Requested setting | Runtime verification | Parallel work |
| --- | --- | --- | --- | --- |
| `/root` | Coordinate decisions/evidence; no repository writes | GPT-6 Astra Ultra | Current parent model/effort is not independently exposed; no downgrade requested or claimed | Read-only orchestration |
| `/root/storage_writer` | Sole writer of branch/worktree, plan, docs, tests, code, staging, commits, push and PR | GPT-6 Astra Extra High (`xhigh`) | Explicit supported model/effort request accepted by agent runtime; serving internals not independently exposed | Critical design and implementation stay with this writer |
| `/root/consumer_discovery` | Persistence consumers, generated types, public consumers, tests, catalog, and gate inventory | GPT-6 Astra High | Explicit request runtime-accepted; no independent serving verification | Read-only discovery, completed |
| `/root/recovery_discovery` | Transaction/identity coordination and failure/recovery contracts | GPT-6 Astra Extra High | Explicit request runtime-accepted; no independent serving verification | Read-only discovery, completed |
| `/root/architecture_review` | Fresh architecture/scope review | GPT-6 Astra Extra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only review |
| `/root/persistence_review` | Fresh persistence/recovery and security/privacy review | GPT-6 Astra Extra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only review |
| `/root/compatibility_review` | Fresh compatibility/consumers and tests/gate review | GPT-6 Astra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only review |
| `/root/final_architecture_review` | Fresh complete-diff architecture/scope review | GPT-6 Astra Extra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only final review, approved |
| `/root/final_persistence_review` | Fresh complete-diff persistence/recovery and security/privacy review | GPT-6 Astra Extra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only final review, approved |
| `/root/final_compatibility_review` | Fresh complete-diff compatibility/consumers and tests/gate review | GPT-6 Astra High | Explicit supported request runtime-accepted; serving internals not independently exposed | Read-only final review, approved |

No effort downgrade is inferred from a prompt. Mechanical work remains on the configured sole writer unless the runtime supports an explicitly verified change; no second writer or ownership churn is created to change tiers.

## Entry Criteria And Evidence

- Step 03 PR #162 is verified `MERGED` on GitHub at the merge SHA above, from final tested head `cfe3b63786e729e60fd6f954c172db86487bebd4`. Standard CI [35899268852](https://github.com/loyalagents/context-router/actions/runs/35899268852) and dedicated migration gate [35899268881](https://github.com/loyalagents/context-router/actions/runs/35899268881) both completed successfully on that exact head.
- Fresh `git fetch origin main` resolved the planning base to the user-observed SHA; no newer base delta exists. Step 03 merge is an ancestor. History is non-shallow and `git fsck --connectivity-only --no-dangling` passes.
- Existing main checkout was clean and preserved. The dedicated clean worktree is `/private/tmp/context-router-step04`; its branch, HEAD, `origin/main`, and merge base agreed before activation. No existing branch/worktree was reset, overwritten, or removed.
- No Step 05/06 or other implementation lane is activated. This writer owns storage/composition/tests/registry/docs hotspots; all other task agents are read-only.
- Exact runtime: Node `24.21.0`, pnpm `10.25.0`, Python `3.12.8`, PostgreSQL `15.15`. Installed dependency trees were privately cloned using the existing gate helper; no shared mutable dependency tree is used.
- Before any activation/product edits, the clean-base `MIGRATION_GATE_BASE_SHA=311f5a09b9b1ee5d43717296fbb49e7d45feda5e pnpm migration:gate` passed all twelve phases on 2026-09-23. The external summary records 579,296 ms; the final console after evidence finalization records 579,662 ms. `baseComparison=performed`, caller integrity true, no failure or cleanup error.
- The administration fixture was an independently named/labelled cached PostgreSQL 15 container with tmpfs data and one random loopback-only publication. The gate removed its generated database and private workspace/diagnostics; the wrapper reverified the exact container ID/ownership label, stopped it and confirmed automatic removal. Existing Step 03/shared resources were untouched. No downloads, production DB or live hosted provider were used.
- Local evidence is retained outside the repository at `/private/tmp/step04-activation-evidence/activation.log`, `local-migration-gate-summary.json`, and `activation-fixture.json`. No local path or sanitized summary substitutes for final pushed-head remote evidence.

| Activation phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | Passed | 27,971 |
| documentation | Passed | 1,462 |
| backend-unit-build | Passed | 27,993 |
| backend-database | Passed | 124,641 |
| local-orchestrator | Passed | 6,431 |
| eval-fixtures | Passed | 41,023 |
| eval-deterministic-scenarios | Passed | 7,728 |
| web-production-build | Passed | 29,373 |
| harbor-static | Passed | 2,503 |
| restart-smoke | Passed | 63,528 |
| packaged-composition-smoke | Passed | 207,376 |
| repository-integrity | Passed | 2,175 |

Activation was local macOS arm64 evidence; Linux candidate CI and hardware/Windows limitations remain as stated in the validation matrix.

## Planning-Base Evidence

The existing repository class names do not imply neutral boundaries. Services call `PrismaService.$transaction`, pass `Prisma.TransactionClient`, construct Prisma filter objects, and inspect `P2002` / `P2034` / `40001`. `prisma-models.ts` owns plain-looking rows but imports generated enum types; DTOs, GraphQL models, validation, snapshots, MCP and document/workflow code import those types transitively. Local identity's nominal repository port returns the concrete PostgreSQL session and its state service imports both concrete classes.

Verified behavior to retain:

| Area | Observed contract |
| --- | --- |
| Mutations/audit | Active set, suggestion upsert, acceptance, rejection, deletion, and definition create/update/archive each commit mutation plus audit in one default-isolation transaction. Validation and most ownership reads precede it. Accept writes active, deletes suggestion, writes audit; reject writes tombstone, writes audit, deletes suggestion. |
| Access history | Best-effort request logging occurs outside mutation transactions; logging failure cannot undo or mask the committed domain mutation/audit. |
| Preferences | Unique `(user, context, definition, status)`; undefined location query means all, null means global, string means exact location. Active merge overrides by definition ID; suggested union does not merge. Updated-time descending order has unspecified ties. |
| Definitions | Live `(namespace, slug)` uniqueness is partial on unarchived rows. Archive preserves old rows and frees live slug reuse. Personal lookup precedes global. Lists sort by slug only; archived lookup sorts updated time only. |
| Locations/grants | Location upsert is read-then-create/update and has no uniqueness guarantee for concurrent first writes. Grant upsert uses its exact unique key; list ordering includes the existing enum declaration order rather than alphabetical action order, and application specificity/deny rules are retained. |
| Histories | Current-user AND filters, inclusive date bounds, `(occurredAt DESC, id DESC)` cursors, existing trim rules and malformed-cursor errors. |
| Reset | One default-isolation transaction, preferences first, cross-user definition-reference conflict rolls back prior deletes, mode-dependent counts/deletes, identity/account/provider bindings always retained. |
| Human identity | Strict envelope/key validation; R1 independently omits malformed supported hints. Exact key only; five fresh serializable attempts; final unique-only exact-winner lookup; no email linking; first-creation-only best-effort profile seed after commit. |
| M2M compatibility | Separate deterministic principal/email upsert and identity count in five serializable attempts; no human binding; final exact ID/email/zero-binding checks remain. |
| Local identity | Dedicated held DB coordination plus durable filesystem operation/candidate; exact principal reconciliation ignores later email changes and allows bindings only to the sole principal; terminate/reap before named recovery. |
| Catalog | Per-entry nontransactional loop; repeated successful runs stable/duplicate-free, updates preserve active ID, archived and stale rows remain, user collision retains personal precedence, later failure leaves earlier successful entries. Production main currently creates two unwanted sample users. |

## Scope

- Application-owned enums, plain persisted/read models, JSON data contracts, normalized persistence conflicts, repository/query ports, and callback-owned unit of work.
- PostgreSQL implementations and explicit hosted/local bindings; no feature module registers/imports a concrete persistence implementation after conversion.
- Preference/definition/location/user/external-identity/grant storage; mutation auditing, access logging/history, reset, verified identity/M2M, first-profile seed, and catalog initialization.
- Behavioral local identity coordination contract and adapter placement, preserving every LM-015/R1 state and failure guarantee.
- Reusable real-PostgreSQL contract tests, structural dependency checks, canonical storage documentation, baseline/census evidence, and required complete validation.
- Removal of sample users from the production seed entrypoint.

## Non-Goals

No SQLite driver/schema/runtime or database cutover; no historical user/data migration, cloud sync, local model, MCP transport/auth cutover, browser/session/UI cutover, installer, LAN mode, public-contract removal, schema migration, new runtime dependency, generic repository framework, new retry policy, or changed transaction granularity. `hosted-v1-maintenance` is unchanged. Steps 05 and 06 remain inactive.

## Contracts And Compatibility

| Contract | Disposition |
| --- | --- |
| Application/use-case results and validation | Preserved, including current ownership-check timing, errors and successful no-ops |
| Storage contract | Added neutral behavioral ports and reusable adapter conformance; PostgreSQL query/generated types stay private |
| Transaction contract | Added callback-scoped capabilities; existing default-isolation mutation/reset atomicity and explicit serializable identity attempts preserved |
| Human/local identity | Preserved exact authority, profile-hint policy, state format, canonical bytes, operation/candidate protocol, and quiescent recovery |
| Model-provider contract | Unchanged; local fixed unavailable adapter remains no-I/O |
| GraphQL | Exact semantic SDL, enum names/values, nullability and outputs preserved; no consumer migration window required |
| REST | Routes, authentication, payloads and statuses preserved |
| MCP transport/tools/resources | Hosted contracts and layered authorization preserved; local preview continues excluding transport |
| Configuration/filesystem | Same explicit hosted/local inputs, verified direct loopback TLS, state root, private artifacts, target hashing and runtime modes |
| Catalog | Semantic/copy fixtures and characterized partial completion preserved |
| Production seed sample users | Removed under baseline owner Step 04; seeding never deletes existing users or changes identity state |

In-repo consumers include all backend resolvers/guards/controllers, GraphQL models/DTOs, document/form/workflow services, MCP tools/auth/grants/access history, web schema code generation/dashboard consumers, developer orchestrator/eval GraphQL operations, seed/smoke scripts, test assembly, and package/restart/gate checks. The registry already inventories exact operations and external GraphQL/REST/MCP/client/configuration buckets; its checker must stay green. Public contracts are preserved, so no external client retirement or compatibility alias is introduced.

## Design

### Application-owned data and dependency boundary

Put persisted/read models, exact string-valued enum constants and JSON types outside infrastructure under `domains/shared/storage/`. They have no generated-client, Prisma, pg, GraphQL DTO, or adapter import/re-export. The PostgreSQL adapter implements them with explicit return contracts. Exact runtime enum value sets and GraphQL registration names remain pinned by contract tests and unchanged SDL; type relocation alone does not prove neutrality.

Use existing repository module paths/names as abstract behavioral injection tokens where this reduces consumer churn. Keep each port to demonstrated application methods, with explicit command fields, filtering criteria and plain results. Do not expose Prisma `WhereInput`, delegates, `include`, generated relation payloads, transaction clients, SQL, or a generic query language. Row enrichment, namespace, context and ordering contracts are named in port documentation and tests. The adapter owns provider JSON mapping and error classification.

Move concrete implementations into `infrastructure/storage/postgres/`; existing `infrastructure/prisma/` remains the driver/client lifecycle. Explicit hosted/local storage composition registers the adapter and exports only application tokens. The existing local configuration parser is an explicit PostgreSQL configuration edge in this reference-runtime step; its `pg` configuration types may remain there and in infrastructure/composition, never in storage/application port signatures. Local CLI/preview assembly may select the concrete adapter, while the state service cannot.

A TypeScript import-graph contract scans production application/domain/transport code, resolving path aliases and relative imports, type imports, dynamic imports/requires and re-exports. It rejects direct or intermediary access to generated Prisma/pg or concrete persistence classes. Composition/configuration/operational entrypoints use an explicit narrow allowlist, not a wildcard exception for all modules. Tests remain free to construct real adapter fixtures. Negative checker fixtures prove aliases and re-export hiding fail.

### Ordinary unit of work

A small `StorageUnitOfWork` runs an awaited callback with behavioral facets bound to one reference-adapter transaction. Required facets cover preference/definition writes, audit append, reset row operations, and identity operations as their consumers move. It exposes no raw transaction, begin/commit method, SQL capability, root-client fallback, implicit nested transaction, or adapter switch. Callers await all work; the callback cannot schedule work after return. The adapter invalidates every captured facet when the callback settles, on both success and failure. A late call fails before touching storage, and facets from one scope cannot be passed into another root or session because methods take commands, not a transaction handle.

`run` uses the current database default isolation and no retry. An explicitly named serializable path serves human/M2M identity only and also performs no automatic retry; the existing application five-attempt policy remains the owner. Rejection rolls back every write from that callback. Successful results are returned only after the adapter acknowledges commit. Provider failure becomes a neutral classified error; no provider object or cause is part of an application contract.

Preference and definition services use the transaction-bound write and audit facets in exactly their current order. Their validation, definition resolution, location ownership, suggestion status/ownership and suppression reads stay outside the callback. Snapshot builders remain application-owned and keep the existing before/after normalization. Reset retains its current sequence, conflict checks and mode policy in the use case while using named facet operations for deletion/count and cross-user references. MCP access append stays outside this unit of work and retains fail-open dispatch behavior.

No CAS, row lock, serializable isolation or additional retry is introduced for ordinary writes. Contracts do not promise a success for every concurrent first write, a new tie-break for ordinary lists, or an atomic global catalog/batch-suggestion operation.

### JSON and conflict translation

Use application JSON scalar/array/object types, with deliberate nullable/omitted command fields. Preserve field-specific behavior: absent/null preference evidence clears database null; optional absent/null audit/access JSON fields are omitted on append; definition creation null options use the existing unset behavior, update omission preserves options while explicit null clears them; verified-human identity metadata retains JSON-null semantics. Return JSON primitives/arrays/objects/null as plain values and timestamps as `Date`; audit snapshots serialize timestamps to ISO text.

The adapter maps only the existing recognized unique and serialization cases to neutral classifications. Human resolution's final fallback occurs only for a normalized unique conflict, never for serialization exhaustion, validation, connectivity, or an arbitrary provider failure. M2M retains its separate fixed diagnostics. Existing public Nest validation/not-found/conflict behavior remains application-owned. Provider messages, SQL, URL, keys, values and causes do not leak through newly introduced errors.

### Human identity and profile seed

Keep strict assertion/envelope validation and R1 optional-hint normalization in the resolver before storage. The serializable callback performs exact `(provider, issuer, subject)` lookup, then principal creation and binding creation if absent. UUID generation and synthetic email policy remain application-owned. An existing exact key returns its principal without account/profile update. Uniqueness/serialization conflicts cause at most the current five fresh attempts; exhausted unique conflict alone permits an exact lookup outside the rolled-back transaction.

Profile seed remains first-creation-only after commit and best-effort per current behavior. Definitions are read by active global slug; an existing active global profile value is not overwritten. No profile write, provider call or network enrichment enters the identity transaction. The M2M compatibility use case retains its deterministic principal/email and no-human-binding proof as a separate path.

### Local identity coordination is a distinct port

Extract `LocalIdentityCoordination` and a held `LocalIdentitySession` behavior contract independently of ordinary UoW. The PostgreSQL implementation keeps one dedicated non-pooled connection/advisory lock until all state-service filesystem work and cleanup finish. Acquiring a busy owner fails promptly; the handle never silently reconnects or reacquires. The port uses the existing application-owned `LocalIdentityState` for initialize/verify, preserving its codec validation without exposing a driver or database configuration; only the principal enters database queries. The core sees only acquire, initialize, verify, assert-held and release behaviors; raw SQL, client factory, database clocks, driver health, destroy and test-only verify-empty remain adapter implementation/test details unless an actual core caller needs them.

Initialize accepts the already validated candidate identity and permits only empty users plus no bindings, or the exact sole principal with all bindings attached to it. Verify requires the exact sole principal and valid binding owners without row mutation. Email is neither checked nor rewritten for an existing principal. The optional validation callback runs after both locked database snapshots validate and before insert/commit, while ownership is held; callback failure rolls back and conflict never calls it. Results are delivered only after acknowledged commit.

The held state is fail-latched. Use after release/loss fails; query/deadline failure destroys the physical session and no later query executes. Any failure during COMMIT is fixed recovery-required, never automatic retry/rollback/new principal. Lost/release failure after attempted or acknowledged commit likewise requires recovery. Release is idempotent, bounded, and destroys on failed unlock/end. The state service preserves a primary error if release also fails and surfaces release failure when it is the only failure.

LM-015 remains authoritative: complete durable operation and candidate precede DB mutation; only acknowledged or empty/exact-reconciled commit permits ready publication; operation removal is last. Root-operation ownership is the filesystem fence. Health checks remain supplementary. All recovery artifact classes, same-root/different-DB and same-DB/different-root races, rotation state, byte validation, target binding and terminate/reap-before-recovery ordering remain. In particular orphan and pre-candidate cleanup classes that prove no DB mutation by durable ordering do not gain an unrelated exact-user/empty-DB precondition.

Do not redesign the local state protocol, change principal/credential format, modify deadlines, or narrow recovery coverage. Ordinary UoW cannot substitute for this held coordination lifetime. Existing adapter fault/query tests and real stopped/killed process tests remain required alongside reusable port behavior tests.

### Catalog and production seed

Extract the catalog's application loop over a small catalog storage behavior if necessary to remove provider arguments. Keep entry order and one-entry-at-a-time persistence, same update/create rules, warning behavior, and partial-prefix completion. The `prisma/seed.ts` executable remains the PostgreSQL assembly entrypoint and closes its own client. Remove only its sample-user creation/logging block. Execute that actual entrypoint twice against the isolated fixture: exactly the source catalog, stable active IDs, zero users created; also prove pre-existing principal/bindings remain unchanged. No whole-catalog transaction or concurrent-seeding success guarantee is added.

## Checkpoints

All five checkpoints belong to the same PR. Hosted/local modes remain supported at each green checkpoint. Existing requirements/assertions are retained; fixture imports and construction may move to the new ports/adapters as necessary, with explicit unchanged behavioral expectations. A changed requirement is limited to the reviewed storage boundary and removal of production sample users.

### Checkpoint 1: Real-adapter characterization before consumer conversion

Add a reusable contract harness under `test/integration/storage-contracts/` with a provider fixture factory and provider-neutral assertions. Initially bind it to current PostgreSQL repositories/services. Add targeted missing evidence for mutation/audit rollback across all operations, consumed suggestion restoration, late reset rollback, JSON/omission round trips, uniqueness/archive/cascades, ownership, existing ordering/cursors and concurrent outcomes. Include best-effort access append leaving a committed mutation/audit intact. Extend local application reset coverage to all three modes and exact identity bytes/bindings.

For local coordination, run reusable acquire/held-callback/release/loss behavior against real PostgreSQL before conversion; retain adapter-specific SQL/deadline and full state/process tests. Provider setup and fault injection can use SQL, but shared contract assertions cannot depend on Prisma/pg types or error codes. Controlled barriers characterize races without asserting new all-writes-succeed or tie-order guarantees.

Expected signal: characterization passes on the base; any mismatch blocks the corresponding design claim rather than causing assertion weakening. New dependency/lifetime/seed requirements receive explicit failing tests immediately before their implementing checkpoint. Run targeted integration/e2e suites and report cases/results.

### Checkpoint 2: Neutral types, mutation ports and transaction ownership

Write failing storage dependency/type and callback-lifetime tests first. Add application-owned enums/models/JSON, repository port tokens, PostgreSQL implementations and scoped UoW. Convert preference/definition mutation and audit paths as one vertical slice, keeping same prechecks, write order, isolation and snapshots. Update only necessary test assembly/imports while retaining assertions. Execute the unchanged contract suite through the new fixture factory; add successful commit, thrown-callback rollback, cross-facet audit ownership and expired-facet checks.

Run focused unit/contract and real-DB preference/definition/audit suites, seed typecheck, schema drift check and backend build. Both compositions must initialize before the checkpoint is marked green.

### Checkpoint 3: Remaining storage consumers and composition

Write or extend failing neutrality/behavior tests first for history, access, reset, user/external identity, grants, locations and serializable identity facets. Convert those consumers and bind storage only at hosted/local composition roots. Preserve exact human/M2M attempts, final unique-only lookup, post-commit profile seeding, history filtering/cursors, reset sequence and access fail-open behavior. Complete generated enum/type replacement in transport/validation/document/workflow consumers, preserving exact public enum values and SDL.

Run new reusable real-adapter contracts plus existing identity, user, grant, location, history, reset and public/MCP consumer tests, all unit tests, seed typecheck and backend/schema builds. No full-suite bypass or weakened assertion is permitted.

### Checkpoint 4: Held local coordination and catalog-only seed

Write failing neutral held-session and actual production-seed-entrypoint tests first. Extract/move the PostgreSQL local coordination adapter, replace concrete core references with its behavioral contract, and retain LM-015 state-service ordering and all callback semantics. Convert catalog storage use and remove the sample-user entrypoint block. Update affected registry source/sink paths without changing unrelated dispositions, public fixtures, phases or timeouts.

Run adapter unit/fault tests, reusable real-PostgreSQL coordination and storage suites, existing real TLS/process recovery/concurrency tests, all-mode local reset preservation, actual seed executable twice and catalog partial-failure characterization. Run both supported-mode restart/package evidence as required by the final gate.

### Checkpoint 5: Canonical documentation, fresh final review and one PR

Document lasting boundary/lifetime/JSON/concurrency behavior in canonical storage docs; update preference/audit/reset/baseline/operator descriptions as applicable. Record Step 03 merged consistently, retain its plan, and keep Step 04 sole active step. Resolve fresh independent complete base-to-candidate reviews across required dimensions, with affected rechecks for fixes. Freeze candidate for final gate and review evidence.

Run the complete exact-base local migration gate, applicable checks, whitespace/link validation, commit and push the reviewed implementation, open one PR using the migration template, and obtain applicable standard CI plus dedicated migration-gate results on the final pushed head. Any changed base/candidate input requires impact assessment and renewed affected evidence. Leave PR ready for human review; never merge or activate Steps 05/06.

## Validation Matrix

All commands use exact Node 24.21.0/pnpm 10.25.0. Database commands receive a fresh isolated loopback fixture URL with safe test naming; no default shared database scripts are used. Adapter-specific fixtures own their exact resources and clean them after success/failure. The existing full gate retains all twelve phases and both supported modes.

| Surface | Command/evidence | Required |
| --- | --- | --- |
| Activation/final aggregate | `MIGRATION_GATE_BASE_SHA=311f5a09b9b1ee5d43717296fbb49e7d45feda5e pnpm migration:gate` with isolated administration, Python and persisted evidence paths | Yes |
| Targeted unit/contracts | `pnpm --filter backend exec jest --selectProjects unit --runInBand --runTestsByPath <affected spec paths>` | Each affected checkpoint |
| Storage/identity integration | `pnpm --filter backend exec jest --selectProjects integration --runInBand --runTestsByPath <storage-contract specs and affected existing specs>` | Each affected checkpoint |
| E2E ownership/atomicity/reset/MCP | `pnpm --filter backend exec jest --selectProjects e2e --runInBand --runTestsByPath <affected e2e specs>` | Each affected checkpoint |
| Generation/types/build/schema | `pnpm --filter backend prisma:generate`; `pnpm --filter backend typecheck:seed`; `pnpm --filter backend build`; `pnpm --filter backend schema:check` | Yes |
| Backend broad suites | `pnpm --filter backend test:unit`; `pnpm --filter backend test:integration`; `pnpm --filter backend test:e2e:tests-only` | Final gate |
| Consumers/web/eval/packaging/restart | Existing aggregate contract checker and all manifest build/test/restart/package phases, including local preview and hosted baseline | Final gate |
| Seed production executable | Bounded Node/ts-node child invocation of `prisma/seed.ts` with explicit fixture-only environment, then semantic DB inspection and second-run comparison | Yes |
| Docs/hygiene | `node scripts/check-markdown-links.mjs`; `git diff --check`; `git diff --cached --check` | Yes |
| Remote exact head | Applicable standard CI and dedicated local-migration workflow on the final pushed SHA | Yes |

Record source/base SHA, tree status, exact versions, base comparison, caller integrity, phase result/timing, lifecycle cleanup, and limitations for every aggregate run. The gate's success summary is retained outside its auto-removed diagnostics. macOS local and Linux CI evidence do not imply Windows or hardware power-loss qualification. No live hosted-provider dependency is permitted.

## Independent Review And Evidence

Approvals bind to named contracts/areas and the reviewed revision. A substantive change renews affected dimensions; unrelated coverage is carried forward only with explicit impact assessment. Fresh independent final reviewers cover the complete planning-base-to-candidate diff. The writer never independently approves its own plan or code.

| Revision | Reviewer/mandate | Finding / disposition | Approval or recheck |
| --- | --- | --- | --- |
| Draft A `6970d8fe532b87ec4c0f141725a742ebcff917859f88c417036f94e07e0e19be` | `/root/architecture_review` / Architecture/scope | Approved architecture and scope; no blocking findings | Approved |
| Draft A `6970d8fe532b87ec4c0f141725a742ebcff917859f88c417036f94e07e0e19be` | `/root/persistence_review` / Persistence/recovery | Approved persistence and recovery; no blocking findings | Approved |
| Draft A `6970d8fe532b87ec4c0f141725a742ebcff917859f88c417036f94e07e0e19be` | `/root/persistence_review` / Security/privacy | Approved security and privacy; no blocking findings | Approved |
| Draft A `6970d8fe532b87ec4c0f141725a742ebcff917859f88c417036f94e07e0e19be` | `/root/compatibility_review` / Compatibility/consumers | Approved compatibility and consumers; no blocking findings | Approved |
| Draft A `6970d8fe532b87ec4c0f141725a742ebcff917859f88c417036f94e07e0e19be` | `/root/compatibility_review` / Tests/gate | Approved tests and gate evidence; no blocking findings | Approved |
| Base `311f5a09b9b1ee5d43717296fbb49e7d45feda5e` through candidate `01d5bd44551f89b8c675a3735a5c0361c1b006af` | `/root/final_architecture_review` / Architecture/scope | Complete implementation and canonical docs reviewed; no actionable findings | Approved |
| Same complete base-to-candidate diff | `/root/final_persistence_review` / Persistence/recovery and security/privacy | Transaction failure/ownership, identity/reset and held recovery reviewed; no actionable findings | Both dimensions approved |
| Same complete base-to-candidate diff | `/root/final_compatibility_review` / Compatibility/consumers and tests/gate | Public fixtures byte-identical; retained assertions and meaningful new failpoint evidence; all suites discovered without phase changes | Both dimensions approved |

The post-approval changes only record verdicts and activation status; they do not alter substantive draft A contracts. All named review coverage is carried forward. Application callback failures retain their own identity/semantics; provider-origin failures alone undergo adapter normalization. The latter clarifies the existing separation rather than authorizing a new behavior.

Original final review impact assessment: closeout edits through `a6964848da83a5ecf465b668cd96b66047cf350c` record verdicts, the actual PR reference and validation provenance only. They do not change production code, tests, registry semantics, supported modes, dependencies or gate inputs other than documentation. All five named final-review dimensions therefore carried forward from `01d5bd44551f89b8c675a3735a5c0361c1b006af`; final documentation links and the complete aggregate gate ran on that clean candidate. Later changes require the affected reviewer recheck and renewed evidence, as recorded below. Fresh origin/main verification after implementation still equals the planning base.

[PR #163](https://github.com/loyalagents/context-router/pull/163) is the durable closeout evidence index: it records the final branch head, local gate source/base and all twelve phase outcomes, standard CI and dedicated migration-gate run links, actual workflow source revision (including any synthetic merge commit), cleanup and platform limits. Gate evidence is never relabelled from an earlier candidate. Keeping that final-head report in the PR avoids a post-validation repository evidence commit invalidating its own claimed head. Human review and merge remain required; Step 04 is not marked merged and Steps 05/06 remain inactive.

## Checkpoint Evidence

### Review Follow-Up After The Original Validated Head

The user authorized addressing the external Claude review of `a6964848da83a5ecf465b668cd96b66047cf350c` on the same unmerged PR. The review approved the original implementation with two low-severity items. Its independent test execution used Node 20.19.5 and is not pinned-toolchain validation; this follow-up uses Node 24.21.0 and pnpm 10.25.0. Fresh PR/base/branch checks found no merge, conflicting changes or base delta. `/root/storage_writer` remains the sole writer at the existing runtime-accepted Astra Extra High setting; the coordinator/reviewers remain read-only.

- **L1 addressed:** the graph checker now prohibits obtaining/exporting the known Node `createRequire` capability through bounded named, namespace/default/import-equals, CommonJS and directly awaited literal-import syntax. Wildcard/namespace re-exports cannot hide it in a barrel. It rejects genuinely unresolved relative/absolute and configured alias paths, retaining ordinary external/builtin imports. Exact/single-wildcard prefix/suffix matching cannot overlap the prefix and suffix. No general JavaScript dataflow or obfuscation framework is introduced.
- **L2 accepted as intended:** fixed provider-error sanitization remains the approved policy for operational seed failures. This follow-up does not add raw provider causes, operator diagnostic categories or a new logging design.
- **Unused root audit binding removed:** read-only inventory found no consumer of the Nest root `PreferenceAuditService` binding. Its registration and two imports are removed from `PostgresStorageModule`. All eight production mutation audit calls already use `tx.audit`; the UoW still directly constructs the scoped adapter. Existing root repository APIs and audit/history behavior are unchanged.
- **Tests first:** after the optional checker configuration parameter was introduced without behavior, the expanded original-checker matrix failed **25 cases / 23 passed** (`checker-extended-red.log`). Parenthesized namespace access and a wildcard-overlap near-miss separately failed before correction (**2 failed / 50 passed**, including the now-green composition cases). Both hosted/local actual Nest tests first failed specifically because root audit lookup resolved after successful module compilation and UoW lookup (`audit-binding-red.log`). Final targeted checker/composition/UoW/local-composition run passed **69/69 tests, 4 suites, 2.06s** (`followup-targeted-green.log`). Existing assertions remain intact. Evidence is isolated under `/private/tmp/step04-followup-l1-evidence/`; earlier logs are retained unchanged.

Impact assessment: the affected dimensions are architecture/dependency enforcement, narrow composition and tests/gate coverage, requiring recheck by `/root/final_architecture_review` (Astra Extra High) and `/root/final_compatibility_review` (Astra High). Persistence/recovery, security/privacy and public compatibility approvals carry forward because UoW implementation, provider error policy, all adapter operations, identity/recovery protocol, schema/state/public fixtures and consumers remain unchanged; removing the unused root binding only eliminates an unconsumed injection path. The PR is draft while this follow-up is reviewed and its new exact head receives the unchanged full local gate plus standard/dedicated CI. Prior-head results are historical evidence, never relabelled as new-head validation. Human review/merge remain required, and Steps 05/06 remain inactive.

### Original Implementation Checkpoints

- CP1 characterization completed before any product conversion on the planning-base implementation. The two reusable PostgreSQL registrations passed 32/32 tests in 3.721s after correcting fixture-only field/enum names and an invalid catalog value; no product mismatch required changed assertions. Expanded final registration plus local composition and MCP E2E passed **65/65 tests across four suites** in 7.063s. Exact command: `pnpm --filter backend exec jest --runInBand --runTestsByPath test/integration/storage-contracts/postgres-storage.spec.ts test/integration/storage-contracts/postgres-coordination.spec.ts test/contracts/local-identity-application.spec.ts test/e2e/mcp-access-log.e2e-spec.ts`.
- CP1 fixture-only sequence observations survive rollback and prove each failpoint fired after earlier writes; exact whole-table snapshots prove restoration. Read barriers synchronize concurrent first preference/definition writes without promising every call success. Other assertions pin persisted evidence clearing, optional history JSON, archive retention/reuse, exact global catalog preservation under cascades, ownership/location selection/definition-ID merge, tied inclusive history cursors, six real held-identity behaviors, all reset-mode principal/binding preservation and unchanged local identity bytes, and committed MCP mutation/audit despite access-log failure.
- CP1 used the independently owned loopback/tmpfs PostgreSQL fixture, exact Node/pnpm, no hosted provider or schema change. Detailed run log: `/private/tmp/step04-activation-evidence/checkpoint1.log`. The preconversion assertions remain reusable through adapter fixture replacement. Advisory `/root/checkpoint_test_review` findings strengthened false-green detection, rereads and concurrent scheduling; narrow recheck at `ef11f66723fbebc9779310694849a7cb6cc8159b` resolved every prior concern with no blockers (advisory checkpoint coverage only, not final implementation approval).

- CP2 added neutral data/enum ownership and behavioral preference/definition/audit ports, scoped UoW and explicit reference-adapter bindings. Preconversion tests first failed on missing modules (`checkpoint2-red.log`); exact arbitrary rejection preservation first exposed the `NaN` identity issue (`checkpoint2-scope-red.log`, 9 passed/1 failed), then passed after `Object.is`. Frozen method-only facets prevent runtime client/property escape; captured and extracted methods expire as soon as the callback settles, before commit acknowledgement.
- CP2 validation: conversion/local composition/rollback suites **58/58 across 7 suites, 8.582s** (`checkpoint2-conversion.log`); retained repositories/audit/catalog/hosted MCP/local assembly **109/109 across 6 suites, 11.718s** (`checkpoint2-targeted.log`); final dependency/lifetime/post-callback failed-commit/real-PG audit suites **28/28 across 4 suites, 3.985s** (`checkpoint2-final.log`). Backend build, seed typecheck and unchanged semantic GraphQL schema check pass. The enum-only import relocation covers remaining consumers now so all transports share one owned runtime enum object; remaining storage behavior conversion stays CP3.
- Advisory `/root/transaction_review` (Astra Extra High) resolved its client-property escape and arbitrary rejection findings on the scoped UoW slice; root received the 58-test evidence and scope/hash recheck. This carries forward the approved architecture/isolation/write-order contracts, with no product policy redesign; it is not final full-diff approval. The final focused suite additionally injects a failed commit after successful callback and proves no success/retry plus expired captured methods.

- CP3 converted remaining repositories, history filtering adapters, access append, identity/profile and reset behavior; core services now own policies over neutral commands. The expanded dependency graph first failed on remaining provider imports (`checkpoint3-red.log`). New loader/package-alias fixtures first failed (`checkpoint3-scanner-red.log`), then passed after known nonliteral loaders fail closed and resolved provider package paths are classified before external pruning.
- CP3 evidence: identity/reset/storage/scanner core **120/120, 8 suites, 16.901s** (`checkpoint3-core.log`); full backend unit **754/754, 64 suites, 20.599s** (`checkpoint3-unit.log`). Remaining real-adapter/public/MCP consumer run passed **97/97 in 10 suites** while two E2E suites did not compile because test assembly still used old constructors; only those constructors/imports changed, then recheck passed **30/30, 2 suites, 4.499s** (`checkpoint3-consumers.log`, `checkpoint3-assembly-recheck.log`). Neutral identity fake cases and new identity/reset facet expiry are included in the 97 passing tests. Backend rebuild, seed typecheck and unchanged GraphQL schema pass.
- Advisory `/root/persistence_review` (Astra Extra High) found no defects in the CP3 identity/profile/reset/UoW behavior at 11-file digest `0eda7958c384bea7a7eaa7aa94b0562551b52addc01341d1e94a64accee8e0c3`; `/root/architecture_review` (Astra Extra High) rechecked and resolved both scanner findings. These are bounded static advisory verdicts, not final full-diff approval. Scope, retries, prechecks, default isolation, JSON distinctions and operation order remain the reviewed contracts. Full production graph coverage, held coordination and production seed are CP4.

- CP4 extracted the separate neutral held-coordination handle and moved the PostgreSQL implementation without changing executable protocol logic. The full graph roots now cover every production file under common/domain/MCP/feature modules with one exact administration-composition entrypoint exclusion; the expanded check first failed on the old local identity dependency. Catalog code now consumes an owned behavior port; the production executable creates no users.
- CP4 production-entrypoint red evidence first exposed a pre-existing plain-ts-node import ambiguity: the sibling `preferences.catalog.json` resolved before the TypeScript wrapper, yielding no named catalog export. Direct canonical-data import fixed that executable path; the new tests then failed on the two sample users before their removal. This necessary entrypoint correction preserves all catalog content/order and the reviewed per-entry persistence contract; it does not add a migration or change test requirements.
- CP4 core **190/190, 6 suites, 18.835s** (`checkpoint4-core.log`) covers production seed, existing seed helper, neutral real-adapter coordination, full dependency graph and retained local adapter/state units. The direct-TLS/process/recovery suite passed **2/2, 72.239s** (`checkpoint4-process.log`), including its large session/pool/process recovery case. Final production/helper seed recheck after provider-error normalization passed **13/13, 2 suites, 6.932s** (`checkpoint4-seed-final.log`) using the actual plain-ts-node require-main path. Backend build and seed typecheck pass. Every runner exited normally with code 0; occasional Jest one-second handle notices did not require forceExit or leave a running test process.
- CP4 advisory `/root/persistence_review` (Astra Extra High) compared the moved adapter and state service against base and found no protocol regression: executable lock/query/deadline/fail-latch/commit/release logic and state ordering are preserved. This is bounded advisory evidence, not final approval. Canonical [storage boundaries](../../../../current/STORAGE_BOUNDARIES.md) carry the full held-handle, callback, ambiguity and terminate/reap guarantees.
- The registry changes only relocate the PostgreSQL source/sink and record completed sample-user removal with executable evidence, retaining the historical approved disposition/classification. Public GraphQL/REST/MCP/catalog fingerprints, supported modes and all twelve gate phases/timeouts remain unchanged. Standalone registry/consumer checks pass (`baseComparison=skipped`, deliberately not final gate evidence); Markdown links pass across 139 documents. Checkpoints 1–4 implement the approved draft A scope; no material redesign requires new plan approval. Fresh complete-diff review and exact-base/final-head aggregate evidence remain CP5.

## Parallel Work And Conflict Surfaces

Only read-only discovery and review run alongside this writer. No parallel implementation lane is approved. The sole writer owns generated output, backend source/test assembly, Prisma/reference adapter, identity state integration, seed, composition roots, registry/gate references and all plan/canonical docs. Independent tests never share writable fixture DBs, ports, state roots or build outputs. A concurrency test may intentionally share one owned fixture under that single test's supervisor.

## Privacy And Security

No listener, provider call, telemetry or new credential is introduced. Local identity continues using literal-loopback verified TLS and private validated files; its human bearer is not an MCP/browser credential. State artifact bytes and target hashing remain unchanged. New storage exceptions carry fixed classifications/messages without raw provider causes or payloads. Authorization remains in use cases, including self-only principal access and current-user history/grant filtering. Scope expiry prevents accidentally using a committed/rolled-back transaction capability as ordinary storage. Existing same-UID/root/runtime/hardware limits remain Step 09; no broader security guarantee is inferred from this refactor.

## Rollback Or Recovery

No schema, migration history, state format, principal, credential or catalog semantic change is planned. Stop running processes and revert this code to the recorded planning base with the same PostgreSQL database and private state root intact; do not execute destructive reset or delete identity artifacts. The previous seed binary recreates sample users if explicitly run, so rollback instructions should not invoke it. Existing named local recovery remains the only supported break-glass path after termination and reaping of original administrators, resolving the existing durable operation/candidate against empty/exact DB state. Gate cleanup targets only independently journaled fixture resources.

## Risks And Open Questions

- Ordinary storage races and unspecified tie order can be accidentally strengthened by abstraction. Owner: writer; characterization and persistence review gate each conversion.
- JSON null/omission or generated enum identity can drift despite typechecking. Owner: writer; real-adapter round trips, exact SDL and public fixtures are required.
- A transaction facade can conceal root writes or survive its callback. Owner: writer; failure injection, ownership/lifetime contracts and structural review must disprove this.
- Local identity's failure model can be weakened by an ordinary UoW abstraction. Owner: writer and independent persistence/security reviewers; keep the separate held lifetime and unchanged process recovery matrix.
- New dependencies, schema/state/public-contract changes, changed deadlines/retry/granularity, extra PRs, or a consequential unresolved protocol decision require revised plan and affected independent review before implementation.

## Exit Criteria

- Production application/domain/transport code is free of provider-specific storage imports/types/query/error knowledge under the explicit boundary check.
- PostgreSQL passes reusable real-adapter behavior and transaction/coordination lifetime contracts while existing test assertions retain their requirements.
- Both supported modes initialize/restart/package successfully; local preview remains non-listening and no-provider-I/O.
- LM-015/R1 exact identity, reset preservation and recovery evidence remain green.
- Actual production seed creates no sample users and retains catalog idempotence/partial completion.
- All independent plan/final findings are resolved, canonical docs and baseline/census are current, and final exact-base local/final-head remote gates pass.
- One PR is ready for human review; human review/merge remains required; Steps 05/06 are not activated.

## Closeout

When a human merges this PR, record the final PR/head/merge outcome consistently while activating the next authorized step. Retain the detailed Step 03 plan while downstream storage work needs its recovery contract. Step 05 owns local-database selection/implementation, Step 06 the local model, Step 07 local MCP credentials/transport, Step 08 browser/UI cutover, and Step 09 platform packaging/backup/hardware durability. No separate closeout PR is created.
