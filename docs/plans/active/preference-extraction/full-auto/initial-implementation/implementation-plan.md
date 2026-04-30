# Full-Auto MCP Mutation Implementation Plan

## Summary

Implement the demo-focused MCP mutation redesign as an atomic permission cutover plus one operation-based MCP mutation tool. The final MCP mutation surface will be `mutatePreferences`, backed by `READ < SUGGEST < WRITE` value permissions plus separate `DEFINE` permissions, operation-level authorization, domain audit rows for actual writes, and MCP access-log rows for every mutation-tool attempt. Backwards compatibility and existing demo data migration safety are out of scope.

## Implementation Steps

1. **Atomically Replace Permission Actions**
   - Change Prisma/GraphQL `GrantAction` to `READ | SUGGEST | WRITE | DEFINE`; treat this checkpoint as a compile-breaking cutover until all call sites are updated.
   - Clear existing `permission_grants` during the demo cutover so stale `WRITE` rows do not silently change meaning.
   - Update `McpAccess.action` to `read | suggest | write | define`, expand `MCP_CAPABILITIES`, update `toCapability()`, and update lowercase-to-uppercase grant action normalization tests.
   - Update generated Prisma/GraphQL artifacts, permission-grant service typing, repository tests, e2e fixtures, inline mock client policies, test auth defaults, and frontend generated types.
   - Update `mcp.config.ts` capabilities and OAuth scopes; note that Auth0 API scopes may need an out-of-band configuration update.
   - Update the web permissions page action type and dropdown options to include all four actions.
   - Verify hierarchy and isolation: `READ` denies block `SUGGEST` and `WRITE`, `SUGGEST` denies block `WRITE`, `WRITE` denies do not block reads, and `DEFINE` is independent from value permissions.
   - **Gate 1:** run permission-grant unit/integration tests and MCP authorization specs before moving on.

2. **Update MCP Dispatcher Authorization**
   - Extend `McpToolInterface.requiredAccess` to accept `McpAccess | McpAccess[]`.
   - Add `canAccessAny()` to `McpAuthorizationService`; do not add `assertAccessAny()` unless a later implementation need appears.
   - Normalize `requiredAccess` to an array in `McpService.onModuleInit()` and validate each access entry with `toCapability()` so array declarations do not crash startup.
   - Use `canAccessAny()` for `tools/list` filtering and pre-dispatch `tools/call` coarse authorization.
   - For no-access pre-dispatch failures on a multi-access tool, return a controlled dispatch-level permission error instead of a vague any-of assertion error.
   - `mutatePreferences` should be visible/callable when the client has at least one of `SUGGEST`, `WRITE`, or `DEFINE`; exact operation+target authorization remains inside the tool handler.
   - Give `claude` and `codex` all four demo capabilities; keep `fallback` read-only and `unknown` empty. Fallback should see only read tools/resources and no `mutatePreferences`.
   - **Gate 2:** run `mcp-authorization.service.spec.ts`, `permission-grants.e2e-spec.ts`, and `mcp.e2e-spec.ts` after the permission/capability/dispatcher cutover compiles.

3. **Add Generic Write-Tool Access Logging Support**
   - Add `accessLogPolicy?: 'default' | 'always'` to `McpToolInterface`.
   - Keep default behavior equivalent to today: read-only tools log via `readOnlyHint === true`.
   - Change the MCP dispatch logging gate to:
     - `tool.accessLogPolicy === 'always' || tool.descriptor.annotations?.readOnlyHint === true`
   - Preserve current unconditional unknown-tool logging and existing resource-read logging.
   - Ensure tools with `accessLogPolicy: 'always'` create `McpAccessEvent` rows for success, denial, validation errors, and thrown handler errors.

4. **Add `mutatePreferences` Tool**
   - Register one new MCP mutation tool named `mutatePreferences`.
   - Supported operations: `SUGGEST_PREFERENCE`, `SET_PREFERENCE`, `CREATE_DEFINITION`, `UPDATE_DEFINITION`, `ARCHIVE_DEFINITION`, `DELETE_PREFERENCE`.
   - Set `requiredAccess` to the any-of mutation actions: `SUGGEST`, `WRITE`, and `DEFINE`.
   - Set `accessLogPolicy: 'always'`.
   - Keep `value` as a JSON string for MCP compatibility.
   - Make `evidence` a structured object, not a JSON-encoded string.
   - Write the MCP descriptor `description` as a first-class interface artifact: clearly list each operation, required fields, required permission, and when to use it.
   - Use a simple JSON Schema with clear descriptions rather than complex `oneOf`; enforce operation-specific requirements in runtime validation.
   - Implement the new tool directly against domain services; extract or reuse small helper logic only where it keeps the new response contract clear.
   - Log sanitized request/response metadata only: operation, target slug when available, required permission, success flag, error code, and safe object ids/counts. Do not store raw preference values, raw evidence, or full returned objects in `McpAccessEvent`.

5. **Implement Operation Behavior**
   - `SUGGEST_PREFERENCE`: require `SUGGEST`; call `PreferenceService.suggestPreference`; if suppressed by a prior rejection, return `success: true`, `changed: false`, `code: "SUGGESTION_SUPPRESSED"`, `preference: null`.
   - `SET_PREFERENCE`: require `WRITE`; call `PreferenceService.setPreference`; populate optional `confidence` and structured `evidence` on `MutationContext`, not `SetPreferenceInput`; use `sourceType: INFERRED` for all MCP active writes in v1. No service-layer change is needed because `MutationContext` and `setPreference()` already pass these fields through to persistence.
   - `CREATE_DEFINITION`: require `DEFINE`; check target access against the new slug before creation; call `PreferenceDefinitionService.create`.
   - `UPDATE_DEFINITION`: require `DEFINE`; resolve by `id` or `slug`; reject global, non-owned, missing, or archived definitions; call `PreferenceDefinitionService.update`.
   - `ARCHIVE_DEFINITION`: require `DEFINE`; resolve by `id` or `slug`; reject global, non-owned, missing, or archived definitions; call `PreferenceDefinitionService.archiveDefinition`.
   - `DELETE_PREFERENCE`: require `WRITE`; resolve the preference first to check target slug access; call `PreferenceService.deletePreference`. Known v1 limitation: suggest-only clients cannot delete suggestions.
   - Define `changed: true` as “the operation performed a domain write,” not “the semantic value differed from previous state.” Suppressed suggestions and validation/permission failures return `changed: false`.
   - **Gate 3:** run targeted `mcp.e2e-spec.ts` coverage for the new tool operations before removing old mutation tools.

6. **Make The MCP Tool List Demo-Clean**
   - Register `mutatePreferences` in `MCP_TOOLS`.
   - Remove old mutation tools from the MCP registry: `suggestPreference`, `createPreferenceDefinition`, and `deletePreference`.
   - Keep existing read tools, workflow tools, `listPermissionGrants`, and `schema://graphql` except for permission-action updates.
   - Remove unused old mutation providers/helpers if no longer referenced.
   - Note a known v1 UX limitation: a suggest-only client can see the full `mutatePreferences` schema because tool visibility is any-of, but unauthorized operations return structured permission errors.

7. **Update Tests And Verification**
   - Add MCP e2e success coverage for all six operations and denial coverage for `SUGGEST`, `WRITE`, and `DEFINE`.
   - Test `DEFINE` specificity on not-yet-existing slugs, including exact deny over wildcard allow.
   - Test lowercase MCP actions map to uppercase Prisma grant actions for `read`, `suggest`, `write`, and `define`.
   - Test suppressed suggestion response shape and `changed` semantics.
   - Test archived definition rejection uses `PREFERENCE_DEFINITION_ARCHIVED`.
   - Test fallback clients do not see `mutatePreferences` in `tools/list`.
   - Test `tools/list` includes `mutatePreferences` for mutation-capable clients and excludes old mutation tools.
   - Verify domain audit rows for MCP active writes, deletes, and definition mutations include MCP actor provenance and correlation id.
   - Verify every `mutatePreferences` success, denial, and validation error creates an MCP access-log row with sanitized metadata.
   - Restore and enforce explicit error codes:
     - `MCP_PERMISSION_DENIED`
     - `INVALID_MUTATION_OPERATION`
     - `INVALID_MUTATION_INPUT`
     - `INVALID_PREFERENCE_VALUE`
     - `UNKNOWN_PREFERENCE_SLUG`
     - `SUGGESTION_SUPPRESSED`
     - `INVALID_PREFERENCE_DEFINITION`
     - `PREFERENCE_DEFINITION_CONFLICT`
     - `PREFERENCE_DEFINITION_NOT_FOUND`
     - `PREFERENCE_DEFINITION_NOT_OWNED`
     - `PREFERENCE_DEFINITION_ARCHIVED`
     - `PREFERENCE_NOT_FOUND`
     - `PREFERENCE_NOT_OWNED`
     - `INTERNAL_ERROR`
   - Run targeted checks:
     - `pnpm --filter backend prisma:generate`
     - `pnpm --filter backend test:db:migrate`
     - `pnpm --filter backend exec jest src/mcp/auth/mcp-authorization.service.spec.ts --runInBand`
     - `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts test/e2e/permission-grants.e2e-spec.ts test/e2e/audit-history.e2e-spec.ts test/e2e/mcp-access-log.e2e-spec.ts --runInBand`
   - Run broader validation once targeted tests pass:
     - `pnpm --filter backend test:integration`
     - `pnpm --filter backend build`
     - frontend codegen/lint/build if frontend permission files or generated types changed.

8. **Write PR Docs And Follow-Ups**
   - Mark `docs/plans/active/preference-extraction/full-auto/pre-implementation-summary.md` as superseded by the final implementation summary, or update it to match the shipped behavior.
   - Update stale current docs, especially MCP authorization, MCP access logging, and preference schema docs.
   - Add `docs/plans/active/preference-extraction/full-auto/implementation-summary.md` covering permission changes, `mutatePreferences`, old tool registry cleanup, MCP access logging, audit behavior, frontend permission updates, tests run, and known limitations.
   - Add `docs/plans/active/preference-extraction/full-auto/TODO.md` covering: combined `UPSERT_DEFINITION_AND_SET_PREFERENCE`, stricter definition shape-change rules, rollback/revert integration, Auth0 scope configuration follow-up if needed, object-level MCP access logs, model smoke testing for the tool JSON Schema and descriptor description, possible client-specific tool descriptions/capability hints, and verification that external MCP client registrations do not still expose stale mutation tools such as `applyPreference`.

## Public Interfaces And Response Policy

- MCP capabilities:
  - `preferences:read`
  - `preferences:suggest`
  - `preferences:write`
  - `preferences:define`
- Prisma/GraphQL grant actions:
  - `READ`
  - `SUGGEST`
  - `WRITE`
  - `DEFINE`
- Value permissions are hierarchical: `WRITE` includes `SUGGEST` and `READ`; `SUGGEST` includes `READ`; `DEFINE` is independent.
- New MCP mutation tool:
  - `mutatePreferences`
- Old MCP mutation tools no longer appear in `tools/list`.
- Successful mutation responses include `success`, `changed`, `operation`, `requiredPermission`, `target`, optional `preference`, optional `definition`, and `audit`.
- Permission/validation failures return structured `success: false`, `changed: false`, `code`, `requiredPermission`, `target`, and `error`.
- Suppressed suggestions are explicit no-ops: `success: true`, `changed: false`, `code: "SUGGESTION_SUPPRESSED"`.

## Assumptions

- No backwards compatibility is required for old MCP tool names, old grant semantics, or existing demo data.
- The first pass will not implement automatic define-and-set in one operation.
- Definition shape-changing updates are allowed for the demo and documented as future hardening work.
- MCP active writes use `sourceType: INFERRED` in v1; callers cannot override source type.
- Runtime MCP mutation attempts appear in MCP access history; actual domain changes also appear in preference audit history.
- Auth0 may need matching scope configuration outside code; document this if implementation cannot verify it locally.
