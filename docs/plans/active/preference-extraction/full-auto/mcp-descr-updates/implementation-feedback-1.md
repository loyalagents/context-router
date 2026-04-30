# Implementation Plan Feedback

## Overall Assessment

The plan is well-scoped and well-reasoned. The three-lever approach (server instructions, better descriptors, structured outputs) is the right call. Keeping tool names stable while making output breaking is a pragmatic tradeoff. The checkpoint structure maps cleanly to testable increments.

The rest of this doc covers gaps, risks, and refinements — roughly ordered from most impactful to least.

---

## 1. SDK Readiness Is Confirmed — But the Plan Should Say So

The installed MCP SDK (v1.27.1) already supports everything this plan needs:

- `ServerOptions.instructions` — second arg to `new Server()`
- `Tool.outputSchema` — optional field on the `Tool` type, restricted to `type: "object"` at root
- `CallToolResult.structuredContent` — optional field, already part of `McpToolExecutionResult.result` since that's typed as `CallToolResult`

No SDK upgrade is needed. No type changes are needed to `McpToolInterface` or `McpToolExecutionResult` — the existing types already accommodate `outputSchema` and `structuredContent`. The plan should state this explicitly so the implementer doesn't waste time investigating compatibility.

## 2. `instructions` Placement Needs a Concrete Code Pointer

The plan says "Update `McpService.createServer()` to advertise server instructions through the SDK initialize flow" but doesn't specify *where* in the constructor. Currently (`mcp.service.ts:87-98`):

```typescript
const server = new Server(
  { name: serverConfig.name, version: serverConfig.version },
  { capabilities: { tools: {}, resources: {} } }
);
```

The `instructions` field goes inside the second argument (`ServerOptions`), sibling to `capabilities`. The plan should call this out so there's no ambiguity about whether to use a request handler override or the constructor option. The constructor option is the correct approach — the SDK handles embedding it in the `initialize` response automatically.

## 3. Dual-Error Path in `PreferenceListTool` Will Cause Confusion

`PreferenceListTool` has two separate error paths that the plan doesn't address:

1. **`list()` method internal catch** (`preference-list.tool.ts:138-141`): catches errors and returns `{ success: false, error: error.message }` as a *normal* (non-error) result.
2. **`execute()` method catch** (`preference-list.tool.ts:72-89`): catches errors and returns with `isError: true`.

If `list()` catches internally, the `execute()` catch is never triggered, so the MCP result won't have `isError: true` — it'll look like a success to the MCP transport layer even though the domain operation failed. With `structuredContent`, this becomes more visible and confusing: `structuredContent.success` would be `false` but `isError` would be `undefined`.

**Recommendation**: The plan should specify whether to unify these paths. The cleanest fix: remove the try/catch from `list()` and let errors propagate to `execute()`, which already handles them properly. The `list()` method is also called directly in tests, so the plan should note that test seams may need adjustment.

`PreferenceSearchTool.search()` has the same pattern (`preference-search.tool.ts:252-258`).

## 4. Breaking Change Impact Deserves a Client Migration Note

The plan correctly identifies the breaking change: `content[0].text` goes from full JSON payloads to short summaries. But it doesn't address how existing consumers handle this:

- MCP clients currently calling these tools will lose data if they only parse `content[0].text`.
- The `local-orchestrator` app in this repo may or may not be affected — it uses MCP tools via remote server.

The plan should either:
1. Add a brief migration note (even one sentence) about which callers need updating.
2. Or specify that during the transition, `content[0].text` still includes enough data to be functional (just formatted differently).

This is especially important since the plan says "breaking-in-output" — the implementation summary should document what clients must change.

## 5. `outputSchema` Definition Strategy Is Unspecified

The plan says to add `outputSchema` to the four read tool descriptors but doesn't address *how* the schemas are defined. Two practical options:

1. **Inline JSON Schema objects** in each tool's `descriptor` — simple, co-located, easy to review.
2. **Shared schema constants** in a `schemas/` directory — reusable, but adds indirection.

Given that each tool has a distinct output shape and there are only four tools in scope, option 1 (inline) is more pragmatic and avoids premature abstraction. The plan should state this preference.

Also: `outputSchema` must have `type: "object"` at root per the SDK type definition. The plan's example shapes (e.g., `success`, `categories`, `count`, `preferences`) all fit this constraint, so no issue there.

## 6. `structuredContent` on Error Responses Needs Clarification

The plan says error responses should include `structuredContent.success = false` plus a machine-readable `error` field. But the MCP spec comment for `content` says: "If the Tool does not define an outputSchema, this field MUST be present in the result."

When `outputSchema` *is* defined, `content` becomes optional per the spec. But for error responses specifically:
- Should `structuredContent` be populated with `{ success: false, error: "..." }` on errors?
- Or should errors skip `structuredContent` and only use `content` + `isError: true`?

**Recommendation**: Always populate `structuredContent` on errors (matching the `outputSchema` shape with `success: false`), and also include a text summary in `content`. This gives clients a consistent parse path regardless of outcome. But the `outputSchema` must then include the error fields (`success: false`, `error: string`) as valid shapes — consider using a broad enough schema or noting that error responses may not strictly conform.

## 7. Shared Helper Scope Should Be Bounded

The plan proposes "a small shared helper for MCP tool success/error result construction." Good idea — the current code has 4+ copies of the JSON-stringify-into-text pattern. But:

- The `mutatePreferences` tool already has its own `MutationEnvelope` + `toExecutionResult()` pattern. The shared helper should not try to replace that — it's more complex and out of scope.
- The helper should be narrowly scoped: take a domain result object, produce `{ result: CallToolResult, accessLog }` with both `structuredContent` and a summary `content[0].text`.
- Putting it in `tools/base/` or a `tools/mcp-result.util.ts` file would be natural.

## 8. `consolidateSchema` Exclusion Creates an Inconsistency

The plan excludes `consolidateSchema` from the structured-output upgrade. But if a shared helper is introduced, `consolidateSchema` would be the most natural next adopter — it follows the exact same pattern as the four in-scope tools. The plan should either:

1. Explicitly include it as a low-effort add-on (it already returns `JSON.stringify(result, null, 2)` in `content[0].text`).
2. Or add it as the first item in the follow-up list.

Leaving it out silently would mean the MCP surface has 4 tools with `outputSchema` + `structuredContent` and 1 read tool without. Agents would see an inconsistent contract.

## 9. Contract Test for `initialize` — Unit or E2E?

The plan says "Add a contract test that exercises MCP initialize and tools/list through the SDK-facing surface." The current e2e tests use the HTTP transport (`POST /mcp` via supertest), which handles the initialize handshake internally within a single request.

Clarify whether this contract test:
- Creates a `Server` via `mcpService.createServer()` and inspects the initialize response (unit-level) — easier, more direct.
- Or sends a separate `initialize` JSON-RPC call via HTTP (e2e-level) — more realistic but the current HTTP transport (Streamable HTTP) handles initialization as part of the first request.

The unit-level approach is probably cleaner: call `createServer()`, set up a mock transport, send `initialize`, and assert the response contains `instructions`. The e2e HTTP tests can verify `tools/list` returns `outputSchema` on the upgraded tools.

## 10. Checkpoint 3 Is Thin — Consider Merging

Checkpoint 3 is documentation only: write the implementation summary and update the TODO. This is important but doesn't have independent test gates — the gate is "rerun the same tests from Checkpoint 2." Merging it into Checkpoint 2 (write docs after tests pass) would keep the implementation at 2 focused checkpoints instead of 3, and avoids a checkpoint that's just writing docs.

If the three-checkpoint structure is preferred for pacing reasons, that's fine — just noting it's lightweight as a standalone checkpoint.

## 11. `schema://graphql` Resource Description — Proposed Text Would Help

The plan says to update the `schema://graphql` resource description so it's "clearly positioned as a support surface." But it doesn't propose actual text. The current description (`schema.resource.ts:22-23`):

> "The GraphQL schema for the Context Router API, showing available types, queries, and mutations."

A concrete proposed replacement would help the implementer. Something like:

> "GraphQL schema for the Context Router API. Use this for API introspection and direct GraphQL integration, not for preference lookup — use searchPreferences or smartSearchPreferences for that."

## 12. `smartSearchPreferences` Descriptor — Missing `openWorldHint`

The current `smartSearchPreferences` descriptor (`smart-search.tool.ts:38-41`) has `readOnlyHint: true` but no `openWorldHint`. The other read tools explicitly set `openWorldHint: false`. Since the plan is already touching this descriptor, it should add `openWorldHint: false` for consistency.

## 13. Minor: Plan References Wrong Doc Path

The plan's summary line references `docs/plans/active/preference-extraction/full-auto/mcp-desc-updates/` (note: `desc-updates` not `descr-updates`). The actual filesystem path is `mcp-descr-updates/`. This should be consistent to avoid confusion.

---

## Summary of Recommendations

| # | Area | Action |
|---|------|--------|
| 1 | SDK readiness | State explicitly that v1.27.1 supports all needed features, no upgrade needed |
| 2 | `instructions` placement | Specify it goes in `ServerOptions` (2nd arg to `Server` constructor) |
| 3 | Dual-error path | Unify the error paths in `PreferenceListTool` and `PreferenceSearchTool` |
| 4 | Client migration | Add a note about which consumers need updating |
| 5 | `outputSchema` strategy | Specify inline JSON Schema objects (not a separate schema layer) |
| 6 | Error `structuredContent` | Always populate on errors; ensure `outputSchema` accommodates error shape |
| 7 | Shared helper | Bound scope to read tools; don't replace `mutatePreferences` pattern |
| 8 | `consolidateSchema` | Either include it or add it as first follow-up item |
| 9 | Contract test level | Clarify unit vs e2e approach for initialize test |
| 10 | Checkpoint 3 | Consider merging into Checkpoint 2 |
| 11 | Schema resource text | Provide concrete proposed description |
| 12 | `openWorldHint` | Add `openWorldHint: false` to `smartSearchPreferences` |
| 13 | Doc path typo | Fix `mcp-desc-updates` vs `mcp-descr-updates` |
