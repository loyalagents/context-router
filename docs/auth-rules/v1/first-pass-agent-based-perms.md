# Agent-Based Permissions for MCP Endpoint

## Context

Currently all MCP agents (Claude Code, ChatGPT, etc.) get identical access — they share a single Auth0 public client and there's no permission enforcement. We want to differentiate agents so that, e.g., Claude gets read-write and ChatGPT gets read-only. Unknown agents should default to read-only without requiring any Auth0 configuration.

**Approach:** Separate Auth0 public clients per known agent. The DCR shim returns the right `client_id` based on redirect_uri domain. The JWT's `azp` claim identifies the agent. All permission logic lives in the backend config — Auth0 is just identity.

---

## Phase 1: Add `requiredPermission` to tool interface + all tools

**Files:**
- [mcp-tool.interface.ts](apps/backend/src/mcp/tools/base/mcp-tool.interface.ts) — add `requiredPermission: string` to interface
- All 7 tool files — add the field:

| Tool file | `requiredPermission` |
|-----------|---------------------|
| [preference-list.tool.ts](apps/backend/src/mcp/tools/preference-list.tool.ts) | `'preferences:read'` |
| [preference-search.tool.ts](apps/backend/src/mcp/tools/preference-search.tool.ts) | `'preferences:read'` |
| [smart-search.tool.ts](apps/backend/src/mcp/tools/smart-search.tool.ts) | `'preferences:read'` |
| [schema-consolidation.tool.ts](apps/backend/src/mcp/tools/schema-consolidation.tool.ts) | `'preferences:read'` |
| [preference-suggest.tool.ts](apps/backend/src/mcp/tools/preference-suggest.tool.ts) | `'preferences:write'` |
| [preference-delete.tool.ts](apps/backend/src/mcp/tools/preference-delete.tool.ts) | `'preferences:write'` |
| [preference-definition.tool.ts](apps/backend/src/mcp/tools/preference-definition.tool.ts) | `'preferences:write'` |

**Checkpoint:** `pnpm test` — all existing tests pass (additive only, no behavior change).

---

## Phase 2: Extend McpContext with agent identity

**File:** [mcp-context.type.ts](apps/backend/src/mcp/types/mcp-context.type.ts)

Add:
```typescript
export interface McpAgent {
  clientId: string;
  name: string;
  permissions: string[];
}
```

Add `agent: McpAgent` to `McpContext`.

**Note:** This causes TS errors wherever McpContext is constructed without `agent`. Fixed in Phase 3.

---

## Phase 3: Add agent config + wire controller

### 3a. Config — [mcp.config.ts](apps/backend/src/config/mcp.config.ts)

Add an `agents` section with `knownAgents` array and `defaultAgent`:

```typescript
agents: {
  knownAgents: [
    {
      name: 'claude',
      clientId: process.env.AUTH0_MCP_CLAUDE_CLIENT_ID,
      permissions: ['preferences:read', 'preferences:write'],
      redirectPatterns: ['claude.ai', 'claude.com'],
    },
    {
      name: 'chatgpt',
      clientId: process.env.AUTH0_MCP_CHATGPT_CLIENT_ID,
      permissions: ['preferences:read'],
      redirectPatterns: ['chatgpt.com'],
    },
    {
      name: 'dev',
      clientId: process.env.AUTH0_MCP_DEV_CLIENT_ID,
      permissions: ['preferences:read', 'preferences:write'],
      redirectPatterns: ['localhost', '127.0.0.1'],
    },
  ],
  defaultAgent: {
    name: 'unknown',
    clientId: process.env.AUTH0_MCP_PUBLIC_CLIENT_ID,
    permissions: ['preferences:read'],
  },
}
```

New env vars (all optional, fall back to default client):
- `AUTH0_MCP_CLAUDE_CLIENT_ID`
- `AUTH0_MCP_CHATGPT_CLIENT_ID`
- `AUTH0_MCP_DEV_CLIENT_ID`

Update [.env.example](apps/backend/.env.example) with these.

### 3b. Controller — [mcp.controller.ts](apps/backend/src/mcp/mcp.controller.ts)

Add a `resolveAgent(req)` private method that:
1. Reads `azp` from `(req as any).tokenPayload`
2. Looks up matching `knownAgent` by `clientId`
3. Falls back to `defaultAgent` config

Populate `context.agent` in `handleMcpRequest` alongside `context.user`.

**Checkpoint:** `pnpm test` — all pass. Mock guard doesn't set `tokenPayload`, so `azp` is undefined → resolves to default agent. No enforcement yet, so all tools still execute.

---

## Phase 4: Enforce permissions in the service dispatcher

**File:** [mcp.service.ts](apps/backend/src/mcp/mcp.service.ts)

In the `CallToolRequestSchema` handler (~line 84), after the `requiresAuth` check, add:

```typescript
if (tool.requiredPermission && context?.agent) {
  if (!context.agent.permissions.includes(tool.requiredPermission)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Agent "${context.agent.name}" does not have permission "${tool.requiredPermission}" required by tool "${name}"`,
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredPermission: tool.requiredPermission,
          agentName: context.agent.name,
        }, null, 2),
      }],
      isError: true,
    };
  }
}
```

Also filter `tools/list` to only return tools the agent has permission to call (better LLM UX — agents won't attempt tools they can't use).

**Checkpoint:** Some tests will fail because default agent only has `['preferences:read']`. Fixed in Phase 5.

---

## Phase 5: Update test harness

**File:** [test-app.ts](apps/backend/test/setup/test-app.ts) — `createMcpMockAuthGuard` (~line 160)

Extend the mock guard to also set `request.tokenPayload`:
- Default: `{ azp: 'test-full-access-client' }` — so existing tests keep working
- Support `x-test-agent-azp` header for per-request agent override in new tests

Add test env vars (in `.env.test` or test setup):
- `AUTH0_MCP_DEV_CLIENT_ID=test-full-access-client` → maps to dev agent (read+write)
- `AUTH0_MCP_CHATGPT_CLIENT_ID=test-readonly-client` → maps to chatgpt agent (read-only)

**Checkpoint:** `pnpm test` — all existing tests pass again.

---

## Phase 6: Write permission-enforcement e2e tests

**File:** [mcp.e2e-spec.ts](apps/backend/test/e2e/mcp.e2e-spec.ts)

Add `describe('Agent permissions')` block:
1. Read tool with read-only agent (`x-test-agent-azp: test-readonly-client`) → succeeds
2. Write tool with read-only agent → returns `INSUFFICIENT_PERMISSIONS`
3. Write tool with read-write agent (`x-test-agent-azp: test-full-access-client`) → succeeds
4. Unknown agent (`x-test-agent-azp: unknown-client-xyz`) → gets default read-only, write denied
5. `tools/list` for read-only agent → write tools not listed

**Checkpoint:** `pnpm test --testPathPattern=mcp.e2e` — all pass.

---

## Phase 7: Update DCR shim to route client_id by agent

**File:** [dcr-shim.controller.ts](apps/backend/src/mcp/auth/dcr-shim.controller.ts)

Replace static `clientId` lookup (~line 128) with a `resolveClientId(validRedirectUris)` method:
1. Parse each valid redirect_uri's hostname
2. Match against `knownAgents[].redirectPatterns` (hostname suffix match)
3. Return that agent's `clientId` if configured
4. Fall back to `defaultAgent.clientId`

Skip agents where `clientId` is undefined (env var not set).

**Checkpoint:** `pnpm test` — all pass.

---

## Verification

1. **Unit/e2e tests:** `cd apps/backend && pnpm test`
2. **Targeted MCP tests:** `pnpm test --testPathPattern=mcp.e2e`
3. **Manual test with Claude:** Connect Claude to the MCP endpoint, verify write tools work
4. **Manual test with ChatGPT:** Connect ChatGPT, verify write tools return `INSUFFICIENT_PERMISSIONS`
5. **Manual test with unknown client:** Use curl with a token from the default client, verify read-only behavior
