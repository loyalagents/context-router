# Connecting MCP Clients (Local Dev)

Backend must be running at `http://localhost:3000`.

## Auth0 Allowed Callback URLs

Make sure these are in your Auth0 application (`R32nJTzigHeOStYW49Xrt4LQXY9gzxE0`) → Allowed Callback URLs:

```
http://localhost:8081/callback, http://127.0.0.1:8082/callback, https://chatgpt.com/connector_platform_oauth_redirect, https://platform.openai.com/apps-manage/oauth, https://claude.ai/api/mcp/auth_callback, https://claude.com/api/mcp/auth_callback
```

## 1. Claude Code (CLI)

```bash
claude mcp add context-router --transport http --callback-port 8081 http://localhost:3000/mcp
```

Uses port `8081` for the OAuth callback — must match Auth0's allowed callback URLs.

## 2. Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-router": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## 3. Codex

Edit `~/.codex/config.toml` and add these root-level keys before any TOML tables:

```toml
mcp_oauth_callback_port = 8082
mcp_oauth_callback_url = "http://127.0.0.1:8082/callback"
```

Then add the local MCP server entry:

```toml
[mcp_servers.context_router_local]
url = "http://localhost:3000/mcp"
```

Log in with:

```bash
codex mcp login context_router_local
```

Codex uses the fixed local callback `http://127.0.0.1:8082/callback` for OAuth, so that exact URL must be in Auth0's allowed callback list.

## 4. ChatGPT

ChatGPT cannot reach localhost. Use a tunnel:

```bash
ngrok http 3000
```

Then add the ngrok URL in ChatGPT's MCP settings. You'll also need to update `MCP_SERVER_URL` in your backend `.env` to the tunnel URL and restart.
