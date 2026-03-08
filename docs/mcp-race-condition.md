# MCP Concurrency Bug Verification & Plan

## Context

Two engineers independently identified the same two bugs in the MCP layer. This plan verifies both bugs are real (they are), compares the two plans, and recommends a unified approach.

---

## Bugs Confirmed

### Bug 1: Singleton MCP Server Reused Across Requests
- **Location**: `apps/backend/src/mcp/mcp.service.ts:37` — `this.server = new Server(...)` in `onModuleInit()`
- **Location**: `apps/backend/src/mcp/mcp.controller.ts:96` — `await server.connect(transport)` called on every request
- **Impact**: Unsupported by MCP SDK. SDK ≥1.26.0 will throw at runtime on repeated `server.connect()`. Currently masked because the app has no server-initiated messages (notifications, sampling, elicitation), but the architecture is broken.

### Bug 2: Shared Mutable Context Race Condition
- **Location**: `apps/backend/src/mcp/mcp.service.ts:20` — `private currentContext: McpContext | null = null`
- **Race window**: Controller sets context (~line 86), yields at `server.connect()` (line 96) and `transport.handleRequest()` (line 103). A concurrent request's `setContext()` can overwrite it before the tool handler snapshots it at line 195. Also, `clearContext()` in the `finally` block (line 117) can null the field while another concurrent request is still using it.
- **Impact**: Concurrent users can get each other's data. The race closes once line 195 runs `const context = this.getContext()` — but that snapshot comes after two async yields.

---

## Plan Comparison

Both plans agree on the core fix: **fresh `Server` per request with context captured in closures**.

| Aspect | Plan 1 (MCP_shared_state_fix_plan.md) | Plan 2 (mcp-race-condition.md) |
|---|---|---|
| Core fix | Same: per-request server + closure context | Same |
| GET /mcp | Prescribes 405 | "Test it, make a concrete decision" |
| `enableJsonResponse` | Explicitly required | Not mentioned |
| Origin validation | Step 6 (explicit) | Not included |
| SDK upgrade | Step 7 | Step A6 |
| Line number grounding | Generic | Specific to current code |

**Verdict**: Both plans are correct and complementary. Plan 1 is more complete (origin validation, explicit transport config). Plan 2 is more grounded in current line numbers.

---

## Recommended Fix (Unified)

### Files to Change
- `apps/backend/src/mcp/mcp.service.ts`
- `apps/backend/src/mcp/mcp.controller.ts`
- `apps/backend/test/setup/test-app.ts`
- `apps/backend/test/e2e/mcp.e2e-spec.ts`
- `apps/backend/package.json` (SDK upgrade)

### Steps with Checkpoints

**Step 1 — Refactor `McpService`**
- Replace `onModuleInit()` singleton with `createServer(context: McpContext): Server`
- Remove: `private server`, `private currentContext`, `getServer()`, `setContext()`, `getContext()`, `clearContext()`
- Tool handlers close over `context` directly — no shared field

_Checkpoint: App boots, TypeScript compiles. Old `getServer()`/`setContext()` tests fail (confirming removal)._

**Step 2 — Refactor `McpController`**
- Replace lines 83–118 with per-request server + transport creation
- Use `enableJsonResponse: true`, `sessionIdGenerator: undefined`
- Clean up server/transport in `res.on('close', ...)`
- No `setContext()`/`clearContext()` calls
- Note: this is JSON-response mode only; if server-initiated streaming features (notifications, progress, sampling, elicitation) are added later, the transport design must be revisited

_Checkpoint: Single POST /mcp request works end-to-end._

**Step 3 — GET /mcp returns 405 (consequence of JSON-response mode)**
- `enableJsonResponse: true` in the SDK causes POSTs to return plain JSON and explicitly rejects GETs with 405. This is not a transport mystery — it is the documented behavior of JSON-response mode and the right choice for this stateless endpoint.
- Document this in MCP docs as intentional: only `POST /mcp` is supported.

_Checkpoint: GET /mcp returns 405, POST /mcp still works._

**Step 4 — Add Origin / Host-Header Validation**
- The MCP Streamable HTTP transport spec requires servers to validate the `Origin` header on incoming connections. When using the HTTP transport directly with a custom framework (Nest), host-header validation and DNS-rebinding protection must be implemented explicitly — the SDK's helper apps do this automatically but a raw Nest controller does not.
- Implement as Nest middleware or a dedicated guard scoped to `/mcp`
- Back it with an allowlist from config/env (local, staging, production frontend origins)
- Decide and document behavior for missing `Origin` headers (non-browser clients)
- Add tests: allowed origin succeeds, disallowed origin rejected, missing-origin behavior matches policy

_Checkpoint: Origin policy documented and tested._

**Step 5 — Fix Test Harness**
- Override `McpAuthGuard` in `test-app.ts` (currently only `GqlAuthGuard`, `JwtAuthGuard`, `OptionalGqlAuthGuard` are overridden at lines 205–207)
- Support `X-Test-User-Id` header for MCP requests to model multiple concurrent users; resolve from in-memory seeded-user map and attach to `request.user`
- Keep existing single-user fallback for non-MCP tests
- `X-Test-User-Id` logic must stay entirely within `test-app.ts` and other test bootstrap code — it must never appear in production controllers or auth guards

_Checkpoint: Existing non-MCP tests pass. MCP tests can authenticate as distinct users._

**Step 6 — Rewrite MCP Tests**
- Remove old set/get/clear context tests (lines 80–98) and `getServer()` test (line 46)
- Add service-level sanity test: `createServer(ctx) !== createServer(ctx)`
- Add **concurrent isolation regression test** — make overlap deterministic, not timing-dependent:
  - Seed user A and B with distinct preference slugs/values
  - Introduce a barrier, latch, or test-only delay in the preference search path so both requests are provably in-flight simultaneously before either resolves
  - Fire two concurrent POST /mcp `tools/call` requests, one per user
  - Assert response A contains A's slug/value and not B's; response B contains B's and not A's
  - Assert on slugs/values (not userId — `searchPreferences` does not return userId)

_Checkpoint: `mcp.e2e-spec.ts` fully green including concurrency test, stable across repeated runs._

**Step 7 — Upgrade `@modelcontextprotocol/sdk`**
- Bump to `^1.26.0` in `apps/backend/package.json` (not `>=1.26.0` — the open range would admit a future major version; stay on the supported v1 line)
- Run full backend test suite

_Checkpoint: All tests pass, no regressions._

---

## Verification

```bash
# Targeted MCP tests
cd apps/backend && pnpm test -- mcp.e2e-spec.ts

# Full suite
cd apps/backend && pnpm test
```

Key assertions:
- No singleton `Server` anywhere in `McpService`
- No `currentContext` mutable field
- Concurrent requests for different users return that user's data only (proven by deterministic overlap test)
- GET /mcp returns 405 (documented as JSON-response mode behavior)
- Origin validation enforced and tested
- SDK pinned to `^1.26.0`
- `X-Test-User-Id` confined to test bootstrap code only

---

## Checkpoint Log

### Checkpoint 1 — 2026-03-08

- Ran `env PATH=/Users/lucasnovak/.nvm/versions/node/v20.19.5/bin:$PATH pnpm test -- mcp.e2e-spec.ts` from `apps/backend` to force the repo's Node 20 toolchain.
- Local shell note: the `pnpm` shim on PATH was resolving `node` to `/usr/local/bin/node` (`v16.15.1`), so raw `pnpm` commands were not using the repo's pinned Node version from `.nvmrc`.
- In this Codex run, the focused suite stopped early in `test/setup/test-db.ts:58` during `resetDb()`, even though the test Postgres instance at `localhost:5433/context_router_test` is reachable.
- Root cause from the user's original failing run is in `apps/backend/test/setup/test-app.ts`: `ApiKeyGuard` is overridden with `mcpMockAuthGuard`, but that guard only read `switchToHttp().getRequest()`. GraphQL setup mutations in `mcp.e2e-spec.ts` therefore hit `request === undefined`, so `setPreference` never seeded the rows that `searchPreferences` expected.

### Checkpoint 2 — 2026-03-08

- Patched `apps/backend/test/setup/test-app.ts` so the shared test auth override resolves the request object from either GraphQL or HTTP execution context before attaching `request.user`.
- Verified the original failing suite outside the sandbox with `env PATH=/Users/lucasnovak/.nvm/versions/node/v20.19.5/bin:$PATH pnpm test -- mcp.e2e-spec.ts`.
- Result: `PASS` — `13/13` tests green, including `supports category as a deprecated alias on searchPreferences`.
- Ran directly related GraphQL coverage with `env PATH=/Users/lucasnovak/.nvm/versions/node/v20.19.5/bin:$PATH pnpm test -- preferences.e2e-spec.ts`.
- Result: `PASS` — `12/12` tests green, confirming the shared `ApiKeyGuard` test override still works for the broader preference GraphQL e2e path.
