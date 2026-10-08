# MCP Client Setup

For the Step 09 unsigned installed Mac candidate, use the [installed runbook](INSTALLED_MAC_APP.md). Its menu app uses the same loopback port 8787; run its bundled native CLI after Quit. The source commands below do not administer managed installation roots.

- Status: useful
- Read when: connecting Codex, Claude, or another MCP client to local or remote MCP
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/config/mcp.config.ts`, `apps/backend/src/mcp/auth/mcp-client-registry.service.ts`
- Last reviewed: 2026-10-03

Step 07 adds `local-mcp`, one manually started SQLite backend for Claude Code and Codex CLI on the same Mac. It exposes only direct Streamable HTTP at `http://127.0.0.1:8787/mcp` by default. There is no stdio bridge, browser UI, GraphQL listener, OAuth/DCR endpoint, public tunnel or LAN mode in this composition. The hosted composition remains separately supported below.

The [Step 07 acceptance checklist](../plans/active/local-migration/07-local-mcp/acceptance.md) gives isolated synthetic setup, both client launches, expected results, restart/revocation, model readiness and cleanup. User-run acceptance is recorded for `d7e9d65` in [PR #166](https://github.com/loyalagents/context-router/pull/166), including its inconclusive live cancellation outcome. Steps 07 and 08 are merged; the [Step 08 acceptance disposition](../plans/active/local-migration/08-local-ui/acceptance.md) preserves its accepted evidence limits. Step 09 requires fresh installed-application evidence.

## Local SQLite Administration

Use Node 24.21.0, pnpm 10.25.0 and the built backend. Select existing canonical private `LOCAL_DATABASE_ROOT` and `LOCAL_IDENTITY_STATE_ROOT` as described in [identity administration](LOCAL_IDENTITY_ADMIN.md). Initialize only fresh state. Existing v1 data and identity must be preserved.

Before upgrade, stop and reap all applications/administrators using these roots and make a matching-pair backup into a new private destination:

```sh
pnpm --filter backend local-mcp backup --out /absolute/private-parent/pre-mcp-backup
pnpm --filter backend local-mcp upgrade
```

Upgrade explicitly and transactionally adds the MCP credential table and advances SQLite schema v1 to v2. It is repeatable, retains identity/catalog/preferences/history, rejects unknown schemas, and never downgrades. Updated ordinary previews accept v1/v2; MCP requires v2. Old v1-only binaries reject v2. To roll back, stop/reap current processes and restore a pre-upgrade matching pair to new roots with compatible code; do not alter `user_version` or remove tables manually.

Provision one credential for **each configuration/instance**, even for two Codex instances. Token export destinations must be new absolute paths under an existing `0700` directory outside both strict application roots. Exports are exclusive `0600` files, fsynced before database authority commits; only a SHA-256 digest is stored in SQLite. Commands print summaries, never tokens.

```sh
pnpm --filter backend local-mcp provision --label claude-code --out /absolute/private-parent/claude.token
pnpm --filter backend local-mcp provision --label codex-cli --out /absolute/private-parent/codex.token
pnpm --filter backend local-mcp list
pnpm --filter backend local-mcp permissions --id CLIENT_ID --capabilities preferences:read --targets 'synthetic.*'
pnpm --filter backend local-mcp grant --id CLIENT_ID --target synthetic.private --action READ --effect DENY
pnpm --filter backend local-mcp rotate --id CLIENT_ID --out /absolute/private-parent/new.token
pnpm --filter backend local-mcp revoke --id CLIENT_ID
```

Defaults are READ, **no allowed targets**, and no sensitive access. `permissions` replaces the entire static policy; `--allow-sensitive` explicitly enables sensitive access, omission disables it. Empty `--capabilities ''` or `--targets ''` denies that dimension. WRITE implies read/suggest; DEFINE is independent. Grant actions are READ/SUGGEST/WRITE/DEFINE and effects ALLOW/DENY/REMOVE. Database ALLOW cannot enlarge the static policy; existing grant fallback/deny layering remains. The production local guard rereads credential/policy for every request. Product labels, submitted principal/client fields and session IDs confer no authority. Sensitive stored values are checked against their actual definition IDs, including archived definitions; ambiguous sensitive/nonsensitive slug collisions are conservatively hidden.

Rotation retains the client ID, grants and policy but invalidates old tokens and sessions. Revocation is durable, terminal and independent; provision a new instance to replace one. Concurrent changes use expected generations and fail instead of retrying or reviving revoked authority. An interrupted or losing export can leave a private inert token file. Preserve exports until the result is understood; list durable state and use a new export path for the next rotation. A committed but unacknowledged token can be active. Never infer success from a file alone.

Administrative backup/restore are thin wrappers over the existing matching-pair mechanism. Stop/reap every user of the roots before either command:

```sh
pnpm --filter backend local-mcp backup --out /absolute/private-parent/new-backup
pnpm --filter backend local-mcp restore --from /absolute/private-parent/new-backup --out /absolute/private-parent/new-restored-root
```

Restore selects new `data` and `identity` children. It restores credential digests, policies, grants and revocations as of the snapshot. An older backup can revive old MCP/human credentials; rotate/revoke before reconnecting. Token delivery files are separate private artifacts and are not inside the bundle. Preserve user state and follow [identity recovery](LOCAL_IDENTITY_ADMIN.md), rather than deleting roots to recover from ambiguity.

## Local Listener And Model

```sh
pnpm --filter backend local-mcp serve --port 8787
# After the manual model prerequisites and health=200 check:
pnpm --filter backend local-mcp serve-model --port 8787
```

The fixed ready record means the application/listener started, not that inference is ready. `serve` ignores model selection. `serve-model` uses the existing [manual model contract](LOCAL_MODEL.md); malformed/missing selection yields honest unavailable AI while non-AI tools remain usable. Human identity, MCP instance tokens and inference keys remain separate. Only MCP tokens may be loaded into the dedicated client environment variable; never substitute human/inference credentials. Avoid shell tracing, printing tokens or putting token bytes in argv/config/Git.

Only literal `127.0.0.1` Host with the bound port is accepted; Origin-bearing requests are denied, including same-origin browser requests. HTTP headers/body/request IDs and session/request counts are bounded. Local protocols are **2025-06-18 and 2025-11-25**, using pinned SDK **1.27.1**. Unsupported initialize versions negotiate 2025-11-25; subsequent headers must match. No batching, resumable GET stream or server-initiated requests are advertised. Existing six tool descriptors and `schema://graphql` remain; `context-router://capabilities` adds bounded local readiness. The SDL resource is a compatibility type description, not a local GraphQL endpoint.

Cancellation notifications route within a live authenticated session using exact typed IDs. They return 202; the original POST ends with 200 and empty event-stream content. Handler ownership remains until terminal output, and native model settlement may continue independently. Disconnect alone does not cancel under these pinned protocols. DELETE cancels only its live authenticated session. Neither disconnect nor DELETE stops the shared backend or implies a committed mutation rolled back. Never retry an ambiguous mutation automatically.

The listener allows 64 sessions total and eight per credential, with 32 active requests total and eight per credential. A valid initialize at either session limit retires that credential's least-recently-used idle session when one exists, preserving active sessions and all other credentials. An initialize rejected by active-request capacity does not evict anything. If capacity cannot be reclaimed, it returns 429; let existing work settle before reconnecting. Idle sessions expire after 30 minutes. Use separate credentials for separate client instances so reconnects do not displace another instance's idle session.

A session retains up to 4096 typed request IDs, including initialization. A duplicate ID returns 400 while the session is live. A new ID beyond that bound retires the session and returns 404 without dispatching the request. Retired session IDs return 404, including for cancellation and DELETE. Already-admitted work may still finish and remains counted until terminal settlement. On 404, initialize a fresh session without the old session ID; reconnect through your client's normal controls if it does not do this automatically. Retirement never clears history for reuse of the old session ID and never authorizes replay of an uncertain mutation. Automated HTTP tests cover recovery; automatic recovery in Claude/Codex has not been newly observed.

Both AI tools share one model admission owner: one active operation, no queue. Workflow/operation/readiness/settlement bounds remain 180/120/5/5 seconds, with a ten-second process shutdown bound. Client tool timeouts should exceed 180 seconds. Busy/unavailable AI leaves ordinary tools running. Cancellation can trigger accepted H: unavailable until both old backend and inference processes exit and fresh model-session credentials are provisioned. Never remove claims or reuse consumed model credentials; keep database, identity and MCP credentials. Accepted E remains limited to the known personal-email omission in Step 06's adversarial extraction fixture.

Domain audit remains atomic with each mutation; access append is best effort. Local access metadata retains bounded operation/count/outcome/actor/correlation data, excluding queries, values, evidence and raw exceptions. No combined define-and-set, definition restore, cross-call rollback, new no-op shape or per-call/session permission narrowing was added. Separate successful calls can partially commit.

## Verified Client Surface

Initial help/version inspection and user setup reported Claude Code **2.1.284** and Codex CLI **0.142.3**; Codex **0.160.0** was installed by later closeout, with the per-call transition unknown. Automated compatibility uses SDK 1.27.1 against the production local guard/HTTP/SQLite path. PR #166 records the user-run functional checks against `d7e9d65`, including durable shared state, permissions, independent revocation and bounded model checks. A client interruption and a successful result were both displayed during the cancellation attempt; server/native cancellation remains unconfirmed. Both clients and the backend/model processes were subsequently stopped. Official references: [Claude MCP](https://code.claude.com/docs/en/mcp), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [2025-11-25 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

Cloud-backed CLI assistants may send tool results to their model providers. Use synthetic data. Those client tests do not prove the whole assistant is offline. The local application is separately tested under source/relocated-package policies that deny hosted providers/DNS/other endpoints and permit only its literal loopback listener and selected pinned synthetic TLS peer.

## Hosted Composition Copy/Paste Summary

Here, "local" means the retained hosted-baseline backend running on a
development machine. It does not mean either the SQLite `local-database-preview` or PostgreSQL
`local-identity-preview`: both have no listener, exclude `McpModule`, and never accept their human bearer
as an MCP credential.

Use these commands to add the backend as an MCP server. The server name convention is:

- `context-router-local`: local backend at `http://localhost:3000/mcp`
- `context-router-remote`: Cloud Run backend at `https://context-router-tvvjziqt3a-uc.a.run.app/mcp`

## Authentication Required

Adding the MCP server only registers the server URL with the client. You still need to authenticate before protected tools can work.

- Claude Code: there is no separate `mcp login` command. Add the server with `--callback-port 8081`, then use it in Claude; Claude should start the browser/Auth0 login flow when the server needs auth.
- Codex: run `codex mcp login <server-name>` after `codex mcp add <server-name>`.

## Claude Code

Claude Code does not have a separate `mcp login` command. Add the server with the OAuth callback port, then use it in Claude; Claude will start the browser/Auth0 flow when needed.

If Claude does not prompt automatically, run `/mcp` inside Claude Code, select the `context-router-local` or `context-router-remote` server, and choose the authenticate option.

### Claude Local

```bash
claude mcp add \
  --scope user \
  --transport http \
  --callback-port 8081 \
  context-router-local \
  http://localhost:3000/mcp
```

### Claude Remote

```bash
claude mcp add \
  --scope user \
  --transport http \
  --callback-port 8081 \
  context-router-remote \
  https://context-router-tvvjziqt3a-uc.a.run.app/mcp
```

### Claude Checks

```bash
claude mcp list
claude mcp get context-router-local
claude mcp get context-router-remote
```

If an entry already exists and you want to recreate it:

```bash
claude mcp remove context-router-local --scope user
claude mcp remove context-router-remote --scope user
```

If `claude mcp get <name>` says the entry is in local project scope, use `--scope local` for the matching remove command.

## Codex

Codex needs the OAuth callback settings in `~/.codex/config.toml` once:

```toml
mcp_oauth_callback_port = 8082
mcp_oauth_callback_url = "http://127.0.0.1:8082/callback"
```

### Codex Local

```bash
codex mcp add context-router-local \
  --url http://localhost:3000/mcp

codex mcp login context-router-local
```

### Codex Remote

```bash
codex mcp add context-router-remote \
  --url https://context-router-tvvjziqt3a-uc.a.run.app/mcp

codex mcp login context-router-remote
```

### Codex Checks

```bash
codex mcp list
codex mcp get context-router-local
codex mcp get context-router-remote
```

If an entry already exists and you want to recreate it:

```bash
codex mcp remove context-router-local
codex mcp remove context-router-remote
```

Hosted tokens must contain recognized scopes. Absent, empty or entirely unrecognized scopes now yield empty authority; they never restore configured maxima. For affected hosted clients, log out and request explicit scopes:

```bash
codex mcp logout context-router-remote

codex mcp login context-router-remote \
  --scopes preferences:read,preferences:suggest,preferences:write,preferences:define,offline_access
```

## Assumptions

- Local backend is running at `http://localhost:3000`.
- Remote backend is deployed at `https://context-router-tvvjziqt3a-uc.a.run.app`.
- Exact Auth0 application IDs and other environment-specific values are intentionally omitted from this repo doc.

## Client Buckets

The backend maps clients into internal buckets. Today the important local callbacks are:

- Claude local callback port: `8081`
- Codex local callback port: `8082`
- OpenAI/ChatGPT use remote callbacks and usually need a tunnel for local development

The DCR shim and client registry map callback URLs to these buckets. Read the source files above if you need the exact logic.

## Claude Desktop

Add MCP entries to your Claude Desktop config:

```json
{
  "mcpServers": {
    "context-router-local": {
      "url": "http://localhost:3000/mcp"
    },
    "context-router-remote": {
      "url": "https://context-router-tvvjziqt3a-uc.a.run.app/mcp"
    }
  }
}
```

## ChatGPT or Other Remote Clients

Remote clients cannot reach `localhost` directly. Expose the backend through a tunnel:

```bash
ngrok http 3000
```

Then update the local backend configuration that advertises the MCP server URL before retrying the OAuth flow.

## Notes

- MCP uses HTTP JSON-RPC. `POST /mcp` is the main transport.
- OAuth metadata and DCR shim behavior live in `apps/backend/src/mcp/auth/`.
- For current authorization behavior and tool inventory, read `docs/current/MCP_AUTHORIZATION.md`.

## Shared Dashboard Composition

[Local dashboard](LOCAL_UI.md) starts the same MCP edge alongside its independent
browser listener. Use that one process instead of a second `local-mcp serve`
instance. The browser can inspect actual client IDs, narrow grants and revoke;
provision, rotate and maximum-policy commands remain this CLI. Its browser bearer
never authenticates MCP, and MCP retains native Origin denial. Hosted setup above
is unchanged.
