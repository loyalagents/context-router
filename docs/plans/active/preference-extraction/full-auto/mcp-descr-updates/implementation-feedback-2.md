# Implementation Plan Feedback — Round 2

## Overall

The plan has clearly incorporated the first round of feedback well. The scope is tight, the SDK readiness is confirmed (v1.27.1 does export `structuredContent`, `outputSchema`, and `ServerOptions.instructions`), and the checkpoint structure is workable. The revised plan now explicitly calls out the dual-error-path unification, inline `outputSchema` strategy, and the `openWorldHint` fix — all good.

The feedback below is a mix of structural observations, implementation-detail gaps, and risks that an implementer would hit. Ordered roughly by impact.

---

## 1. `CallToolResult` Type May Not Accept `structuredContent` At the Tool Layer

The plan says "No type changes are needed to `McpToolInterface` or `McpToolExecutionResult`" — and this is *technically* correct because `McpToolExecutionResult.result` is typed as `CallToolResult`, and the SDK's `CallToolResult` type does include optional `structuredContent`.

However, TypeScript may not cooperate seamlessly. The SDK's `CallToolResult` is derived from a Zod schema (`CallToolResultSchema`), and the inferred type can be strict about which properties are allowed. Verify early that the following compiles without error:

```typescript
const result: CallToolResult = {
  content: [{ type: 'text', text: 'summary' }],
  structuredContent: { success: true, count: 5 },
};
```

If the Zod inference strips `structuredContent` from the inferred type, you may need either a type assertion or to widen the `result` field in `McpToolExecutionResult` to `CallToolResult & { structuredContent?: Record<string, unknown> }`. This is a five-minute fix if needed, but discovering it mid-implementation is annoying. The plan should note this as a verification step at the start of Checkpoint 2.

## 2. `outputSchema` Must Be `type: "object"` — But Error Shapes Need Thought

The plan correctly notes that `outputSchema` must be `type: "object"` at root per the SDK. But the plan says both success and error responses should populate `structuredContent`. This means the `outputSchema` must accommodate *both* shapes, e.g.:

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "error": { "type": "string" },
    "count": { "type": "integer" },
    "preferences": { "type": "array" }
  },
  "required": ["success"]
}
```

This is fine, but the plan should decide upfront: should the `outputSchema` be the *union* of success and error shapes, or should error responses skip `structuredContent` entirely and rely only on `isError: true` + `content` text?

**Recommendation**: Use a single permissive schema where `success` is the discriminator. Keep error shapes in `structuredContent` — this gives clients one parse path. But document that `error` is only present when `success === false`, and domain fields like `preferences` are only present when `success === true`. An `if/then/else` or `oneOf` in the JSON Schema would be cleaner but adds complexity for little gain at this scale.

## 3. Summary Text Construction Needs a Convention

The plan says `content[0].text` becomes "a short human-readable summary instead of a full JSON dump." But it doesn't specify what the summary looks like. Without a convention, each tool will produce ad-hoc text, and tests become fragile.

Proposed convention:
- **Success**: `"listPreferenceSlugs: 12 preferences across 4 categories"` or `"searchPreferences: 5 active, 2 suggested preferences returned"`
- **Error**: `"listPreferenceSlugs: error — <message>"`

This gives tests a stable prefix to assert on without matching exact text, and gives humans a useful glance. The shared helper should implement this pattern.

## 4. The Shared Helper's Shape Needs Specifying

The plan says to add "a small shared helper for read-tool result construction." Good. But there's a design question: what's the signature?

Two options:

**Option A** — A builder that takes domain data and produces the full `McpToolExecutionResult`:
```typescript
function buildReadToolResult(opts: {
  toolName: string;
  data: Record<string, unknown>;
  summaryText: string;
  accessLog: McpAccessLogMetadata;
}): McpToolExecutionResult
```

**Option B** — A narrower helper that only builds `CallToolResult` (with `content` + `structuredContent`), and each tool still constructs `McpToolExecutionResult` itself:
```typescript
function buildCallToolResult(opts: {
  toolName: string;
  data: Record<string, unknown>;
  summaryText: string;
}): CallToolResult
```

Option A is more useful (each tool has identical result-wrapping boilerplate), but it means the helper also owns `accessLog` construction, which differs per tool. Option B is safer — keep the helper focused on the MCP result shape and let tools own their access logs.

**Recommendation**: Option B, plus a separate error variant:
```typescript
function buildReadToolError(opts: {
  toolName: string;
  error: string;
}): CallToolResult
```

## 5. Error Unification Has a Subtle Test Implication

The plan correctly calls for removing the inner try/catch from `PreferenceListTool.list()` and `PreferenceSearchTool.search()`. But both of these methods are called directly in the unit tests (`preference-list.tool.spec.ts` calls `tool.execute()` which calls `list()`, and tests inspect the result).

More importantly, `PreferenceListTool.list()` is *only* called from `execute()` — it's not reused elsewhere. So removing its internal catch is clean. But `PreferenceSearchTool.search()` is similarly self-contained. Verify that no other caller depends on the `{ success: false, error }` return shape from these methods before removing the catch.

The plan mentions this but should explicitly state: after removing the inner catch, the `list()` and `search()` methods should no longer return `{ success: false, error }` as a normal value — failures become exceptions that `execute()` handles. Tests that assert `success === false` from the domain method need to switch to asserting `result.isError === true` from `execute()`.

## 6. `instructions` Content Should Be Short and Stable

The plan proposes server-level instructions as a "short retrieval guide." Good. But consider that `instructions` is a single string that every MCP client receives on initialize. If it's too long, clients will truncate or ignore it. If it references tool names that a client can't access (due to permission grants), it's misleading.

**Recommendations**:
- Keep it under 500 characters. This isn't a user manual — it's a dispatch hint.
- Don't reference tools by name in instructions if the tool list is already filtered by permissions. Instead, describe the *retrieval strategy* generically: "For known-slug or category lookup, use the catalog search tool. For natural-language intent, use the semantic search tool. For definition discovery, use the slug listing tool."
- Alternatively, if you *do* reference tool names, accept that the instructions are a superset of what any given client can see. This is fine if you add a preamble like "The following tools may be available depending on your permissions."

## 7. `listPermissionGrants` Descriptor Update Is Underspecified

The plan says to "strengthen descriptor text" for `listPermissionGrants`, but the current description (`"List permission grants for the calling MCP client only. Read-only introspection for debugging access."`) is already pretty clear. What specifically should change?

If the goal is to make it clear that this tool is *not* for preference retrieval but for access debugging, the current text already does that. The main improvement would be explaining *when* an agent should call it — e.g., "Call this tool when a preference operation is denied to understand which permission grants are in effect for your client."

## 8. `createServer()` Currently Receives `instructions` via ServerOptions — But the Second Arg Is Already Used

Looking at the current code (`mcp.service.ts:87-98`):

```typescript
const server = new Server(
  { name: serverConfig.name, version: serverConfig.version },
  { capabilities: { tools: {}, resources: {} } }
);
```

The SDK's `Server` constructor signature is `constructor(_serverInfo: Implementation, options?: ServerOptions)`. The `ServerOptions` type extends `ProtocolOptions` and adds `instructions?: string`. So the fix is simply adding `instructions` as a sibling to `capabilities` in the second argument:

```typescript
const server = new Server(
  { name: serverConfig.name, version: serverConfig.version },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: '...',
  }
);
```

This is straightforward, but the plan should specify whether the instructions text is hardcoded in the service, loaded from config (like `mcp.server.instructions`), or injected as a constant. Config-driven is probably overkill for a single string — a co-located constant or inline string in `createServer()` is fine for now.

## 9. Test Strategy for `outputSchema` in `tools/list` Needs Precision

The plan says "Add or update a `tools/list` contract test that asserts the upgraded tools expose `outputSchema` and the revised descriptor text." The current `tools/list` e2e test (`mcp.e2e-spec.ts:145-158`) only checks that `searchPreferences` and `listPreferenceSlugs` are present.

The new test should assert:
- Each upgraded tool has an `outputSchema` property.
- The `outputSchema.type` is `"object"`.
- The `outputSchema.properties` includes at least `success`.
- Non-upgraded tools (`mutatePreferences`, `consolidateSchema`) do *not* have `outputSchema`.

But be careful about asserting exact schema shapes in e2e tests — that makes the tests brittle to any future schema refinement. Assert structural invariants (has `outputSchema`, it's an object schema with a `success` property), not full deep equality.

## 10. `consolidateSchema` Exclusion — The Inconsistency Is Worse Than It Looks

The previous feedback flagged this, and the plan acknowledges it by adding consolidateSchema alignment to `TODO.md`. But here's the practical problem: if you introduce a shared read-tool result helper, `consolidateSchema` is the most natural consumer — it follows the *exact* same pattern as the four in-scope tools. Leaving it out means the helper is used by 4/5 read tools, and the remaining one uses the old JSON-dump-into-text pattern.

An implementer will either:
1. Upgrade `consolidateSchema` anyway (it's 15 minutes of work with the helper).
2. Leave it alone, and then someone else will upgrade it later and wonder why it wasn't done in this pass.

**Recommendation**: Include it. The scope expansion is minimal (one more tool, same pattern), and it eliminates a visible inconsistency in the MCP surface. If you explicitly exclude it, at least add a code comment in `schema-consolidation.tool.ts` saying "Intentionally not upgraded to structured output in this pass — see TODO.md."

## 11. Access-Log Behavior With `structuredContent` — Confirm No Breakage

The access log system (`McpAccessLogService`) stores `responseMetadata` from `accessLog.responseMetadata`. Currently, each tool sets its own response metadata (e.g., `count`, `categories`, `activeCount`). The plan doesn't change the access log surface, which is correct.

But verify that the `McpService.createServer()` dispatch code (`mcp.service.ts:290-310`) still works correctly when `execution.result` contains `structuredContent`. The dispatch code inspects `execution.result.isError` for outcome determination — this should be unaffected. But if any code inspects `execution.result.content` structure (e.g., for logging), confirm it handles the shorter summary text gracefully.

## 12. The Breaking Change Needs a Version Bump or Clear Signaling

The plan says "Treat the removal of full JSON payloads from `content[0].text` as an explicit breaking output change." But how is this signaled to clients?

Options:
- Bump the MCP server version in config (`mcp.server.version: '1.0.0'` → `'2.0.0'`). This is the most visible signal.
- Add a `_meta` field to responses indicating the output contract version.
- Document it in the implementation summary and let clients discover the change.

The plan doesn't specify. Since this is a pre-production demo system, the version bump is probably sufficient, but it should be mentioned explicitly. Clients that check `serverInfo.version` will know something changed.

## 13. Checkpoint 1 Test for `initialize` — Confirm Transport Compatibility

The plan says to add a contract test that exercises `initialize` directly. The first feedback asked whether this is unit or e2e. Given that the current e2e tests use Streamable HTTP transport (which handles init internally), the cleanest approach is a unit-level test:

```typescript
const server = mcpService.createServer(context);
// Use an in-memory transport pair
// Send initialize request
// Assert response.instructions is present
```

But the MCP SDK's `Server` class requires a transport to handle requests. You'd need either:
- The SDK's `InMemoryTransport` or `StreamTransport` for testing.
- A mock transport that captures the initialize response.

Verify that the SDK exports a suitable test transport. If not, you may need to test `instructions` indirectly by inspecting the server's internal state (less clean) or by adding the assertion to the existing HTTP e2e flow.

## 14. Minor: Plan Doesn't Address `suggestPreference` and `createPreferenceDefinition` Remote Tool Names

The plan says "Keep tool names unchanged." But the remote MCP surface (visible in the available deferred tools at the top of conversations) includes `suggestPreference`, `createPreferenceDefinition`, `deletePreference`, `applyPreference`, and `searchPreferences` as separate tool names. The TODO already flags verifying that stale remote names don't persist — but the plan should confirm that the *remote MCP client registrations* (e.g., Claude Desktop config, or whatever configures the deferred tools) won't break when the output contract changes.

This may be out of scope for the plan itself, but it's worth a note in the implementation summary.

---

## Summary of Recommendations

| # | Area | Action |
|---|------|--------|
| 1 | `CallToolResult` typing | Verify `structuredContent` compiles on the inferred Zod type early in Checkpoint 2 |
| 2 | `outputSchema` shape | Decide on union schema with `success` discriminator; document which fields appear in which case |
| 3 | Summary text | Define a `"toolName: N items returned"` convention; helper should implement it |
| 4 | Shared helper signature | Use Option B (builds `CallToolResult` only), plus error variant; tools own their `accessLog` |
| 5 | Error unification tests | Explicitly note that `list()` / `search()` no longer return `{ success: false }` — callers must catch |
| 6 | `instructions` content | Keep under 500 chars; describe retrieval strategy, not tool names |
| 7 | `listPermissionGrants` | Specify *when* to call it, not just *what* it does |
| 8 | `instructions` source | Inline constant in `createServer()`, not config-driven |
| 9 | `tools/list` test | Assert structural invariants (has `outputSchema`, has `success` property), not full schema equality |
| 10 | `consolidateSchema` | Include it — 15 min work, eliminates visible inconsistency |
| 11 | Access-log compat | Verify dispatch code handles `structuredContent` without side effects |
| 12 | Breaking change signal | Bump `mcp.server.version` to `2.0.0` |
| 13 | Initialize test | Verify SDK exports a test transport; fall back to internal state inspection if not |
| 14 | Remote tool names | Note in implementation summary that remote client configs may need updating |
