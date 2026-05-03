# MCP Client Setup

- Status: useful
- Read when: connecting Codex, Claude, or another MCP client to local or remote MCP
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/config/mcp.config.ts`, `apps/backend/src/mcp/auth/mcp-client-registry.service.ts`
- Last reviewed: 2026-05-03

## Copy/Paste Summary

Use these commands to add the backend as an MCP server. The server name convention is:

- `context-router-local`: local backend at `http://localhost:3000/mcp`
- `context-router-remote`: Cloud Run backend at `https://context-router-tvvjziqt3a-uc.a.run.app/mcp`

## Claude Code

Claude Code does not have a separate `mcp login` command. Add the server with the OAuth callback port, then use it in Claude; Claude will start the browser/Auth0 flow when needed.

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

Plain `codex mcp login` works for the current setup. If a future Auth0/client config starts returning narrower tokens and tools fail with authorization errors, log out and request scopes explicitly:

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
