# Local-First Migration Orchestration

- Status: active program
- Last completed step: `05-local-database-runtime` — [PR #164](https://github.com/loyalagents/context-router/pull/164), human-merged at `837701b3633eed669dd2c2c518ffebc0e46d55d8` from final tested head `91b86b1b412cc8b2b914ffe4f321a7a0cf1f370b`; successful standard CI [35957573071](https://github.com/loyalagents/context-router/actions/runs/35957573071) and dedicated migration gate [35957573023](https://github.com/loyalagents/context-router/actions/runs/35957573023) reverified 2026-09-24
- Current primary implementation step: `06-local-model` — [active plan](06-local-model/plan.md), plan B approved for bounded feasibility
- Coordinator and sole repository writer for Step 06: `/root`; all other agents read-only
- Step 05 activation/history evidence: retained in its [plan](05-local-database-runtime/plan.md#activation-gate); recording the observed merge here does not activate Step 06
- Concrete next action: execute approved deterministic CP1 probes; await asset/target decisions before live feasibility; all preparation remains in the same branch and PR
- Review date: Step 06 selection review or 2026-10-08, whichever comes first
- Primary development branch: `main`
- Preserved hosted branch: `hosted-v1-maintenance`
- Hosted baseline tag: `hosted-v1-baseline-2026-09-13`
- Hosted production deployment branch: `hosted-v1-maintenance` (operator-confirmed
  2026-09-13; re-verify before changing branch roles)
- Last reviewed: 2026-09-24

This document is the control plane for migrating Context Router from its current
hosted-first architecture to an installable local-first application. Keep it
short enough that every migration agent can reread it before starting work.
Detailed design belongs in the active step's `plan.md`; implemented behavior
belongs in `docs/current/`, `docs/useful/`, or the relevant package README.

For Steps 04–11, [`agent-execution.md`](agent-execution.md) records agreed
agent/effort allocations and overlap candidates. Read it at activation along
with the general [agent workflow guide](../../../useful/AGENT_WORKFLOW.md).
It does not activate future steps or replace approved plans and merge gates.

## Goal

Ship an application that a person can install and run without a hosted account
or required cloud service. The completed local product should:

- store application data on the user's machine;
- use a locally hosted model by default;
- expose an MCP server to applications on the same machine;
- provide a simple local UI for non-MCP interaction;
- bind network services to loopback by default;
- support an explicitly enabled, authenticated LAN MCP mode later; and
- preserve application boundaries that allow future hosted identity, storage,
  and model adapters without building cloud sync now.

## Non-Goals

- Migrating existing PostgreSQL data into local installations.
- Migrating Auth0 users or sessions into local installations.
- Synchronizing local data with a cloud service or another device.
- Keeping PostgreSQL, Auth0, or Vertex AI in the final local runtime merely for
  backward compatibility.
- Rebuilding or actively evolving the hosted product on `main`.
- Exposing an unauthenticated service to the local network.
- Finalizing packaging, SQLite access, or local-model runtime technologies before
  their step has gathered evidence and recorded a decision.

## Program Decisions

The accepted and provisional decisions are maintained in
[`decision-log.md`](decision-log.md). A step plan may refine a provisional
decision. Changing an accepted program decision requires updating the decision
log and explaining the effect on later steps before implementation begins.

The most important current decisions are:

- `main` is the local-first development line.
- `hosted-v1-maintenance` preserves the hosted product.
- Local installations start with fresh local state.
- The application core must not depend directly on Auth0, PostgreSQL, Vertex AI,
  or a desktop-shell framework.
- Remote model calls used for evaluation are explicit opt-in behavior and are
  not part of the default local product path.
- Every merged checkpoint leaves a documented supported mode runnable.
- Apple Silicon is the first local-model/product target; manual model-server
  setup is acceptable for Step 06. A managed runtime belongs to Step 09, with
  early native Windows/Linux qualification before packaging choices harden.
- The [local-model research synthesis](research/local-model/README.md) is
  planning input, not final runtime selection or implementation authority.

## Target Boundaries

The target is one application core with replaceable edge adapters:

```text
Local UI ---------+
                  |
Local MCP --------+--> application services/use cases
                               |
                               +--> principal boundary --> local principal
                               +--> storage boundary ----> local database adapter
                               +--> model boundary ------> local model runtime
                               +--> clock/files/logging --> local platform

Future hosted composition may provide hosted implementations of the same
boundaries. It is not a second application core and does not imply data sync.
```

Transport contracts are separate from application boundaries. HTTP paths,
GraphQL fields, and MCP tool schemas should call the same application use cases
rather than encode storage, identity, or model behavior themselves.

## Planning Inputs That Must Not Be Lost

- Step 01 creates an explicit retain/replace/remove/defer matrix for current
  product capabilities. It covers public HTTP, GraphQL, and MCP contracts; the
  local-orchestrator manifest/API; the eval harness; seed/catalog behavior; and
  every normal-runtime outbound network call. Its contract evidence must
  preserve or explicitly retire preference-definition/value resolution,
  validation and scope rules, mutation provenance plus atomic audit events, MCP
  capability/static-target/database-grant layering, response/log redaction
  invariants, AI's propose-and-narrow boundary, and local-orchestrator manifest
  v3, correlation, dry-run, and partial-apply reconciliation semantics.
- For the local orchestrator, Step 01 decides whether it is a product surface or
  developer tooling. The matrix must classify its remote analyze/apply and
  command-filter dependencies; MIME, hidden-file, and failure policies;
  manifest-v3, dry-run, correlation, and partial-reconciliation contracts; and
  the still-open dedupe/resume, retry/pacing, run-history, and definition-aware
  writer ideas. It must not retain those ideas merely because they appeared in
  a hosted-era TODO.
- Step 01 treats the seven `profile.*` fields as ordinary memory while deciding
  whether the local product needs more core profile fields, bulk import/export,
  account-to-contact copying, or different grant/sensitivity treatment. It also
  classifies Search Lab, demo fixtures, and all reset modes, including user
  isolation, destructive semantics, confirmation, and repeatable synthetic
  smoke data.
- Step 01 separately classifies mutation audit history, MCP access history,
  history UI, and rollback. Retained behavior must preserve mutation-plus-audit
  atomicity, value versus actor provenance, correlation, response/log
  redaction, and safe handling of intervening writes. The step decides request-
  versus-object granularity, authentication-failure coverage, retention and
  deletion, archived-definition sensitivity/masking, workflow/system/import
  attribution, and whether rollback belongs in the local product. Hosted-row
  backfill is unnecessary because local installations start fresh.
- Step 01 classifies document upload and form fill as separate capabilities.
  Application-level raw-file non-retention remains the default unless a later
  step first defines storage location, retention/deletion, access, audit, and
  sensitive-field handling. This does not imply that a configured remote model
  provider has no retention policy. The matrix also covers
  draft/review/confirmation UX, partial or existing-value conflicts, supported
  formats and OCR, retry behavior, and upload abuse controls.
- Step 02 includes an early packaging feasibility spike covering supported OSes,
  process topology, application data locations, native database dependencies,
  signing, distribution, and clean restart. Packaging is validated incrementally
  rather than deferred entirely to the final packaging step.
- As part of that spike, Step 02 selects exact Node 24.21.0 and pnpm 10.25.0 as
  the reviewed target. They become the supported install/build/LMBG/package
  contract only when PR 02B atomically aligns every version source and the full
  exact-runtime gate passes; Step 01 runtime evidence governs until then.
- Step 03 keeps a stable human principal separate from provider credentials,
  email/profile attributes, and MCP client identity/grants. It adds one verified
  provider assertion so Auth0 and future providers remain edge adapters, and it
  must resolve local credential storage and restart stability rather than merely
  bypassing Auth0. Existing hosted users are not migrated, per LM-002.
- Step 04 defines transaction/unit-of-work behavior as well as repository ports.
  Its contract suite preserves atomic audit writes, uniqueness and archival
  rules, location precedence, ordering, cascades, concurrent updates, and seed
  idempotence before a second database adapter is accepted.
- Step 06 validates one manual authenticated loopback runtime/model candidate
  on Apple Silicon before full integration. Minimal AI-port evolution must
  cover truthful capabilities, deadlines/cancellation and failure behavior;
  text inference alone does not complete file-based consumers. Deterministic
  merge tests and measured live-model evidence are distinct. Keep one PR with
  internal checkpoints; app-owned model downloads/process supervision remain
  Step 09. See LM-017/018 and the [handoff](step-06-handoff.md).
- Steps 07 and 08 deliver useful non-AI local flows without waiting for the model
  step. AI-backed tools and pages remain capability-gated until Step 06 lands.
  Local HTTP/MCP planning must address hostile local applications, browser CSRF,
  DNS rebinding, and Host/Origin validation; loopback binding alone is not an
  authentication design.
- Step 07 baselines all six current `mutatePreferences` operations and the
  capability/static-target/database-grant layers before changing local MCP. It
  decides whether combined define-and-set needs one atomic operation, how
  responses expose partial/no-op behavior, whether definition shape changes or
  restores are safe, how rollback interacts with audit, what descriptor/output
  compatibility local clients need, how much request/object detail access logs
  retain, and which explicit scopes survive local identity. It also decides
  whether a client may narrow its own authority for one call or session without
  mutating persisted grants.

## Branch And Change Policy

- Local migration feature branches start from `main` and merge back through
  focused PRs. Use a short-lived name such as
  `codex/local-migration-NN-short-outcome` for Codex-owned work.
- Hosted maintenance feature branches start from and target
  `hosted-v1-maintenance`.
- Production fixes originate on the hosted maintenance line when that is the
  affected product, then are forward-ported to `main` when they are shared.
- Every PR description states its target line and classifies the change as
  `local-only`, `hosted-only`, or `shared`.
- Shared fixes are cherry-picked deliberately. Do not merge either long-lived
  branch wholesale into the other.
- Step 03's provider-neutral assertion, required issuer key, and destructive
  fresh-data transition are explicit main-line migration evolution, not a
  deployed hosted-v1 production fix. The work is `local-only`, leaves
  `hosted-v1-maintenance` unchanged, migrates no historical account, and
  authorizes no backport. Any future production remediation must originate from
  a separate hosted-maintenance decision and branch.
- Do not copy local-database schema changes into the hosted PostgreSQL migration
  history, or hosted PostgreSQL migrations into the local line, without an
  explicit plan.
- Do not commit secrets or environment-specific identifiers. Preserve only
  sanitized configuration shape and operational instructions.
- Generated files and lockfiles have one owner at a time when parallel work is
  active.
- Each active branch has one sole writer in its own worktree. Reviewers remain
  read-only; an assigned integrator coordinates landing order for overlapping
  paths.

For Step 04 onward, default to one PR per step with internal testable checkpoints.
A second PR requires a reviewed plan explaining a concrete independently useful
or safer landing boundary, supported modes, and recovery. More than two requires
an explicit human decision before expanding the sequence. Checkpoints, agent
assignments, review waves, tests, docs, and gate integration are not by themselves
reasons for separate PRs. Do not create standalone planning or closeout PRs just
to satisfy process. There is no arbitrary limit on useful reviewers or waves.

## Agent Workflow

For each numbered step:

1. The coordinator activates exactly one primary step and identifies any
   explicitly allowed parallel track.
2. The planning agent reads `AGENTS.md`, this document, `decision-log.md`, the
   step `README.md`, and every file listed under the step's required reading.
   For Steps 04–11, include `agent-execution.md` and record the role/effort roster.
3. The planning agent creates `plan.md` from [`step-template.md`](step-template.md).
   Planning changes do not include product implementation.
4. Independent reviewers examine architecture, test coverage, compatibility,
   security/privacy, and scope. Review findings are resolved into `plan.md`.
5. The coordinator marks the plan approved and assigns an implementer.
6. The implementer works checkpoint by checkpoint. Backend behavior changes
   follow the repository rule to update tests first and run targeted tests after
   each checkpoint.
7. Independent reviewers compare the implementation diff with the approved
   plan and acceptance criteria.
8. The PR merges only after all required gates pass.
9. Before final merge, the PR updates canonical documentation and records its PR
   number and concise outcome. The coordinator finalizes status while activating
   the next branch; do not create a standalone closeout PR. Detailed plan
   material is deleted when later work no longer needs it; Git and the PR remain
   the archive.

The coordinator resolves disagreement between reviewers. Agent consensus is
input to a decision, not a reason to leave a step indefinitely unresolved.
A material implementation deviation pauses the affected checkpoint until the
plan and its review are updated.

For new step plans, bind approvals to a revision and named contracts/review
areas. Record change impact and renew affected reviews; do not restart unrelated
approvals solely because a whole-plan checksum changed. Broaden review when
impact is uncertain. Preserve existing Step 03 evidence and its approved plan;
this rule does not retroactively rewrite its review record. Fresh final reviewers
must cover the complete base-to-candidate diff across the required dimensions.
Fixes require affected rechecks and an explicit record of unaffected coverage.

A separate coordinator is repository-read-only when another agent is the sole
writer, including for plans, documentation, staging, and commits. Record any
sequential ownership transfer before writes resume; never have two writers on
the same branch/worktree. Requested model/effort settings and actual availability
are recorded separately. Higher effort does not waive independent review or tests.

Use targeted validation between checkpoints, but retain the exact-base activation
gate, final full local `pnpm migration:gate`, and applicable final pushed-head
standard CI and dedicated migration workflow. Record base binding, caller
integrity, phase results, cleanup, toolchain, and timing. Parallel review/testing
requires a frozen candidate and isolated resources; changed inputs invalidate
affected evidence. Do not substitute an earlier green run for final-head evidence.

## Global PR Gates

Every migration implementation PR must satisfy these gates unless its approved
plan explains why a gate does not apply:

- It produces one independently useful, recoverable outcome.
- The supported runtime after merge is stated and works from documented setup.
- Relevant unit, integration, e2e, build, and manual smoke checks pass.
- A new app or package adds its CI path filter and test/lint/build job in the
  same first code PR; repository CI must not silently ignore it.
- Failure and restart behavior are tested where state or subprocesses change.
- Public contract changes use the policy in
  [`tracks/interface-evolution.md`](tracks/interface-evolution.md).
- No local-only workflow silently sends user data to a hosted service.
- Configuration defaults are safe for a local machine and bind to loopback.
- Durable behavior is documented in a canonical location.
- New follow-up work has an owner step instead of an unscoped TODO.
- `git diff --check` passes and repository-local Markdown links are valid.
- The PR states its rollback or recovery path.

## Migration PR Description

Use `.github/PULL_REQUEST_TEMPLATE/local-migration.md` when opening a migration
PR. Every migration PR should make these review facts easy to find:

- program step and target branch;
- one-sentence outcome and supported mode after merge;
- change classification: `local-only`, `hosted-only`, or `shared`;
- contracts preserved, added, deprecated, or removed;
- automated commands and results;
- manual checks completed and checks not run;
- privacy, security, and persisted-state effects;
- rollback or recovery procedure; and
- deferred work linked to its owning roadmap step.

## Supported-State Rule

Intermediate code is allowed to contain temporary adapters, but merged code may
not be a half-transition. Each step plan must name the supported mode after each
checkpoint. Before local cutover, that may be the current hosted composition or
an explicit local preview composition. At cutover, the local composition becomes
the default. Removal of the temporary hosted adapters from `main` happens only
after the local path passes its acceptance suite.

## Roadmap

Only activated steps need a directory and detailed plan. Future step folders are
created from `step-template.md` when activated so stale speculative plans do not
accumulate; more than one may exist during an explicitly approved overlap.

| Step | Status | Outcome | Depends on |
| --- | --- | --- | --- |
| `00-document-consolidation` | Complete — [#153](https://github.com/loyalagents/context-router/pull/153), [#154](https://github.com/loyalagents/context-router/pull/154), [#155](https://github.com/loyalagents/context-router/pull/155) | Classified legacy plans, moved durable knowledge and unfinished outcomes to canonical owners, removed obsolete planning material, and made strict repository-link validation the documentation gate. | Hosted branch/tag preservation |
| `01-contract-baseline-and-product-scope` | Complete — [PR #156](https://github.com/loyalagents/context-router/pull/156) merged at `ff9d8bce6f1b5b28752ab1582e47947f131eff8c` — [plan](01-contract-baseline-and-product-scope/plan.md) | Classify every current capability as retain, replace, remove, or defer with observable acceptance tests; baseline public transports, identity, persistence, AI, orchestrator/eval, seed, and outbound-network behavior. Establish a named aggregate migration gate and clean-restart smoke. | Step 00 complete |
| `02-composition-boundaries` | Complete — PR 02A [#157](https://github.com/loyalagents/context-router/pull/157), PR 02B [#158](https://github.com/loyalagents/context-router/pull/158), PR 02C [#159](https://github.com/loyalagents/context-router/pull/159), PR 02D [#160](https://github.com/loyalagents/context-router/pull/160), and PR 02E [#161](https://github.com/loyalagents/context-router/pull/161); final merge `6b420ed24e9dd344af8990c9045832990ae1b5ec` — [plan](02-composition-boundaries/plan.md) | Select infrastructure at composition roots without changing behavior, and prove early packaging/process/data-directory assumptions with a feasibility smoke. | Step 01 merge and passing LMBG |
| `03-local-identity` | Complete — [#162](https://github.com/loyalagents/context-router/pull/162), merge `1b35c7c513b01a183bb740f0596273baf7620a10`; final head `cfe3b63786e729e60fd6f954c172db86487bebd4` passed standard CI `35899268852` and migration gate `35899268881`; [retained plan](03-local-identity/plan.md) includes R1 | Stable provider-neutral human identity plus explicit non-listening local preview, durable operation/candidate recovery, and best-effort first-creation profile hints. | Step 02 |
| `04-storage-boundaries` | Complete — [PR #163](https://github.com/loyalagents/context-router/pull/163), merge `3426dc556fea88d94a360329e7c685bc9acc155e`; final head `c83bea0add7039cad814567e05d79f4f8b275aba` passed standard CI `35928247258` and migration gate `35928247421`; [retained plan](04-storage-boundaries/plan.md) | Extract storage and transaction/unit-of-work boundaries while PostgreSQL remains green, including mutation/audit atomicity, catalog-only production seed, and Step 03 durable operation/candidate, empty/exact recovery and fencing semantics. | Steps 01–03 |
| `05-local-database-runtime` | Complete — [PR #164](https://github.com/loyalagents/context-router/pull/164), merge `837701b3633eed669dd2c2c518ffebc0e46d55d8`; final head `91b86b1b412cc8b2b914ffe4f321a7a0cf1f370b` passed standard CI `35957573071` and migration gate `35957573023`; [retained plan](05-local-database-runtime/plan.md) | Implemented selected SQLite storage, worker-held identity coordination, actual local composition, recovery/backup and source/package evidence; retain explicit PostgreSQL reference coverage. | Step 04 |
| `06-local-model` | Active — clean-base gate passed; [plan B](06-local-model/plan.md) approved for bounded feasibility | Prove a manual Apple Silicon local-model setup, then integrate truthful capabilities, execution, deadlines/cancellation and errors behind provider-neutral ports; one PR by default. | Step 02 boundaries and current Step 05 local composition |
| `07-local-mcp` | Not started | Connect non-AI local MCP flows and local authorization to the core; capability-gate AI-backed tools until Step 06. | Steps 03 and 05; Step 06 for AI tools |
| `08-local-ui` | Not started | Run useful non-AI UI flows without Auth0 or hosted services; capability-gate AI-backed pages until Step 06. | Steps 03 and 05; may overlap Steps 06-07 |
| `09-installation-and-packaging` | Not started | Early native Windows/Linux qualification after the Mac model path; then managed first-run setup, process supervision, data locations, model assets, clean-install smoke, logs, backup/recovery and updates. | Final product depends on Steps 06–08; early qualification needs explicit non-overlap review |
| `10-lan-mcp` | Deferred/optional | Add explicit LAN enablement, pairing/authentication, exposure warnings, and network tests. | Step 09 |
| `11-hosting-portability-check` | Deferred/optional | Prove a hosted composition can be added at the boundaries without cloud sync or changes to the application core. | Stable local application |

## Parallel Work

Step 05 is merged. Step 06 is the sole active primary step; its clean-base gate passed before preparation transfer. `/root` is coordinator and sole repository writer; discovery and reviewers remain read-only. The original preparation workspace is preserved. See the [active plan](06-local-model/plan.md) for evidence and role settings.
Initial plan review precedes executable feasibility; affected selection review
precedes the production adapter. MCP/UI and early Step 09 platform work remain
inactive until explicitly authorized with non-overlapping ownership. Read-only
discovery and independent review can run in parallel without activating them.

Coordinate or serialize changes to these hotspots:

- `.github/workflows/ci.yml`
- `.github/workflows/local-migration-baseline.yml`
- `pnpm-lock.yaml`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/main.ts`
- `apps/backend/test/setup/test-app.ts`
- `apps/backend/prisma/schema.prisma` and migrations
- `apps/backend/src/schema.gql`
- MCP controller, module, authorization, discovery metadata, and route config
- frontend authentication and shared API-client configuration

Each worktree uses independent ports, environment overrides, temporary data
directories, and local database files. Independent worktrees or test runs must
never share a writable local database file. A dedicated concurrency test may
intentionally use multiple processes against one isolated fixture under one test
owner, with explicit cleanup; this does not authorize shared product runtimes.

## Program Completion

The migration is complete when a supported machine can install the application,
finish first-run setup, use the UI, connect a local MCP client, exercise core
read/write and AI-assisted flows with no network dependency after required model
assets are installed, restart without data loss, back up and restore its data,
and uninstall without surprising data loss. At that point, lasting behavior is
moved to canonical documentation and this active planning tree is removed
according to `docs/README.md`; Git and merged PRs remain the archive.
