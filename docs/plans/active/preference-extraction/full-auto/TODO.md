# Full-Auto MCP Mutation TODO

- Status: follow-up
- Last reviewed: 2026-04-29

## Product Follow-Ups

- Add `UPSERT_DEFINITION_AND_SET_PREFERENCE` or an equivalent combined flow for the common "define this missing slug and immediately set a value" path.
- Run model smoke tests against the `mutatePreferences` descriptor and JSON Schema to confirm agents choose the right operation and shape arguments correctly.
- Consider client-specific MCP descriptor variants only if real clients still misroute between preference read or write surfaces after the generic descriptor cleanup.
- Consider adding a dedicated MCP guide resource if initialize instructions and tool descriptions still are not enough for agents.
- Consider a higher-level MCP wrapper tool if clients still need server-side routing between literal lookup and natural-language preference retrieval.
- Verify external MCP client registrations do not preserve stale cached metadata or outdated tool names after the `2.0.1` read-contract compatibility correction.

## Safety And Semantics

- Add stricter definition update rules before production use, especially for shape-changing updates to `valueType`, `scope`, and `options`.
- Decide whether archived definitions should support a restore flow or only recreate-after-archive.
- Integrate rollback/revert behavior for MCP active writes and definition mutations.
- Decide whether suggest-only clients should ever be allowed to delete their own suggestions.

## Authorization And Operations

- Confirm actual MCP connector app grants and token claims:
  - API scope definitions and the `Context Router M2M` Client Access grant have been verified out of band for the `client_credentials` smoke test.
  - Keep `Context Router M2M` on Auth0 Client Access with the scopes needed for dev/admin smoke testing. User Access is not needed for that app.
  - Verify the `claude` and `codex` MCP connector applications are authorized through Auth0 User Access for `preferences:read`, `preferences:suggest`, `preferences:write`, and `preferences:define`. Client Access can stay unauthorized for those apps.
  - Verify the `fallback` MCP connector application is authorized through Auth0 User Access for `preferences:read` only. Client Access can stay unauthorized for that app.
  - After refreshing/logging in real MCP clients, decode an actual MCP OAuth access token and confirm the expected grants appear in either the `scope` claim or the `permissions` claim.
  - Current demo nuance: partial recognized token grants narrow MCP access, while a token with no recognized MCP grants falls back to local policy-only authorization. Decide before production whether explicit token scopes should be required.
- Consider object-level MCP access-log details if a future audit workflow needs richer cross-linking between access events and domain audit events.
- Revisit whether `DEFINE` should stay fully separate from read visibility when a production client wants schema-only management.

## Testing Follow-Ups

- Add end-to-end smoke tests with an actual external MCP client once the demo client registrations are refreshed.
- Extend that smoke coverage to verify `structuredContent` parsing, initialize instructions, and `tools/list` `outputSchema` metadata on refreshed external clients.
- Add regression tests for any future combined define-and-set operation.
- Add production-oriented migration tests if this stops being a demo-only cutover.
