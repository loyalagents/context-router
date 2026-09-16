# Step 01: Contract Baseline And Product Scope

- Status: remediation independently approved; the local implementation-head
  gate passed and the remote gate is green at `d68dd6c` —
  [PR #156](https://github.com/loyalagents/context-router/pull/156) is prepared
  for final human review subject to final-head required checks remaining green
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-01-contract-baseline`
- Outcome: an approved retain/replace/remove/defer matrix for every current
  product capability, backed by observable contract evidence, a named aggregate
  migration gate, and a clean-restart smoke
- Concrete next action: human review and merge decision for PR #156 only while
  required checks remain green; do not merge automatically, and begin Step 02
  planning only after it merges
- Review date: 2026-10-14 or Step 01 implementation closeout, whichever comes
  first
- Depends on: completed Step 00 PRs
  [#153](https://github.com/loyalagents/context-router/pull/153),
  [#154](https://github.com/loyalagents/context-router/pull/154), and
  [#155](https://github.com/loyalagents/context-router/pull/155)
- Supported mode during planning: the existing hosted
  NestJS/PostgreSQL/Auth0/Vertex and Next.js composition remains supported
- Last updated: 2026-09-16

## Outcome

Create the evidence-backed scope and compatibility baseline that every later
local-migration step can test against. Step 01 decides what the local product
must retain, replace, intentionally remove, or defer; names the observable
acceptance evidence for each decision; and establishes one aggregate gate that
proves a checkpoint has not left the supported application between two modes.

The Step 01 plan was independently approved on 2026-09-14 by fresh read-only
architecture/scope/maintainability, compatibility/contracts, and
testing/security/privacy reviewers after every finding was resolved. The
approved [`plan.md`](plan.md) governs implementation; material deviations pause
the affected checkpoint for renewed review.

Checkpoint 1 added the versioned capability/outbound/package registry, an exact
automatically refreshed public-reference and outbound-sink census, complete
semantic GraphQL and MCP fixtures, HTTP contracts, all 19 catalog semantics and
seed edge characterization, the strict developer-orchestrator manifest-v3
schema, and the canonical current-state baseline. Its focused checker, backend
unit/integration/e2e, orchestrator, Markdown-link, and whitespace validations
passed without changing a public schema or runtime handler. Evidence collection
corrected a prose count from 14 to the schema-derived 15 mutations; scope and
implementation were unchanged.

Checkpoint 2 added the single authoritative `pnpm migration:gate` command, its
strict 11-phase lifecycle manifest, a dedicated CI workflow, safe isolated test
database lifecycle, disposable-workspace and merge-base checks, and
`pnpm migration:smoke:restart`. The smoke probes the built Next.js support routes
and runs two real production backend processes on loopback with an ephemeral
HTTPS OIDC/JWKS fixture and signed read-only M2M token, then compares the
complete 19-definition catalog and stable principal through restart. After the
external-review remediation on 2026-09-15, the focused migration suite passed
133/133 tests. Committed implementation head `b568834` passed all 11 aggregate
phases in 231.787 seconds, including a 35.256-second clean-restart phase, using
Node 20.19.5, pnpm 10.25.0, Python 3.12.8, and PostgreSQL 15.15. The run reported
`baseComparison=performed`, preserved caller integrity, and removed its exact
generated databases and fallback container. Two consecutive backend builds and
an independent 76.980-second restart smoke also proved `dist/main.js` survives
the build lifecycle. On 2026-09-16, remediated head `d68dd6c` passed the Node
20/pnpm 9 remote workflow and all applicable standard checks. The path-filtered
`eval-harbor-checks` job skipped, while the aggregate Harbor static phase
passed. Required checks on the final documentation head must remain green. The
earlier green run from superseded head `493bf49` remains non-acceptance evidence.

## Required Reading

- `AGENTS.md`, the root `README.md`, `docs/README.md`, and every file in
  `docs/IMPORTANT/`
- [`../orchestration.md`](../orchestration.md),
  [`../decision-log.md`](../decision-log.md), and
  [`../step-template.md`](../step-template.md)
- [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md)
- all documents in `docs/current/` and the relevant operator guidance in
  `docs/useful/`
- package metadata and entry points in `apps/backend/package.json` and
  `apps/web/package.json`, plus the maintained package READMEs in
  `apps/local-orchestrator`, `examples/eval`, and `examples/eval-harbor`
- current source and tests for HTTP, GraphQL, MCP, identity, persistence,
  model calls, document analysis/form fill, audit/history, seed/catalog,
  local orchestration, and evaluation

Do not use deleted implementation plans as current truth. Git history and the
completed Step 00 PRs are provenance when needed; current code, tests, schemas,
and canonical documentation are the baseline evidence.

## Entry Criteria

- Step 00 PR #155 is merged and `main` contains this activation charter.
- A single Step 01 branch/worktree and sole writer are assigned; reviewers are
  read-only.
- The writer records the full `main` base SHA in `plan.md` and starts with a
  clean worktree.
- No concurrent branch owns the same contract documents, generated schema,
  CI workflow, or shared test fixtures without an explicit landing order.

If current behavior cannot be established confidently, record the uncertainty
and the bounded evidence-gathering checkpoint. Do not silently promote an
assumption into a compatibility promise.

## Planning Scope

### Capability matrix

Classify every current user-, client-, operator-, and developer-visible
capability as `RETAIN`, `REPLACE`, `REMOVE`, or `DEFER`. Each row must name:

- the current observable behavior and strongest source/test evidence;
- why the disposition serves the installable local product;
- the supported behavior after each implementing checkpoint;
- acceptance tests or a bounded evidence task;
- known in-repo consumers and external-client/configuration considerations;
- the owning roadmap step and any prerequisite; and
- explicit privacy, security, persisted-state, and outbound-network effects.

At minimum, cover preference definitions and values, profiles, document
analysis, form fill, audit/history, reset/demo/search surfaces, UI flows,
local-orchestrator behavior, evaluation tooling, seed/catalog behavior, and
normal operator/developer workflows.

### Public and integration contracts

Baseline HTTP routes and payloads, GraphQL fields/types and generated clients,
MCP transport/discovery/authentication plus tool/resource schemas, and the
local-orchestrator manifest/API. Apply the additive migration and removal gates
from the interface-evolution track. Absence of an in-repo caller is not proof
that a public surface has no external consumer.

The evidence must preserve or deliberately retire these cross-cutting
invariants:

- preference resolution, validation, scope, and definition/value lifecycle;
- mutation provenance and atomic audit writes;
- MCP capability, static-target, and database-grant layering;
- response and log redaction;
- AI propose-and-narrow behavior; and
- local-orchestrator manifest v3, correlation, dry-run, failure, and
  partial-apply reconciliation semantics.

### Runtime dependencies and outbound calls

Inventory Auth0, PostgreSQL/Prisma, Vertex AI and other model providers, hosted
URLs, telemetry, package/runtime downloads, local subprocesses, filesystem
paths, and every normal-runtime outbound network call. Separate required
current dependencies from optional evaluation/developer behavior. A future
step may select replacements; Step 01 defines what behavior those replacements
must satisfy.

### Product decisions carried from Step 00

Resolve or assign the migration inputs preserved in
[`../orchestration.md`](../orchestration.md#planning-inputs-that-must-not-be-lost),
including:

- whether local orchestration and evaluation are product surfaces or developer
  tooling;
- profile fields, import/export, grants, and sensitivity;
- mutation history, MCP access history, rollback, attribution, retention, and
  history UI;
- document upload versus form-fill scope, raw-file non-retention, review UX,
  formats/OCR, retries, and abuse controls; and
- reset modes, user isolation, destructive confirmation, demo/search behavior,
  and repeatable synthetic smoke data.

Do not retain an option merely because a hosted-era TODO mentioned it.

### Aggregate gate and clean-restart smoke

Name one aggregate command or small command set that later migration PRs can
run as the cross-surface compatibility gate. Specify its fixtures, required
services, deterministic assertions, failure diagnostics, CI ownership, and
expected runtime. Include a clean-start/restart smoke that proves the currently
supported composition can initialize, exercise its primary non-destructive
flow, restart, and still satisfy the expected state contract.

The plan may add focused characterization tests before the aggregate gate, but
must split implementation into PR-sized checkpoints with a supported mode at
each merge.

## Non-Goals

- Selecting or implementing SQLite, a storage library, local identity, a local
  model runtime, desktop shell, packaging system, LAN exposure, or cloud sync.
- Importing hosted users, sessions, PostgreSQL data, or configuration into a
  local installation.
- Breaking a public route, GraphQL field, or MCP contract before its consumers
  and compatibility window satisfy the accepted removal policy.
- Refactoring application boundaries merely to make the architecture look
  local-ready; boundary implementation begins in the owning later step.
- Expanding product scope beyond what is needed to classify current behavior
  and define the local product acceptance contract.

## Required Plan Deliverables

The Step 01 `plan.md` is ready for implementation only when it contains:

- a complete capability/contract matrix with no unowned `DEFER` row;
- an inventory of normal-runtime outbound calls and hosted dependencies;
- explicit retain/remove decisions for current public and package surfaces;
- a named aggregate migration gate and clean-restart smoke design;
- test-first, PR-sized checkpoints with a supported mode after each merge;
- exact consumer, compatibility, privacy/security, rollback, and recovery
  treatment for every affected contract;
- ownership and landing order for shared files and generated outputs; and
- independent architecture, compatibility, testing, and security/privacy
  approvals with all findings resolved.

## Ownership And Parallel Work

The assigned Step 01 writer exclusively owns its `plan.md` and any later
implementation branch. Coordinate changes to `.github/workflows/ci.yml`,
generated GraphQL schema, shared e2e setup, authentication, MCP routing, and
canonical current docs. The interface-evolution track remains dormant until
Step 01 establishes the contract baseline and aggregate gate; visual-only UI
or isolated evaluation-fixture work may proceed when it does not change a
baselined surface or shared file.

## Closeout

After independent plan approval, update this README and orchestration with the
approved plan/PR ownership before implementation. Step 01 closes only when its
approved implementation checkpoints have landed, the aggregate gate and
clean-restart smoke are runnable, lasting behavior is canonical, and the next
roadmap step is activated.
