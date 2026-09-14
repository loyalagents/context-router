# Local Migration Decision Log

- Status: active decision record
- Last reviewed: 2026-09-13

This file records decisions that affect more than one migration step. Keep each
entry concise. Detailed alternatives and implementation mechanics belong in the
step plan that resolves them.

## Status Vocabulary

- `Accepted`: governs current planning and implementation.
- `Provisional`: current direction; the owning step must validate it before use.
- `Deferred`: intentionally not being decided yet.
- `Superseded`: retained only while this migration is active, with a link to the
  replacing decision.

## Decisions

### LM-001: Local-first product line

- Status: Accepted
- Decision: `main` becomes the local-first product line. The existing hosted
  application is preserved on `hosted-v1-maintenance`.
- Consequence: hosted fixes and local changes use separate PR targets; shared
  fixes are deliberately cherry-picked. As operator-confirmed on 2026-09-13,
  Vercel production follows `hosted-v1-maintenance`; re-verify that external
  setting before changing either branch's role.

### LM-002: No legacy data or user migration

- Status: Accepted
- Decision: local installations begin with fresh state. PostgreSQL data, Auth0
  users, sessions, and hosted configuration are not imported.
- Consequence: the local schema can use a clean baseline instead of translating
  the hosted migration history.

### LM-003: SQLite for local application data

- Status: Provisional
- Decision: SQLite is the current local persistence candidate. Step 05 must confirm
  it and choose the access library, schema bootstrap, transaction rules, and
  backup mechanism before implementation.
- Consequence: application code must depend on storage behavior rather than
  Prisma/PostgreSQL-specific types or query semantics.

### LM-004: No cloud sync in the initial local product

- Status: Accepted
- Decision: do not implement dual writes, replication, accounts for sync, merge
  resolution, or local-to-cloud data migration during this program.
- Consequence: future hosting means adding adapters or a separate deployment,
  not synchronizing an existing local database.

### LM-005: Local model by default

- Status: Accepted
- Decision: normal product flows use a locally hosted model. Hosted model or
  agent comparisons are explicit evaluation operations. The runtime and exact
  supported capabilities remain deferred to Step 06.
- Consequence: tests and UI must never imply that a local-only operation stayed
  on-device if it invoked a remote provider.

### LM-006: Loopback-first service exposure

- Status: Accepted
- Decision: HTTP and MCP listeners bind to loopback by default. LAN access is a
  later, explicit mode with authentication and clear exposure controls.
- Consequence: `0.0.0.0` is never the implicit development or packaged default.

### LM-007: One application core, multiple edge adapters

- Status: Accepted
- Decision: identity, persistence, model execution, and transport concerns meet
  the application through explicit boundaries selected at composition roots.
- Consequence: future hosted support should add adapters, not fork domain logic.
  This does not require maintaining every hosted adapter on `main` today.

### LM-008: Expand, migrate, then remove public contracts

- Status: Accepted
- Decision: route, GraphQL, and MCP contract changes are additive until supported
  in-repo and external consumers are inventoried, migrated or covered by an
  explicit compatibility window, and the removal gate is approved.
- Consequence: transport URL changes are tracked separately from GraphQL schema
  changes and MCP tool-name/input/output changes. Breaking changes require
  configuration/release guidance and cannot be justified only by the absence of
  an in-repo caller.

### LM-009: One repository during the migration

- Status: Accepted
- Decision: the local application, preserved hosted line, shared contracts, and
  migration documents remain in this repository. Do not create a second product
  repository as part of this program without a new reviewed decision.
- Consequence: short-lived migration branches target `main`; package boundaries
  may evolve without adding cross-repository versioning and release overhead.

## Deferred Decisions And Owning Steps

| Decision | Owning step |
| --- | --- |
| Capabilities and public surfaces to retain, replace, remove, or defer | `01-contract-baseline-and-product-scope` |
| Whether local-orchestrator and eval tooling are product surfaces or developer-only tooling | `01-contract-baseline-and-product-scope` |
| Supported operating systems, process topology, signing, and distribution constraints | `02-composition-boundaries` and `09-installation-and-packaging` |
| Stable local principal ID, display/email behavior, and credential storage | `03-local-identity` |
| Local database choice; if SQLite is confirmed, its library and schema/bootstrap mechanism | `05-local-database-runtime` |
| Local model runtime, supported capabilities, and download policy | `06-local-model` |
| Exact offline guarantee before and after model assets are installed | `06-local-model` and `09-installation-and-packaging` |
| Local MCP transport mix: streamable HTTP, stdio adapter, or both | `07-local-mcp` |
| Local UI/desktop shell and process topology | `08-local-ui` and `09-installation-and-packaging` |
| Application update channel and rollback mechanism | `09-installation-and-packaging` |
| LAN pairing, credentials, discovery, and TLS expectations | `10-lan-mcp` |
| Shape of a future hosted deployment | `11-hosting-portability-check` |
