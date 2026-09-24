# Storage Boundaries

- Status: current
- Read when: changing persistence, adding a storage adapter, or changing transaction or local identity coordination behavior
- Last reviewed: 2026-09-23
- Source of truth: `apps/backend/src/domains/shared/storage/`, behavioral repository tokens in feature modules, `apps/backend/src/infrastructure/storage/postgres/`, `apps/backend/src/infrastructure/storage/sqlite/`, `apps/backend/test/integration/storage-contracts/`, and `apps/backend/test/local-database/`

## Ownership And Composition

Application code owns plain rows, JSON types, runtime enum objects, repository commands, history filters, and transaction behavior. The existing repository class names in feature modules are abstract dependency-injection tokens. They accept concrete application inputs, never provider query objects. PostgreSQL remains the hosted reference adapter. The local SQLite adapter follows the same application-owned boundaries and the reviewed Step 05 database decision.

`PostgresStorageModule.registerHosted()` is selected by hosted `AppModule`; `registerLocal(poolConfiguration)` belongs to the explicit PostgreSQL reference infrastructure root. Default `LocalIdentityInfrastructureModule` selects `SqliteStorageModule` from two explicit independent private roots. Feature modules consume exported behavioral tokens and do not select a driver. The local preview remains non-listening and excludes MCP transport, hosted identity providers and model I/O. The administration CLI, preview bootstrap, production seed and smoke scripts are operational composition entrypoints. Reference PostgreSQL URL/TLS/pool configuration and local SQLite root configuration remain infrastructure responsibilities.

The dependency check starts at every production TypeScript file under `src/common`, `src/domains`, `src/mcp`, and `src/modules`, excluding only the exact local administration CLI entrypoint as a root. It follows internal imports and re-exports, including type-only edges, aliases and literal loaders. Provider packages (including the exact `node:sqlite` builtin), generated Prisma code and concrete storage infrastructure are forbidden on these paths; known loaders with nonliteral targets fail closed. Configuration is traversed when imported, so a core caller cannot hide a provider edge in a configuration barrel. Explicit composition/bootstrap/infrastructure files are outside the core root set. Tests and operational Prisma scripts may use the reference adapter. This is a dependency rule, not a JavaScript sandbox.

Core syntax cannot obtain Node's `createRequire` capability from `module`/`node:module` or `getBuiltinModule` capability from `process`/`node:process` (including direct global `process` access): named imports/re-exports (including aliases), namespace/default/import-equals static member access, CommonJS loads/destructuring and direct awaited literal imports are rejected. Wildcard/namespace re-exports of those builtins are rejected because they expose the capability through a barrel. Other builtin exports and ordinary external packages remain permitted. The rule recognizes these bounded syntax forms rather than tracking arbitrary returned functions. Unresolved relative/absolute imports and aliases matching the actual `tsconfig.paths` exact or single-wildcard patterns fail closed; unrelated scoped packages and builtin imports do not become internal paths.

## Ordinary Transactions

`StorageUnitOfWork.run(callback)` uses the adapter's existing default isolation and makes one attempt. `serializable(callback)` explicitly selects serializable isolation and also makes one attempt. Retry policy belongs to the identity use cases. Successful results are delivered only after commit acknowledgement.

The callback receives frozen, method-only facets for preferences, definitions, audit, identity and reset, all bound to one transaction. There is no raw client, generic query language, transaction argument or root-client fallback. Every operation must be awaited. Facets and extracted methods expire when the callback settles, before commit acknowledgement; later calls fail with `StorageScopeExpiredError`. A facet cannot be supplied to another store or transaction. Rollback and commit failure never make captured capabilities reusable.

Hosted and local Nest composition do not register a root `PreferenceAuditService` binding. Production mutation audit append is supplied through `StorageUnitOfWork`'s scoped audit facet; history queries keep their separate read token. This removes an unused injection path without restricting existing root repository methods or redesigning transaction/audit behavior.

Preference and definition use cases preserve their existing validation and ownership reads before the transaction. Each set, suggest, accept, reject, delete, definition create, update and archive commits its mutation and audit together. Accept performs active upsert, suggestion delete, then audit; reject performs rejected upsert, audit, then suggestion delete. Batch suggestions and the catalog retain per-entry partial completion rather than acquiring a batch transaction. Access logging stays outside this transaction and remains best-effort; an append failure cannot undo a successful domain mutation and audit.

Reset owns one ordinary transaction with its original operation order and mode-specific counts. The cross-user definition-reference check is inside that transaction, so a conflict or late failure restores prior deletes. Every mode preserves principal and external identities and, in local composition, the exact identity file bytes. See [reset](DATA_RESET.md) and [audit/access history](AUDIT_AND_ACCESS_HISTORY.md).

## Data, Ordering And Failures

Owned enums preserve the existing values, declaration order and GraphQL registration names. Rows use plain fields, `Date` timestamps and recursive JSON values; transport schema, descriptions, nullability and MCP payloads are unchanged. Null and omission remain field-specific:

| Write | Meaning |
| --- | --- |
| Preference evidence omitted or null | Clear to database null, on create and update |
| Audit/access optional JSON omitted or null | Omit the write field |
| Definition options on create | Null becomes an unset field |
| Definition options on update | Omission preserves; explicit null clears |
| Verified binding metadata | Explicit JSON null |
| Aggregate reset audit before/after | Preserve the existing null writes |

Global versus location queries retain the difference between undefined (all), null (global), and a location ID. Active location overrides merge by definition ID; suggested values form a union. Preference updated-time, location created-time, definition slug, and archived-definition updated-time ordering retain unspecified ties. History alone has the existing deterministic `(occurredAt DESC, id DESC)` cursor, inclusive time bounds and current-user AND filters. Grant ordering retains enum declaration order and application specificity/deny rules.

Live definition uniqueness permits reuse after archive and preserves archived rows. Preference upserts remain read-then-create/update: concurrent first writes may have a losing unique conflict; existing-row updates do not promise locking or compare-and-swap. Location first-write races have no new uniqueness guarantee. Reference-adapter contracts do not promise that every concurrent caller succeeds or impose an arbitrary tie order.

Adapters map provider-origin unique and serialization failures to `StorageConflictError` with a fixed kind; other provider failures become fixed `StorageUnavailableError` messages without provider causes, SQL or payloads. Caller exceptions and rejection values retain their identity, including errors carrying provider-like properties. No provider-specific error code escapes as an application retry requirement.

Human identity still validates the verified assertion before storage, uses the exact provider/issuer/subject key, and makes five fresh serializable attempts. Only a final unique conflict allows the exact-key winner lookup. It never joins by email. Profile hints remain independently normalized and seed memory best-effort only after first-creation commit. M2M compatibility separately makes five attempts for deterministic principal upsert/binding count and retains its exact email/zero-binding checks; it does not create a human binding.

## Held Local Identity Coordination

`LocalIdentityCoordination.acquire()` returns a dedicated, non-pooled ownership handle distinct from an ordinary transaction. Busy acquisition fails promptly. Connect, lock/query, rollback and release are bounded. A query, deadline or ownership failure latches the handle unusable; it never reconnects, silently reacquires or permits later queries.

`initialize(state, afterValidation)` accepts an empty users/bindings snapshot or the exact sole principal with every binding owned by it. `verify` requires that exact owner. Email is neither compared nor rewritten. The PostgreSQL reference holds ordered table locks; SQLite holds an EXCLUSIVE main-database lock across validation, commit and filesystem work. The callback runs only after successful validation, before insertion/commit, while ownership and those locks remain held. Callback failure rolls back; conflict never invokes the callback. Initialize reports inserted/matched only after acknowledged commit. The callback therefore remains suitable for the state service's existing protected recovery cleanup.

The handle remains owned through filesystem publication and cleanup. `assertHeld` checks are supplementary to the durable operation fence. Release is idempotent and externally bounded, destroys on failed unlock/end, and leaves the handle terminal. SQLite parent deadlines request termination and reject without claiming native I/O interruption; native ownership remains reserved until actual worker exit. State-service cleanup preserves the primary operation failure; a release failure is surfaced when there is no primary failure. Any uncertain commit, lost handle or failed release after attempted/acknowledged commit requires recovery. It must not be reinterpreted as safe rollback, retried initialization or permission to choose a new principal.

LM-015 still governs durable operation/candidate ordering, no-clobber ready publication, and operation removal last. Recovery requires the original processes to be terminated **and reaped**; a newly available DB lock is insufficient. Empty/exact reconciliation preserves the original candidate. Orphan/pre-candidate cleanup classes that prove DB mutation impossible by artifact ordering intentionally do not acquire a new universal empty/exact-user precondition. Credential rotation keeps the principal, and both same-root/different-DB and same-DB/different-root races remain fenced. See the [administration runbook](../useful/LOCAL_IDENTITY_ADMIN.md) and retained [Step 03 protocol](../plans/active/local-migration/03-local-identity/plan.md).

## Catalog And Adapter Evidence

The application catalog loop consumes a small catalog storage interface. It preserves source entry order, active IDs on repeated seeding, personal-definition precedence, retained archived/stale globals, warnings and per-entry partial progress on a later failure. The PostgreSQL production `prisma/seed.ts` entrypoint now creates catalog definitions only; it creates no sample users and leaves existing principals/bindings unchanged. It imports the canonical data module explicitly because the sibling `preferences.catalog.json` previously shadowed the TypeScript wrapper under plain ts-node resolution.

Reusable suites are registered by `test/integration/storage-contracts/postgres-*.spec.ts` against real PostgreSQL. They assert rollback after witnessed late failure, row restoration and attribution, JSON persistence, ownership, ordering/cursors, cascades, controlled conflicting first writes and held coordination. Provider-specific fixtures implement setup/failpoint observation; shared assertions use application behavior. Existing repository, GraphQL/MCP, identity/TLS/process/recovery and reset suites remain additional evidence. `seed-production.spec.ts` executes the actual production require-main path twice, independently of automatically seeded test setup. Unit tests prove callback lifetime, commit acknowledgement, failure classification and neutral fakes. The unchanged twelve-phase migration gate discovers these suites and retains consumer/schema, restart and packaged-composition checks.

The standalone `test:local-database` project runs real file-backed adapters, unchanged shared storage/held assertions, actual resolver/Nest/reset/MCP use cases, and owned process/recovery/backup tests without PostgreSQL setup or `DATABASE_URL`. Its prerequisite builds the compiled worker. Standard CI and the twelve-phase gate invoke it explicitly; the gate additionally requires both reference and SQLite source/relocated-package restart evidence. Local initialize/preview seed the catalog quietly, preserving committed entry prefixes on later failure.

SQLite version-one schema and random target metadata are private adapter resources compiled into the production closure. The selected Node builtin adds no native addon dependency. Ordinary SQLite transactions make one yielded `BEGIN IMMEDIATE` attempt with zero busy wait; application retry policy stays unchanged. Full schema, safe roots, current file pins and target are validated on each new connection. See the administration runbook for intrinsic hot-journal/WAL-header admission effects and closed-copy backup rules.

Step 04's extraction used the same PostgreSQL database/root on rollback. Step 05 adds a separate store: stop and reap local processes, preserve SQLite and identity files, and restore compatible code before reopening. Earlier PostgreSQL-only binaries cannot read local SQLite state; reference PostgreSQL state remains separately operable through its explicit command. There is no historical-data conversion, provider call or new listener. Windows and hardware power-loss qualification remain outside local macOS/Linux CI evidence.
