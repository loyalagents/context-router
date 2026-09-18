# Step 02: Composition Boundaries

- Document status: independently approved plan through PR 02D; PR 02A
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
  passed. PR 02E is activated from that exact merge SHA on
  `codex/local-migration-02-packaging-smoke`; its activation gate passed, and
  the bounded manifest-integrity and workflow-budget clarifications below are
  independently approved. Implementation, the 242-test local-migration suite,
  the original three correction reviews and final CI-correction review, the
  160.698-second final-tree direct packaged-composition smoke, and the
  446.274-second exact-base 12-phase
  aggregate gate are complete; final-head remote validation remains pending
- Program step: `02-composition-boundaries`
- Target branch: `main`
- Planning base commit: `ff9d8bce6f1b5b28752ab1582e47947f131eff8c`
- Change classification: `shared`
- Depends on: Step 01 [PR #156](https://github.com/loyalagents/context-router/pull/156), merged at the planning base above
- Planning owner and sole repository writer: `/root`
- Implementation owner: `/root` for active PR 02E only
- Read-only discovery agents: `/root/discovery_arch_contracts`, `/root/discovery_runtime_packaging`, and `/root/discovery_tests_security`
- Plan reviewers: `/root/plan_review_architecture_scope`,
  `/root/plan_review_compat_runtime`, and
  `/root/plan_review_test_security` (all read-only and approved)
- Supported mode during planning: the existing hosted NestJS/PostgreSQL/Auth0/Vertex and Next.js composition
- Last updated: 2026-09-18

Step 02 is deliberately split into five independently useful PRs. Each later
branch is created only after a human merges its predecessor into `main`; these
are not pre-authorized stacked branches.

| PR/checkpoint | Branch and base | Sole writer | Read-only reviewers | Supported mode after merge |
| --- | --- | --- | --- | --- |
| 02A: hosted model binding | merged via [PR #157](https://github.com/loyalagents/context-router/pull/157) at `5a2fc8a09e9091d16160caea258d678293a1e2b3` | `/root` | `/root/final02a_arch_scope`, `/root/final02a_contract_runtime`, and `/root/final02a_test_security` (all read-only and approved) | Existing hosted composition; `AppModule` selects one hosted adapter binding while the legacy GraphQL transport and application consumers use the existing model ports. No local mode. |
| 02B: toolchain contract | merged via [PR #158](https://github.com/loyalagents/context-router/pull/158) at `5a8b640a883dd33d42239d3a74e827cc17ffaae3` from human-merged PR 02A SHA `5a2fc8a09e9091d16160caea258d678293a1e2b3` | `/root` | `/root/review02b_toolchain_contract` and `/root/review02b_gate_ci` (read-only and approved) | Existing hosted composition on the exact reviewed Node.js/pnpm contract. |
| 02C: runtime configuration/bootstrap | merged via [PR #159](https://github.com/loyalagents/context-router/pull/159) at `143515dac687ffbca989a315edaa89e794a04db3` from human-merged PR 02B SHA `5a8b640a883dd33d42239d3a74e827cc17ffaae3` | `/root` | Earlier implementation: `/root/runtime_impl_arch`, `/root/runtime_impl_compat`, and `/root/runtime_impl_security`; review-finding fixes: `/root/review_fix_architecture`, `/root/review_fix_compat_docs`, and `/root/review_fix_security` (all read-only and approved) | Existing hosted composition with explicit configuration/origin ownership and a tested process lifecycle. No local identity, store, or model. |
| 02D: runtime resources/package closure | merged via [PR #160](https://github.com/loyalagents/context-router/pull/160) at `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf` from human-merged PR 02C SHA `143515dac687ffbca989a315edaa89e794a04db3` | `/root` | Original implementation: `/root/02d_arch_resources`, `/root/02d_package_closure`, and `/root/02d_contract_security`; review-finding correction: `/root/review_schema_tool`, `/root/review_plan_evidence`, and `/root/review_test_integration` (all fresh, read-only, and approved) | Existing hosted composition with cwd-independent schema/catalog resources and an independently deployable backend production dependency closure. |
| 02E: staged packaging feasibility | active `codex/local-migration-02-packaging-smoke` from human-merged PR 02D SHA `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf`; activation gate, implementation, 242-test suite, fresh correction review, 160.698-second final-tree direct packaging smoke, and 446.274-second exact-base 12-phase aggregate gate complete; final-head remote validation pending | `/root` | Activation/plan: `/root/02e_activation_audit`, `/root/02e_arch_packaging`, and `/root/02e_gate_security`; implementation: `/root/02e_packaging_recheck2`, `/root/02e_gate_recheck2`, and `/root/02e_overall_recheck2`; correction: `/root/review_linux_packaging`, `/root/review_gate_journal`, `/root/review_allowlist_flake_docs`, and `/root/linux_cleanup_final_review` (all fresh, read-only, and approved) | Existing hosted source composition plus a tested staged-hosted backend and web feasibility path. This is not an installed local product preview or an offline-guarantee claim. |

The current branch may implement **02E only**. Any
change to the later split, runtime target, public/configuration contract, or
packaging topology is material and returns the affected plan section to fresh
review.

Before activating 02B, 02C, 02D, or 02E, the coordinator must mechanically
record the predecessor's human-merged `main` SHA; verify `HEAD`, local `main`,
`origin/main`, both merge bases, full history, and a clean worktree; assign one
named sole writer and fresh named reviewers; rerun the bound LMBG; and record
the landing order for every overlapping hotspot. Until that gate is complete,
the future branch, owner, base, and reviewers are intentionally **inactive and
unassigned** rather than implied assignments.

## Outcome

Make the current hosted adapter choices explicit at the existing Nest
composition and process roots, then prove that the same hosted application can
be built and staged without depending on the repository working directory.
The step selects one supported Node.js/pnpm toolchain, makes configuration and
runtime resources truthful, gives startup and shutdown a testable lifecycle,
and adds a bounded staged-artifact smoke to the Local Migration Baseline Gate
(LMBG). Every merged PR keeps the hosted GraphQL, HTTP, MCP, catalog, audit,
identity, evaluation, and outbound-provider contracts intact. Step 02 does not
implement a local principal, embedded database, local model, local MCP policy,
desktop shell, installer, or final operating-system support matrix.

## Required Reading

- [`AGENTS.md`](../../../../../AGENTS.md), the root [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md), and every file under [`docs/IMPORTANT/`](../../../../IMPORTANT/)
- [`../orchestration.md`](../orchestration.md), [`../decision-log.md`](../decision-log.md), [`README.md`](README.md), [`../step-template.md`](../step-template.md), and [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md)
- the Step 01 [`README.md`](../01-contract-baseline-and-product-scope/README.md) and [`plan.md`](../01-contract-baseline-and-product-scope/plan.md)
- [`LOCAL_MIGRATION_CONTRACT_BASELINE.md`](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md) and [`local-migration-contract-baseline.json`](../../../../current/local-migration-contract-baseline.json)
- all current behavior documents under [`docs/current/`](../../../../current/) and relevant operator/developer guidance under [`docs/useful/`](../../../../useful/)
- backend composition, configuration, model ports/adapters, schema resource,
  process entrypoint, package metadata, Docker configuration, web production
  configuration, LMBG runner/manifest/tests, and both workflows

The Step 01 registry remains the canonical inventory. This plan classifies its
dependencies for Step 02; it does not replace the registry with a second
hand-maintained contract list.

## Entry Criteria And Mechanical Start Evidence

The writer verified these facts before changing a file:

| Check | Result |
| --- | --- |
| Branch | `codex/local-migration-02-composition-boundaries` |
| Worktree | clean before branch creation and still clean after discovery/gate runs |
| `HEAD` | `ff9d8bce6f1b5b28752ab1582e47947f131eff8c` |
| local `main` | same exact SHA |
| `origin/main` | same exact SHA |
| merge base with local and remote `main` | same exact SHA |
| history | full, non-shallow history; planning base commit resolves locally |
| sole writer | `/root`; all discovery/review agents are read-only and prohibited from editing, staging, committing, creating branches, or otherwise mutating the repository |
| conflicting worktrees | no competing owner for the 02A model-binding files; two unrelated branches own proposed `.github/workflows/ci.yml` changes, so 02A does not edit that file and 02B must record a human-approved landing order before doing so |

Planning or implementation stops if the recorded base is unavailable, the
worktree contains unexplained changes, another writer owns an affected hotspot,
the hosted composition cannot pass its gate, or the proposed fix requires a
Step 03–09 product policy.

## Current Evidence

### PR 02B activation evidence

PR 02A was human-merged through
[#157](https://github.com/loyalagents/context-router/pull/157) at
`5a2fc8a09e9091d16160caea258d678293a1e2b3`. Before any PR 02B repository
change, `HEAD`, local `main`, `origin/main`, and both merge bases resolved to
that exact SHA; history was full and non-shallow; the worktree was clean; and
the branch was `codex/local-migration-02-toolchain-contract`. A mechanical
worktree/branch/PR audit found no active competing owner for the package,
workflow, Docker, documentation, or `scripts/local-migration/**` hotspots.

The entry LMBG was bound to that exact SHA and passed all 11 phases using Node
20.19.5, pnpm 10.25.0, Python 3.12.8, and PostgreSQL 15.15. It reported
`baseComparison=performed`, caller integrity true, no skipped phase, and clean
resource cleanup. This only activates the checkpoint; it does not supersede
LM-012 or establish the selected Node 24.21.0 support claim. `/root` is the
sole writer. `/root/review02b_toolchain_contract` and
`/root/review02b_gate_ci` are the fresh read-only implementation reviewers.

The implemented PR 02B working tree then passed a frozen pnpm 10.25.0 install
with the lockfile hash unchanged, the quoted eval glob and `pnpm eval:verify`
with 364/364 tests and unchanged fixtures, and the full 11-phase LMBG on exact
Node 24.21.0/pnpm 10.25.0. The final gate was bound to
`5a2fc8a09e9091d16160caea258d678293a1e2b3`; the post-review full-tree rerun
reported `baseComparison=performed`, caller integrity true, no skipped phase,
and clean resource cleanup. Exact elapsed time belongs in the PR evidence rather
than this self-referential repository record. The fresh independent reviewers
approved the local implementation. PR 02B head
`e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` subsequently passed all applicable
standard CI jobs in run `35173087186` and the dedicated 11-phase baseline gate
in run `35173087176`.

Vercel is an external remote build topology. It can select Node 24 only by major
and may roll its minor/patch release, while the 02B checker intentionally
requires Node 24.21.0. Accepted decision LM-014 therefore excludes Vercel
preview builds from the supported local-first `main` product and its required
merge evidence. The external project uses `Only build production`: a local-first
push may create a canceled preview deployment record or informational status,
but the ignored-build check must cancel it before the configured application
build proceeds. The canceled record still consumes a deployment and
concurrent-build slot; that cost is accepted because hosted deployments are
infrequent. Before landing, an operator must verify that policy, verify no
GitHub rule or branch-protection setting requires a Vercel status, and confirm
production remains on `hosted-v1-maintenance`. No repository `vercel.json`
branch allowlist is introduced for this infrequently used hosted topology. An
informational Vercel status does not replace the dedicated migration workflow
or applicable standard CI evidence.

On 2026-09-16, that same PR 02B head received a successful Vercel status labeled
`Canceled by Ignored Build Step`, confirming the external policy stopped the
preview before the configured application build. Separate repository inspection
found no rulesets and no `main` branch protection that required Vercel. The
production branch remains the operator-confirmed `hosted-v1-maintenance`
setting recorded in the orchestration document.

PR 02B was subsequently human-merged through
[#158](https://github.com/loyalagents/context-router/pull/158) at
`5a8b640a883dd33d42239d3a74e827cc17ffaae3`, promoting Node 24.21.0 and pnpm
10.25.0 to the landed `main` contract recorded by LM-013.

### PR 02C activation evidence

Before any PR 02C product change, the active branch was
`codex/local-migration-02-runtime-bootstrap`; `HEAD`, local `main`,
`origin/main`, and both merge bases resolved exactly to the human-merged PR 02B
SHA `5a8b640a883dd33d42239d3a74e827cc17ffaae3`; history was full and
non-shallow; and the worktree was clean. The worktree audit found this to be the
only holder of the 02C branch and found no competing owner for its runtime,
configuration, web endpoint, Compose, documentation, or
`scripts/local-migration/**` hotspots. PR 02C does not own `.github/workflows/ci.yml`;
an unexpected workflow edit stops for explicit coordination.

The activation LMBG was bound to that exact merge SHA and passed all 11 phases
in 240,211 ms using Node 24.21.0, pnpm 10.25.0, Python 3.12.8, and PostgreSQL
15.15. It reported `baseComparison=performed`, caller integrity true, no skipped
phase, and clean resource cleanup. `/root` is the sole writer. Fresh read-only
reviewers are `/root/runtime_activation_audit`, `/root/runtime_arch_review`, and
`/root/runtime_test_security_review`; they may inspect and report but may not
mutate the repository.

Shared-hotspot landing order is the merged PR 02B state, then sole 02C
ownership and human landing, then activation of 02D, then activation of 02E.
The supported mode after PR 02C remains the existing hosted composition with
explicit configuration/origin ownership and a tested process lifecycle; it
does not add local identity, storage, model execution, UI, or packaging policy.

### PR 02C implementation evidence

The implementation keeps PR 02C within its approved boundary. Backend startup
now loads `.env.local` and `.env` from the explicit backend package root with
process-environment precedence, validates listener and origin inputs once, and
passes an explicit startup snapshot into the dynamic Nest composition. The
hosted bootstrap has separable create/configure/start/close stages, actual-port
readiness, bounded partial-start and signal cleanup, one-close behavior, and
sanitized nonzero failures without changing the no-host listener call. The MCP
origin fallback consumes the same normalized CORS list. The web application has
one owner for its two build-time public backend endpoints, while `APP_BASE_URL`
remains the Auth0 runtime origin. Launch and Compose migration guidance, the
contract registry, and the cumulative gate argv moved with those changes.

The backend tests were written red first. The final focused Jest command passes
three suites and 50 tests; the required runtime/web Node command passes 17/17;
the reset e2e regression passes 8/8; backend unit/build, seed type-check,
contract checking, frozen-install integrity, web production build, and hosted
restart evidence all pass. The exact-base LMBG is bound to
`5a8b640a883dd33d42239d3a74e827cc17ffaae3` on Node 24.21.0, pnpm 10.25.0,
Python 3.12.8, and PostgreSQL 15.15 and passes all 11 phases with
`baseComparison=performed`, caller integrity true, no skipped phase, and clean
resource cleanup. Exact elapsed time and final-head remote runs belong in the
PR evidence so this repository record does not become self-referential.

Fresh read-only implementation reviewers `/root/runtime_impl_arch`,
`/root/runtime_impl_compat`, and `/root/runtime_impl_security` compared the
complete base-to-working-tree diff with the approved plan. Their findings led
to explicit Nest non-aborting creation, bounded hard exit after failed cleanup,
startup-owned reset configuration, explicit seed database inputs, race-free
process waiters, real post-bind/stuck-close process coverage, compatible dotenv
parsing and runtime dependency classification, exact web consumer/registry
evidence, and preservation of the baseline raw-`NODE_ENV` GraphQL stacktrace
behavior. The reset e2e now constructs independent enabled and disabled startup
compositions instead of mutating configuration after startup. All three
reviewers approved that implementation state with no remaining findings.

A later independent review of consolidated head
`0de5e803bea05a8729f8502afa7f06c3de8f10a8` found an operational diagnostics
regression, a retained MCP-origin fallback inconsistency, a latent
split-environment bootstrap option, and stale control-plane wording. The PR 02C
branch resolved those findings with allowlisted startup diagnostics, one shared
CORS-origin resolver, a fail-fast custom-environment contract, regression
coverage, and the corresponding status correction. Fresh read-only reviewers
`/root/review_fix_architecture`, `/root/review_fix_compat_docs`, and
`/root/review_fix_security` approved the corrected implementation with no
remaining findings. Their review also found and resolved a stateful-getter
redaction gap before approval. GitHub's dedicated migration workflow plus
applicable standard CI were required before human landing of
[#159](https://github.com/loyalagents/context-router/pull/159), and subsequently
passed as recorded below.

The prior reviewed head `0de5e803bea05a8729f8502afa7f06c3de8f10a8`
passed applicable standard CI in run
[`35181940243`](https://github.com/loyalagents/context-router/actions/runs/35181940243)
and the dedicated 11-phase workflow in run
[`35181940231`](https://github.com/loyalagents/context-router/actions/runs/35181940231).
Those runs predate the review-finding fixes and are historical evidence only.
Final PR 02C head `20800ea234584f86bc796238f4d5232d8082800c` subsequently
passed applicable standard CI in run
[`35185165880`](https://github.com/loyalagents/context-router/actions/runs/35185165880)
and the dedicated 11-phase workflow in run
[`35185165892`](https://github.com/loyalagents/context-router/actions/runs/35185165892).
PR #159 was then human-merged at
`143515dac687ffbca989a315edaa89e794a04db3`. Vercel remained outside required
evidence under LM-014 and was not rechecked.

### PR 02D activation evidence

Before any PR 02D product change, the active branch was
`codex/local-migration-02-runtime-resources`; `HEAD`, local `main`,
`origin/main`, and both merge bases resolved exactly to the human-merged PR 02C
SHA `143515dac687ffbca989a315edaa89e794a04db3`; history was full and
non-shallow; and the worktree was clean. The worktree and open-PR audit found no
competing owner for the 02D resource, backend package, lockfile, or migration
gate files. Existing worktrees proposing `.github/workflows/ci.yml` changes
land separately because 02D does not edit that workflow.

The activation LMBG was bound to that exact merge SHA and passed all 11 phases
in 229,801 ms using Node 24.21.0, pnpm 10.25.0, Python 3.12.8, and PostgreSQL
15.15. It reported `baseComparison=performed`, caller integrity true, no skipped
phase, and clean generated-database cleanup. The successful rerun used a
separately owned loopback-only, tmpfs-backed PostgreSQL administration
container after the default Docker writable layer reported no free space; the
failed gate's exact owned container and disposable workspace were verified and
removed before the rerun, and the successful administration container was
verified and removed afterward.

`/root` is the sole writer. Fresh read-only reviewers are
`/root/02d_arch_resources`, `/root/02d_package_closure`, and
`/root/02d_contract_security`; they may inspect and report but may not mutate
the repository. Shared-hotspot landing order is the merged PR 02C state, then
sole 02D ownership and human landing, then activation of 02E. The supported
mode after PR 02D remains the existing hosted composition; it does not add
local identity, storage, model execution, UI, or final OS/product
packaging/distribution policy.

### PR 02D implementation evidence

The implementation keeps PR 02D within its approved resource and production
closure boundary. GraphQL generation is in memory, while a lazy non-strict
application-schema supplier serializes the initialized schema for
`schema://graphql` with exact tracked-fixture parity. The resource caches only
successful values and maps supplier failure to one fixed message without stale
fallback, filesystem access, caller-cwd reads, or path-bearing diagnostics.
The tracked consumer fixture now has explicit `schema:generate` and
`schema:check` commands. Their development-only tool builds the full
`AppModule` schema with inert database, Auth0, and hosted-model providers under
a synthetic credential-free environment, opens no listener, restores the
inherited environment, closes the shared Nest container exactly once, resolves
the fixture module-relatively, and reuses the production serializer. Unit and
hostile-cwd disposable-copy proofs cover exact parity, stale read-only failure,
the actionable regeneration path, and clean exit. Repository attributes keep
the schema and catalog exact-byte fixtures as reviewable LF text.

The raw preference catalog is copied into `dist` and validated before Nest
creation, signal registration, listener bind, or readiness. Its module-relative
reader rejects symlinks and non-regular files, uses no-follow/nonblocking open,
rechecks device/inode identity, bounds reads to the exact 4,273-byte resource,
and parses and hashes those same bytes. The resulting parsed snapshot is the
one consumed by the application, so a post-validation replacement cannot
change runtime data. Missing and integrity-invalid states retain distinct fixed,
cause-free messages; real symlink, directory, FIFO, oversized-file, exact-size
valid-JSON digest tamper, and post-validation replacement/snapshot regressions
enforce that contract.

The backend now owns its Vertex runtime dependency while the root retains its
separate eval importer. The backend packlist is limited to `dist`, production
builds exclude specs, and the workspace plus lockfile enable the reviewed
shared-lock deploy semantics without package/snapshot churn. The self-contained
proof generates and builds in private disposable state, runs the exact offline
production deploy, requires the staged top-level allowlist including pnpm's
pruned lockfile, excludes source/tests/env canaries and dev dependencies, walks
the canonical physical ancestor chain for hoisting, disables Node global module
search, resolves Vertex beneath staged `node_modules`, and exercises staged
resource failures from a hostile cwd under a strict credential-free environment.

The tests were written red before the product slices and the corrective schema
producer. The current exact 02D Jest command passes three suites and 16 tests;
the isolated Node package/resource proof passes 1/1 in 25,607 ms; the backend
unit suite passes 39 suites and 276 tests; and the cumulative migration Node
argv passes 164/164. Direct schema check/generate parity, contract checking,
Markdown validation, Prisma generation, seed type-check, and backend production
build pass. The corrective exact-base LMBG is bound to
`143515dac687ffbca989a315edaa89e794a04db3` and passes all 11 phases in
246,790 ms using Node 24.21.0, pnpm 10.25.0, Python 3.12.8, and PostgreSQL
15.15, with `baseComparison=performed`, caller integrity true, no skipped phase,
and exact owned-resource cleanup. As in activation, the successful run used a
separately owned loopback-only, tmpfs-backed PostgreSQL administration
container because the gate's default Docker writable-layer container did not
become ready; the gate database and external administration container were both
verified and removed.

Fresh read-only implementation reviewers `/root/02d_arch_resources`,
`/root/02d_package_closure`, and `/root/02d_contract_security` compared the
complete base-to-working-tree diff with this plan. Their findings produced the
exhaustive importer/nearest-manifest census, a single validated catalog
snapshot, bounded special-file handling, exact-length digest-negative coverage,
canonical no-hoist ancestry, and disabled global module search. All three
approved the corrected implementation on 2026-09-17 with no remaining required
findings. Fresh corrective reviewers `/root/review_schema_tool` and
`/root/review_test_integration` approved the schema lifecycle, strict
environment/cleanup, hostile-cwd CLI proof, budget, and production closure.
After the writer synchronized current evidence and canonical status,
`/root/review_plan_evidence` approved the final closeout with no remaining
findings.

The pre-correction head `dc69dc7` passed standard CI run
[35193894121](https://github.com/loyalagents/context-router/actions/runs/35193894121)
and dedicated LMBG run
[35193894014](https://github.com/loyalagents/context-router/actions/runs/35193894014).
Those runs are historical evidence and did not satisfy the corrective head's
remote gate. The final corrective head subsequently passed standard CI run
[35197826400](https://github.com/loyalagents/context-router/actions/runs/35197826400)
and dedicated LMBG run
[35197826476](https://github.com/loyalagents/context-router/actions/runs/35197826476).
PR #160 was then human-merged at
`9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf`.

### PR 02E activation evidence

Before any PR 02E implementation change, the active branch was
`codex/local-migration-02-packaging-smoke`; `HEAD`, local `main`,
`origin/main`, and both merge bases resolved exactly to the human-merged PR 02D
SHA `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf`; history was full and
non-shallow; the branch was zero commits ahead/behind `main`; and the worktree
was clean.

The activation LMBG was bound to that exact merge SHA and passed all 11 phases
in 251,654 ms using Node 24.21.0, pnpm 10.25.0, Python 3.12.8, and PostgreSQL
15.15. It reported `baseComparison=performed`, caller integrity true, no
skipped phase, and exact generated-database cleanup. The first attempt stopped
before phase execution when an automatically acquired Docker PostgreSQL
container could not become ready on its writable layer. Its exact owned
container and private diagnostics were verified and removed. The successful
rerun used a separately owned, loopback-only, tmpfs-backed PostgreSQL
administration container; the generated database and exact external container
were verified absent afterward.

`/root` is the sole writer. Fresh read-only activation and plan reviewers are
`/root/02e_activation_audit`, `/root/02e_arch_packaging`, and
`/root/02e_gate_security`; they may inspect and report but may not mutate the
repository. Shared-hotspot landing order is the human-merged PR 02D state, then
sole 02E ownership and human landing, then activation of dependent Step 03 or
Step 06 work unless an explicit non-overlap is approved. PR 02E owns the root
package script, `apps/web/next.config.ts`, the dedicated migration workflow,
the staged packaging and gate files under `scripts/local-migration/**`, the
contract registry/census, and synchronized migration documentation. It does
not edit `.github/workflows/ci.yml`. Historical worktrees
`codex/optimize-ci-path-filters` and `codex/understand-eval-harness` each contain
only a patch-equivalent commit already represented on `main`; they are
superseded/non-landing for workflow ownership. If 02E unexpectedly requires a
`ci.yml` edit, implementation stops for explicit coordination.

The reviewers found two bounded infeasibilities in the previously approved 02E
text: a manifest cannot contain its own final hash, and the earlier workflow
budget grouped independent setup actions into an unenforceable five-minute
window. The corrected self-excluding manifest/external final digest and the
realizable 165-minute workflow schedule below require fresh approval before
implementation. No product scope, public/configuration contract, process
topology, phase order, or later-step ownership changes.

### Authoritative entry gate

The required planning-base command was run with the exact bound base and an
already-installed Python 3.12 executable; no dependency, runtime, image, or
provider download occurred:

```sh
MIGRATION_GATE_BASE_SHA=ff9d8bce6f1b5b28752ab1582e47947f131eff8c \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python \
pnpm migration:gate
```

It passed all 11 active phases in 230,159 ms using Node 20.19.5, pnpm 10.25.0,
Python 3.12.8, and PostgreSQL 15.15 from a uniquely named loopback-only
container. It reported `baseComparison=performed`, caller integrity true, no
skips, exact generated-database removal, clean administration cleanup, no
cleanup errors, no residual gate container/temp process, and a clean caller
worktree.

That is entry evidence for the current hosted composition. It is not the final
runtime decision because Node 20 is end-of-life.

### Runtime reconciliation evidence

The existing version sources disagree: ignored/untracked `.nvmrc` contains
`20`; the root package has no `engines` or `packageManager`; standard and
dedicated CI select Node 20/pnpm 9; the backend Dockerfile selects Node 20 with
pnpm 10.24.0; local passing evidence uses pnpm 10.25.0. Lockfile format 9 does
not choose a pnpm major.

Supplemental gates were run only with already-installed runtimes, the same
bound base, the same Python, and the same isolated PostgreSQL lifecycle:

| Runtime | Evidence | Classification |
| --- | --- | --- |
| Node 20.19.5 / pnpm 10.25.0 | all 11 phases passed as recorded above | complete entry evidence, but Node 20 is EOL and is not selected as the forward contract |
| Node 22.13.1 / pnpm 10.25.0 | phases 1–5 passed; phase 6 failed because `node --test examples/eval/scripts` treats the directory as a module; phases 7–11 skipped; cleanup complete | negative upgrade evidence only |
| Node 24.18.0 / pnpm 10.25.0 | phases 1–5 passed; phase 6 failed for the same directory invocation; phases 7–11 skipped; `baseComparison=performed`; elapsed 118,251 ms; exact database and administration removed with no cleanup errors | negative upgrade evidence only |
| Node 24.18.0 with `node --test 'examples/eval/scripts/**/*.test.mjs'` | 364/364 eval tests passed in 36,501 ms without fixture changes | bounded evidence for the test-discovery repair, not a substitute for the full gate |

An earlier supplemental invocation omitted Docker from `PATH` and stopped in
preflight with no acquired resources. It is classified as an invocation error,
not runtime evidence. No fixture regeneration is permitted to conceal the
phase-6 incompatibility.

As of 2026-09-16, the official [Node.js release table](https://nodejs.org/en/about/previous-releases)
identifies Node 24 as LTS and Node 20 as EOL. The proposed cross-step decision
for review is therefore: **Node 24.21.0 and pnpm 10.25.0 are the exact Step 02
target toolchain**. This does not become a support claim until 02B makes every
version source agree, a frozen install produces no lockfile drift, and the
entire 11-phase LMBG passes on that exact pair. `engines` must reject unsupported
majors; `.nvmrc`, Corepack/package metadata, CI, Docker, and documentation must
select the exact supported versions.

### Composition and consumer evidence

The existing roots should remain roots:

- [`main.ts`](../../../../../apps/backend/src/main.ts) creates the Nest process,
  configures validation/CORS, resolves listener arguments, and listens.
- [`app.module.ts`](../../../../../apps/backend/src/app.module.ts) loads
  configuration, creates GraphQL, selects Prisma/Auth0, imports the current
  Vertex binding, and assembles features.
- [`test-app.ts`](../../../../../apps/backend/test/setup/test-app.ts) is the
  alternate test composition and overrides the current hosted adapters.

Do not create nominal `HostedAppModule`/`LocalAppModule` variants before a
second implementation exists. The immediate composition gap is narrower: four
application consumers already inject `AiStructuredOutputPort`, and
`VertexAiService` already implements `AiTextGeneratorPort`, but consumers repeat
raw string tokens, three feature modules import `VertexAiModule`, and
`VertexAiResolver` imports the concrete adapter.

The registry currently derives 39 capabilities, five contract families,
49 static GraphQL consumers, nine dynamic consumers, 31 fingerprint consumers,
four external-client buckets, 113 references, 17 outbound-call records, 56
outbound-inventory path rows, five packages, and six observed-but-not-promised
items.
Those mechanically derived inventories remain authoritative.

### Mechanical construction/import dependency map

The following map is the path-level inventory at the planning base. Paths in
this table are relative to `apps/backend`; tests are excluded unless they are a
composition root. The reproducible census is:

```sh
rg -n "PrismaModule|PrismaService|@infrastructure/prisma/(generated-client|prisma-models)|Auth0Module|Auth0Service|VertexAi(Module|Service|StructuredService)|Ai(TextGenerator|StructuredOutput)Port|process\.cwd\(|process\.env|new Logger|Date\.now\(|new Date\(|NestFactory|\.listen\(" \
  apps/backend/src --glob '*.ts' --glob '!*.spec.ts'
```

| Edge | Exact construction/import sites at the base | Layer and classification | Treatment/owner |
| --- | --- | --- | --- |
| Process/Nest construction | `src/main.ts`; alternate test root `test/setup/test-app.ts`; launch consumers `package.json`, `Dockerfile`, and `scripts/local-migration/restart-smoke.mjs` | `main.ts` is the legitimate process root; lifecycle/config/listen concerns are currently fused, not domain leakage. | 02C extracts testable create/configure/start/close while keeping the same root. Final supervision/topology is Step 09. |
| Raw runtime configuration | `src/app.module.ts`; `src/main.ts`; `src/config/{app,auth,document-upload,form-fill,graphql,listener-options,mcp,vertex-ai}.config.ts`; `src/infrastructure/prisma/{prisma-client-options,prisma.service}.ts`; `src/modules/reset/user-data-reset.service.ts` | Config loaders are legitimate edge reads; direct reads in root/service code are leakage from configuration ownership. | 02C confines process environment reads to named loaders/root options, including reset enablement. Identity/model/storage meaning stays Steps 03/06/05. |
| Human Auth0 DI/client | registration `src/app.module.ts` -> `src/infrastructure/auth0/auth0.module.ts`; client `src/infrastructure/auth0/auth0.service.ts`; concrete application consumer `src/modules/auth/auth.service.ts` | Module registration is legitimate hosted DI. `AuthService -> Auth0Service` is application/provider leakage and is coupled to Prisma/user policy. | Preserve in Step 02; Step 03 owns principal/session/credential/Auth0 boundary. |
| GraphQL JWT/JWKS | `src/modules/auth/strategies/jwt.strategy.ts`, with guards in `src/common/guards/{gql-auth,jwt-auth,optional-gql-auth}.guard.ts` | Hosted transport/identity edge, including remote JWKS construction; not the same identity as MCP clients. | Preserve; Step 03 owns human identity and Step 08 owns browser/session integration. |
| MCP JWT/JWKS/client identity | `src/mcp/auth/{mcp-auth.guard,mcp-authorization.service,mcp-client-registry.service,oauth-metadata.controller,dcr-shim.controller,dcr-rate-limit.guard}.ts`; config in `src/config/mcp.config.ts` | MCP transport/security edge with separate JWKS client and persisted grant semantics. | Preserve; Step 07 owns MCP transport/auth/scopes/Host/Origin/rebinding. |
| Prisma DI registration | `src/app.module.ts`; `src/infrastructure/prisma/{prisma.module,prisma.service}.ts`; `src/modules/permission-grant/permission-grant.module.ts`; `src/modules/preferences/audit/preference-audit.module.ts`; `src/modules/preferences/location/location.module.ts`; `src/modules/preferences/preference-definition/preference-definition.module.ts`; `src/modules/preferences/preference/preference.module.ts`; `src/modules/reset/reset.module.ts` | Root plus seven repeated module registrations. Registration is hosted infrastructure; repetition is not itself a safe repository boundary. | Preserve in Step 02. Steps 04–05 replace it only with transaction/UoW and cross-adapter behavior tests. |
| Direct Prisma runtime use | `src/modules/auth/auth.service.ts`; `src/modules/external-identity/external-identity.repository.ts`; `src/modules/permission-grant/permission-grant.repository.ts`; `src/modules/preferences/audit/{preference-audit-query.service,preference-audit.service}.ts`; `src/modules/preferences/location/location.repository.ts`; `src/modules/preferences/preference-definition/{preference-definition.repository,preference-definition.service}.ts`; `src/modules/preferences/preference/{preference.repository,preference.service}.ts`; `src/modules/reset/user-data-reset.service.ts`; `src/modules/user/user.repository.ts`; `src/mcp/access-log/{mcp-access-log-query.service,mcp-access-log.service}.ts` | Fourteen application/repository/transport consumers inject the concrete client; this is persistence leakage, not merely DI registration. | Steps 04–05. Step 02 architecture tests explicitly allow these paths so it cannot masquerade as a storage refactor. |
| Generated Prisma types | `src/mcp/access-log/{access-log.types,dto/mcp-access-history.input,mcp-access-log-query.service,models/mcp-access-event.model}.ts`; `src/mcp/{mcp.service,tools/preference-mutate.tool}.ts`; `src/modules/auth/auth.service.ts`; `src/modules/external-identity/{external-identity.repository,external-identity.service}.ts`; `src/modules/permission-grant/{dto/set-permission-grant.input,models/permission-grant.model,permission-grant.repository,permission-grant.resolver,permission-grant.service}.ts`; `src/modules/preferences/audit/{audit.types,dto/preference-audit-history.input,models/preference-audit-event.model,preference-audit-query.service,preference-audit.service,snapshot-builders}.ts`; `src/modules/preferences/document-analysis/{document-analysis.resolver,preference-extraction.service}.ts`; `src/modules/preferences/location/models/location.model.ts`; `src/modules/preferences/preference-definition/{dto/create-preference-definition.input,dto/update-preference-definition.input,models/preference-definition.model,preference-definition.repository,preference-definition.resolver,preference-definition.service}.ts`; `src/modules/preferences/preference/{models/preference.model,preference-value-normalization,preference.repository,preference.resolver,preference.service,preference.validation}.ts`; `src/modules/reset/user-data-reset.service.ts`; `src/modules/user/{user.repository,user.service}.ts` | 38 storage-generated type imports cross application and transport layers. | Steps 04–05 decide domain/storage type separation. No Step 02 purge. |
| Model ports/adapters | ports `src/domains/shared/ports/{ai-text-generator,ai-structured-output}.port.ts`; adapters `src/infrastructure/vertex-ai/{vertex-ai.service,vertex-ai-structured.service}.ts`; mixed binding/transport `src/modules/vertex-ai/{vertex-ai.module,vertex-ai.resolver}.ts`; feature imports `src/modules/preferences/{document-analysis/document-analysis.module,form-fill/form-fill.module}.ts` and `src/modules/workflows/workflows.module.ts`; port consumers `preference-extraction.service.ts`, `form-fill.service.ts`, `preference-search.workflow.ts`, `schema-consolidation.workflow.ts` | Existing ports are correct application seams. Current module mixes hosted binding with public GraphQL transport; resolver/feature imports leak provider selection. | 02A separates provider-neutral legacy transport from a hosted adapter binding. Step 06 owns runtime/capability/download/offline policy. |
| Filesystem/resource | `src/app.module.ts` writes and `src/mcp/resources/schema.resource.ts` reads `process.cwd()/src/schema.gql`; catalog is a JSON module import under `src/config` | Named schema-resource cwd leakage; catalog import is build/package ownership, not a reason for a generic filesystem port. | 02D supplies one cwd-independent schema source and package inventory. Upload/storage/export filesystem policy is Steps 08–09. |
| Clock/time | `src/mcp/access-log/mcp-access-log-query.service.ts`; `src/mcp/auth/{dcr-rate-limit.guard,mcp-auth.guard}.ts`; `src/mcp/resources/schema.resource.ts`; `src/modules/auth/auth.service.ts`; `src/modules/health/health.controller.ts`; `src/modules/preferences/audit/preference-audit-query.service.ts`; `src/modules/preferences/{preference-definition/preference-definition.repository,preference/preference.repository}.ts`; `src/modules/workflows/shared/workflow-step-recorder.ts`; pure calendar calculation in `src/modules/preferences/form-fill/pdf-text-value-normalization.ts` | Expiry/rate-limit, persistence timestamp, health/duration, cache, and pure calendar uses have different semantics; no single named Step 02 consumer exists. | Identity time Step 03/07; persisted timestamps Steps 04–05; model/workflow timing Step 06; operational health/clock Step 09. Pure date normalization remains domain code. |
| Logging | every production `new Logger` site under `src/infrastructure/{auth0,prisma,vertex-ai}`, `src/main.ts`, `src/mcp/{auth,middleware,resources,tools,*.ts}`, and `src/modules/{auth,external-identity,preferences,reset,user,vertex-ai,workflows}` as returned by the census above | Framework logging crosses layers, but a generic logger port has no selected Step 02 consumer. Existing sensitive-log risks are registered. | Keep Nest logging; provider logs Step 06, identity/MCP logs Steps 03/07, UI/file privacy Step 08, and packaged redaction/retention/diagnostics Step 09. 02E uses harness-local redaction only. |
| HTTP/GraphQL/MCP transport | all `src/**/*.{controller,resolver,guard,middleware}.ts`, plus per-request server construction in `src/mcp/{mcp.controller,mcp.service}.ts` | Transport edges are legitimate, but some directly import generated storage types/services. | Public shape preserved under LM-008. Storage leakage Steps 04–05; MCP transport Step 07; web/GraphQL UX Step 08. |
| Platform/native/package | `apps/backend/package.json`, root `package.json`, `pnpm-lock.yaml`, backend `Dockerfile`, web `next.config.ts`; SWC/sharp/libvips optional packages and Prisma/pg runtime | Packaging/build edge, currently target-dependent and partly root-hoisted. | 02B pins tools; 02D proves package closure; 02E records target-native feasibility. Final OS/shell/installer/signing/update remains Step 09. |

This map distinguishes immediate named seams from known leakage that remains
deliberately visible. A later checkpoint may update it only alongside the
registry/consumer census and the owning step's behavioral tests.

### Runtime, resource, and packaging evidence

- `ConfigModule.forRoot` currently resolves `.env.local` and `.env` from caller
  cwd. Observed precedence is process environment, then `.env.local`, then
  `.env`. An unrelated cwd can therefore influence startup.
- `.env.example` advertises `APP_PORT`, but the application listener uses
  `PORT`; Docker Compose uses `APP_PORT` only for host-side port publishing.
  `app.config.ts` parses `PORT`, while `main.ts` bypasses that config object.
- GraphQL generation and the MCP schema resource independently use
  `process.cwd()/src/schema.gql`. A staged run can create or read the wrong
  caller-owned file.
- Bootstrap has no explicit partial-start cleanup, structured actual-port
  readiness, or application-owned SIGINT/SIGTERM lifecycle. Prisma exposes
  module-destroy cleanup, but process shutdown does not prove it runs once.
- The backend imports `@google-cloud/vertexai` at runtime while the dependency
  is declared only by the root package. A pruned backend stage may omit it.
- Next.js uses platform-specific optional SWC and sharp/libvips packages.
  Lockfile availability is analysis evidence, not proof; artifacts cannot be
  copied across OS/architecture/libc targets.
- The existing restart smoke is strong hosted-source evidence, but it builds in
  a repository/disposable checkout, launches the backend with cwd fixed to
  `apps/backend`, reads source fixtures, allocates then releases a port, and
  does not prove a read-only staged artifact, poisoned unrelated cwd, occupied
  port, SIGINT, partial start, or platform-native orphan cleanup.

### Platform evidence labels

| Target | Current label | What is actually proved | Step 02 promotion rule |
| --- | --- | --- | --- |
| macOS arm64 | final-tree direct and exact-base aggregate staged-artifact evidence | On 2026-09-18 the corrected tree passed the direct smoke in 160.698 seconds and the 12-phase aggregate gate in 446.274 seconds (phase 11: 179.275 seconds) with Node 24.21.0/pnpm 10.25.0, manifest `1dfc2c30338b789751542efec3c49a8b4321c91c986ccad822e433672e0d3d86`, stage `8db4a454231df98e4f1e2cd38e84281f3303477f5cec6a9b28bdd244101ba62c`, target-native SWC/sharp/Prisma resolution, two sealed-stage generations, exact owned-PID/port `/usr/sbin/lsof` loopback rows, performed base comparison, and preserved caller integrity | Retain this as feasibility rather than final product support; complete final-head remote evidence before landing |
| GitHub `ubuntu-latest` | CI-tested, source workspace only | Step 01 remote Node 20/pnpm 9 gate; current evidence does not persist exact architecture/libc for a staged artifact | 02E workflow must record and pass the exact staged smoke before naming Linux x64/glibc support evidence |
| macOS x64 | analysis-only | lock/package metadata only | native staged smoke required |
| Linux arm64 | analysis-only | lock/package metadata only | native staged smoke required |
| Windows x64/arm64 | analysis-only | no ACL proof; real descendant-kill regression currently skips Windows; the shell-free pnpm probe does not execute common `.cmd` shims | native safe tool resolution, staged smoke, ACL assertion, and owned process-tree termination required |
| Alpine/musl or any cross-built artifact | analysis-only | Dockerfile/optional lock entries only | build and run on the exact target; no cross-target `node_modules` reuse |

Step 02 records feasibility evidence; Step 09 owns the final product support,
installer, signing, distribution, and update matrix.

## Dependency Classification

| Dependency or boundary | Step 02 treatment | Reason and later owner |
| --- | --- | --- |
| Existing AI text/structured ports and Vertex binding | **Immediate 02A seam.** Stable token constants, one root import, resolver through the existing text port. | Named application consumers already exist; no new model abstraction is needed. Runtime/provider/capability policy stays Step 06. |
| Node.js, pnpm, Corepack, CI, Docker, lock determinism | **Immediate 02B contract.** | Required by this charter and currently contradictory. |
| Eval test discovery under the selected runtime | **Immediate 02B repair, test first.** | It is the observed blocker to a full supported-runtime gate; fixtures remain unchanged. |
| `PORT`, `APP_PORT`, listener/CORS/origin parsing, environment-file root/precedence | **Immediate 02C config seam.** | Named backend, web, Compose, and process consumers exist. No generic config port. |
| Bootstrap create/configure/start/close, actual readiness, partial failure, SIGINT/SIGTERM | **Immediate 02C process seam.** | Required for bounded staged-process proof; hosted default bind behavior stays unchanged. |
| GraphQL schema generation/resource lookup and packaged catalog asset | **Immediate 02D resource seam.** | Concrete cwd bug with MCP/public consumers. One schema source/resolver, not a generic filesystem port. |
| Backend runtime dependency ownership | **Immediate 02D package closure.** | Add `@google-cloud/vertexai` to the backend package that imports it and prove a `pnpm --offline deploy` closure. Retain the root declaration because `examples/eval/scripts/generate.mjs` is a second, root-owned opt-in importer. |
| Target-built backend/web stage, native inventory, private runtime dirs, restart/failure smoke | **Immediate 02E evidence.** | Required packaging feasibility, without selecting the final shell/installer. |
| Prisma repositories, generated types, transaction/UoW, embedded data root/migrations | **Deferred to Steps 04–05.** | Fourteen runtime files import `PrismaService` and 38 import generated Prisma types; a cosmetic Step 02 port would pre-empt storage semantics. |
| Auth0 service, GraphQL JWT/JWKS, local human principal/session/credentials | **Deferred to Step 03.** | Identity policy and persistence must move together. |
| MCP JWKS/client identity, scopes, transport, Host/Origin/DNS-rebinding policy | **Deferred to Step 07.** | Human and MCP identities are separate; loopback is not authentication. |
| Browser session, UI auth, final Host/Origin/CSRF policy | **Deferred to Step 08.** | Step 02 must not claim a final browser trust boundary. |
| Model runtime, assets, cache/download, offline guarantee | **Deferred to Steps 06 and 09.** | 02A only normalizes the existing hosted binding. |
| Generic filesystem, clock, logging, or platform ports | **Deferred to the exact owners in the mechanical map.** | Identity/MCP time and logs: Steps 03/07; storage time/types: Steps 04–05; model/workflow timing/logs: Step 06; UI/file privacy: Step 08; packaged diagnostics/platform/files/log retention: Step 09. Harness-local helpers are not application ports. |
| Local orchestrator | **Deferred to Step 09 as temporary developer tooling.** | It is not promoted into the installed product. |
| Final UI shell/process topology, data/log retention, backup, uninstall, signing/notarization, installer/updater | **Deferred to Steps 08–09.** | 02E records constraints only. |
| LAN exposure/pairing/TLS | **Deferred to Step 10.** | No nonloopback product mode in Step 02. |

## Scope

- 02A: make the existing AI ports the sole application/transport-facing model
  boundary; keep one hosted Vertex selection at `AppModule`.
- 02B: repair eval discovery without fixture changes and atomically align every
  tracked runtime/package-manager source to Node 24.21.0/pnpm 10.25.0.
- 02C: centralize validated listener/config/origin ownership, anchor
  environment-file resolution to an explicit backend package root rather than
  caller cwd, and export testable bootstrap lifecycle/readiness.
- 02D: eliminate cwd schema mutation/lookup, inventory the packaged catalog,
  give the backend its own Vertex runtime dependency while preserving the
  root-owned eval importer, and prove an independently deployable production
  dependency closure.
- 02E: build target-native staged backend and Next production artifacts from
  already installed/frozen dependencies, then exercise both from a private
  non-repository cwd and add that bounded evidence as an active LMBG phase.
- Update registry fingerprints/outbound inventory, configuration docs,
  lifecycle manifest, allowlist, workflow coverage, and consumer fixtures in
  the same checkpoint whenever their governed surface changes.

## Non-Goals

- Adding a local principal, bypassing Auth0, defining credential/session
  storage, or unifying human and MCP identity.
- Creating repository/UoW interfaces, removing Prisma types, selecting SQLite,
  or changing schema/bootstrap/data migration behavior.
- Selecting, downloading, or running a local model; adding model capability
  policy; or changing Vertex payloads/outbound calls.
- Changing GraphQL, HTTP, MCP, OAuth/DCR, catalog, audit, or evaluation public
  semantics; changing fixtures to make unexplained drift pass.
- Changing the hosted default listener call when `APP_HOST` is absent.
- Claiming final Host, Origin, CSRF, DNS-rebinding, authorization, or LAN policy.
- Selecting the final UI/desktop shell, final process topology, application
  data/log layout, installer, updater, signing/notarization, or OS support list.
- Pulling packages, images, model assets, browsers, or live provider data as a
  hidden gate dependency; using a shared or production database.
- Replacing or retiring any Step 01 gate phase merely because a boundary
  compiles or a new feasibility smoke exists.

## Contracts And Compatibility

LM-008 governs every public change. Absence of an in-repo caller is not removal
authority, and unknown external GraphQL/HTTP/MCP clients remain binding.

| Surface | Step 02 disposition | Named consumers/evidence | Compatibility treatment |
| --- | --- | --- | --- |
| Application model ports | preserved; token constants added without changing runtime token strings | document analysis, form fill, preference search, schema consolidation, Vertex resolver, test composition | All consumers move atomically in 02A. Existing interfaces and method shapes remain unchanged. |
| GraphQL | preserved | `askVertexAI`, smart search, web chat/Search Lab, generated schema/client, unknown external clients | No field/type/auth/error change. Resolver delegation test and canonical schema fixture must remain identical. |
| HTTP | preserved | document analysis, form fill, health, web clients, registry consumers | No route/payload/status/auth change. |
| MCP transport/tools/resources/OAuth/DCR | preserved | schema resource, smart search, consolidation, external MCP clients | Exact descriptor/content and tool semantics stay green. Resource implementation may move in 02D only with fixture parity. |
| Catalog/audit/identity/eval | preserved | registry and LMBG phases | No semantic fixture update. Eval command discovery may change; eval inputs/outputs/snapshots may not. |
| Vertex outbound sink | preserved | current Vertex adapter constructor and Step 01 outbound inventory | 02A may move registration, never add a sink/call or change payloads. |
| Configuration and env-file lookup | **intentional compatible behavior correction** in 02C, not merely additive | backend `.env.example`, root Compose file/new Compose env example, package start scripts, Docker/Cloud Run, operator docs, gate/smoke | `PORT` is application listen port; `APP_PORT` is Compose host publication only. Process env continues to win; `<backend-package-root>/.env.local` wins `.env`. Arbitrary caller-cwd env loading is removed with migration guidance. No hosted bind-default change. |
| Backend/web origins and endpoints | preserved semantics with one owner in 02C | `main.ts`, `mcp.config.ts`, web `.env.example`; all `NEXT_PUBLIC_GRAPHQL_URL` and `NEXT_PUBLIC_BACKEND_URL` consumers in the Step 01 registry/census | Backend `CORS_ORIGIN` is parsed once; `MCP_HTTP_ALLOWED_ORIGINS` remains an explicit override and otherwise inherits that normalized list. Web endpoint variables remain build-time public inputs, while `APP_BASE_URL` remains the server-runtime Auth0 origin. The staged build records its exact backend proxy URL and probes backend CORS with the actual staged web origin. |
| Filesystem/resources | corrected without public content drift in 02D | GraphQL generator, MCP `schema://graphql`, contract collector, Docker/stage, restart smoke | Runtime schema comes from one cwd-independent source. No caller-cwd `src/schema.gql` creation. Missing/tampered asset fails before readiness with sanitized diagnostics. |
| Package/toolchain | explicit supported contract in 02B; direct runtime-parser classification in 02C; broad package ownership correction in 02D | root/backend/web packages, Docker, CI, Corepack, contributor docs | Exact Node/pnpm checks gate install/build/LMBG/package evidence. The frozen lockfile permits the reviewed 02C backend-importer reclassification of the existing `dotenv` spec from development to runtime plus the separately reviewed 02D backend importer addition while preserving the root eval importer; 02C does not pull the broader Vertex/package-closure work forward. Prior Node/pnpm lines cease to be supported only when 02B and migration guidance land. |
| Process lifecycle | additive testability in 02C | package `start:prod`, Docker command, restart/packaging smoke | Preserve hosted validation/CORS/listen semantics. Add bounded readiness and graceful close; errors remain sanitized and nonzero. |

Any configuration, package, public descriptor, generated schema, registry
fingerprint, or consumer change must update the registry, fixtures, docs, and
all in-repo consumers in the same PR. Fixture regeneration is prohibited unless
the approved requirement itself changed and the semantic diff is reviewed.

## Design

### 02A: smallest model composition boundary

Keep `AppModule` and `main.ts` as the existing roots. Export stable constants
for the existing `AiTextGeneratorPort` and `AiStructuredOutputPort` token
values. Split the currently mixed module into:

- a provider-neutral legacy GraphQL transport module that owns
  `VertexAiResolver`/`askVertexAI` and injects `AiTextGeneratorPort`; and
- a global `HostedModelAdapterModule` under `src/composition/` that registers
  `VertexAiService`, `VertexAiStructuredService`, and their token aliases.

`AppModule` imports both modules and is the sole production selector of the
hosted binding. The binding exports only the two port tokens; concrete services
remain adapter-internal. Document analysis, form fill, and workflows import no
provider module. Application and test consumers use token constants rather
than string literals. Adapter-internal use of `VertexAiService` by
`VertexAiStructuredService` remains allowed. Replacing the hosted adapter later
therefore does not remove or recreate the legacy public resolver.

An import contract permits concrete Vertex SDK/service imports only inside the
hosted adapter/binding implementation and adapter-focused tests. It explicitly
does **not** ban Prisma/Auth0/generated types yet. Do not add another AI
interface, a provider registry, a runtime mode variable, or a local/no-op model.

Externally visible consumers that must remain unchanged include GraphQL
`askVertexAI`, web chat, smart search in GraphQL/web/MCP, MCP schema
consolidation, document-analysis HTTP, form-fill HTTP, and unknown external
clients. No registry/fixture update is expected unless a real source
fingerprint moves; any such update must be explained rather than regenerated.

### 02B: explicit and enforced runtime contract

First change the eval test invocation from a directory to the quoted recursive
test-file glob demonstrated above. A focused test must prove that top-level and
nested `.test.mjs` files are included exactly once and non-test scripts are not
executed. Do not touch committed eval fixtures or snapshots.

After that red-to-green repair, atomically:

- track `.nvmrc` and pin `24.21.0`;
- add exact root `packageManager: pnpm@10.25.0` (with the Corepack integrity
  metadata produced by the selected tool, if applicable), exact
  `engines.node: 24.21.0` and `engines.pnpm: 10.25.0`, and checked-in strict
  engine configuration;
- add a tested `scripts/check-toolchain.mjs` preflight used by LMBG before any
  resource acquisition and by build/package evidence; reject Node 24 patches
  other than 24.21.0, every other Node major, and every pnpm version other than
  10.25.0 with one sanitized actionable message;
- align all standard/dedicated workflows, Corepack setup, Docker stages, package
  docs, path filters, and gate expectations to the exact pair;
- run `pnpm install --frozen-lockfile` and fail if the lockfile or worktree
  changes;
- run the entire LMBG on the exact pair before making a support claim.

The corresponding accepted decision-log entry will state that the exact pair
is the supported install/build/LMBG/package-evidence runtime. Other Node 24
patches may execute unguarded utility scripts but are explicitly unsupported
and are rejected by install/build/gate/package entrypoints; any patch bump is a
reviewed toolchain change. Node 20 and the old pnpm 9/10.24 selections are not
kept as an undocumented compatibility matrix.

### 02C: configuration and bootstrap lifecycle

Extract a hosted bootstrap API with separable create/configure/start/close
operations. The production entry remains thin and behavior preserving. It must:

- parse and validate `PORT` once, reject non-integer/out-of-range values, allow
  `0` for test-owned ephemeral binding, and report the actual bound loopback
  address/port only after readiness;
- preserve the existing no-host `listen(port)` call when `APP_HOST` is absent;
- replace `APP_PORT` in `apps/backend/.env.example` with application `PORT`;
  add a root `docker-compose.env.example` that owns `APP_PORT`/database
  publication variables, because Compose interpolation does not read a
  service's `env_file`; document `docker compose --env-file`/root `.env` use;
- have `main.ts` inject `<backend-package-root>` as `resolve(__dirname, '..')`.
  That is `apps/backend` for Nest source/start/start:dev/start:prod, Docker's
  `/app/apps/backend`, and the staged `<stage>/backend`; tests inject a temp
  package root. Load only `<root>/.env.local` then `<root>/.env`, preserving
  process-env > `.env.local` > `.env`, and never search caller cwd;
- close partially created Nest/application resources on configuration/listen
  failure, then install bounded SIGINT/SIGTERM shutdown that closes once;
- expose structured readiness for process tests without logging secrets;
- parse `CORS_ORIGIN` once into a normalized list consumed by both Nest CORS and
  the MCP default; preserve `MCP_HTTP_ALLOWED_ORIGINS` as the explicit MCP-only
  override; and
- centralize web public endpoint reads in one build-time module consumed by all
  registry-listed `NEXT_PUBLIC_GRAPHQL_URL`/`NEXT_PUBLIC_BACKEND_URL` callers.
  Preserve existing localhost defaults. `APP_BASE_URL` remains the Next/Auth0
  server-runtime origin, not a backend endpoint.

The exact web consumer set moved atomically is `lib/apollo-client.ts`,
`lib/apollo-wrapper.tsx`,
`app/dashboard/search-lab/SearchLabClient.tsx`,
`app/dashboard/{form-fill/FormFillClient,history/McpAccessHistoryTab}.tsx`,
`app/dashboard/profile/ProfileForm.tsx`,
`app/dashboard/schema/SchemaClient.tsx`,
`app/dashboard/permissions/PermissionsClient.tsx`,
`app/dashboard/preferences/PreferencesClient.tsx`, and preference components
`{AuditHistoryTab,DocumentUpload,ManualPreferenceForm,MemoryResetPanel,PreferenceItem,SuggestionInbox,SuggestionsList}.tsx`.
The Step 01 registry/census test must fail if another direct read remains or a
new one appears. `DocumentUpload` and `FormFillClient` consume the backend base;
the remaining listed callers consume the GraphQL URL.

Removing caller-cwd env loading is an intentional compatibility correction.
Migration guidance inventories `pnpm --filter backend start`, `start:dev`,
`start:prod`, the root dev scripts, Docker Compose, Docker/Cloud Run, tests, and
the staged entry. Operators who previously launched from another directory
with env files there must move them to `apps/backend`, provide process
environment, or use Compose's documented input; no silent fallback remains.

### 02D: cwd-independent resources and package closure

Use one cwd-independent GraphQL schema source for generation and
`schema://graphql`, preferably runtime/in-memory schema ownership. If an
immutable asset is required, stage and integrity-check it explicitly. Keep the
MCP contract collector usable through an explicit schema supplier or safe
module-relative default, never an implicit cwd read. Supplier failure must not
serve a stale cached schema value. Inventory the catalog JSON in the built
output and validate it before Nest creation, listener bind, or readiness. Read
the catalog once and perform both the digest check and JSON parse against those
same bytes. Missing and integrity-invalid resources map to distinct, fixed,
allowlisted logical startup messages. Direct stderr, nested causes, and stacks
must not disclose absolute/repository/cwd paths, canary filenames, parser or
module-loader errors, expected or actual hashes, or asset content.

Keep `apps/backend/src/schema.gql` as the tracked consumer fixture, but give it
one explicit producer instead of relying on hosted startup side effects. The
backend exposes `schema:generate` and `schema:check` commands backed by one
development-only tool outside the production `dist` payload. That tool builds
the full `AppModule` schema in memory through a no-listener Nest testing
composition whose Prisma, Auth0, and hosted-model providers are inert; it must
not connect to a database or provider. While composing the application, replace
the inherited process environment with a strict synthetic environment that
contains no provider credentials, then restore it. In `finally`, close the Nest
application if one was created; otherwise close the compiled testing module.
Close the shared container exactly once, including on generation and check
failures, so lifecycle-owned intervals cannot keep the command alive without
double-running destroy hooks. It serializes only through
`serializeGraphqlSchema`, resolves the fixture from the
tool module rather than the caller cwd, and either writes those exact bytes or
fails `--check` with the documented regeneration command. A backend unit
contract builds through that same application-schema path, with credential
variables absent, compares the result byte-for-byte with the tracked fixture,
and proves clean close. Resolver/DTO drift therefore fails before the restart
smoke. Keep the two exact-byte resources (`schema.gql` and
`preferences.catalog.json`) as text with repository-enforced LF endings; do not
disable text normalization and lose readable diffs.

Add `@google-cloud/vertexai` to `apps/backend/package.json`, because the backend
is a runtime importer. Retain the existing root declaration because
`examples/eval/scripts/generate.mjs` dynamically imports the SDK for opt-in
Vertex corpus generation; retain root `yaml` for the same developer/eval
tooling boundary. A test inventories every non-test SDK importer and requires
ownership by its nearest applicable manifest. Update only the reviewed backend
lockfile importer entry plus the reviewed workspace/lockfile
`injectWorkspacePackages` setting; package and snapshot resolution entries stay
unchanged.

pnpm 10.25.0's shared-lockfile deploy requires the reviewed
`injectWorkspacePackages: true` workspace and lockfile setting to preserve the
approved exact command. The legacy deploy fallback is prohibited: it
re-resolves `auth0`'s ranged npm alias and therefore depends on registry
metadata even with `--offline`, rather than consuming only the frozen shared
lockfile and installed content-addressable store. Constrain the backend package
payload to `files: ["dist"]` so deploy cannot copy ignored `.env*`, source, or
tests; pnpm may additionally emit its pruned frozen deployment lockfile beside
the always-emitted package manifest. Prove a backend-only production closure
with:

```sh
pnpm --offline --filter backend deploy --prod <private-stage>/backend
```

The proof is self-contained inside the existing 120-second `contract-baseline`
phase: it cannot assume caller `dist` or generated Prisma output and creates its
own private generated/build/deploy state without changing caller status or
tracked-file hashes. It measures and asserts its own budget. The proof creates
disposable source, stage, and hostile-cwd siblings under one mode-0700 private
temporary root, so the stage is outside the source workspace's ancestry. The
child environment is a strict allowlist with `NODE_PATH`, `NODE_OPTIONS`, and
provider credentials absent and `COREPACK_ENABLE_NETWORK=0`. It requires no
`node_modules` directory in any stage ancestor, resolves
`@google-cloud/vertexai` with
`require.resolve(..., { paths: [stageBackendRoot] })`, and verifies the resolved
realpath is contained by the staged backend's own `node_modules` before loading
the compiled model adapter without calling it. It then starts
`<private-stage>/backend/dist/main.js` from the hostile cwd and fails if
hoisting or inherited module paths mask an undeclared dependency.

Schema content must remain byte-identical where the current fixture requires
it and semantically identical everywhere. If the in-memory representation
cannot satisfy that contract, stop and use a staged immutable canonical asset;
do not relax the fixture merely to accommodate the implementation.

### 02E: bounded staged-artifact smoke

The smoke is a hosted-artifact feasibility proof, not a local product mode:

1. The direct command creates a local, no-hardlink, disposable full-history
   clone and overlays the caller's current tracked and nonignored working-tree
   state into that private source workspace; it never builds, generates, or
   cleans `dist`, `.next`, Prisma output, or temp state in the caller checkout.
   A dirty caller is allowed only when its pre/post hashes and status are
   preserved exactly. Direct mode copies the verified target-native installed
   dependency trees and offline Corepack cache into the private clone without
   hardlinks by using the existing isolated cloning helpers, and verifies the
   caller dependency copies, source, and observed store before and after. This
   copy is not a dependency materializer. The aggregate gate passes its
   already-owned disposable workspace, dependency/Corepack copies, and a
   verified ownership marker into the same implementation; it does not create
   a nested clone or a second set of dependencies.
2. From already installed frozen dependencies, build backend and web. Configure
   Next with `output: "standalone"` and a module-relative
   `outputFileTracingRoot` equal to the repository root; never derive that root
   from the launch cwd. Assert that
   `relative(outputFileTracingRoot, apps/web)` is exactly `apps/web`. Use
   `pnpm --offline --filter backend deploy --prod` and assemble this exact
   target-native tree:

   ```text
   <stage>/backend/{package.json,pnpm-lock.yaml,dist/**,node_modules/**}
   <stage>/web/** := the complete, unpruned contents of apps/web/.next/standalone/**
   <stage>/web/<derived-app-relative>/.next/static/** := apps/web/.next/static/**
   <stage>/web/<derived-app-relative>/public/** := apps/web/public/**
   <stage>/manifest.json
   ```

   The backend `pnpm-lock.yaml` is pnpm's pruned frozen deployment lockfile;
   inventory it as part of the staged closure rather than deleting it.

   Copy the entire standalone tree without pruning, flattening, or re-parenting
   traced `.next/server`, `node_modules`, package/config, or workspace-package
   files. Derive the app-relative path from the configured tracing root, require
   it to equal `apps/web`, overlay `.next/static` and `public` there, and require
   the derived `<stage>/web/apps/web/server.js` to exist before launch. The
   manifest records that derivation and entrypoint, platform, architecture,
   libc when applicable, Node/pnpm, native SWC/sharp loads, backend dependency
   closure, schema/catalog hashes, and the exact build-time public URLs. Its
   deterministic, path-sorted payload inventory covers every regular file and
   symlink under `backend/` and `web/` and excludes only `manifest.json` itself;
   it records `inventoryExcludes: ["manifest.json"]`. Each canonical inventory
   row records path and type plus mode, size, and file SHA-256 or the normalized
   non-escaping symlink target as applicable.

   First seal payload regular files at mode 0444 and payload directories at mode
   0555, then build the manifest inventory from those final modes. Keep only the
   stage root writable long enough to write `manifest.json` atomically, seal the
   manifest at mode 0444 and the stage root at mode 0555, and only then compute
   its actual SHA-256 and the canonical final-stage-tree SHA-256. Final-tree rows
   cover the stage root (`.`), every directory, regular file, and symlink with
   the same deterministic path/type/mode plus file size/hash or normalized
   non-escaping link-target representation. Record both hashes outside the stage
   in the mode-0600 lifecycle journal and sanitized summary, then reverify them
   before launch and after runtime. Secrets, credentials, mutable runtime files,
   diagnostics, and the external journal remain mode 0600. The smoke rejects a
   symlink that escapes the stage or makes the canonical walk ambiguous; it does
   not require a manifest to recursively contain its own final hash.

   The offline backend deploy is the **single allowed dependency-materializing
   packaging command** in 02D/02E; it is not a runtime child and it does not
   authorize `pnpm install`, `npm install`, Corepack acquisition, or any
   network-capable equivalent. Command policy allowlists the exact argv above,
   requires `--offline`, forces `npm_config_package_import_method=copy`, and
   rejects substitutions or a second materializer. The smoke rejects any
   regular-file inode shared by the private pnpm store and staged payload before
   sealing, so read-only stage modes cannot mutate store files through a
   hardlink.
   Tests capture deterministic inventories and hashes of the already-populated
   pnpm store before and after and require it to be unchanged. Never chmod or
   otherwise mutate a user/global pnpm store. Snapshot the private source tree
   after legitimate generation/build output is complete and before deploy or
   runtime, then require that snapshot to remain unchanged. Caller-checkout
   hashes and status are captured before all work and must remain unchanged at
   the end. Tests fail rather than fetch when an artifact is absent. Record
   immutable ownership IDs before acquisition and make only the private staged
   dependencies/resources read-only. No package download occurs.
3. Before the web build, start a harness-owned loopback proxy on port 0 and use
   its actual URL for `NEXT_PUBLIC_BACKEND_URL` and `/graphql` URL. This stable
   proxy survives backend restarts and forwards only to the current staged
   backend generation. `APP_BASE_URL` is set to the actual staged web origin at
   runtime; the manifest/bundles must contain the proxy URL and must not contain
   the default/dead endpoint.
4. Launch both artifacts from a second non-repository cwd with mode-0700 `HOME`, temp,
   `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and
   log roots. Private mutable runtime files, diagnostics, journals, and
   synthetic credentials are mode 0600; staged files and directories retain
   their sealed 0444/0555 modes.
   The backend command is
   `node --no-global-search-paths <stage>/backend/dist/main.js` with `PORT=0`
   and structured actual-address readiness. The web command is the
   manifest-verified
   `node --no-global-search-paths <stage>/web/<derived-app-relative>/server.js`
   with `HOSTNAME=127.0.0.1`; its
   supervisor uses a random explicit loopback port with bounded `EADDRINUSE`
   retry and emits a structured ready record only after TCP plus route probes.
   Use a strict environment allowlist and `COREPACK_ENABLE_NETWORK=0`.
   For each generation, start web first, capture its verified actual origin,
   start backend with that exact `CORS_ORIGIN`, and set `MCP_SERVER_URL` to the
   stable proxy origin because `PORT=0` leaves the actual backend address
   unknown until bind. The fallback generation omits `MCP_RESOURCE` and proves
   derivation as `<proxy-origin>/mcp`; the explicit generation sets
   `MCP_RESOURCE=<proxy-origin>/mcp`. This resource-URL proof stays distinct from
   the separate `MCP_HTTP_ALLOWED_ORIGINS` override/fallback proof. Then point
   the already-bound proxy at the verified backend address. Do not mark the
   generation ready until web, backend, proxy, origins, and staged routes all
   agree.
5. Put canary `.env.local`/`.env`, URL userinfo, bearer/JWT, filenames, and user
   values in the unrelated cwd/env. Prove they neither influence configuration
   nor appear in stdout, stderr, thrown errors, tails, logs, journals, or
   summaries, including chunk-split/encoded forms covered by the redactor.
6. Use only a unique `_test` PostgreSQL database and the loopback synthetic
   OIDC/JWKS fixture. Runtime does not generate/migrate the database. Do not
   intentionally call Auth0/Vertex, invoke `pnpm install`/`npm install` or a
   download-capable command, or run any dependency materializer except the one
   exact offline deploy above; provide no live provider credentials. This
   selected-route harness does not
   observe arbitrary raw child DNS/TCP/TLS and therefore makes **no zero-egress
   or offline guarantee**; Step 09 owns socket-level enforcement.
7. Preflight exact entrypoints/dependency closure/catalog/schema. Prove no
   repository/cwd lookup, no `<cwd>/src/schema.gql`, and unchanged stage hash.
8. Start the backend with `PORT=0` and consume the structured actual address,
   avoiding the
   allocate-close race. Separately hold an occupied loopback port and require a
   bounded nonzero failure without touching the unrelated occupant. Inject a
   failure after one owned resource starts but before readiness; verify reverse
   cleanup and the primary plus cleanup diagnostics.
9. Require backend readiness plus `/health`, authenticated catalog, GraphQL and
   MCP schema probes. Require web readiness plus a production page/static asset
   and the staged `/api/chat` and `/api/debug/token` missing-session 401 probes.
   Send the actual staged web `Origin` to the backend and assert the preserved
   CORS response; assert the MCP explicit-override/fallback contract separately.
   Generation 1 exits both ready children via `SIGINT`; generation 2 exits both
   via `SIGTERM`. Separate during-startup cases exercise both signals against
   both child types. Successful shutdown must close Nest, Prisma, Next, proxy,
   listeners, journals, and tracked descendants once within grace, without
   SIGKILL. Escalation targets only the exact owned process tree and makes the
   smoke fail.
10. On POSIX, run a real nested-grandchild orphan regression and verify both
   processes are absent or terminal and cannot execute or retain resources.
   Windows remains analysis-only until a native job-object/tree
   mechanism and ACL checks pass; POSIX chmod is not Windows privacy evidence.
11. Restart both staged processes twice from the same artifacts and isolated
   state. Generation 1 writes a safe synthetic marker through a current use
   case; generation 2 reads it and verifies the same principal, complete
   catalog/schema, web support routes/static asset, no duplicate seed, and
   unchanged public fixtures.
12. On macOS, prove every recorded listener's actual bound address is loopback
   with an authoritative native socket-table check. Invoke the absolute system
   `/usr/sbin/lsof` without a shell for each exact owned PID and TCP port, parse
   its NUL-delimited field output, require at least one matching `LISTEN` row,
   and require the complete endpoint set to be exactly `127.0.0.1:<port>`.
   Reject wildcard, unspecified, mixed, malformed, missing, wrong-PID/port,
   nonzero, timeout, stderr, or tool-unavailable results. On Linux, gather
   exhaustive runner-local negative reachability evidence: enumerate
   every noninternal address on every interface and probe every address/family
   against every staged listener (backend, web, and proxy). Any reachable,
   unprobeable, or zero-address case is `INCONCLUSIVE`/failure for a claimed
   network-isolation row; one failed address is never treated as exhaustive.
   Both paths retain parsed structured evidence only. The macOS path proves the
   exact inbound bind tuple; the Linux path proves only non-reachability through
   every enumerated runner-local nonloopback address and is not authoritative
   bind-address evidence. Neither path observes outbound sockets or establishes
   an offline/zero-egress claim.
13. `apps/web/public` is currently absent. Record `publicPresent: false` in the
    manifest and skip that optional overlay; do not create an empty directory
    merely for the smoke. If the directory is later present, inventory and copy
    its full contents under the derived app-relative path.
14. Clean only nonce/journal-owned paths, exact database, ports, and process
    tree; refuse symlink escapes or ambiguous targets. Success leaves no
    process/port/temp root. Failure retains only private sanitized diagnostics
    with exact recovery identities. Finally verify caller repo/worktree and
    stage integrity.

### LMBG evolution

Keep every Step 01 phase active and add a separate Step 02
`packaged-composition-smoke` phase with this exact manifest contract:

| Field | Value |
| --- | --- |
| `order` | `11`; current repository integrity moves to `12` |
| `ownerStep` | `"02"` |
| `status` / modes | `active`; `["hosted-baseline"]` |
| predecessor | `restart-smoke`; repository integrity's predecessor becomes `packaged-composition-smoke` |
| evidence classes | `["build", "restart", "integrity"]` |
| kind | new typed `packaged-smoke` kind; do not overload `commands` or `restart-smoke` |
| phase timeout | `900000` ms |
| termination/cleanup grace | explicit `terminationGraceMs: 180000` |
| exact command | `node scripts/local-migration/packaging-smoke.mjs` |

The phase remains hosted-baseline feasibility evidence; it does not replace the
existing hosted restart smoke. Add `packaged-smoke` and
`terminationGraceMs` to the manifest schema, semantic validator, TypeScript/JSDoc
shape, exact command policy, environment builder, cancellation path, and tests.
The runner passes one abort signal and, after the command settles on success or
failure, independently validates the smoke's owned cleanup journal. It verifies
the diagnostics-directory identity, regular non-symlink mode-0600 journal,
schema and terminal cleanup state; a successful command additionally requires
the exact fixed resources, both backend generations, web-attempt evidence for
both generations, and exactly one administration source. Escalation or
incomplete evidence fails with persisted redacted recovery identities; journal
content alone is not authority to signal a process.

Budgeting uses one gate-wide monotonic clock starting **before** any preflight,
database/container acquisition, or phase work. Existing phase timeouts total
79 minutes; the new 15-minute phase raises the manifest sum to 94 minutes. The
complete timeline is:

- `T+0..3m`: bounded preflight/resource acquisition;
- `T+3..97m`: at most 94 minutes of phase execution; the effective timeout of
  every phase is capped by the remaining global window, and cancellation is
  initiated no later than `T+97m`;
- `T+97..100m`: a signal-aware child-settlement/termination window of at most
  180 seconds; every preflight, phase, and other work subprocess must honor
  cancellation and settle by `T+100m`; and
- `T+100..103m`: the cooperative internal budget for final scoped cleanup,
  including cleanup-owned helper subprocesses, integrity verification,
  sanitized summary, and journal flush. The in-process gate must fail closed
  when this budget is observed, but JavaScript cannot safely preempt and clean
  up an arbitrary promise that ignores its `AbortSignal` without a separate
  supervisor/recovery protocol.

The dedicated workflow provides that outer process boundary and separately
bounds every real step: checkout at five
minutes; pnpm setup at five; Node setup at five; Python setup at five;
toolchain verification plus offline Corepack-cache seeding at five; and frozen
dependency installation at fifteen. The gate step gets 108 minutes, comprising
its 103-minute cooperative internal budget plus five minutes for the workflow
runner to terminate a non-cooperative gate process. This 108-minute step
timeout is the hard process-execution bound; it is a fail-safe, not a claim that
arbitrary uncooperative in-process work can still complete scoped cleanup. An
`if: always()` sanitized artifact/summary step gets five
minutes. Those explicit step maxima total 153 minutes. The job timeout becomes
165 minutes, retaining a 12-minute outer margin. Step timeouts are checked in,
so the job timeout cannot silently become the primary cleanup mechanism.

Tests use a fake clock and signal-aware forced acquisition/phase hangs to prove: preflight
cannot exceed three minutes; sum of active manifest phase timeouts is at most
94 minutes; cancellation begins by `T+97m`; every preflight/phase/work child
settles by `T+100m`; cleanup-owned children and cooperative final
cleanup/summary observe the `T+103m` budget; and the
5/5/5/5/5/15/108/5-minute workflow step bounds total 153 minutes and retain a
12-minute margin beneath the 165-minute job bound. Cancellation at any
boundary, including preflight and `T+97m`, must enter the one final three-minute
cleanup path after owned children settle. Tests that inject a promise which
ignores cancellation must classify the in-process limit as non-preemptive and
pin the workflow's 108-minute process timeout as the hard fail-safe; they must
not use `Promise.race` to abandon live resource-owning work and race cleanup.

The phase lands atomically with:

- exact order, predecessor, owner, mode, evidence, kind, timeout, grace, and
  command above;
- allowlist and command-policy updates;
- phase schema/semantic/owner/order/kind tests;
- private phase environment and cleanup/grace-budget handling;
- positive proof that the old hosted restart plus new packaged phase both run;
- negative tests for omitted/substituted/extra materialization commands, a
  deploy missing `--offline`, `pnpm install`/`npm install`, store/source
  mutation, download-capable/live-provider commands, invalid
  owner/order/mode/evidence, insufficient cleanup grace, timeout,
  cancellation, injected failure, skipped later phases, descendant cleanup,
  sanitized summaries, and canary non-leakage; and
- Step 01 registry fingerprints, executable census, outbound calls/sinks, and
  checker tests for every new `spawn`/`fetch`/socket/filesystem boundary.

No manifest phase is retired without approved replacement evidence. The new
kind/field, aggregate deadlines, workflow timeout, schema, validator, fixtures,
tests, and failure behavior land atomically.

Every new `scripts/local-migration/*.test.mjs` suite becomes remote-required in
the PR that introduces it. That PR appends the file, in deterministic order, to
the `contract-baseline` phase's exact first `node --test` argv in both
`gate-phases.json` and the checked fallback/policy in `gate-runner.mjs`; it also
updates `gate-phases.test.mjs` to require exact parity. The unfiltered dedicated
workflow runs `pnpm migration:gate`, so these tests cannot remain local-only:

| PR | Files appended to the remote-required exact argv |
| --- | --- |
| 02B | `eval-test-discovery.test.mjs`, `toolchain-contract.test.mjs`, `ci-path-filters.test.mjs` |
| 02C | `runtime-process.test.mjs`, `web-runtime-config.test.mjs` |
| 02D | `runtime-resources.test.mjs` |
| 02E | `packaging-smoke.test.mjs` |

The argv is cumulative across descendant PRs. Command-policy, manifest,
registry/fingerprint, and failure-path updates land atomically with each
addition. `ci-path-filters.test.mjs` therefore runs in the very CI path whose
selection rules it validates.

## Test-First Checkpoints

### PR 02A: hosted model binding

1. Add an initially failing `test/contracts/composition-boundaries.spec.ts` and
   resolver port-delegation spec. The failure must list the current feature
   imports, mixed adapter/transport module, exported concrete adapters,
   concrete resolver dependency, and raw token literals.
2. Run:

   ```sh
   pnpm --filter backend exec jest --selectProjects unit \
     --runTestsByPath \
     test/contracts/composition-boundaries.spec.ts \
     src/modules/vertex-ai/vertex-ai.resolver.spec.ts \
     src/modules/preferences/document-analysis/preference-extraction.service.spec.ts \
     src/modules/preferences/form-fill/form-fill.service.spec.ts \
     src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts \
     src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts \
     --runInBand
   ```

3. Apply only the token/root/import changes described above; rerun the same
   command after each small change, then backend build and the full bound LMBG.
4. Stop on any schema/fixture/outbound drift or if a local model/runtime mode is
   needed. A normal revert restores the prior wiring; no state migration exists.

### PR 02B: runtime/toolchain contract

1. Preserve the failing Node 24 phase-6 log as the red signal. Add
   `scripts/local-migration/eval-test-discovery.test.mjs`,
   `scripts/local-migration/toolchain-contract.test.mjs`, and
   `scripts/local-migration/ci-path-filters.test.mjs`. Before the fix, the
   former must show that the package script targets a directory and the latter
   must show that exact/off-version enforcement is absent.
2. Change only eval discovery first and run:

   ```sh
   node --test \
     scripts/local-migration/eval-test-discovery.test.mjs \
     scripts/local-migration/toolchain-contract.test.mjs \
     scripts/local-migration/ci-path-filters.test.mjs
   node --test 'examples/eval/scripts/**/*.test.mjs'
   pnpm eval:validate
   ```

   The quoted recursive glob must discover top-level/nested test files exactly
   once, execute no non-test scripts, pass all 364 current tests, and leave
   fixtures unchanged.
3. Align exact version metadata/checker/workflows/Docker/docs. Before accepting the
   version checkpoint, run:

   ```sh
   node scripts/check-toolchain.mjs
   pnpm install --frozen-lockfile
   git diff --exit-code -- pnpm-lock.yaml
   pnpm eval:verify
   MIGRATION_GATE_BASE_SHA=<exact-02B-base-sha> \
   MIGRATION_GATE_PYTHON_BIN=<python-3.12-executable> \
   pnpm migration:gate
   ```

4. Negative checker tests inject Node 24.20.x, 24.21.1, 22.x, 25.x and pnpm
   9/10.24/10.26 observations and require rejection before gate resource
   acquisition. CI must run the same full root gate on Node 24.21.0/pnpm
   10.25.0. In this PR, append all three new Node suites to the exact
   remote-required `contract-baseline` test argv described above and prove the
   JSON/fallback argv are identical. Stop if
   the exact runtime is unavailable, lockfile drifts, any phase skips/fails, or
   `ci.yml` ownership lacks an explicit landing order. Also stop landing if
   a Vercel preview proceeds past the external production-only ignored-build
   check into the configured application build, a GitHub rule requires a Vercel
   status, or Vercel production no longer follows `hosted-v1-maintenance`;
   LM-014 permits canceled preview records but excludes their major-only
   selector from the local-first contract. Revert the entire version/eval
   checkpoint together; do not leave mixed version sources.

### PR 02C: configuration/bootstrap lifecycle

1. Add red `src/config/runtime-config.spec.ts`,
   `src/bootstrap/hosted-bootstrap.spec.ts`,
   `test/contracts/runtime-composition.spec.ts`,
   `scripts/local-migration/runtime-process.test.mjs`, and
   `scripts/local-migration/web-runtime-config.test.mjs`. Expected failures are
   caller-cwd env poisoning; stale `APP_PORT`; duplicated origin parsing/web
   endpoints; invalid port acceptance; no actual-port readiness; and absent
   partial-start/signal cleanup.
2. Run exactly:

   ```sh
   pnpm --filter backend exec jest --selectProjects unit \
     --runTestsByPath \
     src/config/runtime-config.spec.ts \
     src/bootstrap/hosted-bootstrap.spec.ts \
     test/contracts/runtime-composition.spec.ts \
     --runInBand
   node --test \
     scripts/local-migration/runtime-process.test.mjs \
     scripts/local-migration/web-runtime-config.test.mjs
   ```

3. Test process-env/application-root precedence, every known launch topology,
   caller-cwd poison, invalid/zero/actual ports, no-host compatibility,
   CORS/MCP override/fallback, centralized web build-time endpoint consumers,
   partial-start close, readiness, ready/during-start SIGINT/SIGTERM, and
   one-close semantics. Use test doubles for unit lifecycle tests and loopback
   subprocesses for process tests; no shared database/live provider.
4. Run targeted commands after each implementation slice, then backend
   unit/build, contract checker, hosted restart, and exact-base LMBG. Stop if a
   public response changes, known source/Docker launch lacks migration guidance,
   hosted default binding changes, unrelated cwd is read, cleanup is ambiguous,
   or the fix requires later-step policy. Append both new Node suites to the
   cumulative remote-required `contract-baseline` argv in this PR. Rollback is
   this PR alone.

### PR 02D: runtime resources and production closure

1. Add red `src/mcp/resources/schema.resource.spec.ts`,
   `test/contracts/graphql-schema-fixture.spec.ts`,
   `test/contracts/runtime-package-closure.spec.ts`, and
   `scripts/local-migration/runtime-resources.test.mjs`. They must fail on cwd
   schema access, a missing or stale supported schema producer, writable caller
   `src`, missing/tampered resource behavior,
   a backend importer without a backend-owned Vertex dependency, an unowned SDK
   importer, secret-bearing files in the deploy payload, and a backend deploy
   that succeeds only via workspace hoisting. Resource subprocess cases delete
   the catalog and replace it with valid JSON containing a canary; both must
   exit nonzero before listener bind/readiness and expose only their fixed
   allowlisted logical startup message, never the canary, path, hash, parser or
   module error, nested cause, or stack. Startup-diagnostics allowlist tests
   enforce the same contract, and schema supplier failure proves there is no
   stale-cache fallback. The Node suite owns private generated/build/stage
   state, uses the strict environment and mode-0700/no-hoist layout above,
   proves staged Vertex resolution remains beneath staged backend
   `node_modules`, records elapsed time below its share of the existing
   120-second phase, and leaves caller status and tracked hashes unchanged.
   Update the existing 02C
   `runtime-composition.spec.ts` expectation from preserved cwd schema ownership
   to the new in-memory/module-relative 02D contract before implementation.
2. Run exactly:

   ```sh
   pnpm --filter backend exec jest --selectProjects unit \
     --runTestsByPath \
     src/mcp/resources/schema.resource.spec.ts \
     test/contracts/graphql-schema-fixture.spec.ts \
     test/contracts/runtime-package-closure.spec.ts \
     --runInBand
   node --test \
     scripts/local-migration/runtime-resources.test.mjs
   ```

3. Implement the in-memory schema resource plus explicit fixture
   generate/check commands, the catalog source, and LF checkout policy; add the
   backend Vertex dependency and lockfile importer entry, and add the reviewed
   workspace/lockfile
   `injectWorkspacePackages` setting in small slices. In a private temp stage run the exact
   offline backend deploy and start it with no workspace ancestor. Then run
   backend unit/build, contract checker, hosted restart, and exact-base LMBG.
   Append `runtime-resources.test.mjs` to the cumulative remote-required
   `contract-baseline` argv in this PR.
4. Stop on schema/catalog fixture drift, caller-cwd access/write, undeclared
   hoisted dependency, unexplained lockfile changes, or live provider calls.
   Rollback is 02D only and does not revert 02C lifecycle/configuration.

### PR 02E: staged packaging smoke and gate

1. Add failing `scripts/local-migration/packaging-smoke.test.mjs` plus stage,
   web/backend process, network-interface, permissions/redaction, direct-command
   caller-integrity, timeout-budget, and gate-policy cases. Run exactly:

   ```sh
   node --test \
     scripts/local-migration/packaging-smoke.test.mjs \
     scripts/local-migration/gate-phases.test.mjs \
     scripts/local-migration/gate-runner.test.mjs \
     scripts/local-migration/web-support-smoke.test.mjs
   MIGRATION_GATE_BASE_SHA=<exact-02E-base-sha> \
     pnpm migration:smoke:packaging
   ```

2. The direct root command must create/clean its own disposable workspace and
   its regression must prove pre-existing caller `dist`, `.next`, generated
   files, dirty changes, and unrelated temp state are byte/status unchanged.
3. Build/stage both target-native artifacts and implement the positive/negative
   matrix above. Launch/probe/restart both processes twice.
4. Add the exact manifest kind/phase/budgets plus
   registry/allowlist/schema/failure tests in the
   same checkpoint. Append `packaging-smoke.test.mjs` to the cumulative
   remote-required `contract-baseline` argv in this PR. Run focused tests after
   every gate change.
5. Run the exact-base LMBG locally, the dedicated migration workflow, and all
   applicable standard CI. Record OS/architecture/libc/runtime evidence from
   actual jobs; keep unrun rows analysis-only.
6. Stop if `pnpm install`/`npm install`, a download-capable command, an
   unallowlisted dependency materializer, or a real provider credential/route
   is invoked; on repository/cwd dependence, source/store/stage mutation,
   leaked canaries, weak permissions, any unprobeable/reachable nonloopback address for a claimed
   row, unowned processes/resources, missing web proof, or hosted phase/fixture
   drift. On macOS, stop if the exact owned-PID/port listener-table proof is
   absent, ambiguous, or contains any endpoint other than the required
   loopback tuple; on Linux, stop on any unprobeable/reachable nonloopback
   address for a claimed row. Do not describe either form of listener evidence
   as offline/zero-egress.

## Validation Matrix

| Surface | Automated command/evidence | Required for merge |
| --- | --- | --- |
| 02A import/port unit | exact targeted Jest command above | Yes |
| Backend unit/build | `pnpm --filter backend test:unit`; `pnpm --filter backend build` | Yes for every affected PR |
| Backend integration/e2e | LMBG isolated database phase; focused suite when behavior changes | Yes through LMBG |
| Contract registry/public fixtures | `node scripts/local-migration/check-contract-baseline.mjs` and LMBG contract phase | Yes |
| Eval runtime discovery | `pnpm eval:verify`; exact 364-test discovery evidence; unchanged fixtures | Yes for 02B+ |
| Frozen dependency state | `pnpm install --frozen-lockfile`; clean lockfile/worktree | Yes for 02B+ |
| Hosted clean restart | existing `pnpm migration:smoke:restart` phase remains active | Yes |
| Bootstrap/config/origins | exact 02C Jest and Node commands above | Yes for 02C+ |
| Schema/catalog/package closure | exact 02D Jest/Node commands plus `pnpm --offline deploy` from a no-hoist stage | Yes for 02D+ |
| Staged backend and web artifacts | `pnpm migration:smoke:packaging` from its own disposable workspace; both artifacts probed/restarted twice | Yes for 02E |
| Aggregate compatibility | `MIGRATION_GATE_BASE_SHA=<recorded-exact-base> MIGRATION_GATE_PYTHON_BIN=<python-3.12> pnpm migration:gate`, with `baseComparison=performed`, no skips, integrity true, clean cleanup | Yes for every PR |
| Dedicated workflow | `.github/workflows/local-migration-baseline.yml` exact root gate on selected runtime | Yes remotely |
| Standard CI | exact path-filter mapping below; backend, orchestrator, eval, Harbor static, frontend, and docs jobs as selected | Yes remotely |
| Vercel project topology | operator verifies `Only build production` cancels local-first previews before the configured application build proceeds, no GitHub rule requires Vercel, and production remains on `hosted-v1-maintenance` under LM-014 | Yes externally before landing; canceled records/statuses consume capacity but are not evidence |
| Repository quality | `git diff --check`; clean status; no generated/lock drift; no residual process/container/temp root | Yes |

Live Auth0/Vertex/provider evaluation, package downloads, `pnpm install`/`npm
install`, unallowlisted dependency materializers inside the smoke, shared
databases, and fixture snapshot updates are not acceptable validation. The one
exact offline backend deploy is the sole packaging exception. Static Harbor
validation remains an existing LMBG/CI phase.

02B updates and tests standard-CI filters mechanically:

- `.nvmrc`, `.npmrc`, `scripts/check-toolchain.mjs`, root `package.json`,
  `pnpm-lock.yaml`, and `pnpm-workspace.yaml` select backend,
  local-orchestrator, eval-fixture, and frontend jobs;
- `scripts/local-migration/**`,
  `.github/workflows/local-migration-baseline.yml`, and
  `docs/current/local-migration-contract-baseline.json` select backend,
  local-orchestrator, eval-fixture, eval-harbor-static, and frontend jobs,
  because the aggregate lifecycle spans all five;
- backend package/Docker/config/bootstrap/resource changes select backend;
  web package/Next/config/standalone changes select frontend; and
- `ci-path-filters.test.mjs` parses the checked-in workflow and proves a
  packaging-smoke-only or registry-only diff cannot skip those mapped jobs.

The dedicated LMBG workflow remains unfiltered and runs on every `main` PR.

## Parallel Work And Conflict Surfaces

The active PR has one sole writer. Discovery and review agents inspect
read-only. Safe parallel work is limited to unrelated documents/code with no
shared generated output or workflow ownership.

Serialized hotspots across 02A–02E are:

- `apps/backend/src/app.module.ts`, `main.ts`, model port/token/binding files,
  feature imports, schema resource, config, and `test/setup/test-app.ts`;
- root/backend/web package manifests, `pnpm-lock.yaml`, `.gitignore`, tracked
  runtime version file, backend Dockerfile, Next config, and production assets;
- `.github/workflows/ci.yml` and `local-migration-baseline.yml`;
- `scripts/local-migration/**`, gate manifest/schema/runner/tests; and
- Step 01 registry, fixtures, fingerprints, and canonical migration docs.

02A owns only the model-binding subset and this planning checkpoint. The two
existing branches proposing `ci.yml` changes land or yield ownership before
02B. Later branches are based on human-merged predecessor SHAs, not on unmerged
stacks. A new app/package is not planned; if one becomes necessary, its first PR
must add the required CI path filter and test/lint/build job atomically.

## Privacy And Security

- Hosted behavior, auth, and default bind semantics stay unchanged. Step 02
  test/feasibility listeners bind to IP-literal `127.0.0.1`. macOS verifies the
  complete listener rows for each exact owned PID/port through `/usr/sbin/lsof`
  and rejects any endpoint set other than the expected loopback tuple. Linux
  negative probes cover every enumerated noninternal address/family for every
  staged listener, and any unprobeable/empty set is inconclusive. The latter is
  exhaustive runner-local negative reachability evidence, not authoritative
  socket-bind evidence. Neither is a final authorization, Host, Origin, CSRF,
  DNS-rebinding, LAN, or outbound-socket design.
- Only synthetic credentials, OIDC/JWKS, users, documents, database state, and
  model configuration are allowed. No real secret or user file enters a smoke.
- Child environments use an explicit allowlist. Arbitrary caller credential
  names and values are absent; secrets never appear in argv. Corepack/network
  installers and telemetry commands are disabled in the staged smoke; only the
  exact offline backend deploy may materialize dependencies before runtime.
  This is command/environment containment, not arbitrary-socket observation.
- Private mutable runtime/diagnostic roots are 0700 and their files are 0600 on
  POSIX, verified with `stat`, not assumed from umask. The immutable staged tree
  retains its separately verified 0555 directory and 0444 regular-file modes.
  A Windows claim requires native ACL evidence.
- Redaction tests cover URL credentials/query values, bearer/JWT, env
  assignments, filenames, user values, encoded/decoded and chunk-split
  canaries across terminal output, errors, tails, logs, journals, summaries,
  and retained diagnostics.
- Runtime schema/catalog and read-only install assets are integrity checked.
  Caller cwd `.env*` cannot influence staged startup; no runtime path may expose
  the repository or an arbitrary caller path in normal logs.
- Subprocesses have immutable ownership identities, bounded readiness and
  cancellation, graceful signal deadlines, platform-appropriate descendant
  control, reverse partial-start cleanup, and exact scoped recovery. Never kill
  by name, wildcard, port owner, broad directory, or ambiguous PID.
- The gate's T+103 budget is cooperative because cleanup must not race a live
  resource-owning promise. The 108-minute workflow step timeout is the hard
  process-execution fail-safe. If it is needed, diagnostics or cleanup may be
  incomplete and require the exact journaled recovery procedure; no clean
  shutdown claim is made for arbitrary code that ignores cancellation.
- The staged smoke invokes no package download, `pnpm install`/`npm install`,
  or dependency materializer other than the exact offline backend deploy; it
  uses no live credential and intentionally exercises only loopback synthetic
  routes. It
  does not observe arbitrary raw child DNS/TCP/TLS, so it is **not** offline or
  zero-egress evidence. Step 09 owns target-appropriate socket enforcement and
  its deterministic negative tests.

Current MCP Origin handling, missing Host validation, CORS, and browser auth do
not establish a final local security posture. Step 02 neither weakens them nor
claims to solve them.

## Rollback Or Recovery

Each PR is independently revertible **until a dependent Step 02 PR lands** and
makes no production data migration:

- 02A reverts token constants/root binding/imports/tests as one unit.
- 02B reverts eval invocation and every version source together, restoring the
  previously proven Node 20 entry state; it never leaves a mixed toolchain.
- 02C reverts only configuration/origin/bootstrap lifecycle changes, restoring
  the prior hosted entrypoint and documented cwd behavior.
- 02D reverts only schema/catalog/package-closure, dependency-importer, and
  workspace/lockfile `injectWorkspacePackages` changes; it does not roll back
  02C.
- 02E removes the new manifest row, allowlist/env handling, script/tests,
  registry census, and workflow evidence atomically while retaining the Step 01
  hosted restart phase.

Before a dependent PR lands, revert only the affected checkpoint commit and
rerun the prior checkpoint's exact gate. After descendants land, never revert
an ancestor alone: either apply a separately reviewed forward fix, or revert
merged Step 02 dependents in reverse order before the ancestor (`02E`, then
`02D`, then `02C`, then `02B`, then `02A` as far back as required). Every
revert PR records its clean/full-history `main` base and runs the LMBG bound to
that exact base; after the series, rerun the gate on the restored prior
supported checkpoint and confirm its documented mode. Use normal Git revert;
do not reset shared history. No backup is needed because only unique synthetic
`_test` state is used.

On smoke failure, preserve only the private sanitized diagnostic root and print
its exact path plus immutable owned resource IDs. Attempt cleanup of the exact
database, process tree, sockets, and temp roots; never issue wildcard cleanup.
If ownership is ambiguous, stop and report rather than deleting. Successful
runs remove every owned resource and leave the caller worktree unchanged.
If a gate implementation ignores cancellation, do not start concurrent cleanup
against its live resources. The workflow terminates the gate at its 108-minute
hard step bound, retains any already-persisted exact ownership journal, and
requires scoped recovery or reports ambiguous ownership without deletion. A
future stronger 103-minute hard-cleanup claim requires a separately reviewed
supervisor plus recovery-process protocol and complete descendant registration.

## Risks, Decisions, And Stop Conditions

| Risk/decision | Resolution or stop rule |
| --- | --- |
| Exact Node 24.21.0 is selected before full local evidence exists | 02B is blocked until the eval discovery repair lands test-first and the exact runtime passes all 11 phases locally/CI. Until then it is a reviewed target, not a support claim. |
| pnpm 10 changes lock resolution | Frozen install must produce zero lock drift. Any required lock change is separately explained/reviewed or the checkpoint stops. |
| Workflow ownership overlaps | 02B waits for explicit landing order on `ci.yml`; no opportunistic conflict resolution. |
| Adapter/transport split changes provider visibility | 02A import and resolver tests plus full gate must prove one hosted binding selection, token-only exports, independently preserved resolver, and unchanged consumer behavior. Stop on new outbound sink or public drift. |
| Environment-file root correction affects an undocumented launch pattern | Treat it as an intentional behavior correction: preserve process-env and backend-root precedence, inventory every launch command, and document migration from caller-cwd files. Stop if a known hosted operator lacks a clear compatible migration. |
| Runtime schema representation changes bytes | Keep current fixture byte contract or stage the immutable canonical asset. Do not weaken the test. |
| `PORT=0` or readiness changes hosted logs/listen behavior | Use the structured path for tests while preserving existing hosted no-host call/default. Stop on hosted-default change. |
| Next/native dependency differs by target | Build/stage on each target. Never reuse `node_modules` cross-platform; keep unrun targets analysis-only. |
| Windows tree/ACL semantics are unavailable | Do not claim Windows feasibility. Defer support until native proof rather than emulating POSIX assertions. |
| Packaging smoke invokes package download, `pnpm install`/`npm install`, an unallowlisted materializer, live provider, or shared DB | Stop; only the exact offline backend deploy is allowed. Unexpected raw child egress is not claimed observable and remains a Step 09 proof obligation. |
| Platform listener proof is unavailable or ambiguous | Stop. macOS requires exact owned-PID/port `/usr/sbin/lsof` `LISTEN` rows whose complete endpoint set is only `127.0.0.1:<port>`; Linux requires exhaustive nonloopback interface probes. Neither path may be weakened into a zero-egress claim. |
| New gate phase weakens Step 01 evidence | Stop if old phases, allowlist exactness, base comparison, integrity, failure diagnostics, or cleanup are removed/skipped. |
| Public/config/package surface changes without consumers/registry | Stop and apply LM-008; registry/fixtures/docs/consumers must move in the same checkpoint. |
| Work expands into identity/storage/model/MCP/UI/installer policy | Stop and assign it to Steps 03–09. |

## Plan Review Gate

Fresh read-only reviewers who did not perform discovery inspected the complete
plan. The sole writer resolved every finding, and all reviewers approved the
frozen design at checksum `2439922724 79010` on 2026-09-16. The edits after
that checksum only record those approvals and synchronize canonical status;
material plan changes still require re-review.

| Review dimension | Reviewer | Findings resolution | Approval |
| --- | --- | --- | --- |
| Architecture, composition boundaries, scope, maintainability | `/root/plan_review_architecture_scope` | Separated provider-neutral transport from hosted binding; added the exhaustive dependency map, five-PR boundary, later-step ownership, and dependency-aware rollback. | **APPROVED** 2026-09-16 |
| Public contracts, consumers, runtime compatibility | `/root/plan_review_compat_runtime` | Made LM-008 consumers/config migration exact; completed Next standalone staging, package ownership, toolchain enforcement, offline-deploy semantics, OS labels, and activation metadata. | **APPROVED** 2026-09-16 |
| Testing, LMBG, CI, packaging/OS evidence | `/root/plan_review_test_security` | Added exact tests, cumulative remote execution, bounded gate/workflow timeline, web/backend process proof, interface-complete negative probes, and required CI routing. | **APPROVED** 2026-09-16 |
| Security and privacy | `/root/plan_review_test_security` | Added private-root/permission/redaction, partial-start/signal/orphan/scoped cleanup evidence and explicitly deferred final authorization, Host/Origin/CSRF/DNS-rebinding and offline policy. | **APPROVED** 2026-09-16 |

Fresh read-only reviewers `/root/review_schema_tool`,
`/root/review_plan_evidence`, and `/root/review_test_integration` approved the
complete PR 02D design at checksum `554480599 108261` on 2026-09-17 with no
remaining findings. Their review covered the material 02D refinements that
retain the root Vertex dependency for the eval importer, enable
`injectWorkspacePackages`, constrain the backend payload to `files: ["dist"]`,
permit pnpm's trimmed deployment lockfile, and place the isolated deploy proof
inside the existing 120-second phase. It also covered the corrective explicit
schema generate/check lifecycle, strict credential-free testing composition,
exact-once cleanup, early byte-parity contract, and targeted LF checkout
policy. Edits after that checksum record these approvals and implementation or
status evidence only; further material changes require another fresh review.

Fresh read-only reviewers `/root/02e_activation_audit`,
`/root/02e_arch_packaging`, and `/root/02e_gate_security` approved the complete
PR 02E activation and amended design at checksum `471172706 117875` on
2026-09-17 with no remaining findings. Their review covered the exact merged
base and activation gate, sole-writer/hotspot landing order, nonrecursive staged
manifest and externally recorded sealed-tree integrity, direct/gate dependency
copy ownership, stable-proxy/MCP configuration, final permission modes, signal
and optional-public behavior, and the realizable 153/165-minute workflow
budget. Edits after that checksum only record these approvals and activation
status; further material changes require fresh plan review.

During implementation, route-dependent macOS `awdl`/`utun` probe timeouts
showed that the approved cross-platform connection-probe mechanism could not
produce deterministic native macOS evidence. The writer therefore refined
item 12, the platform promotion rule, privacy boundary, and 02E stop conditions
to use exact owned-PID/port `/usr/sbin/lsof` listener-table evidence on macOS
while retaining the approved exhaustive interface probes on Linux. The macOS
path is an exact inbound-bind proof; the Linux path remains runner-local
negative reachability evidence. Neither expands the zero-egress claim. The
material refinement was approved by fresh read-only reviewer
`/root/02e_macos_plan_review` at checksum `2730964944 121135` on 2026-09-17
before its implementation.

Implementation review also found that the earlier 103-minute "hard" claim was
not realizable in one JavaScript process: racing a promise that ignores
cancellation would abandon live resource-owning work and make concurrent
cleanup unsafe. The timeline, privacy, recovery, tests, and exit criteria now
state the narrower truthful contract: T+103 is the cooperative signal-aware
internal budget, the workflow's 108-minute step timeout is the hard process
execution bound, and that outer fail-safe does not promise successful cleanup
of arbitrary uncooperative code. A future hard-cleanup claim requires a
separately reviewed supervisor/recovery protocol. This material refinement
was approved by fresh read-only reviewer `/root/02e_deadline_plan_review` at
checksum `3875601529 123776` on 2026-09-17 before closeout.

A later independent PR 02E implementation review found a likely Linux hardlink
failure under pnpm's automatic import method, missing outer-gate validation of
the packaged smoke lifecycle journal, a self-referential subprocess allowlist
test, a signal-registration race in a remote-required restart fixture, and an
overbroad packaged-smoke DCR documentation claim. The writer forced copy
imports while retaining the exact offline deploy argv, added independent
post-command journal and exact success-resource validation, replaced the
self-check with a source census covering direct and imported Git, Node, lsof,
OpenSSL, and optional Docker-helper child sites, registered the fixture's
SIGTERM handler before readiness, and narrowed the packaged probe claim to OAuth
protected-resource metadata. Staged Node entrypoints now also disable global
module search. Follow-up adversarial review found that whole-document canary
redaction could corrupt lifecycle IDs, types, and statuses, so lifecycle
serialization now validates and preserves structural control fields while
redacting only dynamic identity, recovery, and error values. Fresh read-only reviewers
`/root/review_linux_packaging`, `/root/review_gate_journal`, and
`/root/review_allowlist_flake_docs` approved the corrected implementation on
2026-09-17 with no remaining findings. The later dedicated Linux run exposed
that zombie-only process groups remain observable to `kill(0)` after every
member is non-executable. The correction now classifies Linux `Z`/`X`/`x`
members as quiescent, fails closed on ambiguous `/proc` evidence, and bounds
post-`SIGKILL` settlement. Fresh read-only reviewer
`/root/linux_cleanup_final_review` approved that correction on 2026-09-18 with
no remaining findings, and the resulting local-migration suite passes 242/242.
The corrected final tree then passed the direct packaged-composition smoke in
160.698 seconds with manifest
`1dfc2c30338b789751542efec3c49a8b4321c91c986ccad822e433672e0d3d86` and stage
`8db4a454231df98e4f1e2cd38e84281f3303477f5cec6a9b28bdd244101ba62c`.
The exact-base 12-phase aggregate gate then passed in 446.274 seconds, with
phase 11 passing in 179.275 seconds, merge-base comparison performed, and
caller integrity preserved. Final-head Linux staged-artifact evidence still
requires the dedicated remote workflow.

The PR 02B follow-up review exposed Vercel's external major-only Node selector
and the unvalidated Windows `.cmd` probe path. The writer added the explicit
Vercel landing stop/decision gate and clarified the current macOS/Linux evidence
boundary. Fresh read-only reviewer `/root/review_findings_platform` approved
that material plan clarification on 2026-09-16; that review did not itself
authorize a checker bypass, a Vercel project-setting mutation, or a Windows
support claim.

On 2026-09-16 the operator selected the reviewed scope-out alternative: Vercel
is outside the supported local-first `main` product and its required merge
evidence, while Vercel production remains on `hosted-v1-maintenance`. This
decision is recorded as LM-014. Before landing, external settings must disable
Vercel application builds for local-first pushes through `Only build
production`, keep Vercel out of GitHub requirements, and preserve the hosted
production branch. Canceled preview records are acceptable but are not merge
evidence; the repository checker and exact GitHub Actions evidence remain
unchanged.

Fresh read-only reviewer `/root/vercel_decision_review` reviewed LM-014 and its
synchronized canonical baseline, step plan, and status updates on 2026-09-16
and approved with no remaining findings. The review confirmed the scope-out
goal: Vercel preview builds and required Vercel statuses are excluded from
local-first `main`, Vercel production remains on `hosted-v1-maintenance`, and
external project/rules verification remains a pre-landing gate rather than
repository toolchain evidence.

The operator subsequently chose the dashboard-owned `Only build production`
policy instead of a repository `vercel.json` branch allowlist because hosted
deployments are infrequent and the allowlist would be easy to outlive unnoticed.
LM-014 now permits Vercel to create a canceled preview record or informational
status, but the ignored-build check must cancel it before the configured
application build proceeds and no Vercel result is required evidence. Canceled
previews still consume deployment/concurrency capacity; the operator accepts
that cost for this infrequently used hosted topology. This refinement requires
fresh read-only review and a final-head remote observation before landing.

Fresh read-only reviewer `/root/vercel_production_only_docs` reviewed the
LM-014 production-only ignored-build refinement and its synchronized canonical
baseline, decision log, step plan, and status updates on 2026-09-16 and approved
with no remaining repository findings. The review confirmed that local-first
pushes may create canceled Vercel preview deployment records/statuses, the
ignored-build check prevents the configured application build from proceeding,
the deployment/concurrency cost is explicitly accepted, no Vercel result is
required merge evidence, production remains on `hosted-v1-maintenance`, and no
JSON-registry change is needed. PR-body synchronization plus final-head remote
observation were the remaining pre-landing closeout gates.

On 2026-09-16, PR [#158](https://github.com/loyalagents/context-router/pull/158)
head `e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` completed the remote-observation
gate: all applicable standard CI jobs and the dedicated 11-phase LMBG passed,
and Vercel returned `Canceled by Ignored Build Step`. This evidence does not
replace PR-body synchronization or the required checks on any later head. PR
#158 must keep both current before human review and landing.

## Implementation Review Gate

Each PR is blocked from ready-for-review status until fresh read-only reviewers
compare the base-to-HEAD diff, tests, registry/fixture changes, gate evidence,
and supported-mode statement with this approved plan. Review must cover
architecture, compatibility, testing, packaging, security/privacy, scope, and
maintainability. The sole writer resolves every finding. Material deviations
return to the plan review gate.

For 02A, required final evidence is the targeted red/green tests, backend
unit/build, exact-base full LMBG, dedicated migration workflow, all applicable
standard CI, clean repository/integrity state, and unchanged public fixtures.
The PR stays draft until local review/validation is complete and becomes ready
only after remote required checks pass. It is never auto-merged.

The fresh 02A implementation review completed on 2026-09-16. Architecture and
security reviewers each found that the initial import contract rejected direct
concrete-service imports but did not reject a direct
`@google-cloud/vertexai` SDK import. The writer added a separate SDK import
guard covering static, dynamic, and CommonJS forms with the sole production
allowlist entry at the hosted adapter implementation, reran the exact targeted
suite at 75/75, and both reviewers approved the resolution. The compatibility
reviewer approved without findings. All three reviewers confirmed the change
stays within 02A, preserves the public transport and hosted behavior, and does
not enter Steps 03–09. Final-head local and remote validation remains a
closeout gate rather than an implementation-review assumption.

The fresh PR 02B implementation review completed on 2026-09-16. The reviewers
required a credential-free pnpm probe environment, exhaustive exact-version
assertions for every workflow selection, a pnpm setup action compatible with
the integrity-suffixed `packageManager` value, and precise registry/status
wording. The writer resolved each finding, reran focused validation and the
exact-base full gate, and both reviewers approved the current local diff.
The implementation head's required remote workflow evidence subsequently
passed; any later documentation-only head must preserve it before human review
and landing.

A later independent review found the external Vercel compatibility gap, stale
elapsed-time wording, the analysis-only Windows limitation, an imprecise
top-level gate failure label, and missing probe-bound regression assertions.
The writer removed self-referential timing, recorded the Vercel/Windows
boundaries, made failure labels stage-aware, moved success output after cleanup,
and added bounded shell-free probe failure tests. Read-only reviewers
`/root/review_findings_platform` and `/root/review_findings_gate` approved the
result on 2026-09-16. The Vercel topology decision is now resolved by LM-014;
the external settings were subsequently verified as a landing gate, not as an
implementation-review finding.

## Exit Criteria

- 02A–02E each land as one independently useful, human-merged PR with one sole
  writer, recorded exact base, supported mode, rollback, and fresh approval.
- Application/transport model consumers depend only on the existing model
  ports; the public transport is independent of the adapter; `AppModule` is the
  sole hosted adapter selector; concrete adapters are not exported.
- Node 24.21.0/pnpm 10.25.0 are pinned consistently and the exact full LMBG is
  green with zero lock drift.
- Configuration/origin ownership and build-time versus runtime web endpoints
  are truthful; every known launch topology has migration guidance; arbitrary
  caller cwd cannot provide env/schema resources; hosted bind semantics remain
  compatible.
- Bootstrap proves readiness, partial-start cleanup, bounded SIGINT/SIGTERM,
  one-close behavior, and actual port/address reporting.
- Both staged hosted artifacts run through selected loopback/synthetic routes
  from a non-repository cwd with private roots, target-native dependencies,
  resource integrity, occupied-port and failure evidence, graceful/no-orphan
  shutdown, redacted diagnostics, scoped cleanup, and same-state restart. The
  result is explicitly not an offline/zero-egress guarantee.
- Existing Step 01 phases and all public contract fixtures remain active/green;
  the exact new Step 02 kind/phase/budgets and registry census are atomic and
  tested; the gate observes its 103-minute cooperative internal budget, the
  workflow enforces the 108-minute hard process bound, and the 165-minute job
  leaves the defined artifact/cleanup buffer.
- Platform rows claim only evidence actually executed. Final OS/product
  packaging policy remains assigned to Step 09.
- Plan and implementation reviews have no unresolved findings, canonical docs
  record the lasting decisions, required CI is green, and no PR is auto-merged.

## Closeout

After plan approval, update this step README, the local-migration index,
orchestration, Step 01 README, and decision log with the approved multi-PR
sequence and runtime target. Commit/push that planning checkpoint and open 02A
as a draft PR before product implementation. After each human merge, record the
PR number, merge SHA, validation evidence, supported mode, and next exact branch
base while activating only the next checkpoint. Keep this detailed plan while
later local-migration steps depend on its boundary and packaging evidence; Git
and merged PRs remain the historical archive.
