# PR Review: MCP Known-Schema Eval Runner (pr-feedback-1)

- Reviewer pass: 1
- Date: 2026-06-15
- Branch: `codex/review-mcpscoringopenschema`
- Head commit reviewed: `b08f726 Implement MCP known-schema eval runner`
- Scope: `eval:e2e-mcp-agent` runner, shared setup extraction, prompt/schema
  contracts, docs.

## Summary

The change implements `pnpm eval:e2e-mcp-agent` as a sibling of
`eval:e2e-known-schema`, extracts the known-schema setup primitives into
`examples/eval/scripts/ingestor/setup.mjs`, adds a prompt template, an
`mcp-agent-run.json` artifact + schema, extends `evaluation-run.schema.json`,
and adds focused tests. It matches the plan's stage order, CLI contract,
reserved-mode behavior, failure policy, and answer-key isolation intent well.
The wrapper-level engineering (staged report writing, schema validation on every
write, redaction, partial-run skip accounting) is solid and closely mirrors the
existing known-schema runner.

The two highest-risk areas are both things the implementation summary itself
flags as "Not Run": **(1)** the runner silently assumes the MCP-authenticated
agent identity is the same backend user as `EVAL_AUTH_TOKEN`, and **(2)** the
Codex/Claude adapter invocations are unverified and at least the Claude one
looks wrong. Because the live smoke was never executed, the codex/claude paths
are effectively untested end-to-end. Everything below "must-fix" is either a
correctness sharp edge or a follow-up.

## What I Verified

- Ran `node --test examples/eval/scripts/e2e-mcp-agent.test.mjs
  examples/eval/scripts/ingest-documents.test.mjs` → **34 pass, 0 fail**. This
  confirms the wrapper staging, redaction, partial-run skip behavior, schema
  validation of `evaluation-run.json` / `mcp-agent-run.json`, and that the
  `ingest-documents` refactor did not regress (its 30+ tests still pass,
  including the definition value-type compatibility throw at
  `ingest-documents.test.mjs:288`).
- Confirmed `eval:e2e-mcp-agent` is wired in `package.json:37`.
- Confirmed the `evaluation-run.schema.json` changes are backward compatible:
  the new `settings` MCP fields and `setup`/`agent` summaries are optional
  (`settings.additionalProperties:false` but all new keys are declared), so the
  existing `evaluationMode: "known-schema"` wrapper still validates. No contract
  break for `eval:e2e-known-schema`.
- Confirmed the `ingest-documents.mjs` refactor preserves call order
  (fetch user → optional reset → collect targets → ensure definitions) and the
  `report.reset` guard semantics.
- Did **not** run the live MCP smoke (needs a running backend, `EVAL_AUTH_TOKEN`,
  and an authenticated `context-router-local` MCP config) — same gap noted in
  the implementation summary.

---

## Must-Fix

### 1. Agent identity vs. `EVAL_AUTH_TOKEN` identity is unverified (correctness)

The runner performs setup, export, scoring, and form-fill against the backend
user resolved from `EVAL_AUTH_TOKEN`:

- reset + ensure-definitions run through `prepareKnownSchemaMemory` with
  `graphqlUrl`/`authToken` (`e2e-mcp-agent.mjs:129-149`, `ingestor/setup.mjs:37-85`),
- export uses `--auth-token options.authToken` (`e2e-mcp-agent.mjs:1015-1036`),
- form-fill uses `--auth-token options.authToken` (`e2e-mcp-agent.mjs:236-244`).

But the agent writes memory through the **configured MCP server's own
authenticated identity** (`--mcp-server`), which the runner never resolves or
compares. Nothing asserts these are the same backend user.

If the MCP-authenticated user differs from the `EVAL_AUTH_TOKEN` user:

- `--reset-memory` wipes the wrong user's memory,
- the agent's `SET_PREFERENCE` writes land on a different user,
- export/score/fill read the `EVAL_AUTH_TOKEN` user's (empty) memory.

The result is a fully green run that scores all facts as "missing" and looks
like a *bad agent*, when it is actually a setup mismatch — which is the worst
possible failure mode for a benchmark whose entire purpose is attribution.

The GLOBAL scope on created definitions (`ingestor/definitions.mjs:47-57`)
masks the *schema-visibility* half of this (any MCP user can see the slugs), so
the failure is silent rather than loud.

Recommendation: before the agent stage, resolve the MCP-authenticated identity
(e.g., have the agent report it, or call an MCP whoami/`searchPreferences`
round-trip) and hard-fail if it does not equal `setupResult.backendUserId`. At
minimum, document this as a hard precondition in the prompt template / runner
usage and surface `backendUserId` next to the MCP server name in the failure
output.

### 2. Codex/Claude adapter invocations are unverified and likely wrong

`buildAgentInvocation` (`e2e-mcp-agent.mjs:804-835`) hard-codes:

- Claude: `claude --print --permission-mode dontAsk --output-format stream-json`
  - `dontAsk` is not a documented Claude Code permission mode (the modes are
    `default`, `acceptEdits`, `bypassPermissions`, `plan`). This will likely
    error out or be ignored.
  - `--output-format stream-json` with `--print` generally also requires
    `--verbose`.
  - The MCP server is never passed to the CLI (no `--mcp-config` /
    server selection); the adapter relies entirely on ambient global config.
- Codex: `codex exec --cd <root> --sandbox read-only --ask-for-approval never -`
  - `--sandbox read-only` plus `--ask-for-approval never` may block the network
    egress the agent needs to reach the local MCP HTTP server
    (`localhost:3000`). If network is sandboxed off, every MCP call fails and the
    run produces empty memory — again indistinguishable from a bad agent.

The brainstorm's own Open Questions section explicitly lists "what exact Codex
CLI invocation" and "what exact Claude CLI invocation" as unresolved, and the
live smoke was skipped, so none of these flags have been exercised. As written,
the `codex` and `claude` agents are not known to work. Either validate them with
a live smoke and correct the flags, or label them experimental and gate them
until verified. The `command` adapter is the only path that is actually tested.

### 3. No test coverage for the agent adapter argv

Only the `command` adapter is exercised (`e2e-mcp-agent.test.mjs:376-405`).
`buildAgentInvocation` for `codex`/`claude` has zero coverage, which is exactly
why the wrong flags in (2) slipped through. Add a unit test that pins the
codex/claude argv so the invocation shape is a deliberate, reviewable contract
even though live behavior still needs manual smoke.

---

## Should-Fix

### 4. Completion-marker detection can false-positive

`completionMarkerObserved` is computed by substring-matching the agent's
combined stdout/stderr for `EVAL_MCP_AGENT_DONE`
(`e2e-mcp-agent.mjs:407-413`, `runAgentProcess` `:778-779`). The rendered prompt
*contains that exact marker string* ("When you are done, print
`{{COMPLETION_MARKER}}`", `prompts/mcp-known-schema.md:28`). Any agent that
echoes its input — notably `claude --output-format stream-json`, whose stream
includes the user message — will make the substring match trivially true
regardless of whether the agent actually finished. It is diagnostic-only in v1,
but as implemented the signal is close to meaningless and could mislead a
reviewer reading `mcp-agent-run.json`. Consider matching only on a standalone
output line, scanning only post-prompt output, or using a less echo-prone
sentinel.

### 5. Redaction only scrubs `EVAL_AUTH_TOKEN`; transcript is labeled `redacted: true`

`buildTranscript` / `redactSecret` only replace `options.authToken`
(`e2e-mcp-agent.mjs:1071-1086`, `1200-1203`), yet the full agent stdout/stderr
is persisted to `mcp-agent-transcript.txt` and the artifact records
`transcript.redacted: true` (`:950-953`, schema requires it). That `redacted`
flag overstates the guarantee. The transcript can contain:

- corpus PII the agent read and echoed (SSN/address/etc. — the very strings the
  prompt test asserts are *not* leaked into the prompt are free to appear in the
  agent's own output),
- MCP OAuth/bearer tokens or auth-related output the CLI may print, which are
  *not* the `EVAL_AUTH_TOKEN` and so are never scrubbed.

The brainstorm lists this as an open question; the implementation ships full
capture with a `redacted: true` label anyway. Recommend: redact common token
patterns (e.g., `Bearer …`, `sk-…`, long base64/JWT-looking blobs), document
that transcripts may contain corpus PII, and/or downgrade the `redacted` flag to
something honest like `redactedAuthToken: true`.

### 6. Shared setup helper has no direct test; the runner mocks it entirely

`setup.mjs` (`prepareKnownSchemaMemory`, `ensureKnownSchemaDefinitions`,
`assertExistingDefinitionCompatible`) has no `setup.test.mjs`, and the MCP
runner tests stub the `setup` runner wholesale. The helper is still exercised
*indirectly* through `ingest-documents.test.mjs` (good — the compatibility throw
is covered at line 288), so this is not a regression. But Checkpoint 0 of the
plan explicitly asked for "focused tests proving existing definition
compatibility checks still run outside the upload ingestor," and the new
module + the runner→helper wiring have no targeted coverage of their own. A
wiring bug between `prepareKnownSchemaMemory` and the runner would not be caught.

---

## Optional Follow-Ups

### 7. `value.startsWith('--')` rejects legitimate flag values

In `parseArgs`, the "missing value" guard treats any value beginning with `--`
as a missing value (`e2e-mcp-agent.mjs:572`). The most likely victim is
`--agent-command` whose shell snippet could legitimately start with `--`, or a
`--model-label`/run-id with a leading `--`. Edge case, but worth a comment or a
positional-aware parse.

### 8. `mcp-agent-run.json` final status reflects only the agent stage

After the agent stage succeeds, `mcp-agent-run.json` is written with
`status: "pass"` and never rewritten (`e2e-mcp-agent.mjs:438-445`). If a later
stage (export/score/fill) fails, `evaluation-run.json` is `fail` while
`mcp-agent-run.json` still says `pass`. Defensible (it is the agent-stage
artifact), but a one-line doc note or a terminal status sync would avoid
confusion.

### 9. `summary.*Count` fields are schema-pinned to `null`

`toolCallCount`/`preferenceWriteCount`/`definitionCreateCount` are typed
`{"type": "null"}` in `mcp-agent-run.schema.json:124-126`. This is intentional
for v1, but means wiring real counts later (from MCP access logs) forces a
schema edit and a `schemaVersion` decision. Fine as-is; just flagging the
coupling so it is a conscious follow-up, consistent with the summary's
"Follow-Up" note.

---

## Plan / Docs Alignment

- CLI contract matches the implementation plan exactly (`--agent`,
  `--schema-mode`, `--form-mode`, reserved `open`/`agent` modes failing with
  usage errors, defaults, env fallbacks). Verified in tests.
- Stage order, `evaluationMode: "mcp-known-schema"`, and MCP stage names match
  brainstorm + orchestration.
- Answer-key isolation holds: the prompt excludes `profile.yaml`,
  validation/score reports, `fact-storage-map.v1.json`, expected snapshots, and
  manifest truth metadata (`factContract`/`evaluationRole`/`intentionallyMissing`).
  `documentList` only emits path/id/title/category/outputExtension
  (`e2e-mcp-agent.mjs:1056-1069`), and the prompt test asserts known PII and
  truth keys are absent. Good.
- Failure policy matches: low scores do not fail the wrapper; only
  setup/runtime/artifact failures do. Partial-run skip accounting is correct and
  tested.
- Doc nit: brainstorm's "Existing artifacts to reuse" lists
  `form-fill-score-report.json` (`brainstorm.md:103`) but the runner and
  implementation summary both use `form-score-report.json` (matching
  `e2e-known-schema.mjs:502`). Pre-existing naming inconsistency — align the
  brainstorm or call it out.
- `implementation-summary.md` and `orchestration.md` accurately mark the live
  smoke as the one remaining (manual) checkpoint.

## Test Notes

- `node --test examples/eval/scripts/e2e-mcp-agent.test.mjs
  examples/eval/scripts/ingest-documents.test.mjs` → 34 passed.
- Live `pnpm eval:e2e-mcp-agent` smoke not run (no backend / token / MCP config
  in this environment). Given findings (1) and (2), running that smoke is the
  single most valuable next verification step.
