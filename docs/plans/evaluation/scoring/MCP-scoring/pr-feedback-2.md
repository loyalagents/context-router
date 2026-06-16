# PR Review 2: MCP Eval Runner Hardening

- Reviewer pass: 2 (follow-up to `pr-feedback-1.md`)
- Date: 2026-06-16
- Reviewed change: `1b61cf9 Harden MCP eval runner isolation and Claude-only v1`
- Compared against: `pr-feedback-1.md` (my prior review) and the new code in
  isolation. Note `pr-feedback-a.md` / `pr-feedback-b.md` (other reviewers) also
  cover this commit; I avoid re-litigating what `pr-feedback-b.md` already owns.

## Disposition Of `pr-feedback-1.md`

Most of my prior findings were addressed well:

- **Adapter invocations (must-fix #2)** — Resolved. Codex is now reserved behind
  a usage error (`parseArgs` `e2e-mcp-agent.mjs:654-660`) and the Claude adapter
  was rewritten (`buildAgentInvocation` `:868-895`). I verified every flag
  against the installed Claude Code (v2.1.178) and the published permission docs:
  `--tools`, `--allowedTools`, `--mcp-config`, `--strict-mcp-config`,
  `--settings`, `--no-session-persistence`, `--output-format stream-json --verbose`
  all exist, and — contrary to my earlier worry — `--permission-mode dontAsk`
  ("auto-denies tools unless pre-approved via `permissions.allow`") and the
  `mcp__<server>__*` allow-glob are both real and are exactly the right
  combination here. The tool-permission design is correct; don't "fix" it.
- **No adapter argv test (must-fix #3)** — Resolved. New test pins the Claude
  argv, cwd, and the sanitized child env (`e2e-mcp-agent.test.mjs:151-191`).
- **Completion-marker false positive (should-fix #4)** — Resolved via
  `completionMarkerInOutput` (`:1432-1456`), which ignores echoed
  `"role":"user"` / `"type":"user"` stream-json and requires a standalone line.
- **Redaction breadth (should-fix #5)** — Resolved. `redactForArtifact`
  (`:1460-1476`) now scrubs Bearer/JWT/`sk-` patterns, and the transcript flag is
  honest (`redactedAuthSecrets` + `mayContainCorpusPii`).
- **`value.startsWith('--')` (optional #7)** — Resolved via `dashPrefixedValueArgs`.
- **Count fields pinned to `null` (optional #9)** — Resolved; schema now accepts
  `integer|null` and bumped `mcp-agent-run` to schemaVersion 2.

Still open (already owned by `pr-feedback-b.md`, not repeating the detail):

- **Agent vs. `EVAL_AUTH_TOKEN` identity coupling (my must-fix #1)** — Not
  addressed in code. The env hardening below actually *sharpens* this risk,
  because the agent's MCP credentials are now deliberately separated from the
  runner's GraphQL token, with no preflight that they resolve to the same backend
  user. Track under `pr-feedback-b.md` #1.

I verified the new state: `node --test e2e-mcp-agent.test.mjs
ingest-documents.test.mjs` → **36 pass, 0 fail**.

---

## New Finding (Should-Fix): sanitized child env omits the documented Claude headless/cloud auth mechanisms

`buildAgentEnvironment` (`e2e-mcp-agent.mjs:1371-1406`) is a strict allowlist —
correct approach, and it properly strips `EVAL_AUTH_TOKEN`, `DATABASE_URL`,
`AUTH0_*`, etc. But the allowlist's auth-related keys are only
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL`. Per the
Claude Code authentication docs, that omits the mechanisms intended for exactly
the non-interactive scenario this runner is (`claude --print`):

- **`CLAUDE_CODE_OAUTH_TOKEN`** — the documented credential "for CI pipelines and
  scripts where browser login isn't available" (`claude setup-token`). Stripped.
- **`CLAUDE_CONFIG_DIR`** — relocates `~/.claude/.credentials.json` on
  Linux/Windows; if set, stripping it makes Claude look in the wrong place for
  stored creds. Stripped.
- **Cloud-provider auth** — `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`
  and their backing AWS/GCP credential vars (e.g.
  `GOOGLE_APPLICATION_CREDENTIALS`), plus `apiKeyHelper`'s
  `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`. Stripped.

Why it matters: this bites the *one remaining checkpoint* — the live Claude MCP
smoke — and any future CI use. The failure is silent and easy to misread: an
operator on macOS who authenticated interactively via `/login` (creds in
Keychain, reachable because `HOME` is preserved) will see the smoke pass, while
the same runner in CI/headless — where `CLAUDE_CODE_OAUTH_TOKEN` or Bedrock/Vertex
env is the only credential — fails to authenticate. Combined with the existing
"low score is benchmark output, not a runner failure" policy, an auth failure
that still exits the CLI nonzero will at least surface, but a partial/odd-auth
state could be misattributed to the agent.

Recommendation: add the headless/cloud auth keys to the allowlist
(`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`,
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, and
the AWS/GCP/Azure credential vars those modes require), or make the agent-auth
passthrough an explicit, documented adapter contract rather than a fixed
Anthropic-API-key-only list. At minimum, document that the Claude adapter
currently assumes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` or HOME-resident
credentials, so the live smoke isn't run blind.

## Optional Follow-Ups

- **Verify list separators during the smoke.** `--tools` and `--allowedTools` are
  passed as single comma-joined strings (`CLAUDE_BUILTIN_TOOLS = 'Read,Glob,Grep'`,
  `:872`, `:887-889`). Claude Code's CLI declares these as variadic
  (`<tools...>`). Comma-joined single-token lists are widely used and should work,
  but this is unverified against v2.1.178 and is exactly the kind of thing the
  live smoke should confirm — if the list is taken literally, the agent ends up
  with no usable tools and writes empty memory (again, a silent low score).
- **`mayContainCorpusPii: true` is now honest, but the transcript is still
  persisted in full.** Fine for v1 given the flag, but worth a one-line note in
  the runner docs that `mcp-agent-transcript.txt` can contain corpus PII so
  artifact roots aren't committed or shared casually.

## Verified

- `node --test examples/eval/scripts/e2e-mcp-agent.test.mjs
  examples/eval/scripts/ingest-documents.test.mjs` → 36 pass, 0 fail.
- Claude flag/permission claims checked against the locally installed
  `claude --help` (v2.1.178) and `code.claude.com/docs/en/permissions` +
  `/en/iam` (auth precedence). Confirmed `mcp__<server>__*` allow-globs and
  `dontAsk` are valid and correctly used; confirmed `CLAUDE_CODE_OAUTH_TOKEN`
  is the documented headless credential and is not in the env allowlist.
- Did not run the live Claude MCP smoke (no backend / MCP config / Claude auth in
  this environment) — same gap noted across all prior reviews.
