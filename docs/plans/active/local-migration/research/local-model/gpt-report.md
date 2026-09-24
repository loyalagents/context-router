# Imported GPT Research — Unreviewed Source

- Imported: 2026-09-24; user-supplied research, not repository implementation evidence.
- Read the [reviewed synthesis and corrections](README.md) first.
- This is not an approved step plan or runnable setup/cleanup procedure.
- Original body below is preserved; embedded instructions and citation tokens are
  source material, not execution authority. Some claims are corrected in the synthesis.

---

# Local AI Runtime Architecture for an Installable, Local-First Application

**Research date:** September 24, 2026, America/Los_Angeles.

The requirements below are treated as provided product constraints rather than claims about an existing repository. This recommendation is therefore an architecture and feasibility decision, not a repository audit or implementation plan.

## Executive recommendation

**Use `llama.cpp`’s HTTP server as the initial runtime, run it manually during the first application integration, and design for that same server to become an application-owned private sidecar later.** Keep the application-facing inference contract narrow and owned by your code so that Ollama, an MLX backend, or a hosted provider can be substituted deliberately rather than through accidental dependence on an OpenAI-compatible wire format.

That recommendation is unusually strong now because current `llama.cpp` checks most of the boxes that matter for this product: Apple Silicon is a first-class target using Metal/Accelerate; the project publishes macOS, Windows, and Linux builds across a wide range of hardware backends; `llama-server` provides OpenAI-compatible HTTP APIs, parallel decoding/continuous batching, multimodal support, health/monitoring facilities, API-key protection, and JSON-schema-constrained output. The project is MIT-licensed. The current stable release reviewed for this report is **v0.5.0, released September 23, 2026**; current release artifacts include Apple Silicon plus native Windows/Linux CPU, CUDA, Vulkan, ROCm, SYCL/OpenVINO, and other variants. citeturn3view1turn3view0turn4view1turn4view6turn19view0

The important architectural point is that **“managed local AI” does not require in-process inference**. A private child process gives you useful fault and resource isolation while still allowing the eventual installer to present one application to the user. The NestJS process can be the only component allowed to know the inference endpoint and credential; the UI and MCP clients continue talking to your application, not to `llama-server` directly. This also preserves the separation in your requirements between your MCP server and the internal inference server.

The three decisions should remain explicitly separate:

| Decision | Recommendation now | Likely managed end-state |
|---|---|---|
| **Inference runtime** | Manually launched `llama-server` v0.5.0 | App-owned, version-pinned `llama-server` child process |
| **Model** | Evaluate Qwen3.5-4B and Qwen3.5-9B in Q4-class GGUF; add gpt-oss-20b on 32 GB as a quality challenger | One approved default model plus perhaps one larger tier; model selection remains independent of runtime |
| **Ownership** | Developer/user manually installs runtime and downloads model | Application owns a private runtime binary, private model directory, process lifecycle, integrity checks, updates, and recovery |

This arrangement minimizes rework. The prompts, schemas, application validators, semantic evaluation corpus, model manifest, availability behavior, and almost all request orchestration can remain unchanged when manual startup becomes managed startup. What gets added later is the part you explicitly do **not** need to build prematurely: executable acquisition, model download UI, hashes, private storage, process supervision, update/rollback, cleanup, disk-space handling, and platform packaging.

### Why not begin with Ollama

Ollama is the strongest alternative. It has arguably the best manual developer experience of the serious candidates: model pull/run commands, a REST API, native macOS/Linux/Windows distribution, configurable model storage, and JSON-schema structured outputs. Its runtime is MIT-licensed. Ollama also documents that its local runs do not send prompts to Ollama, and current versions expose cloud functionality that can be explicitly disabled with `OLLAMA_NO_CLOUD=1` or `disable_ollama_cloud`; the default service binds to `127.0.0.1:11434`. citeturn18search5turn18search8turn1search3turn3view2turn3view3turn22search3

The problem is not that Ollama is unsuitable. The problem is **ownership ambiguity**. Starting with a user's ordinary Ollama instance encourages dependence on their global service, model cache, update cadence, and port. Later taking ownership means either learning to run a fully isolated second Ollama instance or changing engines. Ollama's FAQ does let you relocate model storage and change server configuration, so an app-private Ollama instance is plausible, but it should be deliberately proven rather than assumed. Its current product also includes optional cloud capabilities, which means your managed configuration must explicitly disable them to satisfy “no silent hosted fallback.” citeturn3view2turn3view3

Ollama's new MLX-backed Apple Silicon path is particularly interesting, but Ollama described that integration as a **preview** in March 2026. Its published performance comparison was for Qwen3.5-35B-A3B under particular quantizations and memory conditions, not evidence about your 4B/9B structured workloads. It should therefore be treated as a challenger rather than a foundation for the initial architecture. citeturn3view4

### Strongest counterargument to the recommendation

The best argument **against** `llama.cpp` is that you may end up rebuilding parts of a runtime manager that Ollama already provides: model acquisition, model identity, storage, lifecycle ergonomics, and cross-platform installation. If, in a direct feasibility comparison, an **isolated private Ollama instance** proves that it can use its own port and cache, reliably start and stop under your parent process, remain fully offline with cloud disabled, provide satisfactory cancellation and structured-output semantics, and avoid interfering with a user's ordinary Ollama installation, then Ollama could reduce product engineering substantially. Ollama's MIT license also removes the redistribution problem that affects LM Studio. citeturn22search3turn3view2

I would change the recommendation to Ollama if those tests showed a meaningful lifecycle advantage **and** `llama.cpp` offered no compensating advantage in semantic quality, resource use, startup, cancellation, or packaging. Conversely, an API that merely looks OpenAI-compatible is not enough evidence: structured-output behavior, chat-template handling, reasoning fields, cancellation, finish reasons, context accounting, and model lifecycle differ between engines.

### What is deliberately *not* in the initial scope

Do not make the first Mac release depend on a desktop-shell decision, automatic runtime updates, MLX-specific optimization, vision, OCR, multiple engines, speculative decoding, dynamic quantization selection, cloud inference, cloud sync, or broad support for every Windows/Linux GPU.

Do make the first slice establish the application-owned inference boundary, failure behavior, schema validation, a repeatable evaluation corpus, and a manual local runtime whose eventual managed form is credible.

## Runtime comparison

The serious shortlist should be `llama.cpp`, Ollama, LM Studio/llmster, MLX-LM, and native `node-llama-cpp`. There is little benefit in adding more runtimes before one of these fails a concrete requirement.

| Candidate | Initial integration | Apple Silicon | Windows / Linux | Structured output | Managed-product fit | Main concern | Verdict |
|---|---|---|---|---|---|---|---|
| **llama.cpp server** | Small HTTP adapter; manual binary/model | First-class Metal/Accelerate | Very broad native backend/build matrix | JSON Schema → grammar; OpenAI-compatible `response_format` | Excellent: redistributable MIT sidecar, private dirs/process | You own download/supervision/update UX | **Recommended baseline and likely end-state** |
| **Ollama** | Easiest manual setup; REST API and model pull | Native; MLX path currently preview | Native macOS/Windows/Linux | JSON-schema structured output | Good if a truly private instance is proven | Global service/cache conflicts; cloud surface must be explicitly disabled | **Primary challenger** |
| **LM Studio / llmster** | Excellent; REST API, TS SDK, headless daemon, model management | llama.cpp + MLX | macOS/Windows/Linux | JSON Schema; llama.cpp grammar or MLX/Outlines | Technically strong, legally awkward for bundling | Standard LM Studio terms restrict redistribution | **Dev/evaluation tool, not default embedded runtime** |
| **MLX-LM server** | Python sidecar; straightforward on Mac | Excellent architecture fit | MLX-LM is fundamentally Apple-oriented even though MLX core now has Linux work | No comparable schema-constrained server capability identified in reviewed MLX-LM docs | Useful optional Mac-specific engine | Adds Python/platform divergence and constraint-decoding work | **Optional future Apple backend** |
| **node-llama-cpp** | Very natural for Node/Nest; no HTTP process | Metal, automatic hardware adaptation | Prebuilt/native CUDA/Vulkan paths | Generation-level JSON-schema grammar; documented schema subset | Possible, especially with Electron | Native addon/package lifecycle and fault coupling | **Credible alternative, not preferred initially** |

`llama-server` currently advertises OpenAI-compatible chat/responses/embeddings APIs, multi-user parallel decoding, continuous batching, monitoring, schema-constrained JSON, function calling, speculative decoding, and multimodal support. Its server defaults to loopback, supports an API key or API-key file, exposes readiness through `/health`, has configurable context size, and can run multiple decoding slots. It also has model load/unload and a sleep mode capable of unloading model/KV memory. citeturn3view0turn4view0turn4view1turn4view2turn4view3turn4view5

The structured-output guarantee is narrower than it can appear. `llama-server` turns a JSON Schema into grammar-constrained sampling; that is powerful for ensuring syntax and allowed representations, but it does **not** prove that an extracted preference is supported by the source, that a category is relevant, or that an enum choice is semantically appropriate. Those decisions still require application validation and task-specific measurement. citeturn4view6

Ollama similarly supports structured output from a supplied JSON schema, but the same distinction applies: constrained serialization is not semantic correctness. Its current FAQ documents a loopback default, configurable model storage, local/cloud privacy behavior, and explicit cloud disablement. It also allows localhost-related browser origins by default, which is another reason not to expose the Ollama port directly to your renderer or browser UI. citeturn1search3turn3view2

LM Studio has evolved into a serious headless runtime rather than only a desktop experiment tool. Its `llmster` daemon can run independently of the graphical application; LM Studio offers REST endpoints and TypeScript/Python SDKs for model download/load/unload and inference, supports macOS/Windows/Linux, runs llama.cpp on all three platforms, and uses MLX on Apple Silicon. API authentication exists, although LM Studio documents it as disabled by default. citeturn7view0turn7view1turn7view2turn8view0

LM Studio's structured-output implementation is useful evidence about an important limitation: it says GGUF models use llama.cpp grammar sampling, MLX models use Outlines, and warns that some smaller models—particularly models under 7B—may still perform badly even when the output is structurally valid. Its JIT loading supports an idle TTL and automatic eviction. citeturn8view1turn8view2

The product-distribution issue is more decisive. LM Studio's Desktop App Terms dated August 23, 2026 grant a non-transferable license for personal/internal business use and restrict distributing, sublicensing, or transferring the software; integration is limited to published interfaces absent another agreement. That does not prevent a developer from using an independently installed LM Studio/llmster through its supported API, but it makes it a poor choice for an app you plan to redistribute as one managed product without a separate commercial arrangement. Model licenses remain separate. citeturn11view0

MLX-LM is maintained by Apple's MLX project and is specifically aimed at running/fine-tuning LLMs on Apple Silicon. It supports quantized models, streaming, prompt caching, and bounded KV-cache configuration; its documentation explicitly warns that models large relative to machine memory can perform poorly. MLX itself uses Apple's unified-memory model and now also has Linux package work, but that should not be conflated with MLX-LM being a mature, interchangeable Windows/Linux serving strategy. citeturn13view0turn13view1

`node-llama-cpp` deserves serious consideration because your application is already Node-based. It provides prebuilt native binaries, runs in Node/Bun/Electron, automatically uses Metal/CUDA/Vulkan paths, and can enforce JSON Schema at generation time. Its own documentation explicitly says its schema support covers a subset of JSON Schema. Current releases are in the v3.21.x line. citeturn21search3turn21search7turn20view2

The reason I still prefer the sidecar is operational rather than performance-related. A native addon ties inference allocation and native-library failures to your Node process and makes desktop packaging sensitive to native module architecture and ABI details; the project's Electron documentation, for example, has special packaging instructions to keep the module external rather than bundling it into application JavaScript. A sidecar preserves a much cleaner crash/restart and resource boundary. citeturn21search39

### Cancellation, timeouts, and resource release

This deserves explicit treatment because it is easy to get wrong.

`llama-server` documents HTTP read/write timeouts, parallel slots, and request-serving features, but in the reviewed documentation I did **not** find a sufficiently explicit contract saying, “when an HTTP client disconnects, active generation is guaranteed to stop immediately and its slot/KV resources are released within X.” A network timeout is therefore not the same thing as an inference timeout. citeturn4view1turn4view3

Your abstraction should distinguish:

```text
client stopped waiting
        ≠
server stopped decoding
        ≠
slot/KV memory released
        ≠
model unloaded from memory
```

Treat compute cancellation as a measured engine property. The Apple feasibility test below intentionally aborts a long request and then probes whether a one-slot server can immediately serve another request. If a disconnected request keeps consuming a slot or significant compute, you need either an engine-specific cancellation mechanism, an application queue that avoids uncontrolled overlaps, or—only when the inference process is private and effectively single-tenant—a hard timeout that restarts the sidecar.

For the first release, **serialize AI work through an application-owned queue and run one inference slot**. That makes memory, cancellation, recovery, and UI/MCP contention considerably easier to reason about. `llama-server` supports greater parallelism and continuous batching, so concurrency can be enabled later after measurement rather than baked into the architecture now. citeturn4view3

### Privacy and local-endpoint security

The managed server should bind only to loopback and require a random per-install/session credential. `llama-server` defaults to `127.0.0.1`, supports `--api-key` and `--api-key-file`, and its documentation includes CORS guidance. Current v0.5.0 also added support for multiple bind addresses including Unix sockets, which could eventually provide an attractive permission-controlled local transport on macOS/Linux. citeturn4view0turn4view1turn19view0

**Loopback is locality, not authentication.** Another process running as the user can attempt to connect to a local TCP service, and a browser renderer is not an appropriate place to keep the inference credential. Therefore the topology should be:

```text
MCP client ───────┐
                  │
UI ───────────────┼──> Your NestJS/application service
                  │          │
Local app logic ──┘          │
                             │ private authenticated local call
                             ▼
                       llama-server
                             │
                             ▼
                       local GGUF file
```

Keep the random inference credential in the backend process or a narrowly permissioned credential file, never in browser JavaScript. Do not listen on `0.0.0.0`. CORS is defense-in-depth for browsers, not your process authentication boundary.

For `llama.cpp`, I found no documented hosted-inference fallback analogous to Ollama's cloud features. That absence should not be promoted into an unverifiable “zero network activity” promise: use a local `--model` path rather than `-hf` after provisioning, disable the network during the test, and inspect outbound sockets. For Ollama, by contrast, cloud functionality is explicitly documented and explicitly disableable. LM Studio documents that core local inference works offline after required models/runtimes are present, while model search/download/runtime updates and some application update behavior use the network. citeturn3view2turn9view0

This produces the right product language: **offline operation after setup**, not “can be installed on an air-gapped machine with no prior assets.” Completely offline installation would require bundling or separately side-loading the runtime and model files and is a different product requirement.

## Manual setup to managed operation

The most important way to avoid rework is to make **your application contract smaller than any runtime API**.

An appropriate conceptual split is:

```ts
interface InferenceProvider {
  readiness(): Promise<InferenceStatus>;

  generateText(
    request: TextGenerationRequest,
    signal: AbortSignal,
  ): Promise<TextGenerationResult>;

  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    signal: AbortSignal,
  ): Promise<StructuredGenerationResult<T>>;
}

// Added when the product owns the process.
// It is intentionally separate from "inference".
interface InferenceRuntimeController {
  ensureReady(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<RuntimeStatus>;
}
```

The exact TypeScript is unimportant. The separation is not.

`generateStructured` should return enough metadata to distinguish raw model response, parsed value, model/runtime identity, finish reason, and validation failure. Application code should then run its own schema/domain validator and authorization checks. The model never directly mutates preferences, category definitions, PDFs, or other durable application state.

The application-owned model manifest should be distinct again:

```text
logical model id
upstream model/version
format
quantization
source artifact
expected SHA-256
file size
license + notice material
approved runtime versions
default context cap
modality: text / vision
```

That prevents “Qwen3.5-9B” from silently meaning different bits after an update.

### What survives manual → managed with the same engine

| Work done now | Reusable later? | Why |
|---|---:|---|
| Application `InferenceProvider` contract | **Yes** | Process ownership is below it |
| Prompts and response schemas | **Yes, subject to model-version retest** | Same application semantics |
| Domain validators and authorization | **Yes** | Must remain independent of the model |
| AI-unavailable application states | **Yes** | Managed runtimes will still fail sometimes |
| Gold evaluation corpus | **Yes; essential** | Becomes regression suite |
| `llama-server` HTTP adapter | **Mostly yes** | Same API when process becomes private |
| Approved GGUF files/model manifests | **Yes** | Same artifacts can be moved into app-owned storage |
| Manual shell commands | **No** | Replaced by supervisor/asset manager |
| Developer-selected port/token | **No** | App chooses and protects these |
| User-managed upgrades | **No** | Replaced by pinned release/update policy |

The managed version adds process supervision but does not need a new inference architecture. Start the child, wait for readiness, route requests, shut down gracefully, escalate to force-kill if necessary, and expose “AI unavailable” instead of making the whole application unavailable. `llama-server` supplies an explicit readiness endpoint, and current releases provide model/router lifecycle functionality that can support more sophisticated management later. citeturn4view1turn4view3

Use an **application-private runtime and model tree** rather than reusing global caches:

```text
<ApplicationData>/
  ai/
    runtimes/
      llama.cpp/
        0.5.0/
          <platform-arch>/
    models/
      qwen3.5-9b-q4km/
        <sha256>.gguf
        manifest.json
    run/
      api-key
      process-state
    logs/
```

Do not search for and kill an existing `llama-server`, Ollama, or LM Studio process. Do not write into `~/.ollama/models`, LM Studio's model cache, or a general Hugging Face cache in managed mode. Ollama explicitly documents its normal global model locations and an `OLLAMA_MODELS` override; those are useful for a developer-controlled Ollama experiment but also illustrate why a product-owned directory matters. citeturn3view2

### What changes if the engine changes

An engine switch is **not** merely changing `baseURL`.

The following must be revalidated or replaced:

| Concern | `llama.cpp` → Ollama example |
|---|---|
| Model artifact | Direct GGUF may become an Ollama manifest/blob arrangement |
| Model identity | Filename/hash versus Ollama model/tag/digest |
| Structured output | Both accept schemas, but grammar/template semantics differ |
| Chat template | Engine/model-template selection can differ |
| Streaming | Event framing and usage/finish metadata differ |
| Reasoning models | Thinking/reasoning fields and template control can differ |
| Context controls | Different configuration surfaces/defaults |
| Cancellation | Must be retested |
| Model residency | `llama.cpp` process/model versus Ollama keep-alive/cache semantics |
| Lifecycle | Your child binary versus Ollama daemon/service |
| Security | Different local endpoint and authentication/origin behavior |
| Logging/privacy | Re-audit |
| Model download/update | Entire ownership path changes |

Prompts, application schemas, validators, your gold test corpus, authorization rules, and the high-level `InferenceProvider` interface remain valuable—but **all behavior tests run again**.

### Work that remains regardless of engine

Eventually every “one managed application” design must solve consent and download progress, interrupted/resumable downloads, free-disk checks, artifact hashes, license notices, private storage, version manifests, process startup/shutdown, crash recovery, log retention/redaction, health/readiness, missing or damaged models, runtime/model update compatibility, rollback, orphan cleanup, OS credential storage, permissions, package signing, and support diagnostics.

That is a reason to postpone this work until the inference choice is validated, not a reason to choose a runtime that hides the issues during development.

### Runtime and weight licenses are separate

`llama.cpp` and Ollama are MIT-licensed projects; MLX-LM is also MIT-licensed. Those runtime permissions do not grant any rights to arbitrary weights you load into them. citeturn3view1turn22search3turn13view0

The recommended Qwen3.5 and gpt-oss candidates below are Apache-2.0 according to their model cards. That is attractive for commercial redistribution compared with more restrictive model-specific terms, but you should still preserve the applicable copyright/license notices, document the exact downloaded artifact, and have counsel review the final distribution path before shipping weights. citeturn16view0turn20view3turn21search26

LM Studio is a different case because its **runtime application's own standard terms**, rather than the models, create the redistribution constraint discussed earlier. citeturn11view0

## Platform sequencing and portability

The correct sequencing is **Mac-first implementation, cross-platform architecture now, native Windows/Linux validation soon, full Windows/Linux product packaging later**.

`llama.cpp` is unusually helpful here because the exact same inference engine has documented current binaries/backends across Apple Silicon, Windows, and Linux. Its September 2026 release assets include Apple Silicon ARM64; Linux CPU, Vulkan, CUDA, ROCm, OpenVINO and SYCL variants; and Windows CPU, CUDA, Vulkan, ROCm, OpenVINO and SYCL variants, including some ARM support. citeturn19view0

That means you do not need to choose between “one engine everywhere” and “best engine per platform” yet. Start with one engine everywhere:

```text
Application-owned inference interface
                |
          llama.cpp adapter
        /        |        \
     macOS     Windows    Linux
     Metal     backend    backend
```

If MLX eventually produces a material Apple-specific advantage, add:

```text
Application-owned inference interface
          /                \
  llama.cpp adapter       MLX adapter
  Win/Linux/Mac          Apple-only
```

The platform matrix should be interpreted carefully:

| Runtime | macOS Apple Silicon engine support | Windows native engine support | Linux native engine support | WSL | Your integration tested? | Whole application supported? |
|---|---|---|---|---|---|---|
| `llama.cpp` | **Documented**; Metal/Accelerate | **Documented**, many backend builds | **Documented**, many backend builds | Linux engine may run there, but **not validated here** | **No — proposed test below** | **Not established; no repo audit** |
| Ollama | **Documented** | **Documented** | **Documented** | Separate deployment option, not a substitute for native testing | **No** | **Not established** |
| LM Studio/llmster | **Documented**, llama.cpp + MLX | **Documented** | **Documented** | Not the recommended desktop deployment model | **No** | **Not established** |
| MLX-LM | **Documented primary target** | **No comparable supported path** | MLX core has Linux developments, but do not assume MLX-LM product parity | Not a strategy | **No** | **Not established** |
| node-llama-cpp | **Documented** Metal | **Documented** native/Vulkan etc. | **Documented** native/Vulkan etc. | Separate packaging/runtime environment | **No** | **Not established** |

Sources for the engine-support cells are the current `llama.cpp` release matrix, Ollama's download/docs, LM Studio's system/runtime docs, MLX-LM's project documentation, and node-llama-cpp's hardware documentation. citeturn19view0turn18search5turn7view2turn9view1turn13view0turn21search3turn21search35

**Native Windows and WSL are different deployment targets.** An installable Windows desktop application should validate native Windows process lifecycle, storage, credential handling and GPU behavior even if developers can make the Linux runtime work under WSL. WSL can remain a developer option; it should not be counted as Windows product support without an explicit product decision.

Before final packaging—but after the Mac feasibility gate—perform a thin portability probe on one native Windows machine and one Linux machine. The purpose is not GPU-matrix certification. It is to catch avoidable architectural assumptions around child-process behavior, paths, file permissions, runtime executable selection, local sockets/ports, and model storage.

Typical **whole-application** concerns that should be tracked, without claiming they exist in your current code, include:

- credential storage: macOS Keychain versus Windows Credential Manager/DPAPI versus an appropriate Linux secret facility;
- child-process termination and crash cleanup: Unix signals differ from Windows process/job semantics;
- filesystem locations, permissions, path lengths, executable bits, and model-file atomic replacement;
- SQLite durability/locking assumptions, especially on unusual or network-mounted filesystems;
- code signing/notarization on macOS and signing/reputation mechanisms on Windows;
- native Node dependencies introduced by a desktop shell or in-process inference;
- firewall prompts and local networking;
- GPU driver/backend selection and fallback behavior.

Those should influence interfaces now, but you do **not** need to solve every one before validating Apple Silicon inference.

## Model shortlist and task-specific evaluation

There is no basis for selecting the final model from generic chat benchmarks. Your tasks are mostly **constrained decision and extraction problems**, and a syntactically perfect JSON answer can still be dangerously wrong.

The useful initial shortlist is deliberately small.

| Model | Suggested artifact | Weight file / reported size | License | Memory scenario | Why test it |
|---|---|---:|---|---|---|
| **Qwen3.5-4B** | GGUF `Q4_K_M` | Community conversion lists about **3.01 GB** | Apache-2.0 | **16 GB baseline** | Small, recent, strong vendor-reported instruction following; tests how low you can go |
| **Qwen3.5-9B** | GGUF `Q4_K_M` | LM Studio Community conversion lists **5.63 GB** | Apache-2.0 | **Preferred 16 GB candidate; comfortable at 32 GB if tests pass** | Likely better semantic headroom without a very large file |
| **gpt-oss-20b** | GGUF **MXFP4** | ggml-org lists **12.1 GB** MXFP4 | Apache-2.0 | **32 GB challenger** | OpenAI model card explicitly targets local use and structured outputs/function calling |

The Qwen model cards describe Qwen3.5-9B as a 9B vision-language model and give a native context of 262,144 tokens; the 4B and 9B cards are Apache-2.0. Qwen's published evaluation reports IFEval scores of 89.8 for 4B and 91.5 for 9B, among other benchmarks. Those numbers are **vendor-reported**, not a substitute for your evaluation corpus. citeturn16view0turn16view1

The Q4_K_M sizes above come from current community GGUF packaging metadata rather than the Qwen model vendor: LM Studio Community reports 5.63 GB for Qwen3.5-9B Q4_K_M, while a widely used Bartowski conversion reports about 3.01 GB for Qwen3.5-4B Q4_K_M. Treat the converter, source revision, and SHA-256 as part of the artifact identity rather than treating all “Q4_K_M” files as interchangeable. citeturn17search4turn17search5

For production provisioning, I would prefer, in order: an official model-vendor GGUF, a conversion published by the inference-engine organization, or a conversion you generate and archive reproducibly from the official weights. A community conversion is perfectly reasonable for feasibility, but should not silently become a production supply-chain dependency.

OpenAI describes `gpt-oss-20b` as a 21B-total/3.6B-active model, Apache-2.0 licensed, with configurable reasoning, function calling and structured outputs. Its model card says the MXFP4 version can run within 16 GB of memory; the ggml-org GGUF listing reports a 12.1 GB MXFP4 artifact and direct `llama.cpp` compatibility. citeturn20view3turn20view4

I would nevertheless classify gpt-oss-20b as a **32 GB product candidate**, not the default for a 16 GB Mac. “Weights can fit within 16 GB” is not equivalent to “a 16 GB consumer Mac can run the model, KV/cache, macOS, your Nest/Next application, SQLite, and normal desktop applications with healthy memory pressure.” That 32 GB classification is an engineering safety estimate to be measured, not a vendor performance claim.

### Approximate working-memory planning

These are **planning estimates, not measured results**:

| Artifact | Weight bytes | Rough working-memory budget to plan for | Interpretation |
|---|---:|---:|---|
| Qwen3.5-4B Q4_K_M | ~3.0 GB | ~4.5–7 GB | Strong 16 GB feasibility candidate |
| Qwen3.5-9B Q4_K_M | ~5.6 GB | ~7–11 GB | Plausible on 16 GB, but actual context/backend matters substantially |
| gpt-oss-20b MXFP4 | ~12.1 GB | ~14–20+ GB | Treat 32 GB as the realistic product tier |

The range reflects runtime allocations, context/KV state, backend buffers, and process overhead. The actual Mac's chip generation, memory size, macOS version, and context window are therefore important inputs **after**, not before, this research.

### Context deserves special caution with Qwen3.5

Qwen3.5 advertises a very large native context, and its model card specifically advises maintaining at least 128K context when preserving its full thinking capability. It also runs in thinking mode by default. citeturn16view0

Your application should **not** allocate 128K merely because the model supports it. Most listed workloads can be bounded or chunked:

- preference extraction can work over selected document chunks;
- category selection should receive a bounded allowed list and relevant query context;
- category consolidation works over category metadata, not arbitrary history;
- AcroForm planning receives extracted field metadata and relevant preferences rather than a rendered PDF;
- ordinary generation can use a product-level history limit.

Test Qwen3.5 at **8K and 32K** initially, with the structured tasks configured to avoid unnecessary chain-of-thought. Because this is below Qwen's own recommendation for preserving its long-context thinking behavior, your semantic evaluation—not the model card—must decide whether the reduced context is acceptable. That is a genuine unknown.

### PDF, vision, and OCR boundaries

For the AcroForm workflow described in the requirements, vision should not be part of the initial inference design. Your application can extract field identifiers, labels, types, allowed choice values, flags, and relevant nearby metadata locally, ask the LLM to propose actions over that data, validate every proposal, and then modify the PDF locally.

That is distinct from:

| Input | Initial path |
|---|---|
| Plain text/document text | Send bounded text to text model |
| PDF containing extractable text | Extract text locally, then use text model |
| AcroForm fields | Extract field metadata; model proposes validated actions |
| Image/photo | Requires a vision-capable model if needed |
| Scanned PDF | Requires OCR and/or vision before normal text reasoning |

Qwen3.5 itself is multimodal, and `llama-server` supports multimodal inference in general, so there is a plausible future path without changing the application abstraction. That does **not** prove that the exact Qwen GGUF/projector/runtime combination you choose is production-ready for your document-image cases; test that separately only when vision becomes a product requirement. citeturn16view0turn3view0

### The evaluation that should pick the model

Build a **fixed, version-controlled gold suite** before arguing about 4B versus 9B.

A practical first suite is about 80–120 cases:

| Workload | Cases | What to measure |
|---|---:|---|
| Preference suggestions | ~25 | Precision/recall against human-labelled suggestions; negation, ambiguity, conflicts, unsupported inference |
| Allowed-category selection | ~25 | Exact-set accuracy, false additions, omitted relevant categories, near-synonym distractors |
| Consolidation | ~15 | Human-rated usefulness plus explicit “must not merge” adversarial pairs |
| AcroForm action planning | ~20 | Exact field ID/type/choice correctness; no invented fields; correct checkbox/select semantics |
| General text | ~10 | Basic quality, latency, truncation/finish behavior |
| Optional image/scans | Separate suite | Keep out of release gate unless vision is explicitly in scope |

For structured tasks, record **two scores separately**:

1. **Structural validity:** does the raw response obey the schema?
2. **Semantic validity:** would the application's domain validator and a human consider the proposal correct?

A model that scores 100% on the first and 78% on the second is not an acceptable “structured-output model.”

Recommended initial product gates—explicitly **proposed criteria rather than measured results**—are:

- 100/100 supported-schema responses parse and validate structurally.
- No unauthorized enum/category/field value can pass the application validator.
- Category/PDF-action cases achieve at least 90% exact or adjudicated-correct semantic accuracy before release.
- Preference suggestion precision is at least 90%; lower recall is preferable to confidently inventing preferences because a human can review omissions.
- Zero clearly unsafe “merge these distinct categories” decisions on the dedicated must-not-merge set.
- Any invalid structured answer fails closed; it never becomes a trusted write.
- Human review remains mandatory wherever your requirements specify it, independent of the benchmark score.

Repeat important cases with several seeds/runs. A single temperature-zero pass is not enough evidence that a probabilistic model behaves robustly.

There is no sufficiently controlled independent performance result in the reviewed material that tells you how these exact Q4/MXFP4 artifacts will perform on **your Apple Silicon model, your context size, and these tasks**. I therefore would not quote tokens/second numbers from unrelated machines. The bounded feasibility test is where those numbers should be generated.

## Bounded Apple Silicon feasibility proposal

The goal of this experiment is **not** to build your runtime manager. It is to answer, in a small bounded exercise:

> Can a pinned `llama-server` plus a realistically sized local model deliver semantically adequate structured work, acceptable latency/memory, true offline-after-setup behavior, and usable cancellation semantics on the Macs we intend to support?

### Candidate versions and configurations

Use:

- **`llama.cpp` v0.5.0**, the September 23, 2026 stable release reviewed here rather than the continually published `bNNNNN` prereleases. The release notes emphasize backend correctness/performance and more robust server/router operation, and official artifacts are published for Apple Silicon and the later Windows/Linux targets. citeturn19view0
- **Qwen3.5-4B Q4_K_M** as the low-memory baseline.
- **Qwen3.5-9B Q4_K_M** as the likely quality/default candidate.
- **gpt-oss-20b MXFP4 only on a 32 GB Mac** as a larger quality challenger. citeturn16view0turn20view3turn20view4
- Text-only operation for the release gate.
- One parallel request initially.
- 8K and 32K context trials.
- Full Metal offload where supported.

If the first available test Mac is 16 GB, run 4B then 9B. If it is 32 GB, run 9B first, then gpt-oss-20b. Do not block the experiment waiting for both machines; record the exact chip and RAM and classify the other scenario as pending.

### Reproducible runtime setup

For the test, building the exact stable tag is more reproducible than relying on whatever Homebrew happens to package that day:

```bash
# Prerequisites: Xcode Command Line Tools, git, cmake.
# Pin the runtime rather than testing an unrecorded moving branch.

git clone --depth 1 --branch v0.5.0 \
  https://github.com/ggml-org/llama.cpp.git

cd llama.cpp

cmake -B build \
  -DCMAKE_BUILD_TYPE=Release

cmake --build build \
  --config Release \
  -j \
  --target llama-server llama-cli llama-bench

./build/bin/llama-server --version
./build/bin/llama-bench --version
```

`llama.cpp` documents both source builds and prebuilt distributions; Apple Silicon Metal is a first-class backend. For later product packaging, use approved prebuilt artifacts if they simplify signing/distribution, but pin them by release and hash rather than downloading “latest.” citeturn3view1turn19view0

For the feasibility test, download the model explicitly to a test-private directory rather than relying on a global application cache. A current Hugging Face CLI flow is conceptually:

```bash
MODEL_DIR="$HOME/local-ai-feasibility/models"
mkdir -p "$MODEL_DIR"

# Install/use your preferred Hugging Face client once for asset provisioning.
# Example Qwen3.5-9B Q4_K_M artifact:
hf download \
  lmstudio-community/Qwen3.5-9B-GGUF \
  Qwen3.5-9B-Q4_K_M.gguf \
  --local-dir "$MODEL_DIR"

shasum -a 256 \
  "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf"
```

The current LM Studio Community metadata reports that Q4_K_M file at 5.63 GB. For any production manifest, record the actual SHA-256 produced for the approved artifact rather than copying a hash from an informal document. citeturn17search4

A first server configuration can be:

```bash
export LLAMA_API_KEY="$(openssl rand -hex 32)"

./build/bin/llama-server \
  --model "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf" \
  --host 127.0.0.1 \
  --port 18080 \
  --api-key "$LLAMA_API_KEY" \
  --ctx-size 8192 \
  --parallel 1 \
  --gpu-layers 999 \
  --metrics
```

`llama-server` documents loopback binding, API-key support, context sizing, parallel slots and monitoring. The later managed product should prefer an API-key file or other protected secret mechanism over putting a durable secret in command-line arguments. citeturn4view0turn4view1turn4view2turn4view3

Check readiness before sending work:

```bash
curl -sS \
  http://127.0.0.1:18080/health
```

The health endpoint returns a loading/not-ready status during model loading and a ready status when serving is possible. citeturn4view1

Then make a schema-constrained request through the OpenAI-compatible chat endpoint. The exact application schema should be one of your real schemas rather than a toy “person object”:

```bash
curl -sS \
  http://127.0.0.1:18080/v1/chat/completions \
  -H "Authorization: Bearer $LLAMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "system",
        "content": "Select only relevant categories. Never invent a category."
      },
      {
        "role": "user",
        "content": "Allowed categories: [\"food\", \"travel\", \"pets\"]. Text: I prefer window seats on long flights."
      }
    ],
    "temperature": 0,
    "max_tokens": 256,
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "category_selection",
        "schema": {
          "type": "object",
          "properties": {
            "categories": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": ["food", "travel", "pets"]
              }
            }
          },
          "required": ["categories"],
          "additionalProperties": false
        }
      }
    }
  }'
```

`llama-server`'s documented structured-output path turns the supplied JSON schema into constrained grammar sampling. citeturn4view6

Your application must still independently reject anything outside the permitted domain and decide whether `["travel"]` is semantically justified.

### Test matrix

Run every model through the same corpus and record:

```text
runtime version + commit/tag
model repository + filename + SHA-256
model quantization
Mac model/chip
physical RAM
macOS version
context size
GPU-layers setting
parallel slots
prompt/schema version
input-token count
output-token count
time to first token
total wall time
generation rate where available
peak process RSS / system memory pressure
swap before/after
finish reason
structural pass/fail
semantic score
```

For 16 GB, run at least:

```text
Qwen3.5-4B Q4_K_M: 8K context
Qwen3.5-4B Q4_K_M: 32K context
Qwen3.5-9B Q4_K_M: 8K context
Qwen3.5-9B Q4_K_M: 32K context if memory remains healthy
```

For 32 GB, add:

```text
Qwen3.5-9B Q4_K_M: 32K context
gpt-oss-20b MXFP4: 8K context
gpt-oss-20b MXFP4: larger context only after the first pass
```

Do not allocate Qwen's advertised 262K context in this feasibility test unless a real workload demonstrates a need for it. The model card's own 128K recommendation for full thinking behavior makes the reduced-context semantic comparison especially important. citeturn16view0

### Resource measurements

At minimum:

```bash
# Save the PID after launch.
LLAMA_PID=$!

# Periodically sample the server.
ps -o pid,rss,%cpu,etime,command -p "$LLAMA_PID"

# macOS system-level views.
vm_stat
memory_pressure
sysctl hw.memsize
```

Activity Monitor is also useful for observing system memory pressure and responsiveness. `llama-bench` can provide a repeatable engine-level baseline, but the application task timings are the decision-making measurements.

A useful **proposed** 16 GB acceptance gate is:

- model/server starts and becomes ready within 30 seconds;
- the representative structured suite completes without process OOM/crash;
- no persistent severe memory pressure or swap thrashing develops during a 10-minute workload;
- ordinary application/UI operations remain responsive while generation runs;
- leave practical memory headroom for the Node/Next/Nest application rather than choosing a model that consumes essentially the whole machine.

Do not turn a single RSS number into the requirement: Apple Silicon uses unified memory and the system can compress/cache memory dynamically.

### Latency acceptance

For representative structured requests up to roughly 2K input tokens and 500 output tokens, a reasonable **product gate to test**, not a performance claim, is:

- p95 complete-response latency at or below about **15 seconds**;
- ordinary streamed generation begins within about **3 seconds** on the target machine;
- sustained text generation at least **10 tokens/second** for the selected default hardware/model combination.

Those values are proposed usability criteria. If the product experience can tolerate more, change them deliberately rather than retrofitting the acceptance test around whichever model wins.

### Cancellation test

This test is essential precisely because a client abort does not by itself demonstrate stopped inference.

Start a deliberately long request:

```bash
curl -N \
  http://127.0.0.1:18080/v1/chat/completions \
  -H "Authorization: Bearer $LLAMA_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 1 \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Write a very long detailed explanation of database internals."
      }
    ],
    "max_tokens": 4096,
    "stream": true
  }'
```

Immediately after `curl` aborts, issue a tiny second request to the **one-slot** server. Also inspect process CPU.

Acceptance:

```text
10/10 aborted requests return control to the application promptly;
a tiny following request can begin and finish promptly;
CPU activity associated with the abandoned generation falls;
memory does not grow cumulatively across repeated aborts.
```

A proposed gate is that useful serving capacity is available again within roughly **two seconds** after cancellation on the one-slot configuration. If it is not, document the actual behavior and decide whether engine-specific cancellation or sidecar restart is required.

This measures the thing you care about rather than assuming `AbortController` semantics extend into native decoding.

### Concurrency test

After the one-slot baseline passes, run a small second experiment with two concurrent application requests and `--parallel 2`. `llama-server` supports parallel decoding and continuous batching. citeturn3view0turn4view3

Record memory growth and p95 latency. Do **not** make two slots the release configuration merely because the engine can do it. A local single-user app can queue model work while still accepting UI/MCP operations.

### Offline test

After all runtime/model assets have been downloaded:

1. Stop the server.
2. Disconnect networking or deny outbound access.
3. Restart using `--model /local/path/model.gguf`; do not use a remote `-hf` identifier.
4. Run the complete structured suite.
5. Inspect the process for non-loopback network sockets.

For example:

```bash
lsof -nP -a -p "$LLAMA_PID" -i
```

The acceptance condition is **all normal inference functions pass with no required non-loopback connection**. For stronger assurance during the product security test, capture network traffic at the OS level rather than relying only on socket snapshots.

Repeat with a unique prompt canary such as:

```text
LOCAL_PRIVACY_CANARY_7b9b9f...
```

Then inspect any captured server/application logs. Prompts should not unexpectedly be persisted in support logs. If the runtime logs them under your chosen verbosity, either configure logging appropriately or ensure its stderr/log files receive the same privacy treatment as user data.

### Missing model and failure tests

Rename the model before startup:

```bash
mv \
  "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf" \
  "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf.missing"
```

Acceptance: the application reports **AI unavailable/model missing**, does not silently invoke anything hosted, and all non-AI functions remain usable.

Restore it and restart:

```bash
mv \
  "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf.missing" \
  "$MODEL_DIR/Qwen3.5-9B-Q4_K_M.gguf"
```

Also terminate the server while a request is running. The application should receive a bounded failure, preserve all local application data, and return to the non-AI-capable state.

Later, when a supervisor exists, add a crash/restart loop test and ensure restart attempts are bounded rather than spawning indefinitely.

### Structured semantic acceptance

For each proposed model, run the gold corpus at least once with deterministic/low-temperature settings and repeat high-risk cases.

The model is acceptable only if:

| Gate | Proposed criterion |
|---|---|
| JSON/schema | 100% structurally valid on supported schemas |
| Allowed-category enforcement | 100% of unknown values blocked by application validation |
| Category semantic quality | ≥90% exact/adjudicated-correct |
| Preference precision | ≥90% |
| AcroForm semantic actions | ≥90% exact/adjudicated-correct; 100% of illegal field/type/options blocked |
| Unsafe category merges | Zero on explicit must-not-merge cases |
| Stability | 50 sequential mixed requests without runtime crash |
| Cancellation | 10/10 cancellation/reuse trials satisfy release-capacity gate |
| Offline | Full normal suite runs without network |
| Data integrity | No model proposal mutates durable state until your existing approval path applies it |

If Qwen3.5-4B clears those gates and 9B improves the semantic score by only a trivial amount, ship the smaller model. If 9B materially improves semantic correctness while remaining healthy on a 16 GB Mac, make 9B the default. If neither reaches the task threshold, test gpt-oss-20b on 32 GB before adding runtime complexity.

### Cleanup

The test leaves no need for a permanent runtime manager:

```bash
# Stop the server.
kill "$LLAMA_PID" 2>/dev/null || true

# If needed after a grace period:
kill -9 "$LLAMA_PID" 2>/dev/null || true

unset LLAMA_API_KEY

# Remove only this experiment's private assets.
rm -rf "$HOME/local-ai-feasibility"
rm -rf ./build
```

Do not delete a user's Ollama, LM Studio, Hugging Face, or other model caches as part of testing.

## Delivery sequence and decisions

The runtime experiment and application integration should usually be **checkpoints within one small vertical change, not independent handoff-heavy deliverables**.

A sensible sequence is:

| Stage | Essential outcome | Packaging |
|---|---|---|
| **Feasibility checkpoint** | Pinned `llama-server`, one or two model candidates, gold-task harness, resource/offline/cancel measurements | Manual shell setup |
| **Application integration checkpoint** | Narrow `InferenceProvider`, structured schema calls, validation, AI-unavailable behavior, one-slot queue | Still manual runtime |
| **Decision checkpoint** | Select model/context/minimum Mac target from evidence | No installer work yet |
| **Managed Mac runtime** | Private binary/model paths, download consent/progress, process supervisor, auth, hashes, recovery | Product-owned sidecar |
| **Windows/Linux probe** | Same adapter on one native Windows and one Linux machine; identify portability work | Manual or dev packaging |
| **Product packaging** | Signed runtime assets, model provisioning, updates/rollback, OS-specific lifecycle | Desktop shell/installer |
| **Optional optimization** | MLX backend, vision/OCR, concurrency, multiple model tiers | Only when justified |

The first two checkpoints can be commits in a **single PR/change**: first make the manual runtime reproducible, then wire the application's owned inference interface to it, then run the same harness through the integration. Splitting them into separate deliverables is warranted only if your team wants an explicit go/no-go before any application code is touched. Otherwise a separate “install llama.cpp” ticket or PR creates handoff overhead without producing a meaningful product boundary.

### What must be decided next

Only a few choices are truly blocking:

**Adopt `llama.cpp` as the baseline feasibility runtime.** This is reversible because the application owns the abstraction, but choosing one baseline prevents an unnecessary multi-provider framework.

**Define the supported 16 GB experience.** The actual Mac specifications matter here. The key question is whether a 16 GB Apple Silicon Mac must deliver the full AI feature set or whether 16 GB gets a smaller model while 32 GB gets a larger tier. Do not answer that from model-file size alone.

**Choose the model evaluation pair.** My default test pair is Qwen3.5-4B Q4_K_M and Qwen3.5-9B Q4_K_M; add gpt-oss-20b MXFP4 only when a 32 GB machine is available. Qwen's vendor benchmarks make both sizes plausible, while OpenAI explicitly positions gpt-oss-20b for local structured/agentic use, but your gold suite is the selection authority. citeturn16view0turn20view3

**Choose a conservative context policy.** Start with 8K and test 32K. Do not advertise the model's theoretical 262K as the application's usable context. Qwen's own warning about preserving thinking capability at large contexts is precisely why the product should evaluate its bounded, non-thinking structured tasks directly. citeturn16view0

**Decide whether vision is in the first release.** The architectural recommendation is **no**. None of the representative AcroForm work requires vision by itself. Treat scanned/image documents as a separate feature gate.

**Treat computation cancellation as a release requirement, not an HTTP-client implementation detail.** The proposed abort/reuse test should decide whether `llama-server`'s practical behavior is sufficient.

**Choose model provisioning policy before distribution, not before feasibility.** A good likely policy is to ship or acquire the relatively small runtime with the application and download model weights after explicit user consent, using a pinned manifest and integrity hash. This keeps initial installer size manageable while preserving offline-after-setup operation.

### What can safely wait

The desktop shell can wait until you know the sidecar model works; the inference architecture does not depend on Electron, Tauri, or another shell.

Hosted inference can wait. The provider boundary is sufficient preparation: a future hosted implementation should be an explicit user-selected provider, never an automatic fallback from local failure.

MLX optimization can wait. MLX-LM is technically attractive on Apple Silicon and Ollama's MLX work reinforces the possibility of significant platform-specific optimization, but the current Ollama integration is still described as preview and MLX does not solve Windows/Linux parity by itself. citeturn13view0turn3view4

Multiple local runtimes can wait. Supporting `llama.cpp`, Ollama, LM Studio and MLX simultaneously before a concrete need would multiply lifecycle, privacy, structured-output, model-compatibility and regression testing.

Vision/OCR can wait. Qwen3.5 and `llama.cpp` leave a credible path open, but text extraction, AcroForm metadata planning, and scanned-image interpretation are different problems and should stay different in the application architecture. citeturn16view0turn3view0

Automatic model/runtime update policy can also wait until the feasibility gate, but **version pinning cannot**. Record `llama.cpp` v0.5.0, the exact model artifact, quantization and hash from the first real test. `llama.cpp` releases move quickly—the same release page already contains rapidly advancing `bNNNNN` prereleases—so reproducing “whatever was latest” later would be unreliable. citeturn19view0

The resulting path is intentionally narrow:

```text
NOW
Application-owned interface
        ↓
manual llama.cpp server
        ↓
one approved GGUF
        ↓
gold semantic evaluation

IF IT PASSES
same application interface
        ↓
same llama.cpp API
        ↓
app-owned child process
        ↓
private, hashed model/runtime assets

THEN
native Windows/Linux validation
        ↓
installer / lifecycle / update work

ONLY IF EVIDENCE JUSTIFIES IT
Ollama swap
MLX Apple backend
vision/OCR
hosted provider
multiple model tiers
```

That approach optimizes for the priorities in the requirements: it is simple enough to test now, uses a runtime with documented Apple/Windows/Linux reach, keeps model choice independent, preserves a low-rework route to a fully managed local product, does not require cloud infrastructure, and leaves the genuinely expensive packaging/runtime-management work until local inference has demonstrated that it is good enough for the application's actual structured tasks.
