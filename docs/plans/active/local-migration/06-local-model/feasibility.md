# Step 06 Feasibility Progress

- Status: incomplete; no candidate selected and no production integration authorized
- Owner and sole writer: `/root`; investigators/reviewers remain read-only
- Base: `837701b3633eed669dd2c2c518ffebc0e46d55d8`
- Branch: `codex/local-migration-06-local-model`
- Worktree: `/private/tmp/context-router-step06`
- Updated: 2026-09-24

## Gates And Consent

The [plan](plan.md) records the passing clean-base activation and independent B approval for bounded CP1. The original ten preparation documents still match the retained [manifest](evidence/preparation-manifest.json); original workspace remains untouched. Exact activation and transfer receipts are retained beside that manifest.

Required user answers remain pending: consent for exact runtime/model assets and confirmation of the initial qualified M1 Max/64 GiB/macOS 15.1.1 target. Proposed assets are the MIT llama.cpp b11146 macOS arm64 archive (11,189,714 bytes) from GitHub and Apache-2.0 Unsloth Qwen3.5 Q4_K_M GGUF from Hugging Face: 4B (2,740,937,888 bytes), optionally 9B (5,680,522,464 bytes). The plan binds exact revisions and SHA-256. Proposed destination is `/private/tmp/context-router-step06-assets`; no shared/global cache or install. No runtime/model asset has been downloaded and no model process has started. Lower-memory Macs, other OS versions and native Windows/Linux are unqualified.

## Deterministic Quality Component

The test-only [scorer](../../../../../scripts/local-migration/fixtures/local-model-feasibility/quality.mjs) enforces the planned 16-case/three-repetition matrix with independent task-family thresholds, explicit negative correctness, failed-response accounting, proposal/validated separation, exact typed units and zero accepted critical violations. It emits metrics and fixed case identifiers, not source prompts/answers. This component consumes semantic units produced by actual validators; it is not itself an application validator or a live runner.

Tests preceded implementation: initial missing-module red, then eight passing tests at `c56f2f33fc31ae6b66c9a5b1de952b3947753660`. Independent High reviewer `/root/plan_compatibility` found sparse arrays could omit a trial and that the original family test did not isolate aggregate masking. New regression tests reproduced sparse-trial failure before the fix; dense-array checks now reject missing/nested holes. Separate precision-only and recall-only failures explicitly keep aggregate utility and all negative cases passing while requiring the overall verdict to fail. All eleven targeted tests now pass under Node 24.21.0:

```sh
node --test scripts/local-migration/local-model-quality.test.mjs
```

Affected re-review remains pending. These are harness self-tests only. No real task corpus, expected answers, prompt/schema hashes or model score has yet been frozen/measured; no acceptance claim follows from synthetic scorer inputs. The full live harness and source/package/parser qualification remain to be implemented and validated.

## Blocking Source Finding And Proposed Amendment

Read-only Extra High investigator `/root/safety_discovery` examined pinned llama.cpp `7fe450e19305b828c199d602c23a8337aaa1f03b`. Non-streaming tokenizes input before allocating/posting numeric tasks, and returns HTTP headers only after the final result. `/slots` has no mapping from the caller's request to its numeric task; monitoring operations also consume IDs. An aborted request can therefore still be tokenizing while status reports idle, then be admitted later. Guessing IDs, using an RNG seed as identity, or generic idle polls cannot establish its settlement. See [request lifecycle](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L4257), [slot response](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L686) and [HTTP handling](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-http.cpp#L618).

Amendment C proposes native SSE internally with buffered port results. With `stream`, `return_progress`, disabled prompt cache and one completion, the request's own initial progress frame proves it entered a slot. That frame carries no trustworthy numeric task/slot binding; `id_slot` can be -1. The single-completion source path has no release-and-requeue after admission. Fresh all-slots-idle may therefore establish settlement AFTER the own-request admission marker, provided the SAME runtime instance is proved. This remains a candidate protocol requiring affected plan review and live measurement. See [progress marker](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L3409), [progress serialization](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-task.cpp#L242), [deferral](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L2396) and [release](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L540).

A retained TLS control socket proves continuity only of that socket's peer; a second inference connection could reach a replacement sharing the same certificate. A timestamp is not a unique boot identity. CP1 may use an exclusively owned disposable child with unique per-child certificate/key, direct connections and exact retained control socket. Loss/reconnection fails closed. Production applicability must separately resolve manual restarts/certificate reuse before selection; probe ownership is not application process-control authority. Abort before the admission marker remains permanently unavailable in that client, and killing/reaping an owned child is cleanup, never passing cancellation evidence. See [listener options](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-http.cpp#L218) and [keepalive handling](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/vendor/cpp-httplib/httplib.cpp#L1866).

## Remaining Evidence

Amendment review and required user decisions precede live work. Complete frozen actual-app fixtures/schema probes, bounded TLS/credential/stream/parser harness tests, then consented provisioning, artifact verification and all declared quality/performance/offline/privacy/cancellation measurements. Obtain affected selection approval before production adapter work. Actual integration, full source/package acceptance, fresh independent full-diff implementation review, final local gate and final-head CI remain outstanding. There is no PR yet; all work stays on the single planned branch.
