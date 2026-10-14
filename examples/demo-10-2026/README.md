# Three agents, one portable memory

This example imports a historical snapshot into a private local Context Router
instance. Codex A can update and create memories; Claude Code B and Claude
Desktop C have separate read credentials. Different vendors are optional: two
isolated Codex sessions can also demonstrate shared memory and permissions.
The existing dashboard shows the data, client authority and persisted history.
No product code or installed Context Router state changes are required.

All demo data, credentials, receipts and assistant transcripts are private.
Cloud assistants may send retrieved context to their providers. Do not publish
the demo home or paste credentials into prompts. The supplied context describes
2024–2025; it is not a claim about anyone's current circumstances.

## First time on macOS

Use a source checkout containing this example, Node **24.21.0**, pnpm
**10.25.0**, and the qualified clients: **Codex CLI 0.160.0** and optionally
**Claude Code 2.1.299** / Claude Desktop with a subscription. Client launchers
reject unsupported CLI versions. Install dependencies and build the existing
no-model local dashboard, following the [local UI runbook](../../docs/useful/LOCAL_UI.md):

```sh
pnpm install --frozen-lockfile
pnpm --filter backend prisma:generate
pnpm --filter backend build
pnpm --filter web build
node examples/demo-10-2026/demo.mjs inspect
node examples/demo-10-2026/demo.mjs prepare
node examples/demo-10-2026/demo.mjs verify
node examples/demo-10-2026/demo.mjs serve
```

Commands run from the repository root. This local mode needs no hosted database,
Docker, Auth0 or local model. Existing matching builds can be reused.

The default home is `~/Library/Application Support/Context Router Demo`.
Preparation creates a generation under `generations/<id>`, stable login folders
under `profiles/`, and a private selection receipt. Initial ports are dashboard
**3004** and MCP **8789**. Use a canonical absolute `--home` to choose another
private durable location; repeat that option on every command. First preparation
also accepts `--input`, `--dataset`, `--port` and `--mcp-port`. The selected
generation records these choices; later commands use its recorded ports.

Open the dashboard origin printed by `serve`. Paste the contents of its printed
private unlock file into **Unlock token**. Enter `unlock` in the server terminal
for a new token. Occupied ports fail without stopping their owners. Use **Ctrl-C**
and wait for exit to stop this server; closing the browser does not stop it.
Run strict `verify` with the server stopped.

In another terminal, log in to Codex A's dedicated profile, then launch A:

```sh
node examples/demo-10-2026/demo.mjs codex --agent a --login
node examples/demo-10-2026/demo.mjs codex --agent a
```

The login helper uses the same empty demo workspace and isolated configuration,
with file authentication and no MCP token. It does not copy personal login state.
For B, choose Claude Pro and complete its fresh **Claude.ai subscription** login:

```sh
node examples/demo-10-2026/demo.mjs claude --agent b --auth subscription
```

Do not choose Console/API billing during Claude onboarding. The login setting
preselects Claude.ai but still permits another terminal choice. Alternatively,
use `codex --agent b --login`, then `codex --agent b`.

## Next day, or another rehearsal

```sh
node examples/demo-10-2026/demo.mjs prepare
node examples/demo-10-2026/demo.mjs status
node examples/demo-10-2026/demo.mjs serve
```

`prepare` reuses the selected generation without importing again or resetting
values, history, permissions or login. It rejects explicitly conflicting input,
dataset or ports. Relaunch the assistants in separate terminals as above; login
is needed only if their dedicated session has expired. Each command resolves
the generation, endpoint and credential once. A running assistant remains bound
to that generation even if another generation is later selected.

For a fresh copy of the original dataset, stop your demo clients and server,
then run:

```sh
node examples/demo-10-2026/demo.mjs prepare --fresh
node examples/demo-10-2026/demo.mjs verify
node examples/demo-10-2026/demo.mjs serve
```

This creates new data, identity and A/B/C credentials and preserves all previous
generations. Omitted input, dataset and ports inherit the selected generation;
explicit overrides win. Stable per-vendor/role login folders survive. Support
**one active process per vendor/role profile**: there is no profile lease or
automatic conversation resume. Start a new conversation after switching
copies; an old transcript can contain context from the previous copy. Desktop
requires its separate explicit switch below.

`status` describes the selected paths, ports, memory counts and actual client
policies/grants. It does not prove the server is running or the original baseline
is intact. `verify` checks that strict versioned baseline. Normal audited new
memories or permission changes can intentionally make strict verification fail;
that does not mean their data is corrupt. Inspect status and history instead of
resetting state to obtain a passing baseline.

## Connect Claude Desktop C

Desktop C has its own credential in each durable generation. Keep the checkout
at reviewed committed bridge sources, then prepare a private proposal:

```sh
node examples/demo-10-2026/demo.mjs desktop-prepare
```

This snapshots the [example adapter](desktop-bridge.mjs) and three unchanged
production bridge modules, recording their commit and hashes and the absolute
pinned Node path/hash. It produces a private `proposal.json`; it does not edit
Desktop configuration. The proposed entry refers to that exact generation's
C token and port, never to a mutable current-generation link. Persistent
references under temporary directories are rejected. Keep the pinned Node
installation available at its recorded path.

Review the proposal locally: it includes the existing configuration, which may
contain secrets. Close Claude Desktop normally and close config editors before
applying the exact printed proposal path:

```sh
node examples/demo-10-2026/demo.mjs desktop-apply --proposal /absolute/durable/path/proposal.json --desktop-closed
```

`--desktop-closed` explicitly attests that Desktop and config editors are closed.
The helper requires trusted paths and private files, refuses foreign/edited
entry collisions or changed configuration, and preserves unrelated entries.
An existing config must already be private (`0600`); inspect before deliberately
correcting permissions. `desktop-prepare --config /absolute/config.json` supports
an explicit alternative config whose parent already exists.

Apply rewrites JSON with two-space indentation, preserving unrelated entries'
parsed values rather than their original formatting. Duplicate keys and numeric
formatting may be normalized; the private backup preserves the exact old bytes.
Apply saves that backup, fsyncs a sibling file, rechecks original
bytes, atomically replaces the config and verifies readback. This is guarded
replacement, not compare-and-swap against arbitrary concurrent writers. Start
Desktop normally afterward and inspect its MCP connection. A new generation
requires another prepare/review/apply/restart; it never silently redirects C.
An older proposal still targets its recorded generation even after `--fresh`;
check its generation and prepare a new proposal when switching to the new copy.
Provider-backed Desktop conversation acceptance remains a human check.
Moving the demo into the installed Context Router app, including any approved
reset there, is a separate later operation.

## Five-minute rehearsal and permissions

1. Ask A and B: “Use fresh category-prefix MCP reads for `family.demo001.`,
   `home.demo001.` and `leisure.demo001.`. Suggest a Sunday family plan using this
   historical context. Identify the saved family-dinner sentence and its slug.”
2. Ask A: “Read that exact slug again. Preserve the complete sentence and append
   ` Rehearsal change: dinner starts at 6 PM.` with SET_PREFERENCE. Make this one
   explicit change only.” Review and confirm that call in Codex A. After an
   uncertain response, inspect history before deciding on any separate retry.
3. Ask B, and later C: “Freshly read that exact slug through MCP and quote its
   saved value.” Refresh dashboard Preferences and inspect **Modified by**.
4. Open **Audit History**, show sensitive values and expand the event. Inspect
   before/after, A's actual `local:<id>`, MCP origin and correlation ID. Open
   **MCP Access** for reads/writes and **MCP Clients** for actual authority.
5. Ask B/C to read `health.demo001.` and `finance.demo001.`: these categories are
   filtered. Ask A to create a STRING definition `home.demo001.weekend_note`,
   then set an explicitly supplied value. Confirm each intended mutation.
   A fresh read by B/C demonstrates that definitions and values share the store.

For the default snapshot, A can READ/WRITE all 189 active values and DEFINE
within its dataset category prefixes. B and C can each READ 145 values excluding
health and finance; each also has an explicit `health.*` READ DENY. They cannot
WRITE/DEFINE and do not discover the mutation tool. Direct SDK tests prove a
write denial and persisted typed access event. Empty filtered results do not
establish that no records exist. Category-prefix reads avoid the response cap
(largest category: 31); search matches schema metadata, not full value text.

Use the existing dashboard **MCP Clients** grant controls and
[MCP administration](../../docs/useful/MCP_LOCAL_SETUP.md) for deliberate changes.
Grants can narrow a client's maximum; ALLOW cannot expand it. Revocation affects
only the selected instance. Strict verification reports authority mismatches
against the prepared baseline. Do not delete history to rehearse permissions.

## Client isolation and compatibility

Profiles, temporary files and empty workspaces are dedicated to the demo.
Personal authentication, hooks, plugins and connectors are not copied. Codex
and bare Claude use a separate HOME. On macOS, subscription Claude uses the
OS account HOME to discover the existing Keychain, while `CLAUDE_CONFIG_DIR`,
`ANTHROPIC_CONFIG_DIR`, temporary files and workspace stay in demo folders.
The separate configuration has its own Keychain login entry. If an earlier
launch shows a Keychain create/reset warning, choose **Cancel**, exit that
process and retry; do not reset the account Keychain. See
[Claude authentication](https://code.claude.com/docs/en/authentication) and the
[profile directory reference](https://platform.claude.com/docs/en/manage-claude/wif-reference#configuration-directory).

Claude subscription mode uses `--restricted`, empty native tools, strict
explicit MCP configuration, disabled hooks/skills/Chrome, and environment
controls disabling account MCP, IDE connection, auto-memory, CLAUDE.md loading,
marketplace auto-installation, updates and nonessential traffic. See the
[CLI](https://code.claude.com/docs/en/cli-reference) and
[environment](https://code.claude.com/docs/en/env-vars) references. Legacy
`claude --auth api-key` defaults to A and uses `--bare`; it requires an explicitly
supplied `CR_DEMO_ANTHROPIC_API_KEY` and does not use subscription OAuth. Keep
secrets out of shell history and prompts.

Codex disables native shell, image/file, browser/computer, apps/plugins, hooks,
skills and delegated-agent tools and uses a read-only sandbox. A uses
`on-request`, the human reviewer and a prompt for every `mutatePreferences`
call; B keeps `never` and no mutation-tool exposure. The
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents that `unified_exec` opt-outs are ignored; preflight requires
`shell_tool=false` and the other actual exposure gates. These are configuration
controls, not OS isolation or an egress guarantee. Managed policies may affect
clients; a failed preflight needs investigation, not personal-config fallback.

Existing low-level `prepare --out /new/private/root` and commands with
`--root /existing/root` retain the v1 contract and defaults **3003/8788**. They
never reuse an output directory. V1 A has WRITE but no DEFINE, B has READ without
prepared database grants, and no C is issued. Their profile paths remain inside
the root. Durable defaults do not upgrade or alter these earlier instances.
Legacy Claude A and B share the `claude-*` profile directories: use only one
Claude role per legacy root. Use durable mode for separate A/B Claude profiles.

## Data, recovery and reusable pieces

The 11 original JSONL files contain 198 records: 189 active values and nine
inactive records retained in `import-plan.json`. Original bytes stay unchanged.
Identity is `<category>.<dataset>.memory_<UUID without hyphens>` and sentences
become sensitive user-owned STRING definitions/values. GLOBAL means location
independent, not public. Full source records, filename, line and SHA-256 remain
in import evidence, including qualitative confidence/source version; no missing
version is reconstructed and native numeric confidence stays null.

MCP SET stores native `sourceType: INFERRED`. Later SET without evidence clears
the live row's evidence; the original remains in import audit and update
before-state. Ordinary MCP reads omit evidence. Preparation records build and
toolchain identity. Strict verification checks the retained import-plan hash
and source-summary consistency, original membership/schema/ownership, retained
import audits, revoked importer and versioned A/B/C authority, and reports
modified values/evidence separately. Mutation audit is atomic; access append is
best-effort, with actual persisted events tested. No automatic write replay is
introduced.

Home mutations are serialized with `writer.lock`. Preparation fsyncs complete
generation state before publishing selection. Source/build/tool checks and
validation of existing profile permissions happen before the first layout or
generation write. A failure at that point releases the owned lock, reports the
prerequisite and leaves any selected generation usable. The pnpm check discovers
the installed command on your shell's PATH, then runs it with a clean environment.

During import, **Ctrl-C** or **SIGTERM** lets the current MCP request settle,
then stops without replay, attempts importer revocation and records `failed.json`.
Wait for the process to exit. This is graceful cleanup, not a guarantee after
SIGKILL, power loss or cleanup failure. An interrupted import/publication
or Desktop replacement retains partial state, lock and recovery artifacts.
**Do not delete an unknown lock, rerun uncertain writes, or automatically restore
a backup.** Stop for read-only inspection: identify the writer, inspect selected
and partial receipts plus database/history, and establish whether publication
completed. `status` permits a locked home's existing selection but cannot report
an incomplete first preparation. Recovery requires an explicit decision after
inspection; there is no automatic stale-lock cleanup or destructive reset.
Signals before the runtime's state-creation phase or after manifest preparation
also retain inspection-based recovery; the graceful handler covers import cleanup.

- [records.mjs](records.mjs): pure mapping and bounded source loading/hashes.
- [mcp-import.mjs](mcp-import.mjs): sequential SDK import with no replay.
- [runtime.mjs](runtime.mjs): existing services, versioned baselines and status.
- [home.mjs](home.mjs): durable generations, stable profiles and selection.
- [clients.mjs](clients.mjs): scoped login/launch and offline preflight.
- [desktop-setup.mjs](desktop-setup.mjs): private snapshot/proposal/guarded apply;
  [desktop-bridge.mjs](desktop-bridge.mjs) reuses the production bridge protocol.
- [demo.mjs](demo.mjs): CLI dispatch; no generic policy-management wrapper.

## Validation and acceptance

```sh
node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs
node scripts/check-markdown-links.mjs
# Optional installed CLI probes; no login or model call:
CR_DEMO_TEST_CODEX=1 CR_DEMO_TEST_CLAUDE=1 node --test examples/demo-10-2026/clients.test.mjs
```

The browser fixture requires pinned Playwright **1.63.0**, Chromium
**153.0.8010.12**, revision **1243**. Tests use their own state/processes/ports.
Installed CLI probes are explicit opt-ins. Codex's exact strict argv must reach
its nonterminal-stdin refusal; an unknown-key negative control must fail parsing.
Claude's complete argv runs only `auth status` in fresh auth-free folders and
must identify those folders. Neither probe proves interactive model readiness.
Desktop tests use real SDK stdio and an owned C credential; production no-replay
behavior remains in the unchanged bridge.

The earlier live Codex A / Claude Code B rehearsal demonstrated shared updates
and separately changed permissions. That evidence belongs to its retained v1
instance. New durable preparation, stable-profile login and Desktop switching
need their own human acceptance after local checks and independent reviews.
See the [plan and evidence](PLAN.md) for checkpoint results and review status.
Later CI, PR and merge acceptance remain pending; existing migration/contract/CI
gates are unchanged.
The current GitHub workflows do **not** run this example's test suite; a green
PR does not replace the local command above. Record that command's result for
each candidate. Installed CLI probes and live provider acceptance are separate
from CI coverage.
