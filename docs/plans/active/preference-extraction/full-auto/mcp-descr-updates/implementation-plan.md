# MCP Preference Discovery Contract Cleanup

## Summary

Ship a breaking-but-contained upgrade to the MCP preference-read surface so agents can choose the right retrieval path and parse results from `structuredContent` instead of scraping JSON text.

This pass stays on the current MCP SDK. No SDK upgrade is needed: the installed SDK already supports `ServerOptions.instructions`, `Tool.outputSchema`, `CallToolResult.structuredContent`, and `InMemoryTransport` for contract tests. The work is in how the backend uses the existing SDK.

This pass also broadens the structured-output upgrade to include `consolidateSchema` so the read-only MCP tool surface is consistent.

## Key Changes

### MCP server contract
- Update `McpService.createServer()` to pass `instructions` in the second `Server` constructor argument, alongside `capabilities`.
- Define the instructions as a short co-located constant in `mcp.service.ts`, not config-driven.
- Keep the instructions under 500 characters and start with a permissions preamble, e.g. “Available tools vary by permissions.”
- The instructions should name the tools explicitly:
  - `searchPreferences` for known-slug, known-category, or full active preference retrieval
  - `smartSearchPreferences` for natural-language intent to relevant slugs
  - `listPreferenceSlugs` for schema discovery only
  - `listPermissionGrants` when results may be hidden by grants
  - `schema://graphql` for API introspection only
- Bump `mcp.server.version` from `1.0.0` to `2.0.0` to signal the breaking output-contract change.

### Descriptor and resource cleanup
- Strengthen descriptor text for:
  - `listPreferenceSlugs`
  - `searchPreferences`
  - `smartSearchPreferences`
  - `listPermissionGrants`
  - `consolidateSchema`
- Make the semantics explicit:
  - `searchPreferences` is literal catalog-based filtering plus stored-value retrieval, not semantic search
  - no `query` on `searchPreferences` means “return all active preferences,” optionally location-merged
  - `smartSearchPreferences` identifies relevant slugs from a natural-language task, then returns matching stored preferences; it is not product search or web search
  - `listPreferenceSlugs` returns definitions, not stored user values
  - `listPermissionGrants` is for access debugging when expected results are missing
  - `consolidateSchema` is advisory schema analysis, not preference retrieval
- Add `openWorldHint: false` to `smartSearchPreferences` and `consolidateSchema`.
- Replace the `schema://graphql` description with concrete text:
  - “GraphQL schema for the Context Router API. Use this for API introspection and direct GraphQL integration, not for preference lookup; use searchPreferences or smartSearchPreferences for preference retrieval.”
- Keep tool names unchanged. Do not add aliases, a guide resource, or a new wrapper tool in this pass.

### Structured-first read results
- Upgrade these read surfaces to use inline `outputSchema` objects directly in their descriptors:
  - `listPreferenceSlugs`
  - `searchPreferences`
  - `smartSearchPreferences`
  - `listPermissionGrants`
  - `consolidateSchema`
- Use one permissive object schema per tool with `success` as the discriminator:
  - `required: ["success"]`
  - `success: boolean`
  - `error?: string`
  - success-only fields as optional top-level properties
- Do not use `oneOf` or `if/then/else` JSON Schema logic in this pass.
- Make `structuredContent` the canonical payload for all upgraded read tools.
- Keep `content` present on every result, but change it to a short summary instead of a full JSON dump.
- Standardize result shape:
  - success: `structuredContent.success = true` plus the tool’s existing top-level fields
  - error: `structuredContent.success = false`, `error`, and `result.isError = true`
  - no nested `data` wrapper
- Use a fixed summary convention implemented by a shared helper:
  - success: `"toolName: <summary>"`
  - error: `"toolName: error — <message>"`
- Add a narrow shared helper in the MCP tools layer that builds `CallToolResult` only:
  - one helper for success
  - one helper for error
  - tools continue to construct their own `McpToolExecutionResult` and `accessLog`
- Do not change the `mutatePreferences` result/envelope path.

### Error-path cleanup
- Unify error behavior in `PreferenceListTool` and `PreferenceSearchTool`:
  - remove the inner try/catch from `list()` and `search()`
  - let real failures throw
  - handle MCP errors only in `execute()`
- After this change, `list()` and `search()` no longer return `{ success: false, error }` as a normal value.
- Any caller expecting domain-method error objects must be updated to expect thrown errors or to call `execute()` and assert `isError`.

### Breaking change and docs
- Treat removal of full JSON payloads from `content[0].text` as an explicit breaking output change.
- Add `docs/plans/active/preference-extraction/full-auto/mcp-descr-updates/implementation-summary.md`.
- The implementation summary must cover:
  - what changed in the MCP read contract
  - why no SDK bump was needed
  - why the server version was bumped to `2.0.0`
  - why `structuredContent` is now the source of truth
  - what MCP clients must change
  - tests run and known limitations
  - a note that remote or cached MCP client registrations/tool metadata may need refreshing after the contract change
- Update `docs/plans/active/preference-extraction/full-auto/TODO.md`:
  - remove or narrow the generic descriptor/capability-hint follow-up that this pass fulfills
  - add the remaining follow-ups from this area:
    - client-specific descriptor variants if needed later
    - a guide resource if still desired later
    - a higher-level wrapper tool if still desired later
    - external-client smoke testing of the structured-first contract
    - verification that stale remote tool registrations do not preserve outdated metadata or names

## Checkpoints

### Checkpoint 1: Server guidance and descriptor contract
- Add MCP initialize instructions through `ServerOptions.instructions`.
- Update `mcp.server.version` to `2.0.0`.
- Rewrite the in-scope tool/resource descriptions and add `openWorldHint: false` where missing.
- Add a server-level contract test using `InMemoryTransport.createLinkedPair()` that sends `initialize` and asserts:
  - `instructions` is present
  - `serverInfo.version` is `2.0.0`
- Add or update a `tools/list` contract test that asserts:
  - upgraded read tools expose `outputSchema`
  - each `outputSchema.type` is `"object"`
  - each upgraded `outputSchema` includes a `success` property
  - `mutatePreferences` still does not expose `outputSchema`
- Gate:
  - targeted MCP contract tests
  - existing descriptor/unit tests for touched tools

### Checkpoint 2: Structured-first read-tool outputs
- Verify immediately that `CallToolResult` accepts `structuredContent` cleanly in this codebase, then proceed with the structured-output refactor.
- Implement inline `outputSchema` and `structuredContent` for the five upgraded read tools.
- Add the shared read-tool result helper with the fixed summary convention.
- Replace JSON-text payloads with summary text.
- Unify `PreferenceListTool` and `PreferenceSearchTool` error propagation so failures always surface through the `execute()` `isError: true` path.
- Update `consolidateSchema` to the same structured-first contract so the read-only MCP tools are consistent.
- Keep each tool’s access-log metadata logic intact.
- Gate:
  - unit tests for the upgraded tools
  - `mcp.e2e-spec.ts`
  - `workflows.e2e-spec.ts`
  - `permission-grants.e2e-spec.ts`
  - `mcp-access-log.e2e-spec.ts`

### Checkpoint 3: Documentation and follow-up cleanup
- Add `docs/plans/active/preference-extraction/full-auto/mcp-descr-updates/implementation-summary.md`.
- Update `docs/plans/active/preference-extraction/full-auto/TODO.md`.
- Ensure the implementation summary includes a migration section for MCP clients, a note about the version bump, and a note that no SDK upgrade was required.
- Gate:
  - rerun the same targeted MCP backend test set from Checkpoint 2 after the final doc pass
  - verify docs match shipped behavior exactly

## Test Plan

- Add one initialize-focused contract test using `InMemoryTransport.createLinkedPair()` rather than relying on the HTTP transport handshake.
- Add or update `tools/list` assertions so upgraded read tools expose `outputSchema`, use object-root schemas, and include a `success` property.
- Do not assert full deep-equality of `outputSchema` objects in e2e tests; assert structural invariants only.
- Update unit tests for `PreferenceListTool`, `SmartSearchTool`, and `SchemaConsolidationTool` to assert `structuredContent` instead of parsing JSON text.
- Add or update read-tool tests so each upgraded tool verifies:
  - success responses populate `structuredContent.success = true`
  - error responses populate `structuredContent.success = false` and `isError = true`
  - `content` is summary-only, not a full serialized JSON payload
- E2E coverage must verify:
  - `searchPreferences` with no `query` still returns all active preferences
  - `searchPreferences` remains literal, not semantic
  - `smartSearchPreferences` still returns matched definitions and matching stored preferences
  - `consolidateSchema` still returns advisory schema-analysis data, now via `structuredContent`
  - permission filtering still applies
  - `listPermissionGrants` still scopes to the calling client
- Confirm access-log behavior is unchanged:
  - dispatch outcome still keys off `isError`
  - existing `requestMetadata` and `responseMetadata` assertions still pass with summary-only text content

## Assumptions And Defaults

- No MCP SDK upgrade is part of this pass.
- No changes to `McpToolInterface` or `McpToolExecutionResult` are planned unless compilation proves unexpectedly stricter than the installed SDK types indicate.
- `structuredContent` is the source of truth for upgraded read tools; `content` remains present and summary-only.
- The breaking output change is signaled by bumping the MCP server version to `2.0.0`.
- Tool names remain stable; the break is in result-contract expectations, not in tool discovery names.
