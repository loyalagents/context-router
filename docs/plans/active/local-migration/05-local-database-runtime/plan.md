# Step 05: Local Database Runtime

- Document status: initial plan, revision B; independent review and coordinator approval required before executable feasibility
- Program step: `05-local-database-runtime`
- Target branch: `main`
- Planning base commit: `3426dc556fea88d94a360329e7c685bc9acc155e`
- Working branch: `codex/local-migration-05-local-database-runtime`
- Worktree: `/private/tmp/context-router-step05`
- Planning and implementation owner / sole repository writer: `/root/step05_writer`
- Coordinator: `/root`, repository-read-only
- Change classification: `local-only`; `hosted-v1-maintenance` and external deployments remain unchanged
- Depends on: human-merged Step 04 [PR #163](https://github.com/loyalagents/context-router/pull/163)
- Risk profile: sensitive / quality-first because newly created durable data, identity, transaction ownership, interruption, recovery and backup must remain correct
- Intended implementation PR count: one cohesive PR with internal checkpoints
- Implementation PR: pending
- Supported modes after merge: retained `hosted-baseline`, explicit PostgreSQL `local-identity-preview` reference, and new non-listening `local-database-preview`
- Last updated: 2026-09-23

## Outcome

An explicit local command initializes and runs a fresh file-backed application database behind Step 04's application-owned contracts, without PostgreSQL, Docker, Auth0, a hosted model or a listener. It preserves stable local identity, ordinary storage/use-case behavior, exact provider identity resolution, restart and explicit recovery. A real matching database-and-identity backup/restore demonstration establishes a mechanism for Step 09 without building final backup UX. SQLite and its access library remain candidates until the bounded feasibility checkpoint and affected decision review pass. No importer, automatic merge or next-step activation is authorized.

## Required Reading

- Root [`AGENTS.md`](../../../../../AGENTS.md), [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md), every file in [`docs/IMPORTANT/`](../../../../IMPORTANT/), and `./print-repo-structure.sh`
- [`../orchestration.md`](../orchestration.md), [`../decision-log.md`](../decision-log.md), [`../agent-execution.md`](../agent-execution.md), [`../step-template.md`](../step-template.md), [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md), and [agent workflow](../../../../useful/AGENT_WORKFLOW.md)
- Step 04 [README](../04-storage-boundaries/README.md) and complete [plan including review follow-ups](../04-storage-boundaries/plan.md); retained Step 03 [recovery plan including R1](../03-local-identity/plan.md)
- [Storage boundaries](../../../../current/STORAGE_BOUNDARIES.md), [human baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md), [JSON registry](../../../../current/local-migration-contract-baseline.json), [preferences](../../../../current/PREFERENCE_SCHEMA.md), [audit/access](../../../../current/AUDIT_AND_ACCESS_HISTORY.md), [reset](../../../../current/DATA_RESET.md), and [identity runbook](../../../../useful/LOCAL_IDENTITY_ADMIN.md)
- Actual `apps/backend/src/domains/shared/storage/`, behavioral repository tokens, `infrastructure/storage/postgres/`, local configuration/composition/admin/preview, identity codec/filesystem/state service, Prisma schema/catalog, reusable contracts, separate UoW tests, real process/recovery tests, and gate/package/restart scripts

Landed code and canonical contracts govern over historical planning observations. The Step 03/04 plans remain retained because their contracts are active inputs.

## Agent Allocation

| Role / agent | Mandate and ownership | Requested setting | Runtime verification | Parallel work |
| --- | --- | --- | --- | --- |
| `/root` | Coordination, evidence and review decisions; no repository mutations | GPT-6 Astra Ultra | Current serving model/effort is not independently exposed; no change or downgrade is claimed | Read-only |
| `/root/step05_writer` | All repository mutations, including plans/docs, tests/code, generated output, Git and PR | GPT-6 Astra Extra High (`xhigh`) | Explicit supported spawn request accepted; serving internals not independently exposed | Critical planning and implementation |
| `/root/runtime_research` | Candidate/library, exact runtime, native closure and official documentation | GPT-6 Astra Extra High | Explicit request accepted; internals unverified | Read-only, completed |
| `/root/recovery_research` | Identity coordination, filesystem, failure/backup model | GPT-6 Astra Extra High | Explicit request accepted; internals unverified | Read-only, completed |
| `/root/consumer_inventory` | Bounded consumer and acceptance-gap inventory | GPT-6 Astra High | Explicit request accepted; internals unverified | Read-only, completed |
| `/root/plan_architecture` | Initial architecture/maintainability/packaging/scope review | GPT-6 Astra Extra High | Explicit request accepted; internals unverified | Read-only |
| `/root/plan_persistence` | Initial persistence/recovery/security/privacy review | GPT-6 Astra Extra High | Explicit request accepted; internals unverified | Read-only |
| Independent plan/final reviewers | Architecture, persistence/recovery, security/privacy, packaging; separate compatibility/test inventory where useful | Astra Extra High for sensitive work, High for bounded inventory | Named requests and accepted settings recorded with each review | Read-only |

The superseded `database_writer` launch made no changes and has no ownership. One writer owns every hotspot; the coordinator and all discovery/review agents remain read-only. Mechanical edits remain with the configured writer rather than silently claiming a lower effort. Reviewer approvals never replace executable evidence.

## Entry Criteria And Evidence

- Fresh GitHub verification reports PR #163 `MERGED` at `2026-09-23T22:59:55Z`, merge/planning base `3426dc556fea88d94a360329e7c685bc9acc155e`, from final head `c83bea0add7039cad814567e05d79f4f8b275aba`.
- Standard CI [35928247258](https://github.com/loyalagents/context-router/actions/runs/35928247258) and dedicated migration gate [35928247421](https://github.com/loyalagents/context-router/actions/runs/35928247421) both succeeded on that reported PR head. These are prerequisite evidence, not Step 05 candidate validation.
- Fresh `origin/main` remains the supplied merge. History is non-shallow, connectivity checks pass, prerequisite merge is an ancestor, no conflicting Step 05 local/remote branch existed, and the new dedicated worktree began clean at that exact SHA. Existing user branches/worktrees are preserved.
- Before any activation-document/product edits, the full gate passed on this exact clean source with `MIGRATION_GATE_BASE_SHA` set explicitly; complete evidence is below.
- No Step 06 or other implementation track is activated. No production database or live hosted model participates.

### Activation Gate

The clean planning-base full gate passed all twelve phases before activation edits on 2026-09-23. Source/base/HEAD were `3426dc556fea88d94a360329e7c685bc9acc155e`; `baseComparison=performed`, caller integrity true, no failure or cleanup error. The durable summary reports 552,290 ms and final console reports 552,656 ms after evidence finalization. Exact runtime: Node 24.21.0, pnpm 10.25.0, Python 3.12.8, PostgreSQL 15.15. Independently cloned dependencies and an owned labelled tmpfs PostgreSQL fixture with random loopback-only publication were used. The gate removed its database/workspace/diagnostics; the wrapper verified immutable container ID/label, stopped it and confirmed automatic removal. Caller worktree remained clean. No downloaded image, production DB or live provider was used.

Evidence is retained outside the repository at `/private/tmp/step05-activation-evidence/activation.log`, `local-migration-gate-summary.json`, and `activation-fixture.json`. This is local macOS arm64 activation evidence, not final candidate or Windows/hardware qualification.

| Phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | Passed | 26,872 |
| documentation | Passed | 1,357 |
| backend-unit-build | Passed | 26,174 |
| backend-database | Passed | 120,639 |
| local-orchestrator | Passed | 6,151 |
| eval-fixtures | Passed | 38,981 |
| eval-deterministic-scenarios | Passed | 7,818 |
| web-production-build | Passed | 28,859 |
| harbor-static | Passed | 2,486 |
| restart-smoke | Passed | 64,207 |
| packaged-composition-smoke | Passed | 193,826 |
| repository-integrity | Passed | 1,833 |


## Current Evidence

- Step 04 provides provider-neutral plain rows/enums/JSON, behavioral repositories, ordinary and serializable UoW, and a separate held local identity port. Frozen method-only facets expire before commit acknowledgement. Application callbacks retain exact rejection values; only provider-origin errors are normalized.
- Shared contracts cover mutation/audit rollback, witnessed late failures, reset, JSON/null/omission, archive/live uniqueness, ownership, location precedence, cascades, histories, controlled concurrent first writes and held coordination. Separate UoW, identity resolver/profile, direct-TLS/process/recovery and application-composition suites supply additional guarantees; shared registration alone is insufficient.
- `test/contracts/local-identity-application.spec.ts` creates a real Nest application but supplies mocked Prisma storage. It is useful assembly coverage, not real file-backed integration evidence.
- Integration/e2e Jest setup resets/seeds PostgreSQL before every test. Local file-backed suites require their own project/setup so their standalone command demonstrates no PostgreSQL dependency.
- Current runtime selection occurs in the local infrastructure module, administration factory and preview verifier. All three must select the new adapter. The default hosted root stays unchanged.
- The strict ready identity root contains exactly `identity.json`. Database/journal artifacts require a separate directory rather than weakening identity artifact validation.
- Current package deployment includes only compiled `dist`, production dependencies and manifests. SQL schema and worker resources must be compiled into that closure. Existing package/restart proofs and hosted/PG tests remain active.

## Scope And Non-Goals

Scope includes candidate evidence and local schema/bootstrap, the SQLite storage and held-coordination adapters, actual local composition/commands/catalog, database+identity backup feasibility, real file/process/negative tests, dependency enforcement, gate/CI discovery/package evidence, and canonical documentation/registry. All checkpoints land together in one PR.

No historical PostgreSQL/Auth0 data/user translation, cloud sync, local model, local MCP/browser sessions/UI, installer/updater/keychain, final platform paths, LAN mode, hosted portability work, unrelated public-contract removal, generic repository/IPC framework or external deployment change. Step 09 owns final backup UX and hardware durability qualification. Fresh-install authority never permits loss of data created by this runtime.

## Contracts And Compatibility

| Contract | Disposition |
| --- | --- |
| Application/use-case and public GraphQL/REST/MCP results | Preserved; no transport listener or public shape change |
| Storage ports and UoW | New implementation; provider details stay within infrastructure/explicit assembly |
| Audit versus access log | Mutation and audit atomic; access append remains independent best-effort |
| Provider identity / R1 hints | Exact provider/issuer/subject key, existing five attempts and unique-only final lookup, no email linking, independently normalized hints, first-creation-only postcommit best-effort seed |
| Local identity | Same principal/credential/canonical format and durable operation/candidate/recovery classes; reviewed SQLite mechanism replaces PG advisory session for new mode |
| Filesystem/configuration | Add explicit private database root; identity root stays strict; no dotenv/HOME/cwd or DATABASE_URL fallback |
| Schema history | Fresh local versioned baseline separate from hosted Prisma migrations; unsupported/corrupt/missing state is never reset |
| Catalog | Same entries/IDs/idempotence/partial-prefix behavior; no users created by catalog initialization |
| Model | Unavailable/no-I/O adapter preserved |
| Supported reference modes | Hosted remains default; PG identity preview retained through an explicit reference command, configuration and existing evidence |

In-repo consumers include preference/definition/location/user/grant services, audit/access/history/reset, verified identity/M2M/profile seed, GraphQL/REST guards/resolvers, MCP access/grant use cases, catalog seed, local composition/admin/preview, test assemblies, package/restart/gate, web codegen and developer orchestrator/eval consumers. Existing public fixtures and catalog bytes stay unchanged. No external GraphQL/REST/MCP client needs a compatibility window because their public surfaces are preserved. Local CLI configuration migration is documented: the SQLite command uses fresh separate roots; the explicit PostgreSQL reference command keeps old state usable without an importer.

## State And Failure Model

### Durable authorities and transitions

1. The database contains a schema/application identifier, exact local schema version and random independent 32-byte database instance ID. Path and inode are runtime safety checks, not durable identity. The ID survives an offline move or verified whole-pair restore; a different database never gains an existing identity merely by occupying its path.
2. Only explicit fresh initialization may bootstrap an absent database. Existing-only commands never create missing files. Zero-byte, foreign, truncated, incompatible-version, unexpected-schema, invalid metadata or corrupt canonical files fail closed. Missing DB with existing identity is loss/error, not initialization authority.
3. Bootstrap constructs the whole schema and instance metadata in one transaction in a private nonce stage, closes every SQLite handle, and publishes the complete file no-clobber. Schema version and metadata cannot advertise a partially applied schema. Publication never renames/unlinks a live database or hardlinks one while a SQLite handle remains open.
4. Once the database is ready, identity ordering remains acquired held owner → durable fixed root operation → complete durable candidate → locked empty/exact database reconciliation → acknowledged commit → no-clobber canonical publication → cleanup → operation removal last → owner release. Database bootstrap does not create a principal.
5. Ordinary mutation/audit and reset callbacks have one connection/transaction, no retries, exact callback rejection, expired facets and success only after acknowledged commit. Access logging is outside that transaction. Identity serializable attempts retain their application-owned retry count and final-lookup restriction.

### Failure outcomes

| Interruption / state | Required result |
| --- | --- |
| Before complete bootstrap stage commit | No canonical DB or principal; partial/invalid stage is preserved and rejected, never mistaken for fresh canonical state |
| Complete stage before publication | Quiescent `recover-database-bootstrap` validates the sole stage's exact current schema/metadata and zero application rows, then finishes no-clobber publication; otherwise preserve/fail |
| DB publication before redundant same-inode stage cleanup | The same command validates the exact linked pair through a private copy while original SQLite handles are closed, then unlinks only the redundant stage; never open the nlink-2 original through SQLite |
| Absent DB with nonempty identity root, unrelated replacement, unknown file/version without crash-recovery journal | Fixed failure with bytes/artifacts preserved; no replacement principal, persistent-setting rewrite or automatic reset |
| Metadata-safe canonical DB with an engine-recognized hot journal | SQLite may roll back its interrupted transaction before schema/target queries can run. Physical DB/journal bytes can change even if subsequent logical admission fails; this narrow engine recovery never authorizes application/schema/identity mutation or deletion of unknown artifacts |
| Callback throws before COMMIT | Whole transaction rollback; exact arbitrary rejection retained; scoped methods expire |
| Provider unique/busy/locked failure | Only reviewed unique/serialization classification; one adapter attempt, existing application retry owns policy |
| COMMIT failure/response timeout, lost held owner, failed release after commit attempt | Fixed recovery-required failure, terminal handle, durable candidate/operation retained where still present, no reacquisition/retry/new identity |
| Old admin stopped or lock becomes free | Not takeover authority. Original process must be terminated and reaped before named recovery |
| Rotation before/after atomic rename | Enumerated old/new credential outcome, same principal/target, exact matching recovery; no ambiguous automatic choice |
| Unsafe sidecar/root/inode or unsupported/corrupt content | Fail closed; never remove a journal as identity orphan cleanup |
| Restored earlier complete backup | Restore exact backed-up data/principal/target/credential/generation; old bearer revival is explicit; demonstrate rotation after restore |

All Step 03 recovery classes remain distinct: orphan operation stages under recover-orphans mutex and resumable cleanup; exact same-inode redundant stages plus nlink-1 losing stages; initialize operation without candidate or unpublished partial candidate stage; complete candidate with empty/exact DB; canonical+initialize residue; rotation old/no-candidate, old/proposed-candidate and postrename new state. Pre-mutation orphan cleanup does not gain a universal exact-user/empty-DB precondition. Corrupt published artifacts, foreign targets, wrong links/generations, missing authority and multiple candidates remain rejected unchanged.

## Design Candidates And Bounded Selection

### Database/library and local schema

Use `node:sqlite` as the first and only executable candidate. Its inclusion in the pinned Node runtime avoids an additional native addon/package tree; it remains a release-candidate API, so exact runtime/package evidence is required. Record actual `sqlite_version()`, `sqlite_source_id()` and compile options, rather than assuming the official source tag proves the installed binary. Current official v24.21.0 source bundles SQLite 3.53.4. Better-sqlite3 is a fallback only after a recorded failure criterion: current v13 uses Node-API and bundled prebuilds, but still adds a native closure and its synchronous transaction wrapper cannot await an async callback. A second Prisma schema/client is unnecessary for these existing behavioral ports and does not solve held filesystem coordination. Do not build competing full adapters.

Start feasibility with rollback `journal_mode=DELETE`, `synchronous=FULL`, explicit foreign keys, defensive mode, disabled extensions, disabled trusted-schema execution where compatible, and memory temporary storage. This is deliberately conservative for low-concurrency local preview and simplifies sidecar ownership; it is not a hardware durability claim. WAL is not needed for this outcome and is not selected incidentally. Any future WAL choice must establish a fixed engine for the documented WAL-reset issue and renew affected review.

Compile versioned DDL into TypeScript under `infrastructure/storage/sqlite/`. Use local metadata plus `application_id`/`user_version` and an exact schema identity check; never repair unknown files with blanket `CREATE IF NOT EXISTS`. No local DDL goes into hosted migrations. The first version contains the existing relations, FKs/cascades/restrict behavior, live partial uniqueness, exact external key, preference/grant unique keys, enum/boolean checks and indexes. JSON uses validated UTF-8 JSON text with SQL NULL preserved separately; dates use integer epoch milliseconds and return `Date`. IDs retain existing opaque/UUID application shape, without promoting arbitrary ordering.

Connection admission has an explicit order: metadata-only path/sidecar preflight; internally constructed existing-only open; read and validate application identifier, version, exact schema, instance ID and expected identity target; only then apply/verify the accepted runtime settings or issue application writes. Constructor safety options may disable extension loading and enable defensive behavior before validation, but no application-issued persistent PRAGMA, schema DDL or metadata write precedes admission. Read-only PRAGMA queries are allowed. Incompatible non-recovery fixtures must remain byte-identical, including their schema/header settings. Existing access uses only an internally constructed existing-only `mode=rw` URI if the pinned driver supports it; no external URI/query/ATTACH/extension input is accepted. Existing-only behavior is a feasibility gate; failure pauses selection rather than accepting implicit create.

### File layout, admission and bootstrap

Inputs are absolute `LOCAL_DATABASE_ROOT` and `LOCAL_IDENTITY_STATE_ROOT`, distinct, non-overlapping private roots under trusted real ancestry. New DB root contains the canonical database and only recognized SQLite-owned rollback-journal or bootstrap-stage artifacts; WAL/shared-memory, super-journal and unknown entries are rejected for this first schema. Identity root validation is unchanged. Require current UID, root `0700`, data/journal files `0600`, regular non-symlink non-hardlinked canonical files, pinned ancestry/root/database device+inode, and exact logical target. Unsafe sidecar names/types/ownership/permissions/links fail BEFORE SQLite opens the database. Validate with pathname metadata and SQLite queries; never open/close a separate raw file descriptor to a database while SQLite uses it because POSIX close can cancel SQLite process locks. Worker threads share process POSIX locks: no main-thread direct DB read/copy/fsync/close is allowed while any SQLite connection is live. Do not load a second SQLite runtime; CP1 proves an independent contender remains excluded after every intended main-thread preflight.

SQLite owns rollback-journal recognition and intrinsic hot-journal recovery. Existing-only admission of a canonical file under the validated private root authorizes that engine transaction rollback, which can occur on the first read before schema/target validation and can rewrite DB/journal bytes. It does not authorize application-issued PRAGMA changes, schema repair, principal creation, identity-file publication, or removal of unknown files. If recovered content is foreign, incompatible, corrupt or target-mismatched, reject it without further mutation; do not falsely promise that pre-replay physical bytes survive. Journal-free rejected states retain byte-preservation guarantees. No code removes a journal as orphan cleanup or copies only a live main file. CP1 must demonstrate a genuinely hot journal produced by killing a writer, the committed logical snapshot restored by engine rollback, unchanged identity bytes, and byte-identical rejection of nonhot incompatible/foreign/version fixtures. Unsafe journal preflight must fail with source bytes untouched before SQLite runs. This distinguishes recovery of an interrupted SQLite transaction from resetting or reinterpreting application data.

Only fresh initialization with an absent/empty identity root may create a bootstrap stage. A preexisting canonical DB is always validated, never overwritten. Concurrent creators may build distinct private stages, but only a no-clobber winner publishes; losers clean only their own unpublished stages or stop on observed residue, never replace the winner. Normal startup rejects bootstrap residue.

Add the narrow SQLite-only `local-identity recover-database-bootstrap` command. It runs a database-bootstrap prephase BEFORE constructing/acquiring the canonical database coordination adapter; the existing identity `recover-initialize` command cannot reach an absent canonical database. The new command requires the operator to have terminated AND reaped every original bootstrap/runtime/admin process, all original SQLite handles closed, and the identity root absent or empty. It neither generates a principal/credential nor resumes identity initialization; after successful database recovery the operator invokes ordinary `initialize` separately. PostgreSQL reference commands remain unchanged.

| Bootstrap recovery input | Exact command outcome |
| --- | --- |
| No canonical DB; exactly one recognized nlink-1 stage; no sidecar | Validate complete current schema/metadata/integrity and zero application rows, close the stage connection, then publish no-clobber, fsync and remove only the redundant stage |
| Canonical and exactly one recognized stage are the same inode with exactly two links; no sidecar | With all original handles closed, copy into a newly owned private validation directory, validate that copy as complete current empty bootstrap, close it, recheck the original pair/pins, unlink only the stage and fsync the root; never open either original hardlink through SQLite |
| Partial/corrupt/incompatible stage, application rows, unsafe links/metadata, sidecar, multiple stages, unrelated canonical/stage, or nonempty identity root | Preserve originals and fail; do not choose a candidate, repair schema, delete a stage/journal or create a principal |
| No residue | Report fixed no-bootstrap-recovery-needed state; no mutation or implied initialization |

The validation copy has one owner, is never published as product data, and is closed/removed with its private directory on success/failure; interruption may leave only that independently named scratch directory, never silently grant it bootstrap authority. In the hardlinked-pair case, validation failure preserves both originals byte-for-byte. Test command reachability, every publication/crash boundary, exact link topology and scratch cleanup; a discovered ambiguity pauses implementation for affected plan review.

### Ordinary storage and transaction ownership

Each root repository operation or UoW owns its own connection; no root call can join another callback's transaction. Root multi-statement behavior preserves the port's characterized semantics. UoW uses explicit `BEGIN IMMEDIATE`, awaits the application callback, expires all frozen method-only facets, then executes `COMMIT`. Both run and serializable paths are one attempt; SQLite's single-writer serializable transactions can serve both without changing application policy. No nested callback reuse, implicit root fallback or provider types cross the boundary.

Ordinary SQLite calls may be synchronous within that owned connection with a short explicit busy timeout (candidate 250ms). This is a contention bound, not a total disk-I/O deadline; no same-thread timer is claimed to interrupt native SQLite. Simultaneous same-process/cross-process work uses separate connections, and a contending caller may fail. Map only provider-origin primary/extended UNIQUE/PRIMARY KEY codes to unique conflicts and BUSY/LOCKED transaction contention to serialization conflicts where the whole failed attempt has been rolled back; corruption, I/O, constraints and unknown errors are fixed unavailable failures. No SQL, path, values or raw cause is exposed. Provider-like caller rejection objects and `NaN` retain exact identity.

Preserve field-specific JSON/omission, date precision, namespace precedence, archive reuse, location/global/all distinction, definition-ID merge, suggestion union, current-user filters, inclusive history dates/cursors and reset counts/order/rollback. Grant order explicitly follows READ, SUGGEST, WRITE, DEFINE. Characterize PostgreSQL audit-prefix case and wildcard behavior during feasibility; do not silently use SQLite's case-insensitive LIKE or invent a public semantic change.

### Held identity ownership and bounded worker

The first candidate uses a dedicated `worker_threads` worker with one existing-only connection to the MAIN database. It sets `locking_mode=EXCLUSIVE` and acquires an actual exclusive lock (`BEGIN EXCLUSIVE` plus completed transaction), retaining ownership across every initialize/verify COMMIT until release closes the connection. PRAGMA alone or a read-only shared lock is insufficient. This excludes ordinary readers/writers during the short admin operation; it is a documented local tradeoff, not a new data-success guarantee. Separate coordination DB/native OS locking remains a fallback requiring renewed review if this candidate fails necessary behavior.

The parent owns the port handle and filesystem protocol. A small private typed request/reply channel supports open/acquire, transaction begin, exact identity snapshot/insert, commit, rollback, assertion and close; only principal and storage configuration cross it, never the bearer. Request IDs settle once. Fixed error classifications are sent without raw provider content. Every existing held operation category retains its externally observable bounded watchdog: the reference adapter's default outer deadline is 15,000ms for connect/acquire/query/rollback/release, and failed busy acquisition uses at most a 1,000ms close bound; SQLite busy acquisition itself is fail-fast. Feasibility must preserve those bounds or obtain affected review for a named change. A timeout, worker error/exit, protocol failure or unsafe runtime file pin latches the handle terminal and requests worker termination. No subsequent query, reconnect or reacquire is allowed. `assertHeld` synchronously checks parent state and pinned paths; asynchronous health checks supplement durable ordering.

Do not claim worker termination interrupts arbitrary native/kernel I/O. The parent must fail within its bound even if actual lock release is not yet proved, retain recovery authority, and report fixed recovery-required state; the lock remains until actual close/thread/process death. Named recovery still requires termination and reaping of the original PROCESS, not merely a rejected request or fulfilled terminate request. Worker lifetime is tied to that process, avoiding an orphan database service. A same-process attempt cannot override a still-held lock. A deliberate test-only stalled worker proves watchdog/latch behavior; real stopped/killed process tests prove release and recovery.

Initialize accepts only empty users/bindings or exact sole principal with every binding owned by it, ignoring later email changes. The validation callback runs after both snapshots validate and before insert/COMMIT while ownership stays held. Callback/state-conflict failures rollback and preserve caller errors; domain conflicts need not destroy an otherwise healthy handle because shared contracts verify two conflict calls. Provider/query failures are terminal. Any attempted/acknowledged COMMIT followed by failure has conservative recovery semantics.

Reusable coordination snapshots inside callbacks may use real queries on the held connection (including pending rows), since independent readers are excluded. They must not be cached/faked. Separate independent-process evidence proves exclusion before, DURING and AFTER COMMIT through publication/cleanup, and a fresh owner after release. Renew LM-015 mechanism wording after successful feasibility; preserve its durable authority and recovery contract.

### Consistent backup/restore feasibility

Select SQLite's backup API on the held worker connection after original runtime/admin processes are stopped and reaped and canonical-only identity is validated. Hold the same ownership across the SQLite snapshot, exact identity-byte copy and complete bundle publication; database snapshot alone does not fence rotation. Use a private unique stage, validate no preexisting destination, close/fsync contents and publish a completed bundle no-clobber. Never copy only a live database file or strip a hot journal.

Restore only into a NEW empty private destination and leave source untouched. Verify schema/integrity/FKs, logical target, exact principal and identity canonical bytes before startup. Restoring an old complete pair restores its old bearer/generation; demonstrate that explicitly and then rotate the restored credential without changing principal. An independent copy is a snapshot, not synchronization; simultaneous use of cloned identities is not introduced as a supported product workflow. This checkpoint demonstrates an internal mechanism, not a new final backup CLI/UX.

### Composition, reference compatibility and package closure

Default `local-identity` initialize/rotate/recovery/preview uses the new roots and SQLite assembly; absence of roots never falls back to PostgreSQL. Add explicit `local-identity-postgres-reference` compiled entrypoint with the old config and current adapter, retaining the old `local-identity-preview` mode and its tests/package/restart proof. Existing PG state remains bound to its original database/CA target and must never be reinterpreted as SQLite state. Hosted `main.js` remains default hosted selection. Shared application modules receive only storage tokens; local unavailable model and zero-listener behavior remain.

Seed the exact catalog through the selected local catalog port at documented startup, with idempotence and per-entry partial completion. Preserve account/credential authority if later catalog work fails. Keep the existing fixed command/preview stdout contract: supply an appropriate nonsecret/no-output catalog logger instead of inheriting `seedCatalog` console output. Workers/schema assets live in compiled package output, no repository/source/global lookup. The package smoke exercises the ACTUAL local CLI and preview twice from the sealed relocated backend with hostile cwd/env, no DB URL/Auth0/model inputs, exact runtime and complete production dependencies.

### Official source evidence

The bounded comparison uses official [Node SQLite API documentation](https://nodejs.org/api/sqlite.html), the [pinned Node SQLite source](https://github.com/nodejs/node/blob/v24.21.0/deps/sqlite/sqlite3.h), [SQLite locking mode](https://sqlite.org/pragma.html#pragma_locking_mode), [corruption and POSIX-lock hazards](https://sqlite.org/howtocorrupt.html), [SQLite backup](https://sqlite.org/backup.html), and [better-sqlite3 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0). These support candidate mechanisms and limits; actual pinned binary, failure and package tests decide acceptance. SQLite documents retained exclusive locks, and separately warns against independent raw file descriptor closes and live file manipulation. Its backup API provides a consistent database snapshot; matching identity authority still requires the protocol above.

## Checkpoints

All checkpoints belong to one PR. Tests precede each backend behavior change, targeted tests follow each incremental implementation, and unrelated passing checks are not rerun without changed inputs or unresolved evidence.

### CP1: Approve state/failure model and bounded feasibility

Initial independent architecture/scope, persistence/recovery, security/privacy, packaging, compatibility and test review must approve revision B (or corrected revision) before any feasibility program runs. Coordinator approval authorizes the bounded spike only. Add a focused file-backed Node feasibility suite, with a tiny compiled/relocated worker probe where needed; no full adapter yet.

Success criteria: exact binary/version/source/compile options and API availability; JSON/SQL-null/date/enum/FK/partial-index behavior; literal prefix/reference observations; absent/existing-only access, sidecar admission-before-open, unchanged bytes/settings for rejected nonhot incompatible fixtures, and true hot-journal replay with unchanged committed logical state/identity; transactional DDL+target/version crash behavior, staged no-clobber bootstrap and reachable pre-acquire bootstrap recovery including linked-pair copy validation; async callback lifetime/commit handling; bounded ordinary busy behavior; actual exclusive ownership after COMMIT from another process; parent watchdog/fail-latch and stopped/killed process cleanup; same held-worker backup with matching identity copy and restore; worker/driver load from standalone exact-runtime staging without new addon/dependency.

Failure criteria: any data/identity invariant, resource cleanup, bound, unsupported API or package-closure failure; hidden environment/provider dependency; inability to prove existing-only admission or held postcommit ownership. Stop the affected decision, retain evidence and revise/review. Do not build a second full implementation. After success, record selected database/library/versioning/transaction/backup rules, update LM-003 and affected LM-015 mechanism, and obtain affected independent approval BEFORE full adapter implementation.

### CP2: Bootstrap, data semantics and ordinary UoW

Write failing local bootstrap/security/version/target and UoW tests. Add compiled schema, secure database root/admission and narrow SQL helpers, then repository/UoW vertical slices. Run real file-backed reusable storage contracts without changing assertions and local equivalents of separate UoW commit/rejection/expiry tests. New dependency tests fail on node:sqlite/builtin aliases or concrete adapters from core. Keep driver errors and selection out of application and transport code. Continue targeted tests per slice.

### CP3: Held coordination, interruption and recovery

Write failing local held contracts, worker request/deadline/failure tests and real process fixtures. Implement held worker/session and route unchanged state protocol through it. Prove exact/empty reconciliation, changed email/bindings, both cross-root/database races, blocked/stopped owner, lost acknowledgement, rotation, all recovery artifact classes and terminate+reap ordering. Fault injection stays in fixture seams; no production fault channel, proxy or test secret enters packaged runtime.

### CP4: Real local application, backup and staged runtime

Write real SQLite-backed Nest/GraphQL-in-memory guard/use-case tests, identity resolver/M2M/profile contracts, reset/all-mode byte preservation, history/grants/access fail-open, catalog idempotence/partial failure, and actual CLI/preview integration before wiring the new composition. Keep the preview non-listening. Demonstrate matching-pair backup/restore with snapshot equality, credential restoration and rotation. Run isolated packaged local restart outside the repo under exact Node and production-only closure. Retain reference-mode evidence.

### CP5: Gate integration, canonical docs, fresh review and PR

Add a PostgreSQL-independent `test:local-database` project/command, discovered by CI and the authoritative gate. Add `local-database-preview` to registry and exact gate mode policy while keeping both existing modes and twelve phases. Extend relevant phase commands with local tests and package/restart proof; update command-policy/census/lifecycle tests and explicit resource journal ownership. No timeout increase without reviewed evidence. Update storage/local runtime/reset/audit/preferences/runbooks and baseline; preserve unchanged public/catalog fixtures. Run fresh complete base-to-candidate final specialist review, resolve findings, freeze candidate, run full exact-base gate and hygiene, commit/push/open one migration-template PR, and verify applicable standard/dedicated CI on final pushed head. Record workflow checkout SHA separately from PR branch head. Never merge or activate Step 06.

## Validation Matrix

All commands use Node 24.21.0 and pnpm 10.25.0. PG commands use a separate owned loopback fixture; local commands own private mkdtemp roots/files and supervisor-owned process groups. No live hosted providers.

| Surface | Required command/evidence |
| --- | --- |
| Activation/final aggregate | `MIGRATION_GATE_BASE_SHA=3426dc556fea88d94a360329e7c685bc9acc155e pnpm migration:gate` with exact Python and isolated admin/evidence inputs |
| Feasibility | Focused checked-in Node file-backed suite plus exact-runtime staged worker/backup proof, before adapter work |
| Local adapter/process/application | `pnpm --filter backend test:local-database`, no PG setup/URL; reusable suites and independent UoW/recovery/application evidence |
| Unit and retained PG | `pnpm --filter backend test:unit`; targeted and final `test:integration` / `test:e2e:tests-only` |
| Build/schema/dependency | Backend build, seed typecheck, Prisma generate, unchanged semantic schema check, storage graph negative fixtures |
| Gate scripts/package/restart | Targeted Node gate/lifecycle/discovery tests; actual local CLI and two previews from sealed relocated backend, with reference modes retained |
| Docs/hygiene | `node scripts/check-markdown-links.mjs`; `git diff --check`; `git diff --cached --check` |
| Remote | Applicable standard CI and dedicated migration workflow on exact final pushed head; actual synthetic checkout provenance recorded |

Every aggregate result records source/base, toolchain, performed comparison, caller integrity, every phase/timing, cleanup and limitations. Local macOS plus Linux CI is not Windows or hardware power-loss proof. Failed/invalid evidence remains historical and is never relabelled successful.

## Independent Review And Evidence

Approvals bind to revision plus named contracts/areas. Resolve all blocking initial findings before executable feasibility; after feasibility renew affected mechanism/decision reviews before adapters. Material deviations pause affected work. Fresh final reviewers cover the COMPLETE planning-base-to-candidate diff across architecture/maintainability, persistence/recovery, security/privacy, compatibility, tests, packaging and scope. Candidate stays frozen for review/validation; fixes require affected tests/rechecks and explicit carry-forward assessment for unaffected approvals.

| Revision | Reviewer / area | Finding / disposition | Approval |
| --- | --- | --- | --- |
| Initial A, `79ba7717`, plan SHA-256 `54691f27aa0ad28294d7b8a9bdd16c1fb4e7ffe2e597c0340f6b3fcdc6a91b83` | `/root/plan_architecture`, architecture/maintainability/packaging/scope | No blockers; initial bounded candidate and scope approved, not driver selection or adapters | Approved for CP1 only |
| Initial A, same frozen revision | `/root/plan_persistence`, persistence/recovery/security/privacy | B1 blocked unspecified admission/PRAGMA ordering and hot-journal authority; B2 blocked unreachable bootstrap recovery. Revision B adds ordered admission and explicit intrinsic-replay limits/tests plus named pre-acquire command and exhaustive bootstrap outcomes | Blocked A; B review pending |
| Initial B | Same affected reviewers plus fresh `/root/plan_compatibility` | Corrected plan; no feasibility code has run | Not yet approved |

## Parallel Work And Conflict Surfaces

`/root/step05_writer` owns every change, including plans/docs, schema, config/composition, state integration, driver, tests, generated output, manifest/lockfile, registry/gate/CI and Git/PR. All other agents remain read-only. Separate test invocations never share writable DB files, roots, ports or build/dependency trees; only a single-owner dedicated concurrency fixture intentionally shares a DB among supervised actors. No implementation lane overlaps Step 05.

## Privacy And Security

The new local runtime has no network/database server dependency and opens no listener; Host/Origin/CSRF/DNS-rebinding remain later transport requirements, not bypassed by this step. Human bearer stays only in private identity/candidate files and parent authentication memory, never database rows, worker messages, argv/env, logs or errors. Provider faults and worker failures emit fixed diagnostics without SQL, paths, values or causes. File ownership and strict ancestry protect against other UIDs; same UID/root/debugger/runtime/kernel/hardware compromise and network filesystems are outside this preview's guarantee. Do not promote a package startup smoke into a full transitive offline audit.

## Rollback Or Recovery

Code rollback stops local/admin processes and waits for exact exits, preserving all SQLite and identity state. Earlier Step 04 code cannot read new SQLite data; retain it intact until compatible code is restored. Reference PostgreSQL state stays at its own original database/root and is operable only with its explicit reference command; no deletion/import/rebinding occurs. Never run hosted migrations against local files or downgrade local schema in place.

Named identity recovery runs only after all original admins are terminated and reaped. Worker timeout/loss does not authorize takeover. Preserve operation/candidate until matching empty/exact reconciliation; preserve corrupt/incompatible/unknown state for diagnosis. A restored backup goes to a new empty destination and carries its prior credential generation; rotate that restored bearer when prior backup credentials must be invalidated. No command treats missing or mismatched state as destructive-reset permission.

## Risks And Decision Gates

- Worker-owned exclusive lock and externally bounded failure must be proved on pinned runtime; CP1 owns selection, then persistence/security review approves mechanism.
- Bootstrap hardlink/sidecar crash states and database file replacement can break authority; CP1/CP2 tests plus recovery review must enumerate rather than silently repair.
- Synchronous ordinary busy waits can delay unrelated same-process work; short bounded busy policy and contention tests must show acceptable failure without stronger all-writers-success claims.
- Schema/JSON/history prefix/enum/cursor differences can silently drift; reference characterization and shared contracts govern.
- Existing contract fixtures contain PG-specific injection/scheduling; local fixtures must witness actual writes and preserve assertions without forcing impossible two-writer read barriers.
- Windows, network filesystem, final install/backup UI and hardware durability remain Step 09; no unsupported claim is made.

## Exit Criteria And Closeout

One independently reviewed PR provides the actual local runtime, full file-backed contracts/application/process/recovery and backup evidence, compiled staged restart, current canonical docs/registry/gate, final exact-base local gate and final pushed-head standard/dedicated CI. All blocking plan/final findings are resolved. Human review and merge are the only landing action remaining. Step 05 stays the sole active primary step until a later authorized activation records its human merge; Step 06 is not activated. Retain Step 03/04 plans while their contracts remain needed.
