# Installed Live Series: Proposed Bound Correction

Status: not approved for execution. No new live-model run has occurred.

The current public `askVertexAI` route passes only cancellation/deadline controls
to `LocalModelService`, whose completion client defaults to 2,048 output tokens.
The pinned llama.cpp server chooses the explicit request limit over its CLI default;
`--predict 128` cannot impose the previously reviewed 128-token ceiling. See the
[pinned server selection](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L1674-L1675).
Short-answer wording and a wall-clock limit are not token-limit enforcement.

The concrete opt-in executable is
`scripts/local-migration/installation/live-installed.mjs`. It requires an exact JSON
manifest binding the actual candidate path and SHA-256 of its package manifest,
with fixed series/resource fields. This file and the executable require affected
independent review; the candidate binding is filled after the final rebuild.

Proposed limits: three total fresh generations (first without model, then two with
the cached selected model), three public text-generation requests (two intended
successful completions and one expected rejection after invalidation), at most
2,048 output tokens per dispatched completion, 60 seconds per request and 15 minutes
total, including a two-minute cleanup reserve. The script stops on the first failed
or uncertain check. It never retries a request, changes the app's generation limit,
substitutes an engine or reads personal installation state.

The test uses an isolated private envelope, verifies and copies the already cached
5,680,522,464-byte model, blocks source/toolchain reads and non-loopback outbound
traffic, and allows only the candidate's native guardian, Node and model binaries.
It initializes through the installed guardian, unlocks through the public browser
authority route and invokes the real public GraphQL text endpoint. After a successful
completion it invalidates AI through the existing private lifecycle command, verifies
the same browser session still returns the same authenticated `me { userId }` without
GraphQL errors while the AI request is rejected, then explicitly restarts the whole generation.
It checks new certificate/generation identity, retained store identity, a second
completion, actual guardian exit and durable quiescence. It preserves evidence and
uncertain state; it never signals by name/port or changes personal client settings.

This expands the output-token limit beyond the [approved plan](plan.md)'s 128-token
bound. It needs explicit user approval after the executable review and candidate
binding. All unrelated implementation, deterministic tests and offline qualification
continue under existing authorization. Actual sleep/wake, reboot and human/signing
acceptance remain separate pending items.
