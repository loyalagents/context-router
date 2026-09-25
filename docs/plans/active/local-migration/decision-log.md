# Local Migration Decision Log

- Status: active decision record
- Last reviewed: 2026-09-24

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

- Status: Accepted — Step 05 CP1 selection reviewed at `0a6cda5af9ec90415792d2813f097e6bce62bfaa`
- Decision: use SQLite for local application data with the reviewed access,
  bootstrap, transaction and backup mechanisms below. Production contract and
  package validation remains required before landing.
- Consequence: application code must depend on storage behavior rather than
  Prisma/PostgreSQL-specific types or query semantics.
- Step 05 CP1 accepted selection: Node 24.21.0 built-in
  `node:sqlite` / SQLite 3.53.4, fresh versioned compiled schema plus random logical
  target, closed-stage bootstrap and explicit recovery, DELETE/FULL journals,
  owned one-attempt connections with busy timeout zero and one pre-BEGIN
  scheduling yield, and quiescent matching-pair backup/new-root restore. The
  [feasibility record](05-local-database-runtime/feasibility.md) binds the exact
  evidence, admission limits and compatibility rules. Independent architecture,
  compatibility and persistence/security reviews approved the frozen selection;
  the coordinator authorized tests-first production implementation.
- CP2 admission clarification (affected persistence/security review approved):
  inspecting a sidecar-free unsupported WAL header can transiently create empty
  engine WAL/SHM files before rejection. Reject non-DELETE before configured
  settings; normal close restores the entry set without main/identity conversion.
  Crash or uncertain close may retain those files; preserve and reject them,
  never application-unlink or implicitly recover WAL. Native-owner fencing remains.

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

### LM-013: Exact Step 02 runtime and package-manager contract

- Status: Accepted
- Decision: Step 02 selects exact Node.js 24.21.0 and pnpm 10.25.0 for
  installation, builds, the Local Migration Baseline Gate, and packaging
  evidence. PR 02B atomically aligned the version sources, eval discovery,
  Docker, CI, and documentation; passed the complete exact-runtime gate locally
  and remotely; and was human-merged through
  [#158](https://github.com/loyalagents/context-router/pull/158) at
  `5a8b640a883dd33d42239d3a74e827cc17ffaae3`. The exact pair is therefore the
  supported `main` contract; LM-012 remains historical Step 01 evidence.
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
  record. PR 02B head `e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` then passed
  all applicable standard CI jobs in run `35173087186` and the dedicated
  11-phase baseline gate in run `35173087176`. The target has satisfied its
  implementation evidence and was human-landed at the merge SHA above.
- Consequence: the landed contract rejects other Node majors and Node 24 patch releases, or
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
- Consequence: the Vercel project uses the external `Only build production`
  ignored-build policy. A local-first branch may still create a canceled
  preview deployment record or informational status, but the ignored-build
  check must cancel it before the configured application build proceeds and it
  is never merge evidence. Canceled previews still consume a deployment and a
  concurrent-build slot; that cost is accepted because hosted deployments are
  infrequent. Before PR 02B lands, an operator verifies that policy, verifies
  no GitHub rule or branch-protection setting requires Vercel, and confirms
  Vercel production still follows `hosted-v1-maintenance`. No repository
  `vercel.json` branch allowlist is added: the infrequently used hosted
  deployment remains an explicitly re-verified external topology. Reintroducing
  Vercel builds for local-first `main` requires a new reviewed decision and a
  runtime contract that its selector can satisfy without a checker bypass.
- Verification: on 2026-09-16, PR
  [#158](https://github.com/loyalagents/context-router/pull/158) head
  `e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` received a
  successful Vercel status labeled `Canceled by Ignored Build Step`, confirming
  that the ignored-build check stopped the preview before the configured
  application build. Repository inspection found no rulesets and no `main`
  branch protection, so no GitHub rule required Vercel. The production branch
  remains the operator-confirmed `hosted-v1-maintenance` setting recorded in
  the orchestration document. This observation closes the external PR 02B gate
  but is not required merge evidence.

### LM-015: Stable human principal and local identity preview

- Status: Accepted — materially revised Step 03 plan approved by renewed
  architecture, persistence/recovery, compatibility, and security review
- Decision: `User.userId` remains the provider-neutral human principal. A
  verified provider edge emits one narrow assertion, and external identity is
  keyed exactly by provider, canonical issuer, and subject. Email and display
  attributes are never authentication, authorization, lookup, or implicit
  account-linking inputs. Existing users are not migrated: in accordance with
  LM-002, an upgraded main-line PostgreSQL fixture deletes user-owned data
  before installing the required issuer key rather than backfilling a sentinel
  or preserving/linking historical accounts. A fresh local installation
  generates an independent opaque principal and credential in versioned private
  state under an explicit absolute root. A durable root operation and complete
  candidate precede database mutation; explicit recovery resolves empty/exact
  commit state before canonical ready publication. Step 03 exposes that
  implementation as a non-listening initialized Nest application preview that
  calls `init()` but never `listen()`; local MCP credentials and browser
  sessions remain separate later-step concerns.
- Product-line disposition: this is `local-only` main-line migration work.
  Auth0 remains only one edge adapter for fresh main-line state.
  `hosted-v1-maintenance` is unchanged; Step 03 is not a production remediation
  and authorizes no backport or cherry-pick. A future hosted-production fix
  requires a separate maintenance decision.
- Consequence: Steps 04–08 use the stable principal rather than email, provider
  subject suffixes, MCP client keys, machine identity, paths, or database row
  order. `User.email` remains non-null account/profile data but loses uniqueness
  and all identity authority, so distinct exact provider keys may expose the
  same verified email without merging. A new provider verifies its credential
  and emits the same assertion;
  generic resolution and storage do not add a provider switch. The backend
  Auth0 Management/Authentication SDK clients are removed; the retained hosted
  adapter uses verified JWT claims and JWKS only. Different exact
  keys create different principals unless a later explicit link flow starts
  from an already-authenticated principal. Steps 04–05 must preserve the
  durable operation/candidate, empty/exact recovery, and advisory-session
  fencing contracts when replacing the temporary PostgreSQL adapter. Step 07
  adds distinct local MCP client auth;
  Step 08 adds a browser/session exchange without exposing the file credential;
  Step 09 owns final paths, keychain/process isolation, backup, and destructive
  identity reset. A reachable local listener remains unauthorized without
  Host/Origin/CSRF/DNS-rebinding evidence.
- Step 05 accepted mechanism (reviewed at the same CP1 revision): preserve the durable
  operation/candidate, empty/exact reconciliation, terminal ownership and
  terminate-AND-reap recovery contract using a worker-owned main SQLite
  connection retaining an actual EXCLUSIVE lock across COMMIT and filesystem
  publication/cleanup. Parent watchdog failure and actual native release remain
  distinct; no reconnect/takeover follows timeout. PostgreSQL advisory ownership
  remains the explicit reference mode. Database instance identity is persisted
  metadata, independent of movable paths/inodes. The
  [CP1 record](05-local-database-runtime/feasibility.md) documents the reviewed
  bootstrap/journal and matching-pair backup mechanisms without changing the
  stable principal or credential protocol. The affected independent selection
  reviews explicitly approved this mechanism; full production recovery and
  packaged-runtime evidence remains required.

### LM-016: Risk-weighted agent execution and bounded PR sequencing

- Status: Accepted — user-requested working preferences for Steps 04 onward
- Decision: use the allocations in [`agent-execution.md`](agent-execution.md),
  including Astra Ultra coordinators for Steps 04–05, Extra High for critical
  persistence/security work, and High for routine tasks. Accept slower reasoning
  on sensitive decisions; improve speed through safe parallelism and less
  duplicate work. These are project preferences, not model-quality guarantees.
- Consequence: record role/model/effort and sole-writer ownership at activation.
  Prefer one PR per step; a second needs a reviewed concrete landing rationale,
  and more than two needs an explicit human decision. Checkpoints and useful
  review waves do not become separate PRs. Re-review affected contracts after
  changes, retain independent final-diff review and exact-head validation, and
  leave merging to a human. This activates no future step and changes no
  product, recovery, interface, or migration-gate contract.

### LM-017: Apple Silicon first, manual model setup before managed lifecycle

- Status: Accepted — user-requested platform and setup preferences, 2026-09-24
- Decision: the first supported local-model path targets Apple Silicon Macs.
  Manual runtime/model installation and launch are acceptable in Step 06.
  The eventual application should manage its runtime and model assets, without
  making users operate a separate model product. Windows and Linux are intended
  near-term targets, not abandoned platforms or already supported whole apps.
- Consequence: Step 06 owns a reproducible manual setup and application adapter;
  Step 09 owns product-managed downloads, supervision, installation and updates.
  Schedule native Windows/Linux qualification early in Step 09, soon after the
  Mac path works and before final packaging decisions. Early overlap requires
  reviewed ownership; engine support and Linux CI do not prove native app support.
  Do not weaken identity/filesystem protections to claim portability.
- This does not approve an exact minimum Mac/RAM, runtime, model, download,
  license, final process topology or a multi-platform implementation in Step 06.

### LM-018: One local inference candidate, measured before integration

- Status: Provisional — research-informed Step 06 planning preference
- Proposal: start with a pinned manually launched `llama.cpp` server using a
  protected inference credential on literal loopback. It is a plausible stepping
  stone to an app-private Step 09 sidecar, not a final packaging decision. Use
  Ollama as a challenger only if the bounded feasibility evidence justifies it;
  do not implement a multi-runtime framework now.
- Ownership and future options: a fully managed application may retain a
  separate inference process permanently; embedding is not a required end state.
  Keep inference separate from lifecycle ownership so a later app-owned process
  can reuse the adapter. Step 06 must not start, stop or restart the user's
  manually managed server. Step 09 may supervise only a verified app-owned
  instance and decides final topology plus whether an advanced external-server
  mode has a demonstrated use case. Manual setup now is not a commitment to
  permanent external-server support, embedded inference or dual-runtime modes.
  Preserve options through existing AI ports, not additional implementations.
- Selection gate: independently review the plan before executable feasibility,
  then review the measured runtime/model/capability choice before full adapter
  implementation. Evaluate actual application tasks and Zod schemas, memory and
  latency, file-format behavior, authentication, offline use, cancellation and
  serving-capacity recovery. Keep live evidence distinct from deterministic CI.
- Model candidates: a small Qwen3.5 4B/9B Q4-class GGUF comparison is a starting
  hypothesis, contingent on hardware, artifact provenance, licenses and quality;
  it is not a promise that either model satisfies every retained capability.
  Pin versions/hashes, template/thinking mode, context and budgets at selection.
- Consequence: preserve the existing application boundaries and review minimal
  additive capability/deadline/cancellation changes plus all consumers. Retain
  application validation of proposals, privacy and explicit unsupported states;
  never silently fall back to a hosted model or remove registered formats.
  Keep feasibility, integration and acceptance in one PR by default (LM-016).
- Evidence and corrections: [research synthesis](research/local-model/README.md).
  Imported reports are background, not approved commands or measured repo proof.
  Neither this proposal nor the [handoff](step-06-handoff.md) activates Step 06.

## Step 06 Implementation And Evidence

PR [#165](https://github.com/loyalagents/context-router/pull/165) implements the independently selected manual llama.cpp b11146 / Qwen3.5-9B Q4_K_M path on the qualified M1 Max/64 GiB/macOS 15.1.1. Actual application quality preserves the FAILED original scorer verdict and applies only human-approved E's known email omission. No other quality threshold changes. Both AI ports share one private claimed session; uncertain work latches unavailable. The explicit `preview-model` composition opens no listener and never owns inference lifecycle. Text and qualified PDF input are supported; images/OCR are unsupported locally, live Harbor comparison was not needed or run. See [selection](06-local-model/selection.md), [implementation evidence](06-local-model/implementation.md) and [manual operation](../../../useful/LOCAL_MODEL.md). Final reviews/gates remain separate; the PR is not merged and later steps are inactive.

The independent-review follow-up passed repeat quality under unchanged E but failed the first native prefill cancellation settlement at `59e03d9`. The application safely latched unavailable. CP3 and ready status are paused pending the [bounded diagnostic decision](06-local-model/plan.md#follow-up-result-and-proposed-diagnostic-decision) and resolution; no timeout, runtime setting or selection exception has been changed. Historical passes remain historical.

## Deferred Decisions And Owning Steps

| Decision | Owning step |
| --- | --- |
| Exact supported OS/hardware versions, process topology, signing and distribution constraints; native Windows/Linux qualification after Apple Silicon first (LM-017) | `02-composition-boundaries` and early `09-installation-and-packaging` |
| Final platform credential protection, keychain/process isolation, and destructive identity reset | `09-installation-and-packaging` |
| Local database choice/library/bootstrap | Resolved in Step 05 / LM-003; final hardware durability qualification remains Step 09 |
| Exact local model/runtime, capabilities and manual provisioning policy (resolved by Step 06 selection; final PR gates pending) | `06-local-model`; managed asset lifecycle in Step 09 |
| Exact offline guarantee before and after model assets are installed | `06-local-model` and `09-installation-and-packaging` |
| Local MCP transport mix: streamable HTTP, stdio adapter, or both | `07-local-mcp` |
| Local UI/desktop shell and process topology | `08-local-ui` and `09-installation-and-packaging` |
| Application update channel and rollback mechanism | `09-installation-and-packaging` |
| LAN pairing, credentials, discovery, and TLS expectations | `10-lan-mcp` |
| Shape of a future hosted deployment | `11-hosting-portability-check` |
