# V2: API-Key MCP Client-Policy Merge for `gates-switch-oauth-to-api-branch`

## Summary
- Keep `ApiKeyGuard` as the `/mcp` auth path and do not switch this branch to OAuth.
- Reuse the shared MCP authorization layer from the cherry-picked work: shared types, `McpAuthorizationService`, `McpClientRegistry`, tool/resource `requiredAccess`, and `McpService` filtering/deny behavior.
- Lock the branch-specific adaptation to an explicit API-key field, not `groupName` inference:
  - add `ApiKey.mcpClientKey`
  - resolve MCP requests from authenticated API-key metadata to `clientKey`
  - build `McpContext.client` from that `clientKey`
- Preserve non-MCP API-key behavior by keeping `validateApiKeyAndUser()` unchanged and adding a separate MCP-capable API-key context path.

## Key Changes
- Prisma/API key model
  - Add Prisma enum `ApiKeyMcpClientKey` with `CLAUDE`, `CODEX`, `FALLBACK`, `UNKNOWN`.
  - Add `ApiKey.mcpClientKey` mapped to `mcp_client_key`.
  - Migration sequence:
    1. add the column nullable
    2. backfill existing rows to `CLAUDE`
    3. make the column required
  - Update all direct `apiKey.create(...)` call sites and fixtures to set `mcpClientKey` explicitly.
  - Keep the existing six workshop seed keys and set them to `CLAUDE` so current workshop behavior is preserved.
  - Do not seed `CODEX` or `UNKNOWN` workshop keys in this PR; use them in tests and support them in future key issuance.

- API-key auth path
  - Keep `ApiKeyService.validateApiKeyAndUser()` returning only the user.
  - Add `ApiKeyService.validateApiKeyUserContext(apiKey, userId)` returning:
    - `user`
    - `apiKeyAuth: { apiKeyId, groupName, mcpClientKey }`
  - Update `ApiKeyGuard` to use the new context-returning method and always attach:
    - `request.user`
    - `request.apiKeyAuth`
  - Do not change `OptionalGqlAuthGuard` or other non-MCP callers to depend on MCP-specific data.

- MCP conflict resolution
  - Add `McpClientRegistry.resolveFromClientKey(clientKey)` returning `ResolvedMcpClient`.
  - `mcp.controller.ts`
    - keep `@UseGuards(ApiKeyGuard)`
    - stop reading `tokenPayload` / `tokenGrants`
    - resolve `context.client` from `request.apiKeyAuth.mcpClientKey`
  - `mcp.service.ts`
    - keep the shared authorization behavior for `tools/list`, `tools/call`, `resources/list`, and `resources/read`
    - use resource abstraction via `MCP_RESOURCES`
  - `mcp.module.ts`
    - keep the branch MCP surface, including `PreferenceApplyTool`
    - register `McpAuthorizationService`, `McpClientRegistry`, `MCP_RESOURCES`
  - `PreferenceApplyTool`
    - add missing `requiredAccess = { resource: 'preferences', action: 'write' }`
  - `mcp-auth.guard.ts`
    - resolve the conflict by keeping the branch placeholder/inert version
    - do not wire it to `/mcp`
  - `mcp.config.ts`
    - keep shared client policy definitions only
    - configure `claude`, `codex`, `fallback`, `unknown` capabilities
    - remove OAuth/DCR/Auth0 runtime wiring from this branch’s active config
  - Drop OAuth-only routing from this PR:
    - `dcr-shim.controller.ts`
    - DCR/Auth0 request wiring
    - OAuth metadata rollout work

## Checkpoints
- Checkpoint 1: unit tests first for API-key client resolution
  - Add/update unit coverage for:
    - `ApiKeyService.validateApiKeyUserContext()`
    - `ApiKeyGuard` attaching `request.apiKeyAuth`
    - `McpClientRegistry.resolveFromClientKey()`
  - Keep `mcp-authorization.service.spec.ts` green.
  - Run:
    - `pnpm --filter backend exec jest --runInBand src/modules/auth/api-key.service.spec.ts`
    - `pnpm --filter backend exec jest --runInBand src/common/guards/api-key.guard.spec.ts`
    - `pnpm --filter backend exec jest --runInBand src/mcp/auth/mcp-authorization.service.spec.ts`
    - `pnpm --filter backend exec jest --runInBand src/mcp/auth/mcp-client-registry.service.spec.ts`

- Checkpoint 2: add explicit API-key MCP metadata
  - Apply the Prisma schema + migration.
  - Update seed and all API-key test fixtures.
  - Keep existing workshop credentials effectively full-access via explicit `CLAUDE`.
  - Re-run the auth unit tests above.

- Checkpoint 3: restore a compilable MCP surface
  - Resolve all MCP conflict files and remove conflict markers:
    - `mcp.config.ts`
    - `mcp-auth.guard.ts`
    - `mcp.controller.ts`
    - `mcp.module.ts`
    - `mcp.service.ts`
    - `mcp.e2e-spec.ts`
  - Clear the unresolved index before expanding E2E assertions.
  - Re-run the four targeted unit suites before moving on.

- Checkpoint 4: real API-key MCP E2E
  - Keep the existing mocked-auth MCP behavior coverage where it is useful for non-auth functional checks.
  - In the same MCP E2E file, add a dedicated real-auth block using `createTestApp({ mockAuthGuards: false })`.
  - Create real API-key rows in the test DB for:
    - `CLAUDE`
    - `CODEX`
    - `UNKNOWN`
  - Assertions:
    - `CLAUDE` can list and call write tools
    - `CODEX` sees read tools but not write tools in `tools/list`
    - `CODEX` is denied on write `tools/call`
    - `CLAUDE` can read `schema://graphql`
    - `CODEX` can read `schema://graphql`
    - `UNKNOWN` gets empty `tools/list`
    - `UNKNOWN` gets empty `resources/list`
    - `UNKNOWN` is denied on `resources/read`
  - Run `pnpm --filter backend test:e2e:mcp` after each edit batch.

- Checkpoint 5: stabilize for PR
  - Re-run:
    - `api-key.service.spec.ts`
    - `api-key.guard.spec.ts`
    - `mcp-authorization.service.spec.ts`
    - `mcp-client-registry.service.spec.ts`
    - `pnpm --filter backend test:e2e:mcp`
  - Confirm no conflict markers remain and `git ls-files -u` is empty.
  - Leave `.env.gates`, deployment config, and OAuth rollout work untouched.

## Test Plan
- Unit
  - `validateApiKeyAndUser()` remains behaviorally unchanged.
  - `validateApiKeyUserContext()` returns user plus MCP client metadata.
  - `ApiKeyGuard` attaches `request.apiKeyAuth.mcpClientKey`.
  - `McpClientRegistry.resolveFromClientKey('claude' | 'codex' | 'unknown')` returns the expected policy.
  - `PreferenceApplyTool` is covered by MCP startup/authz tests because it now declares write access.

- E2E
  - Authz assertions must use real API-key auth, not `x-test-mcp-client-id`.
  - Read-only behavior is proven with `CODEX`.
  - Deny-all resource behavior is proven with `UNKNOWN`.
  - Existing MCP functionality remains covered after the merge.

## Assumptions and Defaults
- `ApiKey.mcpClientKey` is a deliberate design choice in V2; this plan does not reopen `groupName -> clientKey` inference.
- Existing workshop API keys are backfilled and reseeded as `CLAUDE` to preserve current behavior on this branch.
- `FALLBACK` remains part of the shared policy model but is not provisioned by the workshop seed in this PR.
- `UNKNOWN` is supported for tests and explicit deny-all keys, not normal workshop issuance.
- No OAuth request auth, DCR rollout, Auth0 env changes, `.env.gates` changes, or deployment/runtime changes are part of this branch.
