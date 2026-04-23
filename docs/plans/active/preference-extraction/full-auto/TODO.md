# Full-Auto MCP Mutation TODO

- Status: follow-up
- Last reviewed: 2026-04-22

## Product Follow-Ups

- Add `UPSERT_DEFINITION_AND_SET_PREFERENCE` or an equivalent combined flow for the common "define this missing slug and immediately set a value" path.
- Run model smoke tests against the `mutatePreferences` descriptor and JSON Schema to confirm agents choose the right operation and shape arguments correctly.
- Consider client-specific tool descriptions or capability hints so suggest-only clients are less likely to attempt write or define operations.
- Verify external MCP client registrations do not still expose stale remote mutation names such as `applyPreference`.

## Safety And Semantics

- Add stricter definition update rules before production use, especially for shape-changing updates to `valueType`, `scope`, and `options`.
- Decide whether archived definitions should support a restore flow or only recreate-after-archive.
- Integrate rollback/revert behavior for MCP active writes and definition mutations.
- Decide whether suggest-only clients should ever be allowed to delete their own suggestions.

## Authorization And Operations

- Confirm actual MCP connector app grants and token claims:
  - API scope definitions and the `Context Router M2M` client grant have been verified out of band.
  - Verify the `claude` and `codex` MCP connector applications are authorized for `preferences:read`, `preferences:suggest`, `preferences:write`, and `preferences:define`.
  - Verify the `fallback` MCP connector application is authorized for `preferences:read` only.
  - After refreshing/logging in real MCP clients, decode an actual MCP OAuth access token and confirm the expected grants appear in either the `scope` claim or the `permissions` claim.
  - Current demo nuance: partial recognized token grants narrow MCP access, while a token with no recognized MCP grants falls back to local policy-only authorization. Decide before production whether explicit token scopes should be required.
- Consider object-level MCP access-log details if a future audit workflow needs richer cross-linking between access events and domain audit events.
- Revisit whether `DEFINE` should stay fully separate from read visibility when a production client wants schema-only management.

## Testing Follow-Ups

- Add end-to-end smoke tests with an actual external MCP client once the demo client registrations are refreshed.
- Add regression tests for any future combined define-and-set operation.
- Add production-oriented migration tests if this stops being a demo-only cutover.
