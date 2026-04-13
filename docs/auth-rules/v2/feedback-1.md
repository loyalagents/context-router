# Feedback 1

## Findings

1. **[P1] `canAccessTarget` as written would bypass existing static target rules**

   In `implementation-plan.md:127-132`, `canAccessTarget` first calls `canAccess(client, access, grants)` without a target and only then checks DB grants. That skips the existing `targetRules` path already supported by `McpAuthorizationService.canAccess(..., target)`. If this lands as written, any future policy-level deny/allow rules in `client.policy.targetRules` would be ignored whenever the new target-aware path is used.

   I would change the layering to:
   - first evaluate `canAccess(client, access, grants, target)`
   - only if that passes, evaluate `PermissionGrantService`
   - let DB grants further narrow access, never widen past static policy

2. **[P1] Post-filtering tool output is too late for AI-backed reads, and `consolidateSchema` is missing entirely**

   `implementation-plan.md:42-45` and `:176-183` focus on post-filtering `preference-search`, `preference-list`, and `smart-search`. That is not sufficient for the current workflow code:
   - `PreferenceSearchWorkflow` builds an AI prompt from the full snapshot before returning `matchedDefinitions`
   - `SchemaConsolidationWorkflow` also sends the full definition set to the model

   So blocked slugs would still be disclosed to the model and could leak back through `queryInterpretation` or summary text even if the final arrays are filtered. I would move grant-aware filtering earlier, either into `PreferenceSchemaSnapshotService` or into the workflows before prompt construction, and explicitly include `schema-consolidation.tool.ts` / `SchemaConsolidationWorkflow` in scope.

3. **[P2] The `preference-list` step does not match the current response shape and would still leak blocked categories**

   `implementation-plan.md:180` says to "update category counts", but the current `PreferenceListTool` does not return category counts. It returns:
   - filtered `preferences`
   - a separate `categories` array from `defRepo.getAllCategories(userId)`

   If only the entries are filtered, blocked category names still leak through `categories`. The plan should say to recompute `categories` from the filtered entries, or to apply grant filtering before both entries and category metadata are derived.

4. **[P2] The wildcard grammar is internally inconsistent**

   The plan relies on nested wildcard targets like `food.french.*` in `implementation-plan.md:7` and `:221-222`, but `:197` says validation only accepts `*`, `category.*`, or an exact slug. That would reject one of the core examples in the plan.

   I would define one grammar and use it everywhere, for example:
   - `*`
   - exact slug
   - `<slug-prefix>.*`, where `<slug-prefix>` is one or more valid slug segments

## Open Questions

1. The plan uses allow-by-default (`no-grant -> allow`) in `implementation-plan.md:11` and `:132`. If the product expectation is "the user picks which slugs/categories a client may access", that reads more like an allowlist than an exceptions list. With the current default, "codex may read only `food.*`" requires a blanket `deny * read` plus explicit allow exceptions. If that UX is intended, I would state it explicitly in the plan.

2. The checkpoint commands should probably be written as backend-scoped commands. At the repo root, `pnpm test` fans out across the workspace; for these checkpoints, `cd apps/backend && pnpm test --testPathPattern=...` or `pnpm --filter backend exec jest ...` is less ambiguous.
