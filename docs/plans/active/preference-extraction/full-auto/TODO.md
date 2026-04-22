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

- Confirm Auth0 API scopes are updated out of band for `preferences:suggest` and `preferences:define`.
- Consider object-level MCP access-log details if a future audit workflow needs richer cross-linking between access events and domain audit events.
- Revisit whether `DEFINE` should stay fully separate from read visibility when a production client wants schema-only management.

## Testing Follow-Ups

- Add end-to-end smoke tests with an actual external MCP client once the demo client registrations are refreshed.
- Add regression tests for any future combined define-and-set operation.
- Add production-oriented migration tests if this stops being a demo-only cutover.

