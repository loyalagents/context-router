# Two agents, one portable memory

This example imports the supplied historical snapshot into a **new private local
Context Router instance**, then demonstrates shared reads, an explicit update,
independent permissions, and persisted history in the existing dashboard. It
changes no product code or installed application state. Different assistant
vendors are optional. The current walkthrough uses Codex A and Claude Code B
with a Claude Pro subscription; two isolated Codex sessions also work.

**Live Claude login, assistant behavior and the human walkthrough remain pending.**
Local automated tests use real MCP, SQLite and the dashboard without model calls.
Cloud assistants may send retrieved context to their providers. All prepared
state, original records, audit history and assistant transcripts are private;
do not publish the output directory or paste its credentials into prompts.

## Prepare and run

From the repository root, use Node **24.21.0** and pnpm **10.25.0**. Build the
existing backend and web first if they are not already built:

```sh
pnpm --filter backend build
pnpm --filter web build
node examples/demo-10-2026/demo.mjs inspect
node examples/demo-10-2026/demo.mjs prepare --out /private/tmp/context-router-demo
node examples/demo-10-2026/demo.mjs verify --root /private/tmp/context-router-demo
node examples/demo-10-2026/demo.mjs serve --root /private/tmp/context-router-demo
```

`prepare` refuses an existing destination, including a failed preparation. It
never resets, resumes or merges existing state. Choose another new canonical
absolute path outside the repository for another rehearsal. Parent directories must have trusted
ownership and permissions. An import failure preserves private `failed.json`
and partial data, attempts importer revocation, and publishes no completion
manifest. Do not replay an uncertain write. Inspect state/history first.

`serve` delegates to the existing no-model local UI. Defaults are dashboard
`http://127.0.0.1:3003` and MCP `http://127.0.0.1:8788/mcp`; override with `--port`
and `--mcp-port` on serve and the matching `--mcp-port` on client commands.
Occupied ports fail without stopping their owners. Open the printed dashboard
origin; paste the contents of the private printed unlock file into **Unlock
token**. Enter `unlock` in the server terminal for another token. Stop the owned
server with **Ctrl-C** and wait for it to exit. Stop it before running `verify`.
Closing the browser alone does not stop the server.

## Assistant setup (user-run only)

Supported offline checks currently pin **Codex CLI 0.160.0** and **Claude Code
2.1.299**. Launchers fail on unsupported versions or missing controls. Personal
config, hooks, plugins, connectors and authentication are not copied. Workspaces
start empty and must remain empty; client settings, profiles and temporary files
use dedicated demo directories. Codex and bare Claude also use a separate HOME.
On macOS, subscription Claude uses the OS account HOME for Keychain discovery,
with the demo-specific configuration described below. No credentials are put in
argv or MCP configuration; tokens are passed only in child environments.

For Claude Code B with Claude Pro, run this from the repository root:

```sh
node examples/demo-10-2026/demo.mjs claude --root /private/tmp/context-router-demo --agent b --auth subscription
```

Complete the fresh demo login using **Claude.ai with your Pro subscription**.
Do not select Console/API billing. `forceLoginMethod: claudeai` preselects the
subscription login, but terminal onboarding still allows another choice.
The separate `claude-config` directory has its own login and macOS Keychain
entry in the existing account Keychain; no existing login is copied. macOS
requires the OS account HOME to find that Keychain. `CLAUDE_CONFIG_DIR` remains
the demo's `claude-config`, `ANTHROPIC_CONFIG_DIR` is its `anthropic` subdirectory,
`TMPDIR` remains `claude-home`, and the workspace stays `claude-workspace`.
The explicit Anthropic directory prevents fallback to the account's profiles;
see the [profile directory reference](https://platform.claude.com/docs/en/manage-claude/wif-reference#configuration-directory).
This is one Claude Code session for either selected role, so do not run both
Claude roles in these directories concurrently.
See the [Claude authentication documentation](https://code.claude.com/docs/en/authentication).

If the earlier failed launch leaves a Keychain-not-found/create/reset dialog,
choose **Cancel**, exit that Claude process, and retry the command above with
this fix. Do not create, replace or reset the account Keychain for the demo.

Subscription mode uses `--restricted`, empty built-in tools, strict demo-only
MCP configuration, explicit settings and disabled hooks/skills/Chrome. It also
disables account MCP connectors, IDE auto-connect, automatic memory, CLAUDE.md
loading, official marketplace auto-installation, auto-updates and nonessential
traffic through documented environment controls. It supplies no API key or
ambient OAuth token. See the [CLI reference](https://code.claude.com/docs/en/cli-reference)
and [environment reference](https://code.claude.com/docs/en/env-vars).
Offline preflight parses the complete launch arguments using `auth status`
with disposable fresh config/profile/temp/workspace directories and the same
macOS account-HOME behavior. It requires an unauthenticated first-party result
naming that exact fresh configuration directory. This proves argument parsing
and the isolated auth probe, not interactive login or model readiness. The
opt-in macOS regression also reads the default Keychain path without querying
stored passwords or changing Keychains.

For two Codex sessions, explicitly log in to each demo-only configuration root
first. Run these from outside the repository; the login commands use file auth
and do not read the normal CODEX_HOME. Replace the paths only if you chose a
different prepared root. Resolve your own Codex executable with `command -v codex`
if it is not installed at the illustrated path:

```sh
cd /private/tmp/context-router-demo/codex-a-workspace
env -i PATH=/usr/bin:/bin HOME=/private/tmp/context-router-demo/codex-a-home CODEX_HOME=/private/tmp/context-router-demo/codex-a-config /opt/homebrew/bin/codex -c 'cli_auth_credentials_store="file"' login
cd /private/tmp/context-router-demo/codex-workspace
env -i PATH=/usr/bin:/bin HOME=/private/tmp/context-router-demo/codex-home CODEX_HOME=/private/tmp/context-router-demo/codex-config /opt/homebrew/bin/codex -c 'cli_auth_credentials_store="file"' login
```

Then, from the repository root in two terminals:

```sh
node examples/demo-10-2026/demo.mjs codex --root /private/tmp/context-router-demo --agent a
node examples/demo-10-2026/demo.mjs codex --root /private/tmp/context-router-demo --agent b
```

If an existing Codex A session refused a write because approval policy was
`never`, exit and restart **only A** with the `--agent a` command above; leave B
and the local server running. A is now configured with `on-request`, human
review, and a prompt for each `mutatePreferences` call. Confirm only the intended
existing-value change after reviewing its exact arguments. This client approval
does not grant DEFINE permission. B retains `never` and no mutation-tool exposure.
The installed CLI accepts these settings; the live confirmation flow still
needs the user walkthrough. See the [MCP tool controls](https://learn.chatgpt.com/docs/extend/mcp).

The legacy `claude --root /private/tmp/context-router-demo` defaults to A and
`--auth api-key`; `--agent b` can select B. This mode's
`--bare` isolation **does not use subscription OAuth/keychain login**. It requires
an API key explicitly supplied as `CR_DEMO_ANTHROPIC_API_KEY` in the launcher's
environment; it passes that only to Claude as `ANTHROPIC_API_KEY`. Do not type
secrets into shell history or prompts. No Claude API key is needed for two Codex
sessions. Login, model availability, live tool discovery and assistant behavior
must still be checked in the user walkthrough.

Claude disables built-in tools, skills, hooks and Chrome integration and uses
only the explicit MCP configuration. Codex disables shell, image/file attachment,
browser/computer, apps/plugins, hooks, skills, and delegated-agent exposure,
uses a read-only sandbox, and permits only the demo MCP tools. These are
configuration controls, **not OS isolation or a whole-machine egress claim**.
The [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
defines `shell_tool` as command-execution exposure. It also documents that
`unified_exec` user opt-outs are ignored; that transport-choice flag can remain
true while shell exposure is false. Preflight verifies the latter and other
supported gates. Managed installation policies may still affect a client; a
failed preflight needs investigation, not a fallback to personal configuration.

## Later Claude Desktop agent C

The example's [Desktop adapter](desktop-bridge.mjs) is prepared for a later
separate Desktop instance. It reuses the existing production credential reader
and stdio/HTTP bridge without changing their protocol, recovery or no-replay
behavior. The production CLI remains fixed to the installed-app endpoint;
this adapter accepts a validated loopback `--mcp-port`, defaulting to 8788:

```sh
node examples/demo-10-2026/desktop-bridge.mjs --credential-file /absolute/private/agent-c.token --mcp-port 8788
```

Desktop C must receive its **own separately provisioned credential**, not A's or
B's. Its provisioning, Desktop configuration entry and normal user restart are
later setup steps; this change does not activate Desktop or modify its existing
configuration. Claude Desktop uses the user's subscription, not the CLI API-key
mode. Node must be exactly 24.21.0, with Node options/debug variables absent.
The adapter reads only the private credential file and uses sanitized diagnostics.

For a durable snapshot, preserve repository-relative paths for this adapter and
the three existing files under `apps/backend/scripts/mcp-bridge/`:
`cli.mjs`, `bridge.mjs`, and `credential.mjs`. Record their source commit/hashes
in a private receipt, and point Desktop at the snapshotted adapter using an
absolute pinned Node path. Only the bridge and credential modules are imported
by the adapter; the production CLI is retained unchanged with the snapshot.
Moving this demo into the installed Context Router app, including its approved
data reset, remains a separate later operation.

## Five-minute rehearsal

1. Ask A and B: “Use fresh category-prefix MCP reads for `family.demo001.`,
   `home.demo001.` and `leisure.demo001.`. Suggest a Sunday family plan using this
   historical context. Identify the saved family-dinner sentence and its slug.”
2. Ask A: “Read that exact slug again. Preserve the complete sentence and append
   ` Rehearsal change: dinner starts at 6 PM.` with SET_PREFERENCE. Make this one
   explicit change only.” Review and explicitly confirm that single write in
   Codex A. If the response is uncertain, inspect history before any separate
   retry. Use family/home for this shared-update exercise: B deliberately cannot
   read health or finance.
3. Ask B: “Freshly read that exact slug through MCP and quote its saved value.”
   Refresh the dashboard Preferences page normally; inspect **Modified by**.
4. Open **Audit History**, show sensitive values and expand the latest event.
   Inspect its before/after, A's actual `local:<id>`, MCP origin and correlation
   ID. Open **MCP Access** for the read/write events. **MCP Clients** shows the
   independent policies and actual IDs.
5. Ask B to read `health.demo001.` and `finance.demo001.`. These return no active
   records under B's policy. For a live denied mutation, ask A to create a new
   definition such as `home.demo001.denial_probe`: A lacks DEFINE. B does not
   discover the mutation tool; the direct SDK test proves its denied write.

A can READ/WRITE all 189 active values and cannot DEFINE. B can READ 145 values,
excluding health and finance, and cannot WRITE/DEFINE. Restricted reads are
filtered, so empty results do not establish that no such source records exist.
Category-prefix reads avoid the response cap (largest category: 31). MCP search
matches schema metadata, not full value text. No local inference tools run.

## Import contract and reusable pieces

- `records.mjs`: pure `parseJsonl`/`mapRecord`, bounded file loading, summaries and
  hashes. `loadDemoPlan(input, dataset)` accepts a validated dataset segment;
  the CLI defaults to `demo001` and accepts `--dataset` and `--input` for inspect
  or fresh preparation.
- `mcp-import.mjs`: SDK connection and sequential definition/value mutations.
  Any rejected, ambiguous or lost response stops import without automatic replay.
- `runtime.mjs`: fresh private state, existing administration, source/build
  receipts, verification and the existing UI launcher.
- `clients.mjs`: separate role credentials, launch argv/environment and offline
  version/control preflight. `demo.mjs` is only CLI dispatch.
- `desktop-bridge.mjs`: example-only port selection around the existing bridge.

The 11 JSONL files contain 198 records: 189 active values and nine inactive
records preserved in `import-plan.json` without becoming active preferences.
Original bytes stay unchanged. Identity is
`<category>.<dataset>.memory_<UUID without hyphens>`; original sentences become
STRING values. Definitions are user-owned and sensitive. GLOBAL means independent
of location, not public. Schema descriptions contain no memory sentence.

Evidence retains the complete source record, filename, line and SHA-256, including
qualitative confidence and source version. Numeric native confidence stays null;
no missing source versions are reconstructed. Existing MCP SET stores native
`sourceType: INFERRED`; the source declaration/import evidence is distinct.
An ordinary later SET without evidence clears the live row's evidence. The
original remains in the import audit and update before-state. Ordinary MCP reads
omit evidence. Use owner history readers/dashboard to inspect it.

The completion manifest records dataset/source hashes, exact build hashes,
revision/dirty state, principal and actual client IDs, not credential bytes.
These are local receipts, not signed attestations. `verify` uses non-listening
application readers, verifies structure/authority/retained import audit and
reports modified values/evidence separately. Client authority must match the
prepared maximum policies and empty database-grant baseline. A later dashboard
grant edit is an explicit client-authority mismatch, not a memory-corruption
claim; removing the added grant restores that baseline. Missing rows, extra rows,
altered ownership/schema or lost history fail verification. Verification is
intended with the server stopped; it is not a concurrent snapshot protocol.

Mutation audit is atomic with the mutation. MCP access append is best-effort;
tests verify actual persisted events. Discovery and pre-dispatch authentication
failures are not claimed as logged. B's dispatch-denial response has no typed
code; tests assert its exact authorization envelope plus persisted typed `DENY`.
A's denied DEFINE returns `MCP_PERMISSION_DENIED`.

## Local validation

```sh
node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs
node scripts/check-markdown-links.mjs
# Optional installed-binary regression; requires Codex CLI 0.160.0:
CR_DEMO_TEST_CODEX=1 node --test examples/demo-10-2026/clients.test.mjs
# Both installed clients; also requires Claude Code 2.1.299, no login needed:
CR_DEMO_TEST_CODEX=1 CR_DEMO_TEST_CLAUDE=1 node --test examples/demo-10-2026/clients.test.mjs
```

The browser test requires the repository's pinned Playwright 1.63.0 / Chromium
153.0.8010.12 revision 1243 prerequisite. Tests create and reap only their own
processes/state and use temporary ports. Browser requests are restricted to the
owned origin without response injection. They prove real dashboard reads,
refresh after A's change, identities/policies and history. Stub tests inspect
actual argv/env/cwd and offline installed preflight does not invoke models.

On 2026-10-13, both fresh implementation reviewers approved the final correction,
and the coordinator independently ran the frozen suite: **21 passed, zero failed,
zero skipped**. The original 11 JSONL files and existing personal Codex/Claude
configuration snapshots remained byte-identical. Documentation links and
whitespace checks passed. See the [reviewed plan](PLAN.md) for exact scope and
evidence.

The live walkthrough subsequently exposed an unsupported strict-config alias,
`tools.view_image`, which the old non-strict readers had ignored. The launcher
now uses the supported `features.view_image=false` gate and checks the complete
strict launch argv in disposable authentication-free directories. Codex 0.160.0
must reach its exact nonterminal-stdin refusal; unknown options are rejected
before any assistant session. The explicit installed-binary regression checks
both roles and an injected unknown-key negative control. The prior 21-test run
did not cover this strict startup boundary.

The Claude Pro/role-B addition passed all nine client tests with both installed
CLI regressions enabled, including requalification after Claude updated to
2.1.299. The affected CLI/mapping tests passed (ten tests),
and the Desktop adapter passed three focused tests using real SDK stdio,
an owned MCP server, permission filtering/denial, startup guards and shutdown.
The Desktop fixture uses B's existing read policy; it does not provision live C.
The unchanged production bridge retains responsibility for no-replay behavior.

Targeted checks passed; final validation pending. Remaining checks are live
demo-only authentication, tool discovery, actual assistant behavior and the
user walkthrough. Later CI and PR/merge acceptance are also pending. The existing
migration/contract/CI gates remain unchanged.
