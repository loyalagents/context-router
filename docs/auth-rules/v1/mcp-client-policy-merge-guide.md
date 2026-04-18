# MCP Client Policy Merge Guide for API-Key Branch

## Purpose

This document explains how the MCP client-policy work on the OAuth branch is split so an API-key branch can merge the reusable authorization pieces without inheriting the OAuth-specific wiring.

This guide assumes:

- the OAuth branch introduces shared MCP client-policy types, a registry, and an authorization service
- the API-key branch already has or will add its own credential-resolution path
- Auth0 and env-file updates remain a separate interactive step owned by the user

---

## Shared vs OAuth-Only

### Shared authorization layer

These pieces should be reusable from an API-key branch without changing their core behavior:

- [`apps/backend/src/mcp/types/mcp-authorization.types.ts`](../../../apps/backend/src/mcp/types/mcp-authorization.types.ts)
- [`apps/backend/src/mcp/auth/mcp-authorization.service.ts`](../../../apps/backend/src/mcp/auth/mcp-authorization.service.ts)
- [`apps/backend/src/mcp/auth/mcp-client-registry.service.ts`](../../../apps/backend/src/mcp/auth/mcp-client-registry.service.ts)
- [`apps/backend/src/mcp/types/mcp-context.type.ts`](../../../apps/backend/src/mcp/types/mcp-context.type.ts)
- MCP tool/resource access declarations:
  - [`apps/backend/src/mcp/tools/base/mcp-tool.interface.ts`](../../../apps/backend/src/mcp/tools/base/mcp-tool.interface.ts)
  - [`apps/backend/src/mcp/resources/base/mcp-resource.interface.ts`](../../../apps/backend/src/mcp/resources/base/mcp-resource.interface.ts)
- MCP dispatcher enforcement:
  - [`apps/backend/src/mcp/mcp.service.ts`](../../../apps/backend/src/mcp/mcp.service.ts)

### OAuth-only wiring

These pieces are specific to OAuth token handling or OAuth discovery/DCR:

- [`apps/backend/src/mcp/auth/mcp-auth.guard.ts`](../../../apps/backend/src/mcp/auth/mcp-auth.guard.ts)
- [`apps/backend/src/mcp/auth/dcr-shim.controller.ts`](../../../apps/backend/src/mcp/auth/dcr-shim.controller.ts)
- OAuth-oriented MCP config in [`apps/backend/src/config/mcp.config.ts`](../../../apps/backend/src/config/mcp.config.ts)
- MCP request context construction in [`apps/backend/src/mcp/mcp.controller.ts`](../../../apps/backend/src/mcp/mcp.controller.ts)

The API-key branch should reuse the shared layer and replace only the credential-resolution path.

---

## Current Model

The MCP layer now works in three steps:

1. Credentials resolve to a `clientKey`
2. `clientKey` resolves to a policy
3. The shared authorizer decides whether the requested MCP access is allowed

Current built-in client keys:

- `claude`
- `codex`
- `fallback`
- `unknown`

Current coarse capabilities:

- `preferences:read`
- `preferences:write`

Current behavior:

- `claude` can read and write
- `codex` can read only
- `fallback` can read only
- `unknown` gets empty MCP lists and denied execution/read access

Target-rule types exist now, but namespace/slug enforcement is not turned on in MCP handlers yet.

---

## What the API-Key Branch Should Reuse

The API-key branch should keep these invariants:

- `McpContext` includes a resolved `client`
- tools declare `requiredAccess`
- resources declare `requiredAccess`
- `McpService` filters `tools/list` and `resources/list`
- `McpService` denies unauthorized `tools/call` and `resources/read`
- `McpAuthorizationService` remains the only place that turns access declarations into capabilities and evaluates grants/target rules

That gives both branches one shared authorization model, even though the credential source is different.

---

## Likely Merge Touchpoints

### 1. MCP context construction

OAuth branch:

- [`apps/backend/src/mcp/mcp.controller.ts`](../../../apps/backend/src/mcp/mcp.controller.ts) resolves the client from token payload claims

API-key branch expectation:

- resolve the client from API-key metadata or DB-backed key records
- still populate `context.client` in the same shape

### 2. Auth guard or middleware

OAuth branch:

- [`apps/backend/src/mcp/auth/mcp-auth.guard.ts`](../../../apps/backend/src/mcp/auth/mcp-auth.guard.ts) verifies JWTs and normalizes grants

API-key branch expectation:

- authenticate the API key
- derive the client identity from key metadata
- optionally normalize any grant-like concepts if the API-key design has them
- attach enough request metadata for the controller to resolve `context.client`

### 3. Config

OAuth branch:

- [`apps/backend/src/config/mcp.config.ts`](../../../apps/backend/src/config/mcp.config.ts) includes OAuth client IDs and redirect URIs in each MCP client bucket

API-key branch expectation:

- keep the policy definitions
- replace or extend the credential mapping section with API-key metadata sources
- do not depend on Auth0 client IDs or redirect URIs for API-key resolution

### 4. Tests

OAuth branch test setup:

- [`apps/backend/test/setup/test-app.ts`](../../../apps/backend/test/setup/test-app.ts) supports `x-test-mcp-client-id`

API-key branch expectation:

- add a test override that mimics API-key client resolution
- keep the same effective MCP behavior assertions

---

## Recommended Merge Order

1. Merge the shared MCP authorization types and service first.
2. Merge the `McpContext` shape change and the tool/resource `requiredAccess` declarations.
3. Merge the `McpService` authorization enforcement and resource abstraction.
4. Merge the `McpClientRegistry`, but adapt the credential-resolution inputs to API-key metadata instead of OAuth claims where needed.
5. Reconcile the API-key auth guard or middleware so it produces the same resolved client shape.
6. Re-run the MCP unit/e2e tests with the API-key branch’s auth path.
7. Leave Auth0-specific DCR and OAuth metadata work out unless that branch still exposes OAuth flows too.

---

## Concrete Adaptation Strategy

If the API-key branch stores keys in a table or config with a client grouping, the simplest mapping is:

- API key record contains or resolves to `clientKey`
- controller or auth middleware constructs `ResolvedMcpClient` via `McpClientRegistry.getPolicy(clientKey)`
- `McpAuthorizationService` remains unchanged

If the API-key branch wants finer controls later, it can:

- keep `clientKey` as the coarse bucket
- add per-key metadata outside the shared MCP authorizer
- optionally layer additional checks before or after `McpAuthorizationService`

That keeps the shared MCP logic stable while allowing API-key-specific evolution.

---

## Validation Checklist for the API-Key Merge

- `McpContext` always contains `client`
- every MCP tool still declares `requiredAccess`
- every MCP resource still declares `requiredAccess`
- `tools/list` filters out unauthorized tools
- `resources/list` filters out unauthorized resources
- unauthorized `tools/call` returns MCP tool errors
- unauthorized `resources/read` returns MCP read denial
- `unknown` still maps to deny-all behavior
- test overrides do not depend on Auth0 env-file edits

---

## Notes on Interactive Config

This branch intentionally does not update:

- Auth0 dashboard configuration
- local runtime env files
- tracked env templates
- deployment env files

Those changes are handled later as a user-owned interactive checkpoint after code and tests are green and committed.
