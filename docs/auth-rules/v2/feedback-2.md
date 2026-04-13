# Feedback 2

The updated plan is materially better. The static-rule layering, AI pre-filtering requirement, category leakage in `preference-list`, wildcard grammar, and backend-scoped test commands are all in much better shape.

## Findings

1. **[P1] Grant-management MCP tools let a write-capable client remove its own restrictions**

   In `implementation-plan.md:224-244`, `setPermissionGrant` and `removePermissionGrant` are ordinary MCP write tools. In the current capability model, that means any client with coarse `preferences:write` can call them. So if you deny Claude access to some slug/category, Claude can still call `removePermissionGrant` or `setPermissionGrant` and undo the restriction, because those tools have no slug target and therefore will not be narrowed by the new target-aware grant checks.

   This is only safe if the product model is "trusted write-capable clients may always manage policy." If the goal is actual self-restriction for a client bucket, the plan needs an extra control boundary, for example:
   - a separate coarse capability like `permissions:write`
   - grant management outside MCP entirely
   - or a rule that a client cannot mutate grants for its own `clientKey`

2. **[P2] The AI-tool section still needs an explicit workflow integration point**

   The plan correctly says blocked slugs must be filtered before prompt construction, but `implementation-plan.md:45-47` and `:194-203` still place most of the change description on tools plus `PreferenceSchemaSnapshotService`. In the current code, prompt construction and snapshot loading live inside:
   - [`preference-search.workflow.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/workflows/preferences/preference-search/preference-search.workflow.ts)
   - [`schema-consolidation.workflow.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.ts)

   Without explicitly modifying those workflow files or changing their inputs to carry `clientKey`, the tool layer cannot actually enforce the "pre-filter before AI" requirement cleanly. I would add both workflow files to the "Files to modify" list and state whether:
   - the workflows receive `clientKey` and call the filtered snapshot method themselves, or
   - the tools stop delegating prompt construction to the workflows and instead pass in pre-filtered snapshot data

3. **[P2] Slug-only grants are ambiguous when GLOBAL and USER definitions share the same slug**

   The plan defines grants entirely in terms of `target` slug/prefix (`implementation-plan.md:7`, `:16`, `:59`, `:100-110`). In this repo, definitions are namespaced and the same slug can exist in both `GLOBAL` and `USER:<userId>` namespaces. The current repository and snapshot code already work with namespace-aware definitions, but the grant model would treat both as the same target.

   That may be acceptable, but the plan should say so explicitly. Right now it is unclear whether:
   - `deny food.dietary_restrictions read` should block both the global definition and a user-owned override with the same slug
   - or namespace needs to become part of the grant target later

## Open Question

1. If you keep the current "allow by default" model, do you want `listPermissionGrants` to remain visible to read-only clients like Codex? That is consistent with coarse access, but it also exposes the exact restriction policy for every client bucket to any client that can read. If that is intentional, I would document it explicitly.
