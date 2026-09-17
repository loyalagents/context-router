# Local Migration Decision Log

- Status: active decision record
- Last reviewed: 2026-09-16

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

### LM-010: Step 01 product-scope baseline

- Status: Accepted
- Decision: the versioned
  [`LOCAL_MIGRATION_CONTRACT_BASELINE.md`](../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md)
  and its JSON registry govern the retain/replace/remove/defer disposition of
  current capabilities and public/package surfaces. The local orchestrator is
  temporary developer tooling, deterministic eval remains developer/evaluation
  tooling, and live provider or Harbor paths are never installed-product or
  merge-gate dependencies.
- Consequence: later steps preserve or deliberately evolve the registered
  outcome and consumer contracts. A public breaking change follows LM-008, and
  a deferred question remains owned by the roadmap step recorded in the
  registry rather than becoming an unscoped backlog item.

### LM-011: Local Migration Baseline Gate

- Status: Accepted
- Decision: `pnpm migration:gate` is the authoritative aggregate compatibility
  gate across migration steps. Its checked-in lifecycle manifest may retire a
  phase only with reviewed replacement evidence, and every supported mode must
  keep an active clean-restart smoke.
- Consequence: local and CI validation use the same root command. Later steps
  expand replacement-mode evidence before retiring hosted-only coverage; they
  do not silently drop phases, invoke live providers, or replace the gate with
  an undocumented CI-only command list.

### LM-012: Step 01 runtime evidence boundary

- Status: Accepted
- Decision: the dedicated Step 01 workflow selects Node 20, pnpm 9, Python
  3.12, and PostgreSQL 15. The local aggregate gate enforces Python 3.12 and
  safe database locality/targeting, and records rather than pins the observed
  Node, pnpm, and PostgreSQL versions. Step 02 owns the exact supported Node and
  package-manager contract plus packaging-runtime validation.
- Consequence: Step 01 evidence must state the versions actually exercised and
  may not promote a developer's toolchain into the product contract. A later
  version change is a Step 02 decision and must keep the Step 01 aggregate gate
  green or update it through reviewed replacement evidence.

### LM-013: Exact Step 02 runtime and package-manager target

- Status: Accepted
- Decision: Step 02 selects exact Node.js 24.21.0 and pnpm 10.25.0 for
  installation, builds, the Local Migration Baseline Gate, and packaging
  evidence. This is a reviewed target, not yet a support claim. It becomes the
  supported contract only when PR 02B atomically aligns all version sources,
  eval discovery, Docker, CI, and documentation and the complete exact-runtime
  gate passes locally and remotely. Until then LM-012 evidence governs.
- Evidence: the exact Step 01-base gate passed all 11 phases on Node 20.19.5 and
  pnpm 10.25.0. Supplemental already-installed Node 22.13.1 and 24.18.0 runs
  passed phases 1–5 and exposed the same phase-6 directory test-discovery defect;
  the quoted recursive test glob passed all 364 eval tests on Node 24 without
  fixture changes. On the active PR 02B worktree, a frozen pnpm 10.25.0 install
  left the lockfile byte-identical, `pnpm eval:verify` passed 364 tests plus
  fixture validation, and the full gate bound to PR 02A merge
  `5a2fc8a09e9091d16160caea258d678293a1e2b3` passed all 11 phases on Node
  24.21.0/pnpm 10.25.0; the post-review full-tree rerun reported
  `baseComparison=performed`, caller integrity true, and clean resource cleanup.
  Exact elapsed time is retained in the PR evidence rather than this repository
  record. Remote final-head evidence is still required before this target
  becomes the supported merged contract.
- Consequence: PR 02B rejects other Node majors and Node 24 patch releases, or
  other pnpm versions, before resource acquisition. A future patch/version
  change requires reviewed evidence and atomic metadata/CI/documentation
  alignment; it may not regenerate fixtures merely to force the upgrade.
  Windows remains analysis-only until a native shell-free pnpm resolution path
  and gate pass exist. Required final-head remote evidence comes from the
  dedicated migration workflow and applicable standard CI; LM-014 excludes
  Vercel preview builds from this exact-toolchain contract rather than
  weakening the checker.

### LM-014: Vercel is outside the local-first `main` contract

- Status: Accepted
- Decision: Vercel previews and deployments are not part of the supported
  local-first `main` product or its required merge evidence. Vercel production
  remains on `hosted-v1-maintenance`; GitHub Actions supplies the required
  final-head evidence for local-first pull requests.
- Consequence: before PR 02B lands, an operator verifies that automatic Vercel
  preview/deployment creation is disabled for `main` and its local-first pull
  request branches, no GitHub rule or branch-protection setting requires a
  Vercel status, and Vercel production still follows
  `hosted-v1-maintenance`. An informational Vercel status cannot establish or
  replace the exact Node.js/pnpm evidence. Reintroducing Vercel for local-first
  `main` requires a new reviewed decision and a runtime contract that its
  selector can satisfy without a checker bypass.

## Deferred Decisions And Owning Steps

| Decision | Owning step |
| --- | --- |
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
