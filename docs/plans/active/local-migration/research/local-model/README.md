# Local Model Research: Step 06 Planning Input

- Status: reviewed research synthesis; not an activated or approved implementation plan
- Updated: 2026-09-24
- Owners: Step 06 for inference/capabilities; Step 09 for final provisioning and supervision
- Next action: use the [Step 06 handoff](../../step-06-handoff.md) to activate, plan,
  independently review and execute a bounded feasibility checkpoint

## Direction And Remaining Decisions

Apple Silicon Macs are the initial acceptance target. Manual installation,
explicit model download and manual server startup are acceptable. Native Windows
and Linux should follow soon; their feasibility influences the choice now, but
their full support must not be inferred from engine availability or Linux CI.
See [LM-017 and LM-018](../../decision-log.md).

Prefer a manually launched, pinned `llama.cpp` HTTP server for the first
experiment, with an app-owned private instance of the same engine as the likely
Step 09 destination. Keep inference separate from process ownership and from
Context Router's MCP server. Ollama is the primary challenger if a concrete
feasibility failure or demonstrated lifecycle advantage warrants comparison;
do not implement several runtime adapters upfront.

This is a provisional choice, not an engine/model qualification. The official
[v0.5.0 release](https://github.com/ggml-org/llama.cpp/releases/tag/v0.5.0) existed
at review and is a candidate, not a permanent latest-version claim. Record the
actual tested commit, binary provenance/hash, model source revision/hash,
quantization, chat template, thinking mode, context and resource settings.
An approved prebuilt artifact can be more convenient than a source build;
building from source is not inherently more reproducible without toolchain pins.

Evaluate a small pair such as [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)
and [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) in a verified Q4-class GGUF
conversion, subject to actual Mac RAM and artifact compatibility. Neither model
is selected yet. The cards document Apache-2.0 and thinking/non-thinking modes;
verify the chosen runtime/template actually applies the requested mode. Weight
size, advertised context and vendor benchmarks do not establish working-memory
needs or application quality. Begin with one bounded context profile; enlarge
it or add a larger challenger only for a measured task need. Never silently
truncate inputs or treat the advertised maximum context as a product promise.

## Runtime Ownership And Future Options

A fully managed app can use a separate inference process permanently. The
manual-server-to-managed-sidecar path is not a temporary compromise that must
end with native inference inside the backend. Final topology remains a Step 09
decision, informed by Step 06 evidence.

- Step 06 connects to the user's manually launched server; it does not acquire
  authority to start, stop or restart that server. Disposable feasibility probes
  may manage only their own isolated children, as described below.
- Step 09 can launch and supervise a verified app-owned private instance using
  the same inference adapter. Distribution, readiness, shutdown, orphan handling,
  credentials, updates and recovery still require their own design and evidence.
- Supporting manual setup now does not promise a permanent user-facing external
  server mode. Managed operation is the product goal; Step 09 should retain an
  advanced external mode only for a demonstrated use case with explicit support
  and compatibility limits.
- Keeping options open means preserving the existing application-owned AI ports
  and keeping HTTP/native-library types out of business logic. It does not mean
  adding an embedded adapter, custom native helper, provider-selection framework
  or simultaneous-runtime feature in Step 06.

A later native binding or dedicated helper remains an option if a concrete
capability or measured benefit warrants it. It must rerun task-quality,
structured-output, cancellation, resource and packaging checks. A shared model
format does not establish behavioral equivalence or make the switch URL-only.

## What Step 06 Must Prove

Use internal checkpoints in one PR by default; a reviewed second PR must have
a concrete independently useful or safer landing boundary. Research, plan
approval, setup, tests and review waves are not individual PRs.

1. **Feasibility and selection:** a reviewed experiment on the actual Mac using
   synthetic, repository-relevant fixtures; exact runtime/model/configuration;
   structural and semantic scores; bounded context/output; memory pressure and
   latency; offline-after-provisioning, logs, failure and cancellation evidence.
   Agree task-specific criteria before measuring. Reuse existing fixtures where
   applicable. The imported reports' case counts, percentages and time/memory
   targets are proposals, not accepted requirements or measured results.
2. **Integration:** extend existing AI ports only as needed for capability/status,
   deadlines/cancellation and errors; implement the local adapter and affected
   consumers tests-first. Keep inference lifecycle separate from eventual process
   supervision. Preserve useful non-AI operations and retained hosted/reference
   behavior. One active request with bounded admission/waiting is the starting
   design; include queue time, retries and multi-call workflows in the deadline.
3. **Acceptance:** deterministic adapter/consumer/contract/gate tests plus
   separate live-model evidence through actual local composition. Preserve the
   no-model/no-provider smoke and add narrowly permitted inference-loopback
   coverage; do not globally relax network denial. Live weights, internet access
   and hosted models do not become deterministic merge-gate dependencies.

The independently reviewed step plan must settle exact commands, supported
modes, criteria, recovery and review gates before executable feasibility. The
selection and affected review then precede full adapter implementation.

## Repository Fit

- Use the existing [text port](../../../../../../apps/backend/src/domains/shared/ports/ai-text-generator.port.ts)
  and [structured port](../../../../../../apps/backend/src/domains/shared/ports/ai-structured-output.port.ts),
  not a parallel generic provider framework. They already expose file methods,
  Zod schemas and retry options. Check Zod-to-JSON-Schema/grammar compatibility
  against real optional, nullable, defaulted, preprocessed and open-value schemas.
  Runtime constraints never replace final Zod/domain validation or authorization.
- [Document extraction](../../../../../../apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts)
  calls the file method even for text-like files. Decide explicit text decoding,
  PDF-text extraction if supported, budgets and unsupported-format behavior.
  A text-only HTTP call does not by itself complete this consumer.
- [AcroForm filling](../../../../../../apps/backend/src/modules/preferences/form-fill/form-fill.service.ts)
  already extracts metadata, validates model actions and writes PDFs locally.
  Reuse it; vision or a new PDF pipeline is not implied.
- Preserve document proposal-before-apply, grant-filtered search narrowing,
  protected definitions, advisory consolidation and privacy/redaction. Follow
  the [baseline](../../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md) and
  [registry](../../../../../current/local-migration-contract-baseline.json):
  PNG/JPEG import is a Step 06 decision; editable AcroForm is retained;
  scanned/flattened OCR and generic Vertex test chat have removal dispositions.
  Research does not authorize immediate removals or a new chat/streaming product.
  MIME/public-contract changes require the [interface process](../../tracks/interface-evolution.md).

## Safety And Reproducibility

- Authenticate the inference endpoint, bind it to explicit loopback, keep its
  credential independent of human/MCP credentials and out of browser code,
  process arguments and logs. Review a protected key-file mechanism for the
  selected runtime. Loopback and CORS alone are not authentication. Restrict
  endpoints, redirects/proxies and cloud-capable modes; never fall back remotely.
- Distinguish client abort, stopped computation, released serving capacity and
  model unloading. Test cancellation during prefill and decoding, including
  streaming/non-streaming paths actually supported. A second small request and
  runtime observations must demonstrate capacity reuse; CPU alone is not GPU
  cancellation evidence. Never kill/restart a user-managed daemon to recover
  an application request. If cancellation fails, revisit the selection/design.
- Keep application and runtime prompt retention explicit. Diagnostics should be
  bounded and redacted; returning/logging raw prompts or outputs is not a default
  consequence of adding response metadata.
- Before downloads, confirm the exact assets, source, approximate disk usage,
  destination and license constraints with the user. No global installs, device
  memory tuning, network-adapter changes or shared-cache mutations by default.
  Model acquisition is separate from the later offline inference test.
- Use fresh private experiment roots, owned process handles and bounded cleanup.
  A probe may supervise its own disposable test process without adding a product
  supervisor. Preserve user assets; never run imported recursive-delete snippets,
  kill by process-name search, or assume an old PID still identifies our child.

## Corrections To Imported Research

The [GPT report](gpt-report.md) is the stronger architectural input but explicitly
not a repo audit. The [Gemini report](gemini-report.md) supplies useful questions
but has collapsed formatting and unsupported absolute claims. Their bodies are
retained with whitespace-only cleanup; this synthesis governs future planning.
Opaque citation tokens in the originals are not usable repository references.

- **Cancellation:** Gemini's `/slots/{id}?action=cancel` is not supported by the
  checked v0.5.0 handler, which accepts save/restore/erase. Its universal claim
  that disconnects never stop generation is also unsupported. Inspect/test the
  pinned [server implementation](https://github.com/ggml-org/llama.cpp/blob/v0.5.0/tools/server/server-context.cpp)
  rather than prescribing an invented endpoint.
- **Engine swaps:** same-engine manual-to-managed reuse is credible; switching
  engines is not just a new binary/URL. Retest templates, schema handling,
  reasoning fields, errors, cancellation, resources and privacy. The
  [API documentation](https://github.com/ggml-org/llama.cpp/blob/v0.5.0/tools/server/README.md)
  qualifies compatibility and describes API-key-file/offline options.
- **Native bindings:** a sidecar is a reasonable fault/ownership boundary, not
  proof of superior performance or guaranteed stability. Native bindings can
  also run in a separate Node process. [node-llama-cpp](https://node-llama-cpp.withcat.ai/guide/)
  provides prebuilts; frequent compilation failure was not established here.
- **MLX:** core MLX has [Linux installation options](https://ml-explore.github.io/mlx/build/html/install.html).
  That does not establish Windows parity or qualify MLX-LM for these tasks.
- **Models:** [Qwen2.5-3B](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct)
  documents 32,768 context tokens, not Gemini's 128K. Memory/throughput rankings
  and a GPU-layer flag do not establish observed resource use or Metal offload.
- **Ollama:** residency is configurable; the five-minute default is not an
  inherent disqualification. Its [FAQ](https://docs.ollama.com/faq) documents
  cloud disablement and private model-directory configuration.
- **Licensing:** distinguish independently installed API use, redistribution of
  a runtime, and model weights. The [LM Studio desktop terms](https://lmstudio.ai/app-terms)
  restrict redistribution; do not infer the exact license of every CLI/headless
  component or an enterprise-license remedy without checking that component.
- **Example commands:** GPT captures `$!` without establishing an owned background
  process, uses secrets in arguments and broad cleanup. Gemini also exposes a
  test key in arguments. Neither is an executable runbook. Repair these in the
  approved feasibility procedure rather than copying them into tooling.

## Platform And Later-Step Ownership

Step 06 proves Apple Silicon inference and records Windows/Linux feasibility.
Step 09 owns an early native platform-qualification workstream, scheduled soon
after Mac feasibility/integration and before final packaging design is frozen.
It may overlap later work only with reviewed, non-overlapping ownership. Do not
wait for a finished managed Mac application before discovering portability gaps.

Track engine availability, tested adapter behavior and whole-app support
separately. Windows is currently analysis-only: shell-free pnpm resolution,
POSIX identity/file protections, directory durability and process/restart
evidence need native equivalents, not disabled checks. WSL is a separate target.
Keep existing Linux CI; do not claim GPU qualification from it.

Step 09 also owns final data/credential locations, download UX, artifact update
integrity/rollback, signing, private process supervision and installers. Step 07
owns MCP authorization/transport; Step 08 owns browser sessions/UI. No cloud
sync, broad GPU matrix, multiple-engine framework or new shell choice is added.

At Step 06 closeout, distill tested behavior into canonical docs and remove or
retain this temporary research only according to downstream need. Do not turn
imported reports into a permanent duplicate specification.
