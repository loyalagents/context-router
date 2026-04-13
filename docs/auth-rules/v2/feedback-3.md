# Feedback 3

The plan is in much better shape now. The main remaining issues are about scope and consistency rather than the core authorization design.

## Findings

1. **[P1] The plan says grants are managed via the web UI, but it does not include any web or app-facing API work**

   In `implementation-plan.md:5` and `:18`, the product story is now "stored in the DB, configurable via the web UI" and grant management is explicitly not done through MCP write tools. But the file list and checkpoints only add:
   - Prisma model/repository/service
   - MCP auth integration
   - one read-only MCP introspection tool

   There is no backend surface for the web app to actually create/update/delete grants, and no frontend work to expose that UI. In the current repo, that usually means adding backend GraphQL types/resolver/service methods plus corresponding `apps/web` query/mutation/UI work.

   I would either:
   - narrow the plan wording to "v1 implements backend enforcement only; UI management comes later", or
   - add the missing scope explicitly:
     - backend module/resolver/DTO/model for permission grants
     - frontend page/components/queries/mutations for managing grants

2. **[P2] Bulk filtering still does not preserve full `McpTarget` semantics**

   The plan keeps `filterByTargetAccess(client, access, grants, userId, slugs): Promise<string[]>` in `implementation-plan.md:148-151`, and the new snapshot filtering is also described in slug-only terms. That is fine for the new DB grants, because `implementation-plan.md:17` intentionally makes grants namespace-agnostic.

   But it is not fully consistent with the stated layering order `coarse -> static targetRules -> DB grants` from `:14` and `:141`, because the existing static `targetRules` model can match on full `McpTarget`, including `namespace`. In the current code:
   - `McpTarget` has `namespace` + `slug`
   - `PreferenceSchemaSnapshot` definitions include `namespace`
   - `EnrichedPreference` does **not** include definition namespace

   So single-target checks can honor full `McpTarget`, but bulk filtering of definitions/preferences cannot unless you either:
   - constrain static target rules to slug-only semantics for this feature, or
   - change the bulk filter shape to operate on full targets / rows and plumb namespace through the preference read path

   I would document that choice explicitly in the plan so the implementation does not silently under-enforce namespace-based static rules on bulk reads.

## Minor Note

If you keep `action`, `effect`, and possibly `clientKey` as plain `String` columns in Prisma, the UI/backend layer will need to be disciplined about validation. For `action` and `effect`, DB enums would give you stronger integrity with very little extra cost.
