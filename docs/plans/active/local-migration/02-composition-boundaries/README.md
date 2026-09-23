# Step 02: Composition Boundaries

- Status: complete; PR 02A
  [#157](https://github.com/loyalagents/context-router/pull/157) merged at
  `5a2fc8a09e9091d16160caea258d678293a1e2b3`; PR 02B
  [#158](https://github.com/loyalagents/context-router/pull/158) merged at
  `5a8b640a883dd33d42239d3a74e827cc17ffaae3`; PR 02C
  [#159](https://github.com/loyalagents/context-router/pull/159) merged at
  `143515dac687ffbca989a315edaa89e794a04db3`; PR 02D
  [#160](https://github.com/loyalagents/context-router/pull/160) was
  human-merged at `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf`
  after final-head standard CI run
  [35197826400](https://github.com/loyalagents/context-router/actions/runs/35197826400)
  and dedicated LMBG run
  [35197826476](https://github.com/loyalagents/context-router/actions/runs/35197826476)
  passed. PR 02E [#161](https://github.com/loyalagents/context-router/pull/161)
  was human-merged at `6b420ed24e9dd344af8990c9045832990ae1b5ec`
  from final tested head `00e4240564b3b63997d63cc581c6e52fbba0f613`;
  standard CI run
  [35318582335](https://github.com/loyalagents/context-router/actions/runs/35318582335)
  and dedicated LMBG run
  [35318582309](https://github.com/loyalagents/context-router/actions/runs/35318582309)
  passed
- Outcome owner and sole writer: `/root` for the completed Step 02 sequence
- Outcome: explicit composition roots for identity, persistence, model, and
  platform edges, plus an evidence-backed runtime/toolchain contract and early
  packaging feasibility smoke, without changing hosted behavior
- Concrete next action: retain this plan as dependency evidence while Step 03
  implements local identity from the exact Step 02 merge
- Review date: when a downstream step no longer depends on this retained plan
- Depends on: merged Step 01 contract baseline and a passing
  `pnpm migration:gate` on its exact planning base
- Supported mode during planning: the existing hosted
  NestJS/PostgreSQL/Auth0/Vertex and Next.js composition remains supported; no
  local preview is implied by this charter
- Last updated: 2026-09-18

## Outcome

Make infrastructure selection visible at composition roots so later identity,
storage, model, transport, UI, and packaging steps can replace hosted adapters
without forking application behavior. Step 02 also resolves the supported
Node.js/package-manager contract and tests early packaging assumptions about
process topology, working directories, data locations, native dependencies,
startup, shutdown, and clean restart. The plan must preserve all Step 01
contracts and keep the currently hosted composition runnable after every merged
checkpoint.

The independently reviewed [`plan.md`](plan.md) defines five serial PRs. All
five were human-merged, ending with PR #161 at the exact SHA above. The bounded
02E implementation and 244-test local-migration suite, fresh read-only reviews,
167.223-second final-tree direct packaging smoke, 454.088-second exact-base
12-phase aggregate gate, final-head standard CI, and dedicated remote LMBG all
passed. This does not
authorize a local identity, database, model, UI shell, installer, final OS
claim, or default listener change.

## Required Reading

- [`AGENTS.md`](../../../../../AGENTS.md), the root
  [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md),
  and every file in [`docs/IMPORTANT/`](../../../../IMPORTANT/)
- [`../orchestration.md`](../orchestration.md),
  [`../decision-log.md`](../decision-log.md), and
  [`../step-template.md`](../step-template.md)
- the Step 01 [`plan.md`](../01-contract-baseline-and-product-scope/plan.md),
  [`LOCAL_MIGRATION_CONTRACT_BASELINE.md`](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md),
  and its executable JSON registry
- relevant current operator/developer guidance in
  [`docs/current/`](../../../../current/) and [`docs/useful/`](../../../../useful/)
- package manifests, entry points, configuration modules, generated-output
  paths, and tests for `apps/backend`, `apps/web`, and `apps/local-orchestrator`
- `.nvmrc`, `pnpm-lock.yaml`, Docker/CI configuration, production build output,
  and the checked-in Local Migration Baseline Gate lifecycle

Do not use deleted plans as current design authority. Git history is provenance;
current contracts, code, tests, Step 01 classifications, and accepted decision
log entries govern planning.

## Entry Criteria

- The Step 01 PR is merged into `main`, its exact merge commit is recorded as
  the Step 02 planning base, and `pnpm migration:gate` passes from that base.
- A single Step 02 branch/worktree and sole writer are assigned; discovery and
  review agents remain read-only.
- The planning base has full Git history and the versioned Step 01 registry,
  fixtures, lifecycle manifest, aggregate gate, and restart smoke.
- No concurrent branch owns the same composition roots, runtime configuration,
  package manifests, lockfile, generated contracts, or workflows without an
  explicit landing order.
- Planning stops if a proposed seam requires public-contract breakage, silently
  changes the supported hosted composition, or makes a local preview depend on
  an unselected Step 03–08 implementation.

## Planning Scope

### Composition map and seams

Inventory every place the application core constructs or imports Auth0,
Prisma/PostgreSQL, Vertex/model, clock, filesystem, logging, transport, and
process-specific implementations. Distinguish dependency-injection registration
from domain leakage. Propose the smallest behavior-preserving ports and
composition roots needed by the owning later steps; do not pre-implement those
adapters or abstract code without a named consumer.

The plan must show how the current hosted adapters continue to satisfy the Step
01 GraphQL, HTTP, MCP, catalog, audit, identity, and evaluation evidence after
each checkpoint. It must identify generated types or framework decorators that
may remain at transport edges and storage/provider types that must not cross an
application boundary.

### Runtime and configuration contract

Resolve and pin the supported Node.js and pnpm versions using local and CI
evidence. Reconcile truthful configuration ownership and precedence, including
`PORT` versus `APP_PORT`, listener host selection, backend/web origins, process
working directory, production build artifact paths, schema/resource lookup, and
environment-file behavior. Configuration changes require compatibility and
upgrade guidance; a name that exists in `.env.example` is not proof of a
working capability.

### Early packaging feasibility

Run a bounded spike for the intended supported operating systems and process
topology. Record executable/native dependency constraints, application data and
cache/log locations, asset and migration lookup from a non-repository working
directory, process supervision and shutdown behavior, signing/distribution
assumptions, first-start and clean-restart behavior, and how failures are
diagnosed and recovered. The spike may produce test-only scaffolding; it does
not select the final UI shell, embedded database, model runtime, installer, or
update channel owned by later steps.

### Gate evolution

Use `pnpm migration:gate` as the entry and regression criterion. If Step 02 adds
a preview composition, add its active clean-restart proof and replacement
evidence before changing a hosted-only phase. Do not retire a phase merely
because a new boundary compiles. Keep provider/network-dependent evaluation and
package downloads outside the deterministic aggregate gate.

## Non-Goals

- Implementing the local principal or credential/session policy from Step 03.
- Selecting or implementing the Step 04–05 repository contracts and embedded
  database.
- Selecting or downloading the Step 06 local model runtime.
- Changing public GraphQL, HTTP, MCP tool/resource, OAuth/DCR, or catalog
  contracts except through the accepted additive interface policy.
- Building the final local MCP transport, local UI/desktop shell, installer,
  updater, backup/restore workflow, LAN mode, or cloud sync.
- Removing hosted adapters, hosted operator documentation, developer/eval
  tooling, or compatibility phases before their owning step and removal gate.

## Required Plan Deliverables

The Step 02 `plan.md` is ready for implementation only when it contains:

- a current construction/import dependency map and named target composition
  roots with no speculative ports;
- test-first, PR-sized checkpoints and the supported mode after each merge;
- exact public/consumer compatibility treatment for every moved dependency;
- a Node.js/pnpm/configuration decision with upgrade and CI implications;
- a bounded packaging-feasibility matrix, smoke design, and observable pass/fail
  evidence for each claimed operating-system/process assumption;
- working-directory, generated/resource path, startup, shutdown, restart,
  diagnostics, rollback, and recovery treatment;
- privacy/security analysis for credentials, environment files, local paths,
  listener exposure, Host/Origin/CSRF/rebinding boundaries, and any subprocess;
- the required LMBG lifecycle changes, if any, with replacement evidence and no
  live-provider dependency;
- ownership and landing order for shared composition/config/package/workflow
  files; and
- explicit independent review approvals with every finding resolved.

## Ownership And Parallel Work

The assigned Step 02 writer exclusively owns its `plan.md` and implementation
branch. Coordinate edits to `apps/backend/src/app.module.ts`, entry points and
configuration, package manifests/lockfile, generated schemas/clients, Docker
files, `.github/workflows/**`, web authentication/runtime configuration, and the
LMBG manifest. Step 03 or Step 06 planning may overlap only after explicit file
and decision boundaries are recorded; neither may assume unapproved Step 02
ports.

Review agents inspect read-only. The sole writer resolves findings and performs
all repository mutations.

## Closeout

After independent plan approval, update this charter and orchestration with the
approved ownership, branch, checkpoints, supported mode, and PR plan. Step 02
closes only when its boundaries and feasibility evidence are canonical, the
aggregate gate is green, the supported runtime still works, and Step 03's entry
criteria are concrete. Keep detailed planning only while downstream steps need
it; Git and the merged PR remain the archive.
