# Installed Live Series: Approved Bound Correction

Status: explicitly approved by the user for Candidate 13 on 2026-10-10 and executed
once successfully. The authorization is consumed; this is not standing authority
for another run. The series passed in 68.273 seconds with three generations, two
successful completions and one expected rejection after AI invalidation, followed
by clean native exit and matching durable quiescence. See
[Candidate 13 qualification](qualification-candidate13.json).

The current public `askVertexAI` route passes only cancellation/deadline controls
to `LocalModelService`, whose completion client defaults to 2,048 output tokens.
The pinned llama.cpp server chooses the explicit request limit over its CLI default;
`--predict 128` cannot impose the previously reviewed 128-token ceiling. See the
[pinned server selection](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-context.cpp#L1674-L1675).
Short-answer wording and a wall-clock limit are not token-limit enforcement.

The concrete opt-in executable is
`scripts/local-migration/installation/live-installed.mjs`. It requires an exact JSON
manifest binding the actual candidate path and SHA-256 of its package manifest,
with fixed series/resource fields. The compatibility/evidence reviewer approved
the executable and exact Candidate 13 binding before approval was requested:
proposal SHA-256 `961ff557a4e88a777744de9d5a1c03f291f378761824aee0b6a89eaf8d39a0ea`,
manifest SHA-256 `6729b70ec1d4767b72ff43ad4d98110d34e0941ec46bf394cf5e4ace08ec15c0`.

Approved limits: three total fresh generations (first without model, then two with
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

This expands the output-token limit beyond the [approved plan](plan.md)'s original
128-token bound. The user separately approved the concrete reviewed expansion;
the earlier authorization was not reused. Independent receipt review confirmed the
bounds and artifact binding. Actual sleep/wake observations, reboot qualification
and human/signing acceptance remain separate; Step 06 E/H is unchanged.
