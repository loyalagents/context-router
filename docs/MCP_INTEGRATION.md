# MCP Integration Guide

## Overview

The backend exposes a Model Context Protocol endpoint at `/mcp` for preference discovery and mutation. The MCP surface is narrower than the GraphQL API on purpose: MCP can discover preference definitions, read a user's preferences, create suggestions, delete preferences, and read the GraphQL schema resource.

## Architecture

```mermaid
flowchart LR
  Client["MCP Client"]
  Guard["ApiKeyGuard"]
  Controller["McpController"]
  Service["McpService\ncreateServer(context)"]
  Tools["Preference Tools"]
  Resource["schema://graphql"]
  PrefSvc["PreferenceService"]
  DefRepo["PreferenceDefinitionRepository"]

  Client -->|POST /mcp| Guard
  Guard --> Controller
  Controller --> Service
  Service --> Tools
  Service --> Resource
  Tools --> PrefSvc
  Tools --> DefRepo
```

## Authentication

The MCP endpoint uses the same API-key auth model as the rest of the workshop backend.

Every request must include:

```http
Authorization: Bearer <apiKey>
```

And one user identity mechanism:

1. `X-User-Id: <userId>` preferred
2. `?asUser=<userId>` fallback for clients that only support a URL
3. Compound bearer token: `Authorization: Bearer <apiKey>.<userId>`

The server always scopes tool execution to the authenticated user context.

## Supported Tools

### `listPreferenceSlugs`

Lists preference definitions visible to the authenticated user, including user-owned definitions.

Arguments:

```json
{
  "category": "food"
}
```

### `searchPreferences`

Searches the user's preferences.

Arguments:

```json
{
  "query": "travel",
  "locationId": "optional-location-id",
  "includeSuggestions": true
}
```

Notes:

- `category` is still accepted as a deprecated alias for `query`.
- When `locationId` is present, results use the merged location-aware preference view.

### `suggestPreference`

Creates or updates a `SUGGESTED` preference.

Arguments:

```json
{
  "slug": "system.response_tone",
  "value": "\"professional\"",
  "confidence": 0.9,
  "locationId": "optional-location-id",
  "evidence": "{\"reason\":\"Mentioned in chat\"}"
}
```

Notes:

- `value` must be a JSON string, not a raw JSON object.
- `evidence` must also be a JSON string when provided.
- MCP writes only create suggestions; they never write `ACTIVE` preferences directly.

### `deletePreference`

Deletes a preference by id.

Arguments:

```json
{
  "id": "preference-id"
}
```

## Supported Resources

### `schema://graphql`

Returns the generated GraphQL schema from `apps/backend/src/schema.gql`.

## Configuration

The current MCP configuration only supports the flags that are actually wired into the backend:

```env
MCP_HTTP_ENABLED=true
MCP_TOOLS_PREFERENCES_ENABLED=true
MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS=100
MCP_RESOURCES_SCHEMA_ENABLED=true
```

Notes:

- The MCP route is fixed at `/mcp`.
- Auth is always enforced on `/mcp`.
- There is no stdio MCP entrypoint in this repo.

## Usage Examples

### List Tools

```bash
curl -N -X POST "http://localhost:3000/mcp?asUser=<userId>" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

### List User-Visible Preference Slugs

```bash
curl -N -X POST "http://localhost:3000/mcp?asUser=<userId>" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "listPreferenceSlugs",
      "arguments": {
        "category": "travel"
      }
    },
    "id": 2
  }'
```

### Suggest a Preference

```bash
curl -N -X POST "http://localhost:3000/mcp?asUser=<userId>" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "suggestPreference",
      "arguments": {
        "slug": "system.response_tone",
        "value": "\"professional\"",
        "confidence": 0.9
      }
    },
    "id": 3
  }'
```

### Read the GraphQL Schema Resource

```bash
curl -N -X POST "http://localhost:3000/mcp?asUser=<userId>" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "schema://graphql"
    },
    "id": 4
  }'
```

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector "http://localhost:3000/mcp?asUser=<userId>" \
  --header "Authorization: Bearer <apiKey>"
```

## Testing

Run the dedicated MCP suite:

```bash
pnpm --filter backend test:e2e:mcp
```

That suite covers:

- advertised tool list
- namespace-aware `listPreferenceSlugs`
- `searchPreferences` category alias support
- `suggestPreference` and `deletePreference`
- `schema://graphql` resource reads
- per-request MCP server isolation across concurrent users
