# MCP Integration Guide

## Overview

The Context Router now exposes a **Model Context Protocol (MCP)** server that allows AI assistants to interact with user preferences programmatically. This enables AI applications to read, create, update, and delete user preferences through a standardized interface.

## Architecture

```
┌─────────────────┐
│   AI Assistant  │
│  (Claude, etc)  │
└────────┬────────┘
         │ HTTP POST /mcp (SSE)
         │ + JWT Bearer Token
         ▼
┌─────────────────────────────────────────┐
│         MCP Server (NestJS)             │
│  ┌─────────────────────────────────┐   │
│  │  JWT Auth Guard                  │   │
│  │  Extract userId from token       │   │
│  └───────────┬─────────────────────┘   │
│              ▼                           │
│  ┌───────────────────────────────────┐  │
│  │  MCP Service                       │  │
│  │  - Tool Registration               │  │
│  │  - Resource Registration           │  │
│  │  - Request Routing                 │  │
│  └───────────┬───────────────────────┘  │
│              │                           │
│    ┌─────────┴──────────┐               │
│    ▼                    ▼               │
│  Tools              Resources           │
│  • searchPreferences   • GraphQL Schema │
│  • createPreference                     │
│  • updatePreference                     │
│  • deletePreference                     │
│    │                                     │
│    ▼                                     │
│  PreferenceService                      │
│  (User-scoped)                          │
└─────────────────────────────────────────┘
```

## Features

### Tools (4 total)

1. **searchPreferences** - Search user preferences
   - Filter by category
   - Filter by location
   - Get global preferences only
   - Returns all user preferences

2. **createPreference** - Create new preference
   - Requires: category, key, value
   - Optional: locationId (for location-specific preferences)

3. **updatePreference** - Update existing preference
   - Requires: preferenceId, new value
   - Ownership verified automatically

4. **deletePreference** - Delete preference
   - Requires: preferenceId
   - Ownership verified automatically

### Resources (1 total)

1. **schema://graphql** - GraphQL schema
   - Exposes the full GraphQL schema
   - Allows AI to understand available types and operations
   - Cached for 1 minute to reduce file reads

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# MCP HTTP Transport
MCP_HTTP_ENABLED=true                          # Enable HTTP transport (default: true)
MCP_HTTP_PATH=/mcp                             # Endpoint path (default: /mcp)
MCP_HTTP_REQUIRE_AUTH=true                     # Require JWT (default: true)
MCP_HTTP_ALLOWED_ORIGINS=*                     # CORS origins (default: *)

# MCP Stdio Transport (local development only)
MCP_STDIO_ENABLED=false                        # Enable stdio (default: false)

# Tool Configuration
MCP_TOOLS_PREFERENCES_ENABLED=true             # Enable preference tools (default: true)
MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS=100   # Max search results (default: 100)

# Resource Configuration
MCP_RESOURCES_SCHEMA_ENABLED=true              # Enable schema resource (default: true)
```

### Config File

Configuration is loaded from `src/config/mcp.config.ts` and follows NestJS ConfigModule patterns.

## Authentication & Security

### JWT Required

All MCP HTTP requests **must** include a valid Auth0 JWT token:

```
Authorization: Bearer <jwt_token>
```

### User Context Isolation

**Critical Security Feature**: The MCP server automatically extracts the `userId` from the JWT token and ensures:

1. Users can only search their own preferences
2. Users can only create preferences for themselves
3. Users can only update/delete their own preferences

**The userId is NEVER accepted as a parameter** - it's always extracted from the authenticated JWT token.

See [AUTHORIZATION_TODO.md](./AUTHORIZATION_TODO.md) for pending security enhancements marked with:
- `TODO: MCP_USER_CONTEXT`
- `TODO: MCP_SEARCH_AUTH`

## Usage Examples

### Using with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "context-router": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      }
    }
  }
}
```

### Using with HTTP Client

#### 1. Get a JWT Token

```bash
# Use your existing authentication flow
TOKEN="eyJhbGc..."
```

#### 2. Connect to MCP Server

```bash
curl -N -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }'
```

#### 3. List Available Tools

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 2
}
```

#### 4. Call a Tool

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "searchPreferences",
    "arguments": {
      "category": "appearance"
    }
  },
  "id": 3
}
```

### Using Stdio Transport (Local Development)

For local development and testing with tools like Claude Desktop:

1. Enable stdio in `.env`:
   ```env
   MCP_STDIO_ENABLED=true
   ```

2. Run the stdio entrypoint:
   ```bash
   ts-node bin/mcp-stdio.ts
   ```

3. Configure in Claude Desktop:
   ```json
   {
     "mcpServers": {
       "context-router": {
         "command": "ts-node",
         "args": ["/absolute/path/to/context-router/bin/mcp-stdio.ts"],
         "env": {
           "DATABASE_URL": "postgresql://...",
           "AUTH0_DOMAIN": "...",
           "AUTH0_AUDIENCE": "..."
         }
       }
     }
   }
   ```

**Note**: Stdio transport bypasses JWT authentication. Only use in trusted local environments.

## File Structure

```
src/
  config/
    mcp.config.ts              # MCP configuration

  mcp/
    mcp.module.ts              # NestJS module
    mcp.service.ts             # Core MCP server logic
    mcp.controller.ts          # HTTP endpoint (/mcp with SSE)

    tools/
      preference-search.tool.ts       # Search tool implementation
      preference-mutation.tool.ts     # Create/update/delete tools

    resources/
      schema.resource.ts              # GraphQL schema resource

    types/
      mcp-context.type.ts             # User context type definitions

  common/guards/
    jwt-auth.guard.ts          # JWT authentication guard

bin/
  mcp-stdio.ts                 # Stdio transport entrypoint (optional)

test/e2e/
  mcp.e2e.spec.ts             # E2E tests for MCP
```

## Testing

### Unit Tests

Run the e2e test suite:

```bash
pnpm test:e2e
```

### Manual Testing with MCP Inspector

The official MCP Inspector is the best way to test your MCP server:

```bash
# Install globally
pnpm add -g @modelcontextprotocol/inspector

# Run against your server
npx @modelcontextprotocol/inspector http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_JWT_TOKEN"
```

This provides a UI to:
- List available tools and resources
- Call tools with custom parameters
- View responses in real-time
- Debug MCP protocol messages

### Example Test Flow

1. Start your server:
   ```bash
   pnpm start:dev
   ```

2. Get a valid JWT token (use your existing auth flow)

3. Test with curl or MCP Inspector:
   ```bash
   # List tools
   curl -N -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

   # Search preferences
   curl -N -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer $TOKEN" \
     -d '{
       "jsonrpc":"2.0",
       "method":"tools/call",
       "params":{
         "name":"searchPreferences",
         "arguments":{"category":"appearance"}
       },
       "id":2
     }'
   ```

## Troubleshooting

### "MCP HTTP transport is disabled"

Enable in `.env`:
```env
MCP_HTTP_ENABLED=true
```

### "Authentication required"

Ensure your JWT token is:
1. Valid (not expired)
2. Issued by your Auth0 tenant
3. Included in the `Authorization` header

### "Unknown tool: ..."

Check that tools are enabled in config:
```env
MCP_TOOLS_PREFERENCES_ENABLED=true
```

### "GraphQL schema not available"

The GraphQL schema is auto-generated on app startup. Ensure:
1. The app has started successfully
2. `src/schema.gql` exists
3. Schema resource is enabled: `MCP_RESOURCES_SCHEMA_ENABLED=true`

## Development

### Adding a New Tool

1. Create tool implementation in `src/mcp/tools/`
2. Register in `src/mcp/mcp.service.ts`:
   - Add to `tools/list` response
   - Add handler in `tools/call` switch statement
3. Add to `src/mcp/mcp.module.ts` providers
4. Add TODO comments for auth if needed

### Adding a New Resource

1. Create resource implementation in `src/mcp/resources/`
2. Register in `src/mcp/mcp.service.ts`:
   - Add to `resources/list` response
   - Add handler in `resources/read`
3. Add to `src/mcp/mcp.module.ts` providers

## References

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [Authorization TODO](./AUTHORIZATION_TODO.md) - Security enhancements

## TODO: Future Enhancements

See `docs/AUTHORIZATION_TODO.md` for:
- Phase 2: Automatic userId filtering in search queries
- Advanced RBAC integration
- Rate limiting per user
- Audit logging for tool calls
