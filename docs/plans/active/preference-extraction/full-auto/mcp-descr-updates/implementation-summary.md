# MCP Preference Discovery Contract Cleanup

## What Changed

This pass upgraded the MCP preference-read surface so agents can discover the right tool and read structured results without parsing JSON out of `content[0].text`.

Shipped changes:

- `mcp.server.version` was bumped from `1.0.0` to `2.0.0` to mark the breaking output-contract change.
- `McpService.createServer()` now exposes short server-level MCP `instructions` that explain when to use `searchPreferences`, `smartSearchPreferences`, `listPreferenceSlugs`, `listPermissionGrants`, and `schema://graphql`.
- The read-only MCP tools now have clearer descriptions:
  - `searchPreferences` is described as literal catalog-based filtering plus stored-value retrieval, not semantic search.
  - `smartSearchPreferences` is described as natural-language intent to relevant slugs, then matching stored preferences.
  - `listPreferenceSlugs` is described as schema discovery only.
  - `listPermissionGrants` is described as access-debugging help when grants may hide results.
  - `consolidateSchema` is described as advisory schema analysis, not preference retrieval.
- `smartSearchPreferences` and `consolidateSchema` now advertise `openWorldHint: false`.
- `schema://graphql` now explicitly says it is for API introspection, not preference lookup.
- `listPreferenceSlugs`, `searchPreferences`, `smartSearchPreferences`, `listPermissionGrants`, and `consolidateSchema` now expose `outputSchema`.
- Those same read tools now return canonical data through `structuredContent`.
- The text payload in `content` is now a short summary using the format `toolName: ...` instead of a full JSON dump.
- `PreferenceListTool` and `PreferenceSearchTool` no longer swallow errors inside `list()` or `search()`. Failures now propagate to `execute()` and return `isError: true` with structured error content.
- `consolidateSchema` was included in the structured-output pass so the read-only MCP tool surface stays consistent.

## Why No SDK Bump Was Needed

No MCP SDK upgrade was required for this implementation. The installed SDK already supported the features used here:

- `ServerOptions.instructions`
- `Tool.outputSchema`
- `CallToolResult.structuredContent`
- `InMemoryTransport.createLinkedPair()` for initialize-contract testing

Because the necessary protocol features were already available, this change was implemented entirely in the backend MCP layer rather than by changing SDK versions or widening local MCP interface types.

## Client Migration

This is a breaking output-contract change for MCP read-tool consumers.

Clients must now:

- treat `structuredContent` as the source of truth for `listPreferenceSlugs`, `searchPreferences`, `smartSearchPreferences`, `listPermissionGrants`, and `consolidateSchema`
- treat `content` as summary-only human-readable text
- expect errors on those read tools to include:
  - `result.isError = true`
  - `structuredContent.success = false`
  - `structuredContent.error`

Clients should no longer parse read-tool JSON from `content[0].text`.

Because tool metadata changed as well, remote or cached MCP client registrations may need to be refreshed so clients pick up:

- the new `2.0.0` server version
- revised tool descriptions
- new `outputSchema` metadata

## Why `structuredContent` Is Now Canonical

The old contract forced agents and tests to parse serialized JSON from text content. That was fragile and made tool outputs harder to consume reliably.

Using `structuredContent` as the source of truth gives agents:

- a stable machine-readable payload
- explicit success vs error handling
- discoverable output metadata through `outputSchema`

The short text summary remains useful for humans and for clients that still render plain-text tool output, but it is no longer the canonical contract.

## Validation

Targeted MCP/backend tests run after the implementation:

- `pnpm --filter backend exec jest src/mcp/tools/preference-list.tool.spec.ts src/mcp/tools/smart-search.tool.spec.ts src/mcp/tools/schema-consolidation.tool.spec.ts test/e2e/mcp.e2e-spec.ts test/e2e/workflows.e2e-spec.ts test/e2e/permission-grants.e2e-spec.ts test/e2e/mcp-access-log.e2e-spec.ts --runInBand`

That suite passed after the implementation.

Coverage from that run includes:

- MCP initialize instructions and server version
- `tools/list` exposure of `outputSchema`
- read-tool `structuredContent` behavior
- smart search and schema consolidation workflows
- permission-grant filtering
- MCP access-log behavior with summary-only text content

## Known Limitations

- `mutatePreferences` was intentionally left on its existing result contract in this pass.
- No new guide resource was added.
- No higher-level wrapper tool was added to auto-route between literal lookup and natural-language lookup.
- External MCP client smoke tests were not run as part of this implementation; only in-repo unit and e2e coverage was updated here.
