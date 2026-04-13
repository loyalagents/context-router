# gates-workshop-2026 Handoff

## Purpose

This note is for the next agent working on `gates-switch-oauth-to-api-branch`, which is branched from `gates-workshop-2026` and should open a PR back into `gates-workshop-2026`.

The goal is to reuse the new shared MCP client-policy authorization model from `main` while keeping the `gates-workshop-2026` line on its API-key-based MCP authentication path for now.

This is intentionally **not** a production rollout guide for the OAuth branch.

---

## Source Commit

Cherry-pick this squash commit from `main`:

- `REPLACE_WITH_MAIN_SQUASH_COMMIT_SHA`

If the exact commit SHA is not filled in yet, stop and get it first.

---

## What Was Already Validated

On the OAuth branch, the following was verified locally:

- DCR routing returns the correct Auth0 client ID for:
  - Claude callback URIs
  - Codex callback URI
  - fallback OpenAI/ChatGPT callback URIs
- mixed redirect URI sets are rejected
- Claude authenticates and can read + write
- Codex authenticates and can read-only
- tool visibility is filtered correctly by client policy

This branch should **reuse the shared authorization model**, not re-implement it differently.

---

## Cherry-Pick Plan

1. Check out `gates-workshop-2026`.
2. Create `gates-switch-oauth-to-api-branch` from it.
3. Cherry-pick the squash commit from `main` onto `gates-switch-oauth-to-api-branch`.
4. Expect conflicts around MCP auth flow and environment-specific setup.
5. Keep the shared MCP authorization layer.
6. Preserve the API-key request-auth path from `gates-workshop-2026`.
7. Re-run the gates-branch MCP tests after integration.
8. Open a PR from `gates-switch-oauth-to-api-branch` into `gates-workshop-2026`.

---

## Reuse These Pieces

These files contain the shared authorization model that should be reused as much as possible:

- [mcp-authorization.types.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/types/mcp-authorization.types.ts)
- [mcp-authorization.service.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-authorization.service.ts)
- [mcp-client-registry.service.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-client-registry.service.ts)
- [mcp-context.type.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/types/mcp-context.type.ts)
- [mcp.service.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/mcp.service.ts)
- [mcp-tool.interface.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/tools/base/mcp-tool.interface.ts)
- [mcp-resource.interface.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/resources/base/mcp-resource.interface.ts)
- tool `requiredAccess` declarations under [apps/backend/src/mcp/tools](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/tools)
- resource access declarations under [apps/backend/src/mcp/resources](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/resources)
- targeted tests:
  - [mcp-authorization.service.spec.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-authorization.service.spec.ts)
  - [mcp-client-registry.service.spec.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-client-registry.service.spec.ts)
  - [mcp.e2e-spec.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/e2e/mcp.e2e-spec.ts)

Core model to preserve:

- credentials resolve to `clientKey`
- `clientKey` resolves to policy
- one shared authorizer enforces access
- `tools/list` and `resources/list` filter unauthorized entries out
- `tools/call` and `resources/read` deny unauthorized access

Permission-grant follow-up from `main`:

- `PermissionGrantModule` now adds per-client per-slug narrowing on top of coarse client policy
- `McpAuthorizationService.canAccessTarget(...)` and `filterByTargetAccess(...)` are the merge points to preserve
- `listPermissionGrants` is read-only and scoped to `context.client.key`
- write clients are still prevented from self-managing grants over MCP; grant mutation stays in GraphQL/web only for now
- if permission grants are cherry-picked onto the API-key branch, preserve the same layering:
  coarse policy -> static `targetRules` -> DB permission grants

---

## Do Not Blindly Copy These Pieces

These files are OAuth/Auth0-specific and likely need adaptation or partial reuse only:

- [mcp-auth.guard.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-auth.guard.ts)
- [dcr-shim.controller.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/dcr-shim.controller.ts)
- OAuth-oriented client config in [mcp.config.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/config/mcp.config.ts)
- OAuth request-context wiring in [mcp.controller.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/mcp.controller.ts)

The `gates-switch-oauth-to-api-branch` work should keep the API-key auth path from `gates-workshop-2026` and adapt these ideas instead of replacing that branch’s authentication design with OAuth.

---

## Branch Constraints

While integrating on `gates-switch-oauth-to-api-branch` for a PR back into `gates-workshop-2026`:

- keep API-key auth as the MCP request authentication path
- do not switch deployed runtime from API keys to OAuth
- do not treat Auth0 env/config as required for the branch to work
- do not update [apps/backend/.env.gates](/Users/lucasnovak/loyal-agents/context-router/apps/backend/.env.gates) unless the branch actually needs new values after the integration
- do not assume Cloud Run should be updated yet

---

## Suggested Adaptation Strategy

For `gates-switch-oauth-to-api-branch`, the intended adaptation is:

1. Keep API-key validation/authentication from that branch.
2. After API-key validation, resolve the caller to a `clientKey`.
3. Use `McpClientRegistry.getPolicy(clientKey)` or equivalent shared logic.
4. Populate `McpContext.client` in the same shape as the OAuth branch.
5. Reuse `McpAuthorizationService` unchanged if possible.
6. Keep the existing API-key branch behavior for any non-MCP auth paths.

If API keys already carry a group, label, or policy bucket, map that directly to `clientKey`.

---

## Files To Read First

The next agent should read these before making changes:

- [mcp-client-policy-merge-guide.md](/Users/lucasnovak/loyal-agents/context-router/docs/auth-rules/v1/mcp-client-policy-merge-guide.md)
- [gates-workshop-2026-handoff.md](/Users/lucasnovak/loyal-agents/context-router/docs/auth-rules/v1/gates-workshop-2026-handoff.md)
- [mcp-authorization.types.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/types/mcp-authorization.types.ts)
- [mcp-authorization.service.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-authorization.service.ts)
- [mcp-client-registry.service.ts](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/auth/mcp-client-registry.service.ts)
- the current `gates-workshop-2026` MCP auth entrypoints

---

## Acceptance Criteria For gates-switch-oauth-to-api-branch

The integration is successful when:

- the API-key MCP auth flow still works
- MCP requests resolve to a `clientKey`
- the shared authorizer gates tools/resources by client policy
- read-only clients do not see write tools
- unauthorized tool/resource calls are denied
- tests cover at least one read-write client and one read-only client in the API-key flow
- no production OAuth rollout is required for the branch to function
- the branch is in a state that can be reviewed as a PR into `gates-workshop-2026`

---

## Notes

- The OAuth branch also included a grant-normalization fix so empty or irrelevant token scopes do not collapse effective capabilities to zero. That logic matters for OAuth, but the API-key branch may not need the same grant-handling path.
- The doc [mcp-connections.md](/Users/lucasnovak/loyal-agents/context-router/docs/mcp-connections.md) now reflects the split Auth0 client setup. That is useful background, but it is not the primary implementation guide for `gates-switch-oauth-to-api-branch`.
