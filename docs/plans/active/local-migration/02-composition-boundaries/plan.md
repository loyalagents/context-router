# Step 02: Composition Boundaries

- Document status: independently approved; PR 02A
  ([#157](https://github.com/loyalagents/context-router/pull/157)) merged at
  `5a2fc8a09e9091d16160caea258d678293a1e2b3`; PR 02B implementation active
- Program step: `02-composition-boundaries`
- Target branch: `main`
- Planning base commit: `ff9d8bce6f1b5b28752ab1582e47947f131eff8c`
- Change classification: `shared`
- Depends on: Step 01 [PR #156](https://github.com/loyalagents/context-router/pull/156), merged at the planning base above
- Planning owner and sole repository writer: `/root`
- Implementation owner: `/root` for active PR 02B only
- Read-only discovery agents: `/root/discovery_arch_contracts`, `/root/discovery_runtime_packaging`, and `/root/discovery_tests_security`
- Plan reviewers: `/root/plan_review_architecture_scope`,
  `/root/plan_review_compat_runtime`, and
  `/root/plan_review_test_security` (all read-only and approved)
- Supported mode during planning: the existing hosted NestJS/PostgreSQL/Auth0/Vertex and Next.js composition
- Last updated: 2026-09-16

Step 02 is deliberately split into five independently useful PRs. Each later
branch is created only after a human merges its predecessor into `main`; these
are not pre-authorized stacked branches.

| PR/checkpoint | Branch and base | Sole writer | Read-only reviewers | Supported mode after merge |
| --- | --- | --- | --- | --- |
| 02A: hosted model binding | merged via [PR #157](https://github.com/loyalagents/context-router/pull/157) at `5a2fc8a09e9091d16160caea258d678293a1e2b3` | `/root` | `/root/final02a_arch_scope`, `/root/final02a_contract_runtime`, and `/root/final02a_test_security` (all read-only and approved) | Existing hosted composition; `AppModule` selects one hosted adapter binding while the legacy GraphQL transport and application consumers use the existing model ports. No local mode. |
| 02B: toolchain contract | active `codex/local-migration-02-toolchain-contract` from human-merged PR 02A SHA `5a2fc8a09e9091d16160caea258d678293a1e2b3` | `/root` | `/root/review02b_toolchain_contract` and `/root/review02b_gate_ci` (read-only) | Existing hosted composition on the exact reviewed Node.js/pnpm contract. |
| 02C: runtime configuration/bootstrap | inactive `codex/local-migration-02-runtime-bootstrap`; create only from the human-merged 02B commit and record its exact SHA | unassigned until activation | fresh reviewers assigned at activation | Existing hosted composition with explicit configuration/origin ownership and a tested process lifecycle. No local identity, store, or model. |
| 02D: runtime resources/package closure | inactive `codex/local-migration-02-runtime-resources`; create only from the human-merged 02C commit and record its exact SHA | unassigned until activation | fresh reviewers assigned at activation | Existing hosted composition with cwd-independent schema/catalog resources and an independently deployable backend production dependency closure. |
| 02E: staged packaging feasibility | inactive `codex/local-migration-02-packaging-smoke`; create only from the human-merged 02D commit and record its exact SHA | unassigned until activation | fresh reviewers assigned at activation | Existing hosted source composition plus a tested staged-hosted backend and web feasibility path. This is not an installed local product preview or an offline-guarantee claim. |

The current branch may implement **02B only**. Any
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
approved the local implementation; remote final-head evidence remains required.

The Vercel preview status is an external remote build topology. Vercel can
select Node 24 only by major and may roll its minor/patch release, while the 02B
checker intentionally requires Node 24.21.0. When that status is attached to
the final PR head, its log must record the observed Node and pnpm versions. A
green run on the exact pair is only point-in-time evidence, not a durable
selector. Landing remains blocked until a separate reviewed decision either
reconfigures/scopes the preview out of the local-first `main` contract or
revises the exact toolchain contract atomically; repository files do not capture
the project settings. Production remains on `hosted-v1-maintenance` under
LM-001.

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

The Step 01 registry currently derives 39 capabilities, five contract families,
45 static GraphQL consumers, nine dynamic consumers, 28 fingerprint consumers,
four external-client buckets, 119 references, 16 outbound-call records, 54
outbound-sink rows, five packages, and six observed-but-not-promised items.
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
| macOS arm64 | directly tested, source workspace only | local 11-phase Node 20 gate; partial Node 22/24 gates; no staged artifact yet | 02E smoke must pass natively and record platform, architecture, Node, pnpm, and relevant native package load |
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
| Backend runtime dependency ownership | **Immediate 02D package closure.** | Move `@google-cloud/vertexai` from the root importer to the backend package that imports it and prove a `pnpm --offline deploy` closure. |
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
  move the Vertex runtime dependency to the backend importer, and prove an
  independently deployable production dependency closure.
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
| Package/toolchain | explicit supported contract in 02B; package ownership correction in 02D | root/backend/web packages, Docker, CI, Corepack, contributor docs | Exact Node/pnpm checks gate install/build/LMBG/package evidence. Frozen install must not alter the lockfile except the reviewed workspace-importer move in 02D. Prior Node/pnpm lines cease to be supported only when 02B and migration guidance land. |
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
module-relative default, never an implicit cwd read. Inventory the catalog JSON
in the built output and fail before readiness when a required asset is missing
or tampered.

Move `@google-cloud/vertexai` from the root package to
`apps/backend/package.json`, because the backend is its runtime importer;
retain root `yaml` for eval tooling. Update only the reviewed lockfile importer
entries. Prove a backend-only production closure with:

```sh
pnpm --offline --filter backend deploy --prod <private-stage>/backend
```

The proof runs from a disposable source workspace, starts
`<private-stage>/backend/dist/main.js` with no root workspace `node_modules` in
resolution ancestry, loads the model adapter without calling it, and fails if
hoisting masks an undeclared dependency.

Schema content must remain byte-identical where the current fixture requires
it and semantically identical everywhere. If the in-memory representation
cannot satisfy that contract, stop and use a staged immutable canonical asset;
do not relax the fixture merely to accommodate the implementation.

### 02E: bounded staged-artifact smoke

The smoke is a hosted-artifact feasibility proof, not a local product mode:

1. The direct command creates its own disposable full-history source workspace;
   it never builds, generates, or cleans `dist`, `.next`, Prisma output, or temp
   state in the caller checkout. A dirty caller is allowed only when its
   pre/post hashes and status are preserved exactly. The aggregate gate invokes
   the same implementation with its already-created disposable workspace.
2. From already installed frozen dependencies, build backend and web. Configure
   Next with `output: "standalone"` and a module-relative
   `outputFileTracingRoot` equal to the repository root; never derive that root
   from the launch cwd. Assert that
   `relative(outputFileTracingRoot, apps/web)` is exactly `apps/web`. Use
   `pnpm --offline --filter backend deploy --prod` and assemble this exact
   target-native tree:

   ```text
   <stage>/backend/{package.json,dist/**,node_modules/**}
   <stage>/web/** := the complete, unpruned contents of apps/web/.next/standalone/**
   <stage>/web/<derived-app-relative>/.next/static/** := apps/web/.next/static/**
   <stage>/web/<derived-app-relative>/public/** := apps/web/public/**
   <stage>/manifest.json
   ```

   Copy the entire standalone tree without pruning, flattening, or re-parenting
   traced `.next/server`, `node_modules`, package/config, or workspace-package
   files. Derive the app-relative path from the configured tracing root, require
   it to equal `apps/web`, overlay `.next/static` and `public` there, and require
   the derived `<stage>/web/apps/web/server.js` to exist before launch. The
   manifest records that derivation and entrypoint, a complete staged-file
   inventory and hashes, platform, architecture, libc when applicable,
   Node/pnpm, native SWC/sharp loads, backend dependency closure, schema/catalog
   hashes, and the exact build-time public URLs.

   The offline backend deploy is the **single allowed dependency-materializing
   packaging command** in 02D/02E; it is not a runtime child and it does not
   authorize `pnpm install`, `npm install`, Corepack acquisition, or any
   network-capable equivalent. Command policy allowlists the exact argv above,
   requires `--offline`, and rejects substitutions or a second materializer.
   Tests capture deterministic inventories and hashes of the already-populated
   pnpm store and source tree before and after, require both to be unchanged,
   and make them read-only where the target permits. They fail rather than fetch
   when an artifact is absent. Record immutable ownership IDs before acquisition,
   hash the stage, then make staged dependencies/resources read-only. No package
   download occurs.
3. Before the web build, start a harness-owned loopback proxy on port 0 and use
   its actual URL for `NEXT_PUBLIC_BACKEND_URL` and `/graphql` URL. This stable
   proxy survives backend restarts and forwards only to the current staged
   backend generation. `APP_BASE_URL` is set to the actual staged web origin at
   runtime; the manifest/bundles must contain the proxy URL and must not contain
   the default/dead endpoint.
4. Launch both artifacts from a second non-repository cwd with mode-0700 `HOME`, temp,
   `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and
   log roots. Files, diagnostics, journals, and synthetic credentials are 0600.
   The backend command is `node <stage>/backend/dist/main.js` with `PORT=0` and
   structured actual-address readiness. The web command is the manifest-verified
   `node <stage>/web/<derived-app-relative>/server.js` with
   `HOSTNAME=127.0.0.1`; its
   supervisor uses a random explicit loopback port with bounded `EADDRINUSE`
   retry and emits a structured ready record only after TCP plus route probes.
   Use a strict environment allowlist and `COREPACK_ENABLE_NETWORK=0`.
   For each generation, start web first, capture its verified actual origin,
   start backend with that exact `CORS_ORIGIN`, then point the already-bound
   proxy at the verified backend address. Do not mark the generation ready
   until web, backend, proxy, origins, and staged routes all agree.
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
   Exercise ready and during-startup SIGINT/SIGTERM for both children. Successful
   shutdown must close Nest, Prisma, Next, proxy, listeners, journals, and
   tracked descendants once within grace, without SIGKILL. Escalation targets
   only the exact owned process tree and makes the smoke fail.
10. On POSIX, run a real nested-grandchild orphan regression and verify exact
   PIDs are gone. Windows remains analysis-only until a native job-object/tree
   mechanism and ACL checks pass; POSIX chmod is not Windows privacy evidence.
11. Restart both staged processes twice from the same artifacts and isolated
   state. Generation 1 writes a safe synthetic marker through a current use
   case; generation 2 reads it and verifies the same principal, complete
   catalog/schema, web support routes/static asset, no duplicate seed, and
   unchanged public fixtures.
12. Assert every recorded listener's actual bound address is loopback. Enumerate
   every noninternal address on every interface and probe every address/family
   against every staged listener (backend, web, and proxy). Any reachable,
   unprobeable, or zero-address case is `INCONCLUSIVE`/failure for a claimed
   network-isolation row; one failed address is never treated as exhaustive.
13. Clean only nonce/journal-owned paths, exact database, ports, and process
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
The runner passes one abort signal, waits for the smoke's owned cleanup journal
to settle, and treats escalation or an incomplete journal as failure.

Budgeting uses one gate-wide monotonic clock starting **before** any preflight,
database/container acquisition, or phase work. Existing phase timeouts total
79 minutes; the new 15-minute phase raises the manifest sum to 94 minutes. The
complete timeline is:

- `T+0..3m`: bounded preflight/resource acquisition;
- `T+3..97m`: at most 94 minutes of phase execution; the effective timeout of
  every phase is capped by the remaining global window, and cancellation is
  initiated no later than `T+97m`;
- `T+97..100m`: hard child-settlement/termination window of at most 180 seconds;
  no child remains at `T+100m`; and
- `T+100..103m`: unconditional final scoped cleanup, integrity verification,
  sanitized summary, and journal flush. The gate has a 103-minute hard bound.

The dedicated workflow separately bounds all work before the gate: checkout at
five minutes, Node/Corepack setup at five minutes, and frozen dependency
installation at fifteen minutes, for a 25-minute maximum. The gate step gets
108 minutes, comprising its 103-minute internal bound plus five minutes for the
workflow shell to persist diagnostics. An `if: always()` artifact/summary step
gets five minutes. The job timeout becomes 150 minutes: 25 + 108 + 5 plus a
12-minute outer margin. Step timeouts are checked in, so the job timeout cannot
silently become the primary cleanup mechanism.

Tests use a fake clock and forced acquisition/phase hangs to prove: preflight
cannot exceed three minutes; sum of active manifest phase timeouts is at most
94 minutes; cancellation begins by `T+97m`; every child settles by `T+100m`;
final cleanup/summary ends by `T+103m`; and the 5/5/15/108/5-minute workflow
step bounds plus the 150-minute job bound retain the stated margin. Cancellation
at any boundary, including preflight and `T+97m`, must enter the one final
three-minute cleanup path.

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
   `ci.yml` ownership lacks an explicit landing order. Also stop if a Vercel
   preview is attached without a reviewed decision for its major-only
   Node selector; even a point-in-time exact result does not establish durable
   alignment. Revert the entire version/eval checkpoint together; do not leave
   mixed version sources.

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
   `test/contracts/runtime-package-closure.spec.ts`, and
   `scripts/local-migration/runtime-resources.test.mjs`. They must fail on cwd
   schema access, writable caller `src`, missing/tampered resource behavior,
   root-owned Vertex dependency, and a backend deploy that succeeds only via
   workspace hoisting.
2. Run exactly:

   ```sh
   pnpm --filter backend exec jest --selectProjects unit \
     --runTestsByPath \
     src/mcp/resources/schema.resource.spec.ts \
     test/contracts/runtime-package-closure.spec.ts \
     --runInBand
   node --test \
     scripts/local-migration/runtime-resources.test.mjs
   ```

3. Implement the schema/catalog source and move the Vertex dependency/root
   lockfile importer in small slices. In a private temp stage run the exact
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
   drift. Do not describe this selected-route proof as offline/zero-egress.

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
| Attached Vercel preview | final-head build log records observed Node/pnpm; a reviewed decision must reconfigure/scope out the major-only preview or revise the exact contract | Yes when the status is attached to the PR |
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
  test/feasibility listeners bind to IP-literal `127.0.0.1`; negative probes
  cover every enumerated noninternal address/family for every staged listener,
  and any unprobeable/empty set is inconclusive. This is not a final authorization,
  Host, Origin, CSRF, DNS-rebinding, or LAN design.
- Only synthetic credentials, OIDC/JWKS, users, documents, database state, and
  model configuration are allowed. No real secret or user file enters a smoke.
- Child environments use an explicit allowlist. Arbitrary caller credential
  names and values are absent; secrets never appear in argv. Corepack/network
  installers and telemetry commands are disabled in the staged smoke; only the
  exact offline backend deploy may materialize dependencies before runtime.
  This is command/environment containment, not arbitrary-socket observation.
- Private roots are 0700 and files 0600 on POSIX, verified with `stat`, not
  assumed from umask. A Windows claim requires native ACL evidence.
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
- 02D reverts only schema/catalog/package-closure and dependency-importer
  changes; it does not roll back 02C.
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

The PR 02B follow-up review exposed Vercel's external major-only Node selector
and the unvalidated Windows `.cmd` probe path. The writer added the explicit
Vercel landing stop/decision gate and clarified the current macOS/Linux evidence
boundary. Fresh read-only reviewer `/root/review_findings_platform` approved
that material plan clarification on 2026-09-16; it does not authorize a checker
bypass, a Vercel project-setting mutation, or a Windows support claim.

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
Remote final-head workflow evidence remains the closeout gate.

A later independent review found the external Vercel compatibility gap, stale
elapsed-time wording, the analysis-only Windows limitation, an imprecise
top-level gate failure label, and missing probe-bound regression assertions.
The writer removed self-referential timing, recorded the Vercel/Windows
boundaries, made failure labels stage-aware, moved success output after cleanup,
and added bounded shell-free probe failure tests. Read-only reviewers
`/root/review_findings_platform` and `/root/review_findings_gate` approved the
result on 2026-09-16. The unresolved reviewed Vercel topology decision remains
a landing blocker, not an implementation-review finding.

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
  tested; the 150-minute workflow leaves the defined cleanup buffer.
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
