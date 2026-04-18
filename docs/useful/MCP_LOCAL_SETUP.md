# MCP Local Setup

- Status: useful
- Read when: connecting Codex, Claude, or another MCP client to a local backend
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/config/mcp.config.ts`, `apps/backend/src/mcp/auth/mcp-client-registry.service.ts`
- Last reviewed: 2026-04-18

## Assumptions

- Backend is running locally at `http://localhost:3000`.
- Exact Auth0 application IDs and other environment-specific values are intentionally omitted from this repo doc.

## Client Buckets

The backend maps clients into internal buckets. Today the important local callbacks are:

- Claude local callback port: `8081`
- Codex local callback port: `8082`
- OpenAI/ChatGPT use remote callbacks and usually need a tunnel for local development

The DCR shim and client registry map callback URLs to these buckets. Read the source files above if you need the exact logic.

## Claude Code

```bash
claude mcp add context-router --transport http --callback-port 8081 http://localhost:3000/mcp
```

## Claude Desktop

Add a local MCP entry to your Claude Desktop config:

```json
{
  "mcpServers": {
    "context-router": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Codex

Add these root-level settings to `~/.codex/config.toml`:

```toml
mcp_oauth_callback_port = 8082
mcp_oauth_callback_url = "http://127.0.0.1:8082/callback"

[mcp_servers.context_router_local]
url = "http://localhost:3000/mcp"
```

Then log in:

```bash
codex mcp login context_router_local
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
