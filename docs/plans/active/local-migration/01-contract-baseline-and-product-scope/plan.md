# Step 01: Contract Baseline And Product Scope

- Document status: implementation complete; final review in progress
- Program step: `01-contract-baseline-and-product-scope`
- Target branch: `main`
- Planning base commit: `9b56d38fde927d4e643af89ba45665a439613939`
- Branch: `codex/local-migration-01-contract-baseline`
- Branch/PR sole writer: `/root`
- Change classification: `local-only`
- Depends on: completed Step 00 PRs [#153](https://github.com/loyalagents/context-router/pull/153), [#154](https://github.com/loyalagents/context-router/pull/154), and [#155](https://github.com/loyalagents/context-router/pull/155)
- Planning owner: `/root`
- Implementation owner: `/root` (approval gate completed 2026-09-14)
- Read-only discovery reviewers: `/root/discovery_contracts`, `/root/discovery_runtime_security`, `/root/discovery_tests_tooling`
- Plan reviewers: `/root/plan_review_architecture`, `/root/plan_review_compatibility`, `/root/plan_review_test_security` (fresh, read-only, explicitly approved)
- Implementation PR: one PR from `codex/local-migration-01-contract-baseline`, organized as the three independently runnable checkpoints below
- Checkpoint commits: plan gate `d3536c7`, executable registry `bc183ae`, aggregate gate/restart `64342cc`
- Supported mode after every checkpoint: the existing hosted NestJS/PostgreSQL/Auth0/Vertex and Next.js composition; no local preview becomes supported in this step
- Last updated: 2026-09-15

## Outcome

Establish the executable hosted-behavior baseline that later local-migration
steps must preserve or deliberately retire. The merged result will contain a
canonical, machine-checked capability and public-contract registry, one
deterministic aggregate command named the **Local Migration Baseline Gate
(LMBG)**, and a clean-process restart smoke against an isolated `_test`
PostgreSQL database using its `public` schema. It will not introduce a local
identity, database adapter, model, listener composition, or
UI composition. The currently supported hosted composition remains unchanged.

## Required Reading

- [`AGENTS.md`](../../../../../AGENTS.md), the root [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md), and [`docs/IMPORTANT/CURRENT_STATE.md`](../../../../IMPORTANT/CURRENT_STATE.md)
- [`../orchestration.md`](../orchestration.md), [`../decision-log.md`](../decision-log.md), [`README.md`](README.md), [`../step-template.md`](../step-template.md), and [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md)
- all current behavior documents under [`docs/current/`](../../../../current/) and relevant operator guidance under [`docs/useful/`](../../../../useful/)
- package metadata and entry points for [`apps/backend`](../../../../../apps/backend/package.json), [`apps/web`](../../../../../apps/web/package.json), [`apps/local-orchestrator`](../../../../../apps/local-orchestrator/README.md), [`examples/eval`](../../../../../examples/eval/README.md), and [`examples/eval-harbor`](../../../../../examples/eval-harbor/README.md)
- current source and tests for HTTP, GraphQL, MCP, identity, persistence,
  provider calls, document analysis, form fill, audit/history, reset,
  seed/catalog, orchestration, evaluation, and CI

## Entry Criteria

- Step 00 is present at the recorded full base SHA, which is also the merge base
  of this clean branch and `main` at planning time.
- `/root` is the sole writer. Discovery and review agents are explicitly
  read-only and may not edit files, create branches, commit, or run mutating
  repository commands.
- The repository was clean before branch creation.
- No current worktree owns this plan. Other worktrees do own proposed changes
  to `.github/workflows/ci.yml`; Step 01 therefore will not edit that file and
  will use a dedicated workflow with the landing rule below.
- Planning stops if the observed public schema or supported hosted composition
  cannot be reproduced. Uncertain behavior is labeled as observed-but-not-
  promised and receives a bounded characterization task instead of becoming a
  compatibility promise.

## Current Evidence

### Supported composition and test posture

- `apps/backend` is a NestJS application with GraphQL, REST, stateless HTTP MCP,
  Prisma/PostgreSQL, Auth0 JWT validation, and Vertex AI. `apps/web` is a
  Next.js/Auth0 UI. `app.listen(port)` does not provide a hostname, so the
  current process is not code-enforced loopback-only.
- Backend unit, PostgreSQL integration, and e2e suites strongly cover preference,
  definition, location, profile, document, form, history, MCP, grant, reset,
  workflow, identity, and transaction behavior. The e2e test app replaces real
  Auth0/Vertex and differs from production CORS, validation, and listener setup.
- The web package has codegen/build/lint but no behavior-test script; the root
  `test:web` command currently names a nonexistent package script. This is a
  recorded gap, not a passing test claim.
- Current CI checks docs, backend unit/integration/e2e, orchestrator
  test/lint/build, eval fixture verification, Harbor static checks, and the web
  build. It does not run a backend production build, seed typecheck, actual
  process restart, generated-file cleanliness assertion, network-egress
  assertion, or browser Host/Origin/CSRF tests.
- `.nvmrc` specifies Node 20. Local evidence is Node 20.19.5 with pnpm 10.25.0,
  while CI installs pnpm 9 and the orchestration document records pnpm 10.24 as
  prior evidence. Step 02 owns the supported runtime pin; Step 01 must keep its
  gate compatible with the existing CI and report the versions it ran.

### Observed contract caveats

- GraphQL root fields are checked into `apps/backend/src/schema.gql` and consumed
  by the web generated client, local-orchestrator apply client, eval scripts,
  and the MCP `schema://graphql` resource.
- `preferenceCatalog` is documented and described as optionally authenticated,
  but its resolver also has a class-level required auth guard. Existing e2e
  tests replace both guards and do not establish production unauthenticated
  behavior. Step 01 records this as unresolved observed behavior and does not
  promise anonymous catalog access.
- `MCP_HTTP_PATH`, `MCP_HTTP_REQUIRE_AUTH`, and `MCP_STDIO_ENABLED` are
  configuration-shaped non-capabilities: controller/middleware paths are
  hard-coded to `/mcp`, auth is unconditional, and no stdio bootstrap exists.
- An absent, empty, or wholly unrecognized MCP preference scope currently means
  “no token narrowing,” restoring the recognized client's configured maximum
  capability. That behavior is tested but is not a least-privilege target.
- Document analysis sends raw file bytes, filename, schema, and all active
  global values to Vertex; form fill sends field metadata, resolved facts,
  policies, and all active global values. Neither excludes sensitive definitions.
- Audit snapshots contain values. UI masking is derived from the live catalog,
  so archived/deleted sensitive definitions can become visible. Some provider,
  extraction, identity, filename, and correction logs can contain user data.
- The authenticated web `/api/debug/token` route returns the complete bearer
  token and decoded claims and is linked from the dashboard.
- Local-orchestrator “dry run” prevents preference application but still reads
  and uploads documents. Its manifest v3 can store absolute paths, snippets,
  values, backend URLs, command arguments, and errors. `--include-hidden` can
  include `.env` files. Arbitrary backend URLs and command providers are
  accepted without a product-grade consent or containment boundary.

## Scope

- Add a canonical Markdown explanation and versioned JSON registry covering the
  capability decisions, semantic public contracts, an exact in-repo
  path/operation consumer map, known external client configurations, current
  outbound boundaries, and observed-but-not-promised discrepancies.
- Add test-first, non-mutating contract fixtures/checks for normalized complete
  GraphQL signatures and known operations; REST request/auth/status/success and
  error envelopes; complete MCP server/tool/resource/OAuth/DCR descriptors and
  capability visibility; all 19 seeded catalog definitions and seed behavior;
  the six MCP mutation operations; and local-orchestrator manifest-v3 schema,
  failure/correlation/partial-reconcile behavior and versioning.
- Add `pnpm migration:gate`, a tested phase runner, deterministic diagnostics,
  temporary-database lifecycle, and one dedicated CI workflow that invokes the
  same root command.
- Add `pnpm migration:smoke:restart`, which uses an isolated PostgreSQL database,
  real migrations and seed, an actual production backend build/process, two
  starts against the same state, bounded readiness, cross-transport public
  probes, state comparison, and scoped cleanup.
- Add a narrowly scoped, test-first `APP_HOST` listener option so the smoke can
  bind the real production entry point to `127.0.0.1`; leaving it unset preserves
  the hosted listener behavior. Step 02 still owns making loopback the local
  default and centralizing port/host configuration.
- Update this step README, orchestration status, and canonical documentation at
  the approved-plan and closeout gates.

## Non-Goals

- Selecting or implementing SQLite, repository ports, local identity, local
  model runtime, a desktop shell, packaging, LAN exposure, cloud sync, or hosted
  data/user import.
- Changing the current default all-interface bind, Host/Origin/CSRF posture, Auth0
  behavior, Vertex payloads, history masking, debug-token route, GraphQL fields,
  MCP route/auth/descriptor behavior, or orchestrator behavior in Step 01.
- Adding frontend behavior tests or claiming that a production Auth0/Vertex flow
  is covered by the restart smoke.
- Pulling model assets, packages, containers, Harbor, or remote provider data as
  an implicit part of the gate. Dependencies and the PostgreSQL 15 image are
  explicit prerequisites; live provider/eval commands remain opt-in.
- Promoting local-orchestrator, eval, or eval-harbor into installed-product
  surfaces, or implementing their hosted-era ideas as product requirements.
- Breaking or removing a public route, GraphQL field, MCP tool/resource, or
  manifest before the later owning step satisfies LM-008.

## Capability And Product-Scope Matrix

Step 01's implementation checkpoints only capture and test these decisions; all
three checkpoints leave the hosted default behavior unchanged. “After owner” describes
the required local-product behavior when the named later step implements the
decision. A `DEFER` row always has a decision owner and acceptance question.

| Capability and strongest current evidence | Disposition and local-product reason | Compatibility and acceptance | Owner; privacy/security/state/network effects |
| --- | --- | --- | --- |
| Preference definition lifecycle: global catalog plus user-owned create/update/archive/export, validation metadata, namespaces and scopes; definition service/e2e and `docs/current/PREFERENCE_SCHEMA.md` | **RETAIN** domain meaning; **REPLACE** direct Prisma implementation. User-defined memory remains core product behavior. | Current GraphQL shapes remain during migration. Steps 04–05 run shared contracts for ownership, uniqueness, archive visibility, type/options/scope changes, and catalog order; Step 08 keeps edit/export UI. Unsafe shape changes with existing values must reject or migrate explicitly. | Steps 04–05 and 08; local state, atomic transactions, no required egress. |
| Preference values: active/suggested/rejected lifecycle, delete suppression, validation/canonicalization, global/location precedence; preference/location suites and current docs | **RETAIN** exactly as application behavior; **REPLACE** storage adapter. | Contract suite must cover status transitions, tombstones, array/number/date normalization, location merge and isolation before accepting a new adapter. Existing GraphQL stays compatible through Steps 07–08. | Steps 04–05, consumers web/MCP/orchestrator/eval; local sensitive state, no intrinsic egress. |
| Location entities: user-owned create/read/list/type-filter/update/delete, `HOME|WORK|OTHER`, nonempty create fields, newest-first lists, and cascading removal of location-scoped preferences; location e2e, service/repository implementation, and Prisma relation | **RETAIN** the location domain behavior and ownership boundary; **REPLACE** direct Prisma storage. Addresses are sensitive local memory, not account identity. | Current GraphQL shapes remain during migration. The current e2e proves CRUD/filter/input behavior while service/repository/Prisma sources establish ownership, ordering, and cascade; Steps 04–05 must turn all of those into cross-adapter behavioral tests, including cross-user read/update/delete denial and preference cascade, before accepting a new adapter. Step 08 preserves client compatibility and may add a location UI only through a separately scoped product decision; none exists today. | Steps 04–05/08; sensitive address state, transactional cascade, no intrinsic egress. |
| Seven `profile.*` global slugs in the catalog and profile UI | **RETAIN** as ordinary memory; add no mandatory fixed profile fields in the initial local product. | Registry pins the seven slugs and current `profile.email` sensitivity. Step 08 preserves editable profile behavior; no account field is silently treated as profile memory. | Steps 04–05/08; potentially sensitive local values. |
| Auth0 login currently copies available name/email claims into four profile values after first account creation | **REPLACE**, not a provider-independent contract. Local first run/profile editing supplies memory explicitly; no continuous account-to-contact copying. | Hosted behavior remains until Step 03/08 additive migration. Tests distinguish account identity fields from memory and prevent unverified-email linking. | Steps 03 and 08; removes identity-provider egress and implicit personal-data copying. |
| Definition-schema export | **RETAIN** as user portability/developer inspection. | Preserve GraphQL export through Step 08; Step 09 documents a local file export and compatibility format. | Steps 08–09; export is an explicit local user action and may contain sensitive schema metadata. |
| Bulk value import/export is not a current product contract; document analysis proposes values and the orchestrator is tooling | **DEFER** product bulk import/export decision to Step 09 after backup/restore format exists; do not infer it from the orchestrator. | Step 09 must either add a consented, versioned local format with conflict/recovery tests or record a scoped removal decision. Existing orchestrator remains tooling until then. | Step 09 decision gate; filesystem secrets, conflicts, retention, and recovery are mandatory inputs. |
| Mutation audit events are co-transactional with preference/definition writes and capture actor, origin, source, correlation, and snapshots | **RETAIN** atomic provenance and user-visible history; **REPLACE** persistence. | Steps 04–05 must prove mutation rollback also rolls back audit. Step 08 preserves filter/order/pagination and masks by event-time sensitivity, including archived definitions. | Steps 04–05/08; raw value snapshots are sensitive local state and require deletion/retention treatment. |
| MCP access history is request-level, sanitized, non-atomic and fail-open; no discovery/auth-failure events | **RETAIN** the current minimum audit surface, isolation, correlation, and fail-open service behavior. | Step 07 decides additive auth-failure/discovery/object granularity and explicit scope issuance; Step 08 renders it. Current omissions are documented, not promised forever. | Steps 07–08; value-free logs remain the invariant, errors need centralized redaction. |
| History retention is indefinite until destructive reset; no rollback exists | **REPLACE** undefined retention with user-visible local retention/deletion policy. **REMOVE** record-level rollback from the initial local product rather than invent unsafe intervening-write semantics. | Step 09 defines backup/restore and whole-history deletion; Step 08 explains no rollback. A future rollback feature requires a new reviewed contract, conflict policy, and audit semantics. | Steps 08–09; local disk growth, deletion and recovery. |
| Document analysis proposal/review/explicit apply; application does not persist raw upload bytes | **RETAIN** propose-before-write and raw-file non-retention; **REPLACE** Vertex and client-trusted/sequential partial apply. | Steps 06/08 use a local-default model, minimize supplied memory, expose per-item success/failure/conflict, require confirmation, and prove no raw bytes survive request/restart. Current REST payload remains until consumers migrate. | Steps 06 and 08; raw/sensitive file data, prompt injection, memory values; zero default remote egress. |
| Supported analysis formats: text, Markdown, JSON, YAML, text-extractable PDF, PNG/JPEG plus config-file coercion in tooling | **RETAIN** text/Markdown/JSON/YAML/text-PDF product inputs. **DEFER** image OCR/vision support to Step 06's model capability decision. Tool-only config/MIME behavior is not a product promise. | Step 08 adds magic/type, pre-read size, cancellation, concurrency and secret-file consent tests. Step 06 must explicitly enable or reject image inputs with truthful UI before merge. | Steps 06/08; file privacy and resource-abuse boundary. |
| PDF AcroForm filling supports text/checkbox/radio/dropdown/single-list, field-policy v1, editable output, and summary | **RETAIN** supported field semantics and editable artifact; **REPLACE** remote inference and silent overwrite/opaque partial outcomes. Scanned/flattened PDF OCR is not a current feature and is **REMOVE** from initial scope. | Steps 06/08 preserve REST during migration, run local inference, default to review/preserve-existing unless policy says overwrite, and report per-field outcomes. | Steps 06/08; raw PDF stays local, only explicitly selected local/opt-in provider sees minimized facts. |
| Literal preference search plus AI slug proposal validated/narrowed against local schema | **RETAIN** literal search and propose-and-narrow invariant; **REPLACE** provider. | Step 06 runs local model proposal; Step 08 moves useful search into the product UI and capability-gates AI. | Steps 06/08; schema metadata only for AI search, zero default egress. |
| Read-only `consolidateSchema`: defaults to personal definitions, can include grant-filtered global definitions, short-circuits below two definitions, sends definition metadata—not stored values—to structured AI, rejects protected `profile.*`, hallucinated/repeated slugs, undersized groups, and invalid recommendations, and returns advisory groups without mutation; workflow unit/e2e suites | **RETAIN** the scoped, non-mutating advisory/propose-then-validate behavior; **REPLACE** the hosted structured-model implementation. It is a distinct workflow, not merely a retained MCP name. | Steps 05–07 preserve personal-default scope, authorization filtering, protected-schema exclusions, validation of every model-returned slug/recommendation, and the no-write invariant. Step 06 supplies a local-default model or capability-gates the tool; Step 07 preserves the MCP descriptor/envelope while consumers migrate. | Steps 05/06/07; definition descriptions/options/ownership metadata may reach the selected model, but preference values do not; zero default remote egress after Step 06. |
| Search Lab is a demo/diagnostic page, and Test AI Chat exposes generic `askVertexAI` | **REMOVE** both from the shipped local navigation/product. They do not define core memory workflows. | GraphQL `askVertexAI`, `/api/chat`, and pages remain during LM-008 compatibility window, are deprecated/migrated in Steps 06/08, and are removed only with release/config guidance. | Steps 06/08; removes generic prompt/data egress surface. |
| Core UI pages: dashboard, profile, preferences, schema, form fill, history, permissions | **RETAIN** user outcomes; **REPLACE** hosted Auth0/API composition with local UI adapters. | Step 08 proves non-AI pages without Auth0/remote services, capability-gates AI pages, and preserves relevant GraphQL during consumer migration. | Step 08; browser local-service Host/Origin/CSRF boundaries. |
| Authenticated `/api/debug/token` and dashboard link expose a full bearer token | **REMOVE** from shipped product; do not replace with another raw-token display. | Keep only until Step 03/08 provide bounded local connector/pairing setup and migrate operator docs; then remove with LM-008 evidence. | Steps 03/08; critical credential exposure removed. |
| `MEMORY_ONLY`, `DEMO_DATA`, and `FULL_USER_DATA` reset modes are transactional/user-scoped; advanced modes erase histories/definitions but retain identity | **RETAIN** clear-memory outcome. **REMOVE** demo/full modes from normal product UX; deterministic fixture cleanup remains explicitly test/developer-only. **REPLACE** confirmation/recovery. | Steps 04/08 keep user isolation and audit; Step 09 defines “clear local data” versus uninstall/backup, server-side confirmation, and recovery. | Steps 04/08/09; destructive local state, no remote calls. |
| Seeded core definition catalog is JSON-backed and idempotent; seed also creates sample users | **RETAIN** catalog meaning, exact slugs and idempotent initialization. **REMOVE** sample users from product first-run seed; retain synthetic identities only in isolated fixtures. **REPLACE** storage mechanism. | Step 01 registry pins catalog. Steps 04–05 cover collisions, updates, archives, stale entries, transaction failure, and two-run idempotence. | Steps 04–05; local state only. |
| Human identity is Auth0/external-identity/email centered; M2M clients create synthetic human users | **REPLACE** with stable provider-neutral local principal, distinct MCP client identity and grants. | Step 03 must survive restart, never link on unverified email, and run with Auth0 DNS/config absent. Step 07 maps separate client authority. | Steps 03/07; removes Auth0/JWKS/management egress and client/principal conflation. |
| GraphQL `me` and self-only `user(id)` expose the current principal; `user(id)` rejects cross-user reads and has no known in-repo caller | **RETAIN** provider-neutral “current principal” via `me`; **REMOVE** the redundant caller-supplied `user(id)` from the final local contract after migration. | Step 03 first preserves both and pins `user(id)` self-only authorization. Step 08 migrates any newly discovered caller to `me`; deprecation/removal follows LM-008 with external-client guidance. | Steps 03/08; principal isolation is security-critical, no intrinsic egress. |
| MCP capability ladder, static client targets, optional token narrowing, and database grants | **RETAIN** layered maximum-and-narrowing semantics; **REPLACE** absent-scope full-capability issuance with explicit least-privilege local authority. | Step 07 baselines every rule, adds explicit scopes without silently expanding authority, and applies LM-008 to external clients. | Step 07; security-critical local authorization state. |
| Local-orchestrator remote analyze/apply CLI and manifest v3 | **REMOVE** as installed-product scope; **RETAIN temporarily** as developer/eval tooling with current v3, correlation, dry-run, failure and partial-reconcile semantics. | Step 01 characterizes its contract. Step 09 either retires the package after consumers move or explicitly documents its developer-only support window. No product requirement is inferred from it. | Step 09 retirement decision; manifests can persist secrets, analyze/apply can egress. |
| Orchestrator command/Claude/Codex filters, arbitrary backend URL, hidden/MIME policies | **REMOVE** from product. While tooling remains, all are explicit operator opt-in and current behavior is characterized rather than hardened in Step 01. | No LMBG phase invokes them. Step 09 retirement decision owns deletion or a separately reviewed developer-tool hardening plan. | Step 09; subprocess inherits environment and remote providers may receive previews/values. |
| Orchestrator TODOs: dedupe/resume, retry/pacing, durable run history, definition-aware writer | **REMOVE** from this program's product scope. | Any future bulk-import design starts from Step 09's decision and a new plan; these ideas are not acceptance criteria. | Step 09 only if bulk import is approved; otherwise no owner/work. |
| `examples/eval` deterministic fixtures/runners | **RETAIN** as developer/evaluation tooling, not product. | LMBG runs `eval:verify` and two deterministic database scenarios. Live GraphQL/provider/agent variants require explicit invocation. | Every migration step maintains fixtures; local test data only in gate. |
| `examples/eval-harbor` static and live comparison tooling | **RETAIN** static checks as research/dev validation; **DEFER** live Harbor/provider comparison ownership to Step 06 model evaluation. Never a product dependency. | LMBG runs only checked-in static verification. Step 06 records whether a live research run informs its model choice; it cannot be a merge gate. | Step 06; live path may download Docker/HF assets and call OpenRouter/agents. |
| Cloud Run, Vercel/Auth0 invite gating, hosted deployment docs, Docker PostgreSQL operator flow | **REMOVE** from `main` product workflow after local cutover; preserved and maintained on `hosted-v1-maintenance`. **REPLACE** with local install/operate/update/backup guidance. | No Step 01 hosted-doc deletion. Step 02 adds early local composition guidance; mandatory Step 09 cutover owns replacing/removing stale main-line hosted instructions after re-verifying the preserved branch role. Optional LAN Step 10 has no cleanup dependency. | Steps 02/09; package/download boundary, local paths and recovery. |
| No application telemetry is directly configured; transitive tools may check for updates/telemetry | **RETAIN** no product telemetry by default; **DEFER** transitive offline audit to packaging. | LMBG disables known Next telemetry and invokes no provider. Step 09 captures sockets after install/assets and disables or discloses all update checks. | Step 09; zero undisclosed normal-runtime egress. |

## Public, Package, And Integration Contracts

The versioned registry added in Checkpoint 1 is the executable name-level
baseline. Exact payload and authorization assertions remain in the cited test
suites; the registry links rather than duplicates every type definition.

| Interface | Step 01 decision and observed baseline | Consumers, compatibility window, and removal guidance |
| --- | --- | --- |
| `GET /health` | **RETAIN** `{status:"ok",timestamp}` readiness surface; Step 02 may add readiness detail additively. | Operators, Docker, smoke scripts, external monitors. Preserve through the program; document any future versioning. |
| `POST /graphql` | **RETAIN during migration** the complete normalized semantic SDL: every type/field, argument/default, list/non-null wrapper, enum value, input/output field including `@oneOf`, interface/union, scalar, deprecation and custom directive application; description copy is separately fingerprinted. Current roots include the listed 15 queries and 15 mutations, with no subscriptions. `me` is the retained current-principal outcome; `user(id)` is currently self-only and planned for later removal. | Every named web/orchestrator/eval operation is validated against the schema and mapped by stable path/operation/root-field identity; MCP exposes the same SDL resource; unknown external clients remain. Fields remain until each owning Step 03–08 checkpoint expands/migrates/removes under LM-008. Semantic diff classifies additive/deprecation versus breaking changes, and generated artifacts have one owner. |
| `POST /api/preferences/analysis` | **RETAIN route/payload during migration; REPLACE provider/implementation**. Multipart, 10 MiB default, documented MIME set; application errors include `success`, `no_matches`, `parse_error`, `ai_error` in HTTP-success envelopes. | Web document UI, orchestrator, eval/live callers, unknown external clients. Step 06/08 add provider-neutral/local path before deprecation; removal requires version/release guidance. |
| `POST /api/form-fill/pdf` | **RETAIN route/payload during migration; REPLACE provider/implementation**. Multipart PDF plus optional JSON field-policy v1; base64 PDF and `success|partial|no_fillable_fields|unsupported_format|failed` summary. | Web form UI, eval scripts, unknown external clients. Step 06/08 preserve or version before incompatible field outcome semantics. |
| `POST /mcp`, `GET /mcp` | **RETAIN current HTTP compatibility**: stateless Streamable HTTP JSON response; GET is 405 with `Allow: POST`; disabled HTTP reports 503. **REPLACE** hosted auth/transport default in Step 07. | Claude/Codex/other MCP clients and config docs. Step 07 chooses HTTP/stdio mix, expands first, migrates setup docs, and publishes a compatibility window before any path removal. |
| OAuth discovery (root and `/mcp` protected-resource and authorization-server variants) and `POST /oauth/register` | **RETAIN while hosted HTTP MCP is supported; REMOVE/REPLACE** with local connection metadata after Step 07. | MCP clients and Auth0 configuration. Removal is coupled to transport migration guidance, not to tool schema changes. |
| MCP tool names | **RETAIN** `listPreferenceSlugs`, `searchPreferences`, `smartSearchPreferences`, `consolidateSchema`, `listPermissionGrants`, `mutatePreferences`. | External MCP clients plus eval. Step 07 preserves names or adds versioned alternatives. |
| MCP server/tool/resource shapes | **RETAIN complete normalized baseline**: server name/version/instructions/capabilities; every tool name, description, annotations, full input/output JSON Schema and scope-dependent visibility; five read tools expose `structuredContent` and matching JSON text while `mutatePreferences` intentionally has a text envelope only and exactly six operations; `schema://graphql` is the only resource with a full descriptor/read envelope. | Step 01 pins full descriptors for `claude`, `codex`, `fallback` and zero-capability `unknown` buckets plus read-only scope narrowing. Step 07 may add compatible descriptors/versioned tools; any mutation output-schema addition must preserve text clients for the declared window. |
| MCP OAuth/DCR/auth payloads | **RETAIN during hosted compatibility** exact root/path metadata status, headers, issuer/resource/authorization/token/registration/scopes fields; missing/invalid/insufficient bearer challenge shapes; exact DCR success/error envelopes and redirect-bucket resolution for Claude, Codex, ChatGPT and OpenAI callbacks. | Claude/Claude Desktop, Codex, ChatGPT/OpenAI connectors and other external clients. Step 07 expands/migrates connection metadata before removal and preserves independent signed-token verification plus client-capability mapping until the hosted window closes. |
| Web support routes `/api/chat`, `/api/debug/token`, Auth0 `/auth/*` | **REMOVE/REPLACE later**, no Step 01 runtime change. `/api/debug/token` receives priority removal after a safe connector path exists; `/api/chat` retires with Test AI Chat. | Current dashboard and local-orchestrator setup docs. Steps 03/06/08 migrate consumers first and give explicit operator guidance. |
| Local-orchestrator CLI/API/manifest | **Developer-only compatibility**. Pin manifest literal version 3, dry-run-is-not-no-egress, failure policy, analysis correlation, and slug-based partial reconciliation until package retirement decision. | Eval/operators only; not installed-product users. Step 09 names retirement release notes or a separately approved developer support window. |
| Catalog JSON, GraphQL SDL/contract fixtures, and generated clients | **RETAIN** the committed catalog, SDL and semantic fixtures as canonical inputs/contracts, with generated cleanliness in LMBG. Ignored Prisma and web clients remain disposable build outputs under current policy. | Backend seed/tests, web, eval. Single owner per branch; additive SDL first. Commit catalog/SDL/fixture changes with the producer; regenerate and compare ignored clients only in the disposable gate workspace, never commit them under current ignore policy. |
| Configuration-shaped MCP flags and `APP_PORT`/`PORT` drift | **Do not promise unsupported modes**. Registry labels custom path, auth-off, and stdio as non-capabilities; production currently reads `PORT`, despite `.env.example` advertising `APP_PORT`. | Step 02 centralizes truthful config; Step 07 may add custom transport modes. Documentation must not claim a mode until an executable test proves it. |

The checked path/operation map enumerates every current query/mutation in
`apps/web/app/**`, local-orchestrator analysis/apply calls, eval
ingestion/export/snapshot/live clients, root/package scripts, and every current
runbook that names a contract. Known external configurations enumerate Claude
and Claude Desktop callback variants (including loopback 8081), Codex loopback
8082, ChatGPT connector callback, OpenAI apps callback, and the fallback/public
bucket; their secrets and deployment values are never recorded.

That external inventory is necessarily incomplete. HTTP, GraphQL, and MCP are
publicly reachable in the hosted baseline, so “no in-repo caller” never permits
removal. The checker fails when a discovered operation/path lacks a map entry.
Each owning step must repeat discovery, state a calendar- or release-bounded
compatibility window, publish migration instructions, and retain a tested
adapter/alias until its removal gate is approved.

## Hosted Dependencies And Outbound Calls

“Default” describes the current hosted composition. LMBG itself makes no remote
provider calls and uses only verified loopback TCP or local Unix-socket
PostgreSQL/process traffic after explicit installation prerequisites are
present.

| Dependency/call | Current trigger and data crossing boundary | Current requirement | Disposition, owner, and acceptance |
| --- | --- | --- | --- |
| PostgreSQL through Prisma/`pg` | Backend startup opens a database socket; all account, preference, definition, audit, access, grant and location state | Required; endpoint may itself be remote | **REPLACE Steps 04–05** with an embedded store while preserving transaction/contracts. Acceptance: clean restart and no database socket outside the application process. |
| Auth0 JWKS | First REST/GraphQL bearer validation and independently MCP validation fetch/cache signing keys | Required for protected APIs/MCP | **REMOVE/REPLACE Steps 03/07**. Local auth/read/write/MCP works with Auth0 DNS blocked and no Auth0 config. |
| Auth0 Management/Authentication API | First-login user fetch and metadata operations; subject/profile/account data and client credentials | Required for some account flows | **REMOVE Step 03**. Stable local principal, verified-linking rules, no management credentials. |
| Next.js Auth0 SDK | Browser login/logout/session/refresh and server API token acquisition; cookies/tokens/identity claims | Required for current web | **REMOVE/REPLACE Steps 03/08** with local session/CSRF boundary and separate MCP client identity. |
| Vertex generate/content APIs and Google ADC/OAuth/metadata | Document bytes/filename/schema/values; form fields/values/policies; prompts/schema for search/consolidation/chat; retries may resend prompt plus invalid result | Required for current AI flows, not base startup | **REPLACE Step 06** with local default. Any remote adapter is explicit opt-in and discloses destination, payload classes, retry multiplicity, and provider retention. |
| Web to configured backend/GraphQL | Browser/server sends bearer and product inputs to configurable URLs | Required, normally hosted network | **RETAIN interface, REPLACE topology Steps 02/08** with loopback canonical client/config and hostile Host/Origin/CSRF tests. |
| Local-orchestrator analysis/apply | Reads whole selected file, uploads multipart with bearer to arbitrary backend, then GraphQL writes; no effective request timeout | Optional developer tool | **REMOVE product / temporary developer RETAIN**, Step 09. Never invoked by LMBG; current dry run is disclosed as egressing. |
| Orchestrator arbitrary command, Claude CLI, Codex CLI | Inherited environment plus previews/suggestions/values over stdin/CLI provider; remote behavior depends on executable | Optional explicit developer operation | **REMOVE product**, Step 09 retirement decision. No implicit gate invocation. |
| Eval Vertex/Claude/Codex/OpenRouter/remote GraphQL/MCP | Fixtures, prompts, values, tokens; some tokens appear in child CLI arguments | Optional live evaluation | **RETAIN opt-in developer only**; Step 06 owns model-comparison usage. Deterministic local variants alone are merge gates. |
| Harbor/Docker/Hugging Face/bootstrap/package registries | Images, runner packages, datasets, model/build assets | Install/bootstrap or optional research, never normal checked-in runtime | **DEFER offline/install policy Steps 02/06/09**. LMBG fails with prerequisite guidance rather than silently downloading a missing DB image. |
| Telemetry/update checks | No direct application analytics found; possible Next/Prisma/provider CLI/transitive behavior | Uncertain | **DEFER bounded socket audit Step 09**; disable known Next telemetry in Step 01 gate. |
| Filesystem/subprocess boundary | Uploads memory-buffered; generated client/schema, manifests and eval artifacts; orchestrator commands inherit env | Mixed required/optional | **REPLACE/harden Steps 08–09** with explicit data directories, permissions, limits, cancellation, redaction and cleanup. |

## Design

### Canonical registry and checker

Add `docs/current/LOCAL_MIGRATION_CONTRACT_BASELINE.md` for human-facing lasting
behavior and `docs/current/local-migration-contract-baseline.json` as a
versioned registry. The JSON contains only contract names, classifications,
evidence paths, exact consumers/operations, discrepancy status and owning
steps—no secrets, user values, generated identifiers, callback client IDs, or
mutable deployment URLs. Focused versioned fixtures live beside the owning test
surface rather than turning the high-level registry into an unreadable payload
dump:

- a normalized GraphQL semantic signature containing every type, field,
  argument/default, null/list wrapper, input/output (including `@oneOf`), enum,
  deprecation, and ordered custom directive application, plus a separate
  description-copy fingerprint;
- an HTTP contract fixture covering method/path/content type, multipart fields,
  auth class, success status/envelope, expected application-error status/envelope
  and important headers for health, GraphQL, analysis, form fill, MCP and
  OAuth/DCR;
- normalized complete MCP server, tool, resource, OAuth/DCR and challenge
  descriptors for each client/scope visibility profile;
- the exact 19-entry catalog semantic fixture (`slug`, `valueType`, `scope`,
  normalized `isSensitive`, ordered `options`, validation bounds/pattern and
  default when present) plus a separately classified display/category/
  description copy fingerprint; and
- `apps/local-orchestrator/contracts/run-manifest-v3.schema.json` plus valid,
  invalid and mixed partial/failure fixtures.

`scripts/local-migration/check-contract-baseline.mjs` loads these artifacts and
fails with a focused semantic diff. It validates every known GraphQL operation
against the SDL; discovers embedded GraphQL/HTTP calls and named runbook/script
references and requires an exact path/operation map entry; checks HTTP fixtures
against focused e2e characterization; compares full MCP descriptors and
capability/scope visibility; verifies all catalog semantics; and checks the six
MCP mutations, manifest-v3 schema/version and package classifications.

The checker also derives exact public-reference and outbound-sink maps from the
current product, operator/runbook, orchestration, evaluation, and smoke source
trees. It fails on missing or stale references, changed sink kinds/counts, or a
sink path without a reviewed outbound-boundary classification and live source
fingerprints. It then compares a changed public fixture with its merge-base form.
GraphQL changes are classified as additive, deprecation, or breaking using
semantic—not textual—types. HTTP/MCP descriptor removals or incompatible
request/response changes are breaking. A breaking diff fails unless the same PR
contains a registry migration record naming consumers by stable identity and
exact path, additive replacement, bounded compatibility window, guidance and
rollback. Consumer IDs include fingerprint-row IDs, GraphQL
path/kind/operation/root-field tuples, and public-reference tuples; the checker
unions prior/current identities and reports every missing or mismatched entry.
Named and inline root fragments are resolved transitively and cycle-safely, and
the clean-restart GraphQL probes are named census members. Unknown external
route/MCP classifications, known MCP auth/config GraphQL/catalog affinities,
and client callback buckets are set-normalized protected registry facts, so
they cannot be erased in a preparatory PR. Existing-route HTTP constraints,
response domains, and accepted upload MIME changes; new MCP client/visibility
buckets; existing-client capabilities, target rules, redirects and visibility;
OAuth/DCR/challenge metadata; tool/resource authority and tool task-execution
metadata; constraining input-schema arrays; and output-schema domain changes
fail closed into reviewed evolution. Explicitly proven input widenings remain
additive; existing GraphQL enum, union, and interface possible-type widenings
also require review as output-domain changes. A manifest-v3 schema
shape change fails unless its literal/versioned filename is bumped; descriptive
copy changes are reported separately and do not masquerade as value-contract
breaks. Seed integration characterization covers catalog-attribute update,
personal-slug collision precedence, archived-global replacement, stale-global
retention, transaction failure behavior and two-run idempotence rather than
deriving every assertion from the mutable catalog itself. Structurally invalid
HTTP-success orchestrator analysis/apply fixtures must fail the canonical schema
check; current permissive client behavior remains an observed developer-tool gap
unless a separately reviewed hardening change is approved.

The checker distinguishes `preserved-contract`, `observed-not-promised`, and
`planned-removal`; it must not force later steps to preserve an unsafe
implementation merely because Step 01 observed it. Changes update the registry
in the same PR and follow LM-008 when public.

### Local Migration Baseline Gate (LMBG)

Root command: `pnpm migration:gate`.

The tested Node phase runner prints sanitized Node/pnpm/Python/PostgreSQL/commit
preflight information, uses fail-fast phases with elapsed time, writes its
machine-readable summary and per-phase logs to a unique OS temporary directory,
prints that directory on failure, and cleans only resources it created. Secrets
and full environment variables are never printed. It accepts a CI-supplied test
PostgreSQL administration URL or starts a uniquely named loopback-published
PostgreSQL 15-alpine container only when that image is already installed. It
creates a uniquely named database whose generated name ends in `_test`, uses
that database's normal `public` schema, and verifies `current_database()` over a
server connection before running any suite that truncates data. This matches the
current Prisma adapter and raw test SQL, both of which assume `public`; a URL
`schema=` parameter is explicitly forbidden as an isolation mechanism. The
runner never uses the developer's normal database, a fixed container name, or
`docker compose down -v`.

Before that first server write, URL parsing accepts only `postgres:`/
`postgresql:` endpoints whose client-side DNS results and actual connected
socket peer are loopback, or an explicitly selected local Unix socket. It does
not require PostgreSQL's `inet_server_addr()` to be loopback: a Docker/CI
service correctly reports its container-side bridge address even when its host
publication is loopback-only. `current_database()` remains the independent
destructive-target check. Remote hostnames, mixed loopback/non-loopback DNS
results, URL userinfo in diagnostics, and any non-loopback client peer are
rejected. Duplicate `host`/`port` routing parameters are rejected before client
construction, and a validated Unix-socket URL is reconstructed from its single
canonical routing value. Focused tests cover IPv4/IPv6, localhost resolution, Unix sockets,
remote/mixed names and addresses, a loopback-published container, and redacted
refusal messages. There is no “allow remote” gate escape hatch. A pre-existing
loopback tunnel to a remote database cannot be distinguished at this boundary;
supplying an administration URL is an explicit test-infrastructure action, and
Step 09's packaged-runtime socket audit owns physical-egress proof.

Before running phases, the runner copies all tracked and non-ignored working
files into a unique disposable workspace while excluding `.git`, ignored
secrets, dependency trees, and build outputs. It clones each already-installed
workspace dependency tree and the Corepack cache into private workspace-owned
copies, using copy-on-write file cloning where supported, and never invokes an
installer. All generators, builds, tests, eval artifacts and process smokes run
in that copy without a write path back through shared dependencies. Tracked
generated SDL is hashed
before and after its generator/process phases and compared byte-for-byte.
Ignored Prisma/web clients are disposable products created only in the copy;
their required entry points are checked and repeated codegen output is hashed
for determinism, not compared with a nonexistent committed file. A `finally`
integrity check confirms the caller's declared generated paths retain their
pre-run existence and hashes on every success/failure path. This prevents a
failed late phase from leaving the caller's worktree overwritten.

Merge-base and whitespace checks run in the caller checkout before copying. CI
checks out full history and supplies the pull request base SHA (or push event's
`before` SHA) as `MIGRATION_GATE_BASE_SHA`; local runs may derive only
`git merge-base HEAD origin/main`. The runner requires a full hexadecimal commit,
resolves it with `git cat-file`, verifies it is an ancestor of `HEAD`, and fails
on missing/shallow/ambiguous history instead of skipping compatibility checks.
It runs both `git diff --check <base>...HEAD` for committed PR changes and
worktree/index checks (`git diff --check` and `git diff --cached --check`). It
exports immutable merge-base copies and hashes of every public contract fixture
into the disposable workspace and passes their validated directory/SHA to the
semantic checker, which needs no `.git`. The one-time Step 01 bootstrap permits
absent base fixtures only when the current registry declares version 1 and the
merge-base predates this file; all later missing base artifacts fail.

`scripts/local-migration/gate-phases.json` is the checked-in lifecycle manifest.
Each supported mode declares active/retired status and zero or one active
successor; the initial hosted baseline is active with no successor. Each phase
declares its current supported-mode applicability, owning roadmap
step, required predecessor/replacement evidence, and retirement condition.
Later steps keep the root `pnpm migration:gate` command stable: a PR adds the
replacement mode proof before, or atomically with, retiring a hosted-only phase.
The checker rejects an unowned phase, a retired phase without replacement
evidence, or a supported mode with no restart smoke.

Required phases, in order:

1. contract-checker tests and registry check;
2. Markdown-validator tests and repository-link validation;
3. Prisma generate, seed typecheck, backend production build under
   `NODE_ENV=production`, and backend unit under `NODE_ENV=test`;
4. unique-database migrations, backend integration, and backend e2e tests;
5. local-orchestrator test, non-mutating typecheck/lint, and build;
6. `pnpm eval:verify`;
7. deterministic `samir-desai-i9-template-smoke` and
   `elena-marquez-i9-template-smoke` eval runs against the same isolated database;
8. web production codegen/build under `NODE_ENV=production` with
   `NEXT_TELEMETRY_DISABLED=1`;
9. eval-harbor static checks under the available Python 3.12 contract;
10. the clean-restart smoke below against a second unique database; and
11. caller-worktree `git diff --check`, disposable-workspace tracked-SDL
    equality, repeated ignored-client generation determinism, and the `finally`
    caller-integrity assertion.

Auth0, Vertex, Claude, Codex, OpenRouter, Hugging Face, live Harbor, real bearer
tokens, package installation, and image pulls are prohibited gate dependencies.
The runner passes provider-deny/sanitized environment defaults and documents
that Step 09 must add socket-level zero-egress proof for the final packaged
runtime. Initial budget is 15 minutes warm / 25 minutes cold after dependencies
and the DB image are installed; Checkpoint 2 records measured local and CI
runtimes rather than presenting discovery estimates as facts.

Database and automatic-container acquisition write their generated identity,
independent per-run ownership nonce, and exact recovery action to an atomic
mode-`0600` lifecycle journal before the create/start attempt. A generated
database receives the nonce in its ownership comment; cleanup rechecks both its
server identity and comment immediately before `DROP`, and never drops a known
name conflict or unverified database. The Docker fallback writes the independent
nonce as a label, verifies it before every cleanup, and removes only the
immutable container ID returned by that inspection rather than the mutable
name. Journal replacement uses a private same-directory file, flush, and atomic
rename. Phase scripts that spawn their own command groups install explicit
SIGINT/SIGTERM forwarding; real nested-child regressions prove cancellation
does not strand the managed process, while the aggregate parent grants the
restart smoke more time than its cumulative bounded cleanup budget.

Add `.github/workflows/local-migration-baseline.yml`, not the concurrently owned
`ci.yml`. It selects Node 20, the repository's currently CI-supported pnpm 9,
Python 3.12, and a PostgreSQL 15 service, installs with frozen lockfile, seeds an
offline Corepack pnpm-9 cache for the disposable workspace, then runs only
`pnpm migration:gate`. The gate itself enforces Python 3.12 and safe
database topology/targeting while recording, not pinning, the observed Node,
pnpm, and PostgreSQL versions. Checkout uses full history and the workflow
passes the validated PR-base or push-before SHA; a zero/missing push-before SHA
fails with an actionable message rather than weakening comparison. Step 02 owns
version selection/pinning. A later CI optimization may consolidate workflows
only after preserving this one-command entry point and its required status.

### Hosted Baseline Clean-Restart Smoke

Root command: `pnpm migration:smoke:restart`.

The smoke creates a random `_test` PostgreSQL database from the test
administration connection, verifies its name server-side, deploys real
migrations into `public`, runs the real catalog seed twice, and asserts the exact
active global catalog without duplicate slugs. A failing backend unit test first
characterizes listener argument resolution; the smallest implementation makes
`main.ts` pass an explicit host only when `APP_HOST` is set, preserving the
current hosted default when it is absent. The backend build config pins
`rootDir` to `src`, and contract-only Jest files live under `test/contracts`, so
a test import cannot relocate the production artifact. The smoke builds the
backend and web app once each. It starts the built Next.js app on `127.0.0.1`, proves the
unauthenticated `/api/chat` and `/api/debug/token` envelopes, and follows
`/auth/login` only as far as an ephemeral loopback OIDC discovery endpoint. It
then starts the documented backend build artifact, `node dist/main.js`, twice with
`APP_HOST=127.0.0.1` on a dynamically selected port against the same database.
The same artifact is named by the package and Docker production commands, and
the focused tests plus clean-restart smoke fail if those entrypoints diverge.

A loopback-only HTTPS OIDC/JWKS fixture supplies an ephemeral RSA key and a
short-lived synthetic M2M token. Only the isolated web probe and backend child
trust that generated test certificate; the fixture URL and token are never
printed or persisted. The M2M
path avoids Auth0 Management API calls, while still exercising the production
JWT strategy and real GraphQL guard. Each generation must, within a bounded
timeout:

- return `status: ok` from `/health` with a parseable timestamp;
- answer a public GraphQL `__typename` probe without a bearer token;
- return the exact active global `preferenceCatalog` through the real GraphQL
  process when called with the synthetic bearer token;
- return the characterized unauthenticated GraphQL and MCP challenge shapes;
- return exact OAuth protected-resource/authorization-server metadata and
  allowed, empty, invalid, mixed, and denied DCR responses with their exact
  headers without contacting Auth0;
- return the characterized `GET /mcp` 405 and `Allow: POST`, then authenticate
  `POST /mcp` through the independent MCP verifier and execute `initialize`,
  read-scoped `tools/list`, `resources/list`, `resources/read` for
  `schema://graphql`, and `tools/call listPreferenceSlugs`, asserting server
  identity, complete descriptor fingerprints, scope visibility and read-result
  envelopes; and
- leave the sorted catalog slug/ID/count snapshot queryable from the isolated
  database.

For each generation the harness enumerates non-internal host interfaces and
asserts that the health port cannot be reached through any non-loopback address,
in addition to confirming loopback success. Unit and failure-injection coverage
proves `APP_HOST` reaches `app.listen`, unexpected early exits close the JWKS and
database resources, and the unset option keeps the prior hosted call shape.

The harness records each owned resource in a private mode-`0600` lifecycle
journal with exact recovery guidance before or as the resource is acquired; the
web subprobe links its own journal for its reserved loopback port, in-process
Next app, and private temporary home. Its listener binds port `0` before Next
preparation, so no released-port race exists. Before loading Next, it snapshots
the caller environment, removes every inherited key, installs only the explicit
smoke allowlist and synthetic credentials, and restores the exact snapshot
after bounded Next/listener cleanup. Cancellation waits for listener
acquisition to settle before cleanup, and pending Next preparation must settle
or hit its own bound before environment/home teardown. Listener, Next,
environment, and home cleanup are independently bounded/attempted and preserve
the primary plus all cleanup failures. The parent command grants the web child
more SIGTERM grace than the sum of those bounded cleanup stages.
SIGINT/SIGTERM cancel the active command tree and still enter bounded cleanup.
The harness requests backend termination with SIGTERM, waits a bounded interval,
then waits for the process `close` event before finalizing redactors/logs, and
records whether the current production process exited cleanly. Because
`main.ts` has no shutdown hooks today, it uses a scoped SIGKILL fallback rather
than claiming graceful application shutdown. The database remains. The second
must reproduce identical application-level and direct-database catalog
IDs/slugs/count, the same synthetic principal ID, and no duplicate active global
definition, proving seed idempotence and application-readable state survival
across a real process restart. Separate logs, readiness/JWKS failures,
exit/signal, DB diagnostics, state diff, and cleanup result are retained in the
temporary diagnostic directory on failure. On success, the exact unique
database/container/process/JWKS fixture is removed. Database cleanup terminates
only connections to the generated database and drops that exact validated name.
The harness refuses a non-test database or unexpected `current_database()` and
never calls the existing all-model database cleaner.

This is deliberately named **Hosted Baseline**: it proves the currently
supported production entry point, PostgreSQL migrations/seed, public readiness,
GraphQL transport/authorization/read use case and authenticated MCP discovery/
read boundary. It does not claim to prove interactive Auth0 login, Auth0
Management API, preference mutation, Vertex, browser startup, future
SQLite/packaging, or loopback binding **as the default**. The client and JWKS
fixture connect on `127.0.0.1`; the hosted default bind gap and graceful
shutdown-hook lifecycle remain owned by Step 02. Production anonymous
`preferenceCatalog` behavior is characterized separately and is not a smoke
assumption.

## Checkpoints

Each checkpoint is independently useful and recoverable, is recorded as a
separate commit on the sole-writer branch, and leaves the hosted composition as
the supported runtime. No implementation checkpoint begins until the plan
review table contains explicit approval from all fresh reviewers.

### Checkpoint 1: Executable contract registry

1. Add failing tests for missing/mismatched registry fields, normalized GraphQL
   signatures and known operations, HTTP request/auth/status/envelope fixtures,
   complete MCP descriptors/OAuth/DCR/challenges/capability visibility, all 19
   catalog semantics and seed edge behavior, exact consumer map entries,
   manifest-v3 valid/invalid/partial fixtures and version-bump enforcement,
   package classifications, and unowned `DEFER` rows.
2. Add the JSON registry, semantic fixtures, manifest schema, checker
   implementation, seed characterization and canonical Markdown baseline;
   update only documentation/contracts/tests/tooling, not product handlers,
   public schemas, runtime client behavior, or generated artifacts.
3. Expected initial failure: checker fixtures report the missing registry and
   one deliberate mismatch per unit test; success produces counts by semantic
   contract family and consumer path.
4. Targeted validation:
   `node --test scripts/local-migration/check-contract-baseline.test.mjs`, the
   targeted backend seed/public-contract suites against a unique `_test`
   database, local-orchestrator manifest/client contract tests,
   `node scripts/local-migration/check-contract-baseline.mjs`,
   `node scripts/check-markdown-links.mjs`, and `git diff --check`.

Reportable result: every current capability/public/package surface has a
machine-checked disposition and owner without changing runtime behavior.

### Checkpoint 2: Aggregate gate and clean-process restart

1. Add failing phase-runner tests for ordering, first-failure exit, redacted
   diagnostics, timeout/cleanup, remote/mixed-address refusal, loopback/Unix and
   loopback-published-container connection acceptance, and server-verified
   test-database acceptance,
   disposable-workspace/caller-integrity behavior, phase-manifest ownership and
   transition rules, validated/missing/shallow merge bases, base-to-HEAD plus
   index/worktree whitespace checks, and prohibition of live-provider phases.
2. Add failing listener/smoke tests for unset-versus-explicit `APP_HOST`,
   non-loopback reachability, test administration URL and server-verified
   database-name validation, loopback JWKS/token handling, two-generation
   authenticated GraphQL/MCP state comparison, bounded readiness, unexpected
   early exit, bounded SIGTERM/SIGKILL reporting, process/JWKS/database cleanup,
   and failure-log preservation.
3. Implement the minimal `APP_HOST` listener option, phase runner, unique
   PostgreSQL database lifecycle, disposable workspace, lifecycle manifest,
   complete restart smoke, root commands, and dedicated workflow atomically.
   There is no public/authoritative partial-gate state: `pnpm migration:gate`
   is added only with every required hosted phase and replacement rule present.
   Do not edit `.github/workflows/ci.yml`, generated files, or the lockfile.
4. Run the smoke independently, then the entire gate. Record caller/base
   integrity, non-loopback refusal, process generations, state assertions,
   elapsed time and exact cleanup without credentials.
5. Targeted validation:
   `node --test scripts/local-migration/*.test.mjs`,
   `pnpm migration:smoke:restart`, and `pnpm migration:gate`.

Reportable result: local and CI callers share one complete deterministic gate;
the real hosted backend is loopback-confined for the smoke and survives restart
against isolated application-readable state.

Final Checkpoint 2 remediation evidence on 2026-09-15: the focused
local-migration suite passed 128/128 tests. The final committed-tree LMBG rerun
passed all 11 phases in 227.805 seconds, including its 33.947-second
clean-restart phase, under Node 20.19.5, pnpm 10.25.0, Python 3.12.8, and
PostgreSQL 15.15. The passing aggregate run removed its generated database and
fallback container and preserved the caller's tracked SDL and ignored generated
paths. PR #156's dedicated workflow subsequently passed under Node 20, pnpm 9,
Python 3.12, and PostgreSQL 15, and every required remote check was green at the
reviewed implementation head.

The first Checkpoint 2 aggregate run also exposed two stale deterministic I-9
expectation snapshots. Only
`examples/eval/scenarios/samir-desai-i9-template-smoke/expected/filled-form.json`
and
`examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json`
were updated, from Git blobs `302a159` to `2e55255` and `3280ae7` to `f970563`
respectively, to include the already-canonical personal-email field-map note.
No scenario input, expected action/value, scorer, runtime behavior, or test
threshold changed. The affected deterministic scenarios and complete gate were
rerun. This is an explicitly recorded derived-expectation correction discovered
by the new gate, not a relaxation of tests or a public-contract change.

### Checkpoint 3: Integration review and closeout

1. Update canonical docs, this README, orchestration, and the PR description
   with measured evidence and the next Step 02 action; do not claim unrun checks.
2. Ask fresh read-only implementation reviewers to compare the approved plan,
   each checkpoint, full base-to-HEAD diff, contract registry, security/privacy
   properties, and validation evidence. Resolve every finding as sole writer;
   rerun the smallest affected test after each fix.
3. Run the full LMBG and every existing CI-equivalent job required by both
   `.github/workflows/ci.yml` and the dedicated workflow. Inspect remote PR
   checks when available; fix failures but do not merge.
4. Targeted validation: `pnpm migration:gate`, validated-base
   `git diff --check <base>...HEAD`, worktree/index whitespace checks,
   `node scripts/check-markdown-links.mjs`, and clean caller generated-path
   integrity after committed outputs.

Reportable result: reviewed implementation, complete evidence, and a PR ready
for human review with no automatic merge.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Contract/unit | `node --test scripts/local-migration/*.test.mjs`; normalized GraphQL/HTTP/MCP/catalog/manifest fixtures; backend unit within LMBG | Review semantic diff, exact consumer map and observed-vs-promised labels | Yes |
| Integration | backend PostgreSQL integration in unique `_test` database via `pnpm migration:gate` | Inspect exact DB cleanup and failure summary | Yes |
| E2E/contract | backend e2e, focused public/seed contracts, deterministic eval scenarios, registry check, signed GraphQL and MCP restart probes | Confirm descriptor/envelope fingerprints and no live-provider/token prompt | Yes |
| Frontend/build | web codegen/production build in disposable workspace; repeated ignored-client hash | Confirm there is still no web test script and do not report one | Yes |
| Backend/package builds | backend production build, seed typecheck; orchestrator test/lint/build; eval verify; Harbor static | Inspect workflow invokes only root gate | Yes |
| Clean install/process restart | `pnpm migration:smoke:restart` inside and outside LMBG | Verify explicit loopback bind/non-loopback refusal, two PIDs/generations, same catalog snapshot, bounded shutdown | Yes |
| Persisted-state upgrade/recovery | real migrations into random `_test` database, seed twice, authenticated catalog read, restart, exact DB cleanup | Failure injection proves logs retained and only the validated generated database is removed | Yes |
| Docs/repository hygiene | Markdown tests/checker; validated-base `git diff --check <base>...HEAD`; index/worktree checks; generated equality | Check full-history base SHA, branch, owners, PR template | Yes |
| Live Auth0/Vertex/agent/Harbor | None; intentionally excluded | Explicitly list as not run/non-gate | No |

## Parallel Work And Conflict Surfaces

- This branch exclusively owns this `plan.md`, the new canonical baseline and
  JSON registry, `scripts/local-migration/**`, root migration scripts, and
  `.github/workflows/local-migration-baseline.yml` until its PR lands. It also
  owns only the narrow `APP_HOST` resolution and its focused tests in
  `apps/backend/src/main.ts` (or a helper extracted solely for testability).
- No Step 01 edit will touch `pnpm-lock.yaml`, `apps/backend/src/schema.gql`,
  `apps/web/lib/generated/graphql.ts`, shared e2e setup, authentication, MCP
  routing, `AppModule`, any other `main.ts` behavior, database schema/migrations, or
  `.github/workflows/ci.yml`.
- Worktrees proposing `.github/workflows/ci.yml` optimizations may land before
  or after Step 01 because this branch uses a separate workflow. If later work
  consolidates workflows, it must land after Step 01 and retain
  `pnpm migration:gate` as the authoritative command and preserve its required
  status/path coverage.
- Generated GraphQL files are read-only caller-worktree inputs for Step 01. All
  codegen/build/process work occurs in the disposable copy. The gate compares
  tracked SDL there, checks ignored outputs there, and verifies in `finally`
  that caller generated paths retain their exact pre-run state.
- Review agents run read-only inspections only. The sole writer applies all
  plan and implementation resolutions serially.

## Privacy And Security

Step 01 does not make the unsafe hosted boundary the local target. The registry
records current exposure separately from retained invariants and later owners.

- Current backend binding without hostname, permissive missing MCP Origin,
  absent Host validation, browser CSRF/rebinding questions, proxy-header trust,
  and Docker host publishing remain observed risks. Steps 02, 03, 07 and 08
  must add loopback `127.0.0.1`/`::1`, exact Host/Origin/null-Origin policies,
  cookie CSRF protection, trusted-proxy configuration and negative LAN/rebinding
  tests before a local mode is supported. Step 01 adds only the explicit
  `APP_HOST` opt-in needed to keep its real-process smoke on loopback and proves
  non-loopback reachability fails; it does not change the hosted default.
- The future stable human principal must remain separate from MCP client/grant
  identity. Unverified email cannot link accounts. Current absent-scope MCP
  expansion is compatibility evidence, not the local issuance design.
- DCR rejection logging currently includes complete untrusted redirect-URI
  arrays and therefore can expose query-string secrets or personal data. Step
  07 must replace it with redacted origin/class/outcome logging before local
  transport ships; Step 01 records the risk without changing hosted behavior.
- Current provider/extraction/identity/upload logs can include prompt prefixes,
  old/new preference values, subject/email, filenames, and user IDs. Steps 06,
  08, and 09 must route those through centralized value-aware redaction and
  safe logging; Step 01 records the active boundary without altering hosted
  output.
- The gate uses obviously synthetic DB credentials and data in a random test
  `_test` database. It rejects non-test database names both syntactically and
  through `current_database()`, prints no URL/password/token or
  environment dump, invokes no remote provider, disables known telemetry, and
  scopes process/container/database cleanup by generated identifiers.
- Registry and tests contain no actual tokens, provider secrets, user values,
  deploy IDs, or URLs with userinfo. Failure diagnostics redact URL credentials,
  authorization headers, JWT-like strings, common secret assignments, and
  canary test values before terminal/file output.
- Later upload/model work must enforce pre-read limits/type checks, cancellation,
  concurrency controls, secret-file consent, minimal prompts, prompt-injection
  tests, explicit review, centralized canary redaction, secure local file
  permissions, and raw-upload absence after request/restart. A remote provider's
  own retention is always disclosed separately from application non-retention.
- Audit values remain sensitive local state; response/log/access metadata remain
  value-free outside the designated audit store. Event-time sensitivity must
  survive definition archive/deletion.
- `PrismaService.cleanDatabase()` and demo reset helpers are never called by the
  gate. The harness creates and drops only its exact generated `_test` database.

## Rollback Or Recovery

This step changes no production data/schema and no default supported runtime
behavior. The only application-code addition is opt-in `APP_HOST`; unset hosted
startup retains the prior listener call. Before merge, revert the affected
checkpoint commit and rerun the previous checkpoint's targeted command. After
merge, a normal Git revert of this Step 01 PR removes the listener option plus
registry/checker/gate/smoke/docs artifacts; the hosted runtime continues using
the unchanged schema and default application entry point.

Every gate/smoke run uses a random `_test` database and, when needed, a uniquely
named container. Success cleans both. Failure retains only sanitized files in
the printed OS temporary directory and attempts scoped cleanup; recovery
instructions name the exact validated database/container, never a wildcard or
volume-wide command. The runner refuses ambiguity rather than truncating a
caller-supplied database. The disposable workspace prevents generator/build
recovery from depending on cleanup. No backup is needed because no production
state is migrated.

## Risks And Open Questions

| Risk/question that can change this step | Resolution owner/decision point |
| --- | --- |
| Can current production anonymously query `preferenceCatalog`, contrary to the class-level guard? | Checkpoint 1 bounded production-entry characterization. Registry marks it observed-not-promised either way; restart smoke does not depend on it. Step 03/08 decide target access. |
| Does the current build/test toolchain pass under both local pnpm 10.25 and CI pnpm 9? | Checkpoint 2 measures both where available. Step 02 selects/pins the contract; Step 01 does not change lockfile. |
| Is the validated comparison commit available in full local/CI history? | Checkpoint 2 fails before copying/running tests when `git cat-file` or ancestor validation fails. CI uses full checkout and event SHA; local guidance fetches `origin/main` explicitly outside the gate if needed. No shallow-history skip exists. |
| Is a locally cached PostgreSQL 15-alpine image present? | Gate preflight. If absent and no test administration URL is supplied, fail with an explicit installation prerequisite; never silently pull. CI uses its declared service. |
| Can all current CI-equivalent suites fit the 25-minute cold budget? | Checkpoint 2 records phase times; optimize orchestration without dropping required surfaces. Any split remains under one aggregate root command. |
| Do current tools attempt undisclosed outbound connections despite provider-deny environment? | Step 01 records process-level observations if seen; Step 09 owns socket-level packaged-runtime proof. Any actual required egress discovered pauses approval and updates the inventory. |
| Will concurrent CI optimization change workflow ownership/path filters first? | Sole writer avoids `ci.yml`; Step 01 dedicated workflow lands independently. Later consolidator must preserve the root gate and required status. |

## Plan Review Gate

Implementation is blocked until fresh read-only reviewers inspect the completed
plan, every finding is either incorporated or rejected with evidence, and this
table records explicit approval. Discovery reports do not count as approvals.

| Review dimension | Reviewer | Findings resolution | Approval |
| --- | --- | --- | --- |
| Architecture, scope, maintainability | `/root/plan_review_architecture` | Replaced unsafe schema isolation with a unique database; added application-level restart reads, disposable generated-output workspace, phase lifecycle rules, mandatory Step 09 cleanup, atomic gate activation, explicit bind/base handling, and corrected stale artifact wording. | **APPROVED** 2026-09-14; no remaining findings |
| Public compatibility and consumers | `/root/plan_review_compatibility` | Added semantic GraphQL/HTTP fixtures, complete MCP/auth/OAuth/DCR coverage and signed smoke calls, all catalog semantics, version-gated manifest fixtures, exact consumer/external-client mapping, and explicit `me`/`user(id)` evolution. | **APPROVED AND REAFFIRMED** 2026-09-14; no remaining findings |
| Testing, security and privacy | `/root/plan_review_test_security` | Combined incomplete gate/smoke checkpoints; added opt-in loopback binding and non-loopback negatives, validated merge-base propagation, loopback-only DB client-peer checks, container-safe locality, and bounded shutdown claims. | **APPROVED AND REAFFIRMED** 2026-09-14; no remaining findings |

## Implementation Review Gate

Checkpoint 3 is blocked until fresh read-only reviews compare the complete
base-to-HEAD diff and validation evidence with this approved plan. The sole
writer resolves every finding and records explicit final approval here.

The first-pass approvals below are retained as audit history, but they were
superseded when a user-supplied independent review of PR #156 found a production
entrypoint regression at head `493bf49`. They do not authorize merge after the
remediation.

| Review dimension | Reviewer | Findings resolution | Approval |
| --- | --- | --- | --- |
| Architecture, scope and maintainability | `/root/final_architecture_scope` | Reconciled canonical counts; made restart GraphQL probes named, fragment-aware consumers; derived MCP schema/catalog affinities from actual visibility; and kept the implementation within the two approved checkpoints. No remaining semantic, architecture, scope, or maintainability finding. | **APPROVED AND REAFFIRMED** 2026-09-15; no remaining findings |
| Public compatibility and consumers | `/root/final_compatibility_testing` | Closed fail-open GraphQL, HTTP, MCP, OAuth/DCR/challenge, client-visibility, authority, task-execution, output-domain, and accepted-MIME evolution cases; protected both sides of consumer transitions; and tied real HTTP/MCP descriptors and upload enforcement to executable e2e evidence. No remaining compatibility or consumer finding. | **APPROVED** 2026-09-15; no remaining findings |
| Testing, security and privacy | `/root/final_compatibility_testing` | Added environment replacement/restoration, manifest-producer validation, private atomic journals, loopback/peer checks, independent database/container ownership, immutable-ID cleanup, cancellation-safe acquisition, merge-base artifact hashing, and real unsupported-upload rejection coverage. No remaining testing, security, privacy, or CI-equivalence finding outside the remote workflow result. | **APPROVED** 2026-09-15; no remaining findings |

### Post-approval remediation

| Finding | Resolution | Verification state |
| --- | --- | --- |
| Production build moved from `dist/main.js` to `dist/src/main.js`, breaking `start:prod` and the Docker/Cloud Run container command | Moved the MCP contract spec out of `src`, pinned the production TypeScript `rootDir` to `src`, added the contract directory to Jest, restored the smoke to `dist/main.js`, and tied package/Docker/smoke entrypoints together with a focused test. | Focused build/unit validation passed; exact-tree aggregate and remote reruns pending. |
| EADDRINUSE retry omitted `httpContract` | Retry now spreads the complete generation options object and increments only `portAttempt`; a regression test pins dependency preservation. | Focused migration tests passed; restart smoke pending. |
| Merge-base comparison could skip without explicit evidence | Every aggregate contract-baseline command receives bound base artifacts plus `MIGRATION_GATE_REQUIRE_BASE_COMPARISON=1`; required-but-missing state fails closed, and success reports `baseComparison=performed` or `skipped`. | Focused migration tests and standalone skipped-mode checker passed; aggregate performed-mode run pending. |
| Catalog smoke seed missed the dedicated seed typecheck | `tsconfig.seed.json` includes both seed entrypoints with an explicit package root. | Seed typecheck passed. |
| Gate orchestration was outside the outbound-sink census | The census now covers all non-test local-migration scripts and recognizes subprocess wrappers, `execFile`, DNS, direct PostgreSQL clients, spawn, fetch, and sockets; the registry classifies the reviewed gate boundary and fingerprints its sources. | Contract checker passed. |
| Hosted-era orchestrator TODO disposition existed only in this plan | The canonical bulk-import/export registry decision now says any Step 09 design starts fresh without inheriting dedupe/resume, retry/pacing, durable run-history, or definition-aware-writer requirements. | Contract checker passed. |

Fresh read-only remediation reviewers must fill the table below after comparing
the complete implementation and diff with this plan. All rows remain pending
until that review is complete.

| Review dimension | Reviewer | Findings resolution | Approval |
| --- | --- | --- | --- |
| Architecture, scope and maintainability | Pending | Pending fresh remediation review. | **PENDING** |
| Public compatibility and consumers | Pending | Pending fresh remediation review. | **PENDING** |
| Testing, security and privacy | Pending | Pending fresh remediation review. | **PENDING** |

## Exit Criteria

- The canonical registry and human baseline classify every current capability
  and public/package surface with no unowned `DEFER`.
- LMBG and Hosted Baseline Clean-Restart Smoke pass from their documented clean
  prerequisites, with measured runtime and sanitized failure diagnostics.
- Existing hosted application behavior, schemas, generated clients, lockfile,
  and production data remain unchanged.
- Required local and CI checks pass; live/remote exclusions are explicit.
- Plan review findings and final implementation/diff review findings are all
  resolved with explicit read-only approvals recorded.
- Canonical docs and the PR describe contracts, security/privacy/state/network
  effects, rollback, and each later decision's owner.
- Step 02 is activated with the aggregate gate as its entry criterion.
- The PR is prepared for human review and is not automatically merged.

## Closeout

Before human merge, update [`README.md`](README.md) and
[`../orchestration.md`](../orchestration.md) with the approved ownership,
implementation status, measured evidence, PR link/number if available, and the
concrete Step 02 activation action. Keep this detailed plan while downstream
Step 02 still needs its classifications; delete it only in a later reviewed
closeout when canonical documents fully own the lasting contract.
