# Step 06: Local Model

- Document status: draft A; no feasibility or implementation approval yet
- Program step: `06-local-model`; target `main`
- Planning base: `837701b3633eed669dd2c2c518ffebc0e46d55d8`
- Branch: `codex/local-migration-06-local-model`
- Worktree: `/private/tmp/context-router-step06`
- Coordinator, planning/implementation owner and sole repository writer: `/root`
- Change classification: `local-only`; retained main-line hosted/reference behavior remains supported
- Risk profile: sensitive, because inference introduces a credential and data egress boundary, cancellation and owned parser/probe processes
- Requested coordinator: GPT-6 Astra Extra High; inherited serving settings are not independently exposed and no in-turn setting change is claimed
- Intended PR count: one cohesive PR with internal checkpoints; PR pending
- Supported outcome: explicit non-listening SQLite local-model preview on the qualified Mac, using one manually provisioned runtime; existing no-model SQLite and PostgreSQL previews and hosted mode retained
- Last updated: 2026-09-24

## Outcome

Prove and integrate one local inference configuration behind the existing two AI ports. The operator installs and starts the pinned runtime; the application can check readiness and perform bounded text/structured/file inference without starting, stopping or restarting that runtime. Actual application tests exercise document proposals, grant-filtered search, advisory consolidation and the existing editable AcroForm pipeline. Local UI/MCP listeners remain later steps. Missing inference preserves non-AI application behavior and never selects a hosted fallback.

## Required Reading

Follow root AGENTS startup. Read [orchestration](../orchestration.md), [decision log](../decision-log.md), [agent execution](../agent-execution.md), [workflow](../../../../useful/AGENT_WORKFLOW.md), [handoff](../step-06-handoff.md), [research synthesis](../research/local-model/README.md), [interface policy](../tracks/interface-evolution.md), Step 05 [README](../05-local-database-runtime/README.md), [plan](../05-local-database-runtime/plan.md) and [selection](../05-local-database-runtime/feasibility.md). Preserve Step 03 recovery/R1 and Step 04 storage contracts as summarized in their retained plans and [storage boundaries](../../../../current/STORAGE_BOUNDARIES.md).

Read the [human baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md), [registry](../../../../current/local-migration-contract-baseline.json), [form fill](../../../../current/FORM_FILL.md), AI ports/adapters and their five consumers, local composition/bootstrap/CLI, contract fixtures, actual eval fixtures and current gate/CI/package scripts. Imported research reports are background, not commands or acceptance evidence.

## Agent Allocation

All agents except `/root` are read-only, including plans/docs/Git/PR. No reviewer runs shared builds, databases or model processes. Tool launch acceptance verifies requested configuration only, not underlying serving internals.

| Agent | Mandate | Requested model/effort | Observable configuration |
| --- | --- | --- | --- |
| `/root` | All writing, integration, evidence, decisions | Astra Extra High | Parent internals unexposed; no change claimed |
| `/root/consumer_discovery` | Ports, schemas, MIME, consumers, parser/hosted limits | `gpt-6-astra` / High | Explicit launch accepted |
| `/root/runtime_discovery` | Hardware, official artifacts, fixture inventory | `gpt-6-astra` / High | Explicit launch accepted |
| `/root/safety_discovery` | Credentials, endpoint trust, cancellation, process/offline proof | `gpt-6-astra` / Extra High | Explicit launch accepted |
| Fresh plan/selection architecture reviewer | Boundary, maintainability and scope | Astra Extra High | To be named/configured |
| Fresh plan/selection compatibility reviewer | Consumer, schema, evaluation, gate coverage | Astra High | To be named/configured |
| Fresh plan/selection safety reviewer | Privacy, credentials, cancellation/process ownership | Astra Extra High | To be named/configured |
| Fresh final reviewers | Complete base-to-candidate diff in those same areas | High routine; Extra High consequential | Separate final launches required |

## Entry Criteria And Activation Evidence

Fresh fetch confirms `main` and `origin/main` equal the planning base. History is non-shallow; `git fsck --connectivity-only --no-dangling` passes and Step 05 is an ancestor. PR #164 is merged from `91b86b1b412cc8b2b914ffe4f321a7a0cf1f370b`; standard CI 35957573071 and migration gate 35957573023 both succeeded on that head. No branch/worktree was overwritten.

Ten original preparation documents were snapshotted with exact path/content SHA-256 in `/private/tmp/step06-evidence/preparation-manifest.json`, plus their bytes and tracked patch. Original workspace stays untouched. The dedicated branch began clean at the base. Preparation is transferred only after the clean-base full gate succeeds; hashes and original workspace are rechecked then.

Before activation/preparation transfer, the full clean-base gate passed all twelve phases on 2026-09-24. Source/base/HEAD were the planning SHA and `dirty=false`, copied-input digest `e3c9ea478f95229f361a0347c4cd1f150e9b4581bc466636add8eb3a38d4a3a6`, `baseComparison=performed`, caller integrity true, failure null and cleanup errors empty. Summary elapsed 690,573ms (final console 690,942ms). Wrapper verified immutable fixture ownership, stopped it and confirmed automatic removal. The caller remained clean. All ten preparation files then transferred byte-for-byte with original hashes unchanged. Command: `MIGRATION_GATE_BASE_SHA=837701b3633eed669dd2c2c518ffebc0e46d55d8 pnpm migration:gate`. Use Node 24.21.0, pnpm 10.25.0, Python 3.12.8, cloned independent dependencies and a labelled owned tmpfs PostgreSQL 15.15 fixture on a random literal-loopback port. Evidence wrapper, log and summary live in `/private/tmp/step06-evidence/`. Evidence is activation-only, not validation of later planning or implementation. No live model, provider credentials or downloaded images participated.


| Activation phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | passed | 28,455 |
| documentation | passed | 1,445 |
| backend-unit-build | passed | 27,245 |
| backend-database | passed | 215,429 |
| local-orchestrator | passed | 6,198 |
| eval-fixtures | passed | 38,109 |
| eval-deterministic-scenarios | passed | 7,833 |
| web-production-build | passed | 28,911 |
| harbor-static | passed | 2,436 |
| restart-smoke | passed | 66,596 |
| packaged-composition-smoke | passed | 232,137 |
| repository-integrity | passed | 1,837 |

## Current Evidence

The two AI ports return string/Zod-validated data and expose file methods, but no capabilities, readiness, execution controls or metadata. Hosted Vertex implements them; both local previews bind a fixed unavailable adapter. Zod is v4. Actual schemas include any-valued facts, optional/nullable values, default arrays, dynamic literals and preprocess-null-to-undefined. Runtime JSON Schema constraints do not reproduce all Zod semantics.

Five consumers are Vertex test chat, preference extraction (including one additional text call per duplicate group), smart search, schema consolidation and AcroForm fill. Extraction always calls the file method, even for text; JSON/YAML currently remap to text/plain. Its duplicate fallback catches all failures and must not turn cancellation/deadline into success. AcroForm extracts/fills locally and sends metadata and preferences as text. No PDF document-text parser exists; pdf-lib alone is not that capability.

The observed machine is M1 Max, 64 GiB RAM, macOS 15.1.1 arm64. No candidate runtime/weights were found in bounded discovery. Qualification of this exact target and specific asset downloads await user answers; no lower-memory/OS support is inferred. Linux CI is deterministic application evidence, not Mac GPU or native Windows qualification.

## Scope And Non-Goals

Scope: bounded candidate/provenance/evaluation probes; minimal AI-port execution/capability additions and consumer propagation; one local adapter; explicit text/PDF capability; private inference configuration; actual local composition and no-model preservation; deterministic source/package/gate proof; canonical setup and limitations; reviews and one PR.

No embedding, custom native inference helper, provider-selection framework, second production adapter, model downloader/manager, product supervisor, installer/updater, generic chat product, OCR/vision, UI/session/MCP transport, LAN, historical migration or cloud sync. An owned parser child is file-processing isolation, not inference lifecycle ownership. Step 09 owns managed model assets/processes and early native Windows/Linux qualification. Manual support does not promise a permanent external-server product mode.

## Contracts And Compatibility

| Interface | Decision |
| --- | --- |
| Existing AI tokens and results | Preserve both tokens and string/generic result shapes; add application-owned control/status types, no HTTP/native types |
| Identity/storage | Preserve principal/bearer, roots, SQLite schema/fencing/recovery/backup, all held ownership and audit semantics |
| GraphQL/REST/MCP | Preserve routes, SDL, tools, payload/envelope domains and accepted upload MIME list; no public capability endpoint in this step |
| Text file inputs | Strict UTF-8 for plain/Markdown/JSON/all YAML variants, explicit bytes/context bounds, no truncation |
| PDF document analysis | Bounded local text extraction; reject encrypted, malformed, empty/image-only, over-budget or unsupported text resources with fixed errors; no OCR |
| PNG/JPEG | Selected text configuration reports unsupported before inference; hosted upload behavior/list remains; selection record resolves local capability under baseline without silent format removal |
| AcroForm | Existing local metadata/extraction/validator/editable output remains; model action proposals still pass Zod and domain validation |
| Non-AI | Runs with model absent, offline or misconfigured; no initializer requires inference |
| Configuration | Explicit model preview/configuration only, separate protected inference credential; ordinary no-model preview ignores ambient model settings |

Inventory and migrate every port implementation, direct mock, test/eval harness and affected consumer atomically. Preserve web DocumentUpload/FormFill/SearchLab/chat, developer orchestrator, eval clients, operator scripts and unknown external clients by retaining wire contracts. No compatibility-removal window is being opened. Registry evidence must classify new outbound calls and supported mode; changing protected disposition/owner semantics requires exact reviewed migration records, never a fixture refresh to bypass failure.

## Design And Failure Model

### Minimal AI contract

Add shared optional `signal` and absolute monotonic deadline to text/structured request options, retaining retries/operationName. A helper creates one default local workflow budget and propagates the same deadline through file preparation, readiness, admission, inference, retry and every duplicate group. It never refreshes a deadline per call. Caller cancellation/deadline is checked before and after awaited stages and before publishing a successful result. No HTTP types enter these contracts.

Expose a small immutable capability descriptor and async bounded status through the existing ports: supported text/structured/file MIME modes, execution-control guarantees, runtime/model identity labels and configured/available/unsupported states. Metadata is a configured/observed claim, not artifact attestation. No generic provider registry or discovery framework. Local configured adapter and unavailable adapter remain distinct explicit composition choices.

Use fixed typed internal errors: unavailable, unsupported, busy, input/context limit, cancelled, deadline, invalid/truncated response, unsafe configuration. Never retain raw provider cause, prompt/output, key, path or filename in diagnostics. Map to existing wire envelopes. Preserve hosted behavior without new controls; hosted capability reports strict end-to-end deadline/compute cancellation unsupported. Explicit unsupported controls reject before credential/provider I/O; shared consumers automatically create strict budgets only for capable local execution. Do not disguise Promise.race as stopped computation.

### Admission, requests and output

Start with one active inference operation and no waiting queue (zero is the bounded queue budget); concurrent attempts return busy. One structured correction retry maximum, only for invalid JSON/schema, inside the same operation/deadline. No retry on authorization, transport, cancellation, context overflow or server error. A workflow has at most 180 seconds total; each inference at most 120 seconds; readiness at most 5 seconds; parser at most 10 seconds, all clamped to the outer deadline. Selection may reduce budgets but cannot relax them after failed measurements without renewed review.

Candidate context 16,384 tokens, at most 12,000 fully rendered input tokens and 2,048 output tokens, one slot, fixed non-thinking template/sampling profile. Cap prompt plus decoded text at 128 KiB, schema at 32 KiB, response body at 256 KiB and uploaded input at the retained 10 MiB transport limit. Count the actual rendered template/tokenizer input before inference; never accept server truncation/context shift as success. Pin model alias/template/settings and reject mismatched readiness. Native completion/context-limit and finish reasons must be interpreted truthfully; token-limit output is failure even when JSON parses.

Structured calls convert actual Zod v4 input schemas with documented unrepresentable/preprocess handling. Grammar is a generation aid; final Zod parse and application checks are authoritative. No prose-fence repair or partial-output salvage silently makes malformed/truncated local responses successful. Probe every real schema shape before selection, including null preprocessing/defaults and arbitrary JSON facts.

Only non-streaming inference is planned. No conversation/session/resumption headers, slot-save/restore, prompt caching on disk or auto-download paths. Client abort destroys the owned HTTP request/socket. Native cancellation may await completion of one decode/prefill batch; qualification must establish stopped computation and freed serving capacity, not merely client rejection. After an abort, state transitions active → cancel-pending; the caller may receive its fixed cancellation error promptly but admission remains closed. Poll authenticated `/slots` for at most 5 seconds, projecting only fixed numeric/bool task/slot/progress fields with slot debug disabled. Only observed idle restores ready; timeout, wrong auth or ambiguous status latches unavailable until explicit authenticated configuration/idle revalidation. Never kill/restart a user-owned runtime or claim it was unloaded. Source batch-boundary behavior, stopped task progress and a successful same-process follow-up establish capacity reuse; slot idle is not direct GPU telemetry.

### Endpoint, credential and process authority

Use fixed HTTPS on literal `127.0.0.1`, port-only endpoint configuration and fixed paths/headers. A private node:https Agent with empty proxyEnv and exclusive pinned certificate trust avoids ambient/global proxy and system-root routing; redirects are errors and are never followed. Reject hostname aliases, alternate IP notations, credentials/paths/query/fragments and caller header/URL overrides. Validate peer tuple. No hosted/provider imports or fallback in local closure. No browser credential exposure.

Read an independent random inference key from a third private root outside identity/database roots. Require canonical absolute real ancestry, current-UID 0700 parent, bounded 0600 regular no-follow single-link file, descriptor/path identity rechecks, fixed format and no secret in argv/env/logs. Runtime uses its protected API-key-file mechanism plus private TLS key/certificate files with IP SAN 127.0.0.1. Pin the self-signed server certificate exclusively in the adapter, require normal certificate/IP/expiry verification and an exact certificate/SPKI match; never disable verification or fall back to HTTP/system trust. Provisioning remains a manual documented command, not application-managed download/launch. Credential rotation requires explicit operator runtime/configuration action, no process-control authority.

`/health` is public and insufficient. Before user-data requests prove protected route access, rejection with absent/wrong key and expected model metadata; cache no result across unknown endpoint/configuration changes. TLS peer verification must finish before the HTTP credential/body is sent. Test wrong certificate, wrong IP SAN, expired certificate, untrusted CA and plaintext before any credential receipt. The official b11146 macOS recipe enables bundled BoringSSL; CP1 must prove actual artifact behavior. Do not downgrade to HTTP or widen local-adversary exclusions if TLS fails; pause for a reviewed decision. PID/hash/listener checks support provenance but do not replace server authentication.

Probe ownership is narrower than product authority: own only exact spawned handles/process groups and fresh private roots, use bounded graceful shutdown then kill only owned children, await actual exits before deleting roots, preserve uncertain cleanup artifacts with fixed recovery evidence. Never kill by name or trust a stale PID alone. No shared cache, global install, network-adapter, PF/VPN/firewall or device-memory changes.

### PDF handling

The candidate is exact `pdfjs-dist@6.3.289` (Apache-2.0, Node 24 compatible), separate from unchanged pdf-lib AcroForms. Its optional canvas/native closure and source/relocated behavior must be qualified before selection. Use one owned parser process with stripped environment, no credentials/provider/product roots, fixed package entry/asset paths, bounded IPC, 256 MiB JS heap limit and 10-second parent deadline. Heap is not a total native/RSS cap; record actual footprint. Parser death/abort is awaited before capacity is reused.

Supply bytes only, no user URL. Disable worker fetch, WASM, XFA, system fonts/font face and rendering/image paths; no obsolete `isEvalSupported` claim. Node PDF.js fake-worker behavior does not supply isolation by itself. Extract sequential streaming text, at most 50 pages/128 KiB/100,000 text items; reject overflow instead of truncating. Initially deny external/auxiliary resource resolution and qualify/document the resulting text-PDF subset, including embedded-font and non-Latin controls. Fixed errors cover encrypted, invalid, no-text and unsupported cases. Suppress raw parser diagnostics. Approved offline probes include the parser; the child is a responsiveness boundary, not a claimed OS security sandbox.

### Primary-source basis and limits

Pinned [runtime API](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/README.md), [Mac release recipe](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/.github/workflows/release.yml), [server cancellation/slot implementation](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp), [JSON-schema limits](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/grammars/README.md), [4B artifact card](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/blob/e87f176479d0855a907a41277aca2f8ee7a09523/README.md), [9B artifact card](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/blob/3885219b6810b007914f3a7950a8d1b469d598a5/README.md), and [PDF.js v6.3.289](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289) support these candidates, not measured acceptance. Installed Vertex 1.10.0 exposes no per-call AbortSignal; SDK POST timeout starts after token acquisition and does not establish stopped remote computation.

## Checkpoints

### CP1: Bounded feasibility and affected selection review

Independent plan architecture/scope, compatibility/tests and safety approval precedes executable probes. Approval initially authorizes CP1 only. Asset consent and Mac-target answer remain separate required user gates. Build a checked-in bounded probe and deterministic harness tests before live use; behavior-neutral exports of actual private schemas for probing are permitted. No production adapter or composition cutover yet.

Acquire only consented exact assets under `/private/tmp/context-router-step06-assets`, one model loaded at a time. Check published byte counts and SHA-256 before execution, archive entries before extraction, binary version/source, license/provenance, template hash and non-thinking rendering. Do not infer conversion's original checkpoint revision from the current model card. Start with 4B; 9B is a consented challenger only if useful.

Pinned candidates:

| Asset | Exact source/revision | Bytes | Expected SHA-256 |
| --- | --- | --- | --- |
| llama.cpp b11146/v0.5.0 macOS arm64 | ggml-org/llama.cpp `7fe450e19305b828c199d602c23a8337aaa1f03b` | 11,189,714 | `1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711` |
| Qwen3.5-4B-Q4_K_M.gguf | unsloth/Qwen3.5-4B-GGUF `e87f176479d0855a907a41277aca2f8ee7a09523` | 2,740,937,888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| Qwen3.5-9B-Q4_K_M.gguf | unsloth/Qwen3.5-9B-GGUF `3885219b6810b007914f3a7950a8d1b469d598a5` | 5,680,522,464 | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` |

Use repository synthetic Elena/Samir/Maya documents and actual prompts/schemas, plus focused missing cases. Freeze the fixture/expected-answer manifest before live measurement: 16 cases (six extraction, four search, two consolidation, four form actions), three repetitions each candidate. Separate JSON parse, Zod validity, domain acceptance and expected fact/action metrics. No hosted judge/provider. Include absent/null facts, stale conflicts, another person's decoy, malicious instructions, protected definitions, inaccessible/hallucinated slugs and conflicting form choices. Run at least one actual extraction duplicate-consolidation chain and actual editable-PDF fill through the application after CP2.

Predeclared acceptance:

| Dimension | Required evidence |
| --- | --- |
| Structure | All final quality responses parse and satisfy actual Zod; initial failures/retries reported, never excluded |
| Safety/correctness | Zero accepted ownership contamination, unsupported sensitive inference, authorization expansion or prohibited form action; domain checks remain authoritative |
| Utility | At least 90% expected fact/action recall and 95% precision overall, with per-task metrics and all cases reported |
| Latency | Warm one-call p95 at most 60s; no call above 120s; cold ready at most 120s; complete workflow at most 180s |
| Memory | Process footprint at most 12 GiB (4B), 18 GiB (9B), normal system pressure/no OOM; record engine allocations, footprint and swap delta; RSS alone is insufficient |
| Cancellation | Three witnessed prefill and three decode aborts on the supported non-streaming path; client returns within 1s, slot/computation releases within 5s, immediate short follow-up within warm baseline p95 + 5s; no restart/kill workaround |
| Offline/privacy | Per-process network denial on owned runtime/client/parser, explicit allowed-loopback positive control and permission-denied DNS/nonloopback/other-port negative controls, synthetic sentinel/key absent from bounded logs; no change to host network |
| Errors/bounds | Missing runtime/model/key, wrong auth, saturation, context/output overflow, malformed/truncated output and unsupported file are bounded explicit failures; no hosted fallback or silent truncation |
| PDF | Text fixtures, embedded/non-Latin subset, encrypted/malformed/empty/over-limit negatives, actual timeout/abort and subsequent capacity reuse; source and relocated parser closure |

Use a temporary sandbox-exec profile on this Mac only for isolated evidence, after its allow/deny controls and Metal compatibility pass. It is deprecated and is not a product dependency or blanket offline guarantee. If it cannot prove native-runtime denial, record that blocker rather than disabling user networking. Logs stay private and bounded; engine info counters/slot projections and latency witness actual prefill/decode state without recording request bodies. No TRACE/DEBUG, prompt-log or raw HTTP diagnostics.

Selection record binds runtime/artifact hashes, hardware, exact flags/template/settings, test/prompt/schema/application revisions, measurements, failures, cleanup and limitations. Prefer 4B if it passes; adopt 9B only with measured benefit within budgets. Both failures stop selection and require a decision/reviewed revised experiment. Independently approve capabilities, endpoint trust, parser closure, cancellation and chosen budgets before CP2. No retrospective lowering of criteria.

### CP2: Tests-first integration

In small slices, write failing behavior tests then implement and run targeted checks: shared contracts/errors/options; bounded transport and protected config; schema/file parsing; adapter admission/deadline/retry/abort; explicit local composition; application consumer propagation and sanitized failure mappings. New assertions are required by this plan; do not rewrite unchanged contracts to make them pass.

Use `pnpm --filter backend test:unit --runInBand --runTestsByPath <affected specs>`, focused existing consumer suites, backend build and local application contracts after each relevant slice. Add a PostgreSQL-independent deterministic local-model test project only if useful for real server/child fixtures; do not create a package/framework merely for tests. All mock/harness updates remain in this PR.

The existing `local-identity preview` stays no-model. Add explicit `preview-model` selection using the same local roots/application and one validated model configuration; application startup does not own runtime startup or require model availability. The exact additive CLI/readiness shape is finalized at selection. Actual Nest tests call the real consumers with SQLite and deterministic authenticated loopback inference, plus no-model unavailable and non-AI success. Hosted/reference tests and public fixtures remain.

### CP3: Acceptance, fresh reviews and PR

Preserve the current strict no-model/provider-denial proof. Add separate narrow authenticated model-loopback source and sealed relocated-package evidence, with exact owned fake-server/parser/preview lifecycle census and two clean generations. Do not globally relax existing preloads or require weights/Metal/internet in CI. Run final live application fixtures separately against the selected runtime; bind evidence to exact tested code/configuration/prompts/schemas, then freeze candidate.

Update canonical manual setup/capabilities/privacy/error/limits docs and registry. Resolve images and live Harbor research in the selection record: no image support or live remote comparison is inferred merely from engine features. Assign managed lifecycle, native Windows/Linux qualification and lower hardware targets to Step 09; MCP/UI capability discovery to Steps 07/08. They remain inactive.

Create one migration-template PR, initially draft if necessary to establish its number before final freeze. Fresh independent reviewers inspect the full base-to-candidate diff for architecture/maintainability/scope, compatibility/capabilities/evaluation/tests, and privacy/credentials/cancellation/process behavior. Fix blockers; record impact and rerun affected review/tests, carry forward only explicitly unaffected dimensions. No automatic merge.

## Validation Matrix

| Surface | Required command/evidence |
| --- | --- |
| Clean-base activation and final aggregate | Exact-base `pnpm migration:gate`; all phases, toolchain, source/base/digest, performed comparison, caller integrity, timings, cleanup |
| Targeted backend changes | Focused unit/consumer/local real-composition tests, tests first, backend build/schema check |
| Parser/adapter/process | Deterministic authenticated server, credentials/config negatives, body/context/retry/admission bounds, actual owned-child abort/reap, no-model preservation |
| Retained contracts | Integration/e2e, immutable wire/catalog fixtures, storage/identity/recovery and web production build through full gate |
| Source/package | Actual compiled preview and parser, no global/source fallback, restart/cleanup/lifecycle proof, retained supported modes |
| Live model | Frozen synthetic task corpus and actual app workflows, exact Mac/artifacts/settings, cancellation/capacity/offline/privacy/latency/memory, separate from CI |
| Hygiene | `git diff --check`, cached diff check, `node scripts/check-markdown-links.mjs` |
| Final pushed head | Applicable standard CI and dedicated migration workflow; distinguish actual workflow checkout SHA from PR head |

## Independent Review And Evidence

No approvals yet. Record revision plus named review dimensions and dispositions here. CP1 approval is not candidate selection; selection approval is not implementation completion. Fresh full-diff final review and final local/remote gates remain required even after targeted checks pass.

## Parallel Work And Conflict Surfaces

Only read-only discovery/review runs in parallel. `/root` owns all composition, schemas, ports, mocks, package/lockfile, CI/gate/registry, docs, staging and PR operations. Validation can overlap fresh reviews only on a frozen snapshot with isolated model processes, ports, dependencies, database files and roots. No other migration step is activated.

## Privacy, Rollback And Recovery

The new trust boundary is operator-provisioned inference on this machine. Secrets stay independent of human/MCP identity. Raw uploads/prompts/results are not persisted by application code; engine/parser caches/logs and external process retention are explicitly qualified, not assumed. All supported local calls remain on-device without automatic provider failover. Same-UID/root/kernel compromise is outside existing credential protections; pinned TLS protects the configured peer from an unrelated local port occupant, while file provenance remains an operator/qualification responsibility.

Rollback selects the unchanged no-model preview or restores compatible prior code, preserving identity/database/model assets. No data/schema migration or credential replacement occurs. Operator controls their manual runtime. Failed disposable-probe cleanup preserves roots and exact ownership evidence; never take over or terminate an unowned daemon. Parser cancellation awaits owned-child exit. No model error triggers SQLite/identity recovery/reset.

## Risks And Decision Gates

Required user answers: exact asset consent and qualified Mac target. CP1 selection must prove pinned TLS/server authentication, real schema/template behavior, parser/package closure, model task quality and cancellation/capacity. Failure in any required dimension blocks production selection. Material deviations require affected renewed plan review; continue automatically between approved checkpoints. One PR remains the default.

## Exit Criteria And Closeout

Only report Step 06 complete when selected configuration and actual app behavior are demonstrated, required reviews and full final local/remote gates pass, canonical docs and limitations are current, and the single PR is ready for human review. Report branch/base/PR, supported exact Mac/runtime/model/settings, review verdicts, source-bound validation and next human action. Leave merge to the human; later-step activation is separate.
