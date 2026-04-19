# MR1 Read API Implementation Plan — Feedback

## Overall Assessment

The plan is solid. The `subjectSlug` denormalization, cursor pagination design, and checkpoint structure are all well-reasoned. The feedback below is mostly about tightening edge cases, surfacing implicit decisions, and flagging areas where the implementation will need extra care.

## Feedback

### 1. subjectSlug Write-Path Is the Riskiest Checkpoint

Checkpoint 2 touches every audit-producing call site to pass `subjectSlug`. A missed path means a null or missing slug that silently breaks read queries later. Consider adding a defensive check: either make `subjectSlug` required in `AuditEventInput` (which the plan implies but doesn't state explicitly in the type update), or add a runtime assertion in `PreferenceAuditService.record` that throws if `subjectSlug` is falsy. The existing integration and e2e tests should catch missed paths, but a belt-and-suspenders guard in `record()` would make failures loud and immediate.

### 2. Filter Composition Semantics Should Be Stated Explicitly

The plan lists individual filters but doesn't say how they compose. The natural behavior is AND (every supplied filter narrows the result set). This is almost certainly what's intended, but stating it in the plan removes ambiguity for whoever implements it and for future readers.

### 3. Index Coverage for Compound Filters

The new `(userId, subjectSlug, occurredAt desc)` index covers the primary slug-history query. But consider what happens for compound filters like `subjectSlug + eventType` or `subjectSlug + targetType`. PostgreSQL can use the slug index for the prefix and then filter the remaining conditions in-memory, which is fine at small scale. But if you expect slug histories to grow long (hundreds of events per slug), a compound index like `(userId, subjectSlug, targetType, occurredAt desc)` would help the most common compound query — "show me just the preference-value history for this slug." This might be premature for MR1, but worth noting as a follow-up if query performance shows up.

### 4. Cursor Validation and Error Handling

The plan specifies an opaque cursor encoding `(occurredAt, id)` but doesn't mention what happens when the client sends a malformed or tampered cursor. The read service should throw a clear validation error (e.g., `BadRequestException`) for unparseable cursors rather than letting a Prisma query error bubble up.

### 5. `first` Default Behavior in GraphQL

The plan says `first: Int!` with default `20` and max `100`. In NestJS GraphQL code-first, this would be `@Field(() => Int, { defaultValue: 20 })`. But `Int!` with a default means the field is required at the schema level yet has a default — the server-side default only applies if the client omits it entirely. This works as expected in practice, but consider making it `Int` (nullable) with the default, which is the more common GraphQL convention for "optional with a server default." Minor point either way.

### 6. GraphQL Type Naming

The plan uses `PreferenceAuditEvent` as both the Prisma model name and the GraphQL type name. This works fine since they live in different contexts, but it can cause confusion in imports. Other modules in this repo use separate model files (e.g., `preference.model.ts` for the GraphQL type vs. the Prisma model). As long as the new GraphQL model follows the same `*.model.ts` convention, this should be clear enough.

### 7. Sensitive Preference Data in Snapshots

Audit event snapshots can contain values from `isSensitive` preferences. The read API is user-scoped (users only see their own events), so this is safe from an authorization perspective. But it's worth noting for MR2 — when the UI displays audit history, sensitive values in snapshots may need masking or a display-time flag. No action needed in MR1, just flagging it as a consideration for the UI pass.

### 8. MCP Read Surface — Intentional Omission?

MR1 only adds a GraphQL query. There's no mention of an MCP tool for reading audit history. This is probably intentional since MR1 is focused on the backend+UI pipeline, but it should be called out explicitly in the "Assumptions" section so future readers know it was a conscious scope decision, not an oversight.

### 9. Checkpoint 2 and 3 Could Potentially Merge

Checkpoint 2 (subjectSlug schema + write-path) and Checkpoint 3 (read service) are relatively independent and could be implemented in parallel or merged into a single checkpoint. The subjectSlug plumbing is a prerequisite for meaningful read-service testing, so they do have a dependency, but the read service can be built against the updated schema as soon as checkpoint 2 is green. Consider whether keeping them separate adds enough value over combining them. Either way works; the current split is a bit more conservative, which is fine.

### 10. Missing: What Ordering Does the Existing `(userId, occurredAt desc)` Index Cover?

The plan adds a new index on `(userId, subjectSlug, occurredAt desc)` but the existing `(userId, occurredAt desc)` index already covers the "all events for a user, newest first" query that the read API will use when no `subjectSlug` filter is provided. Worth confirming that the query planner picks up this existing index for the unfiltered case rather than needing a new one.

### 11. Test Plan Looks Comprehensive

The test plan covers the important dimensions: ordering, pagination stability, filter composition, user isolation, mixed target types, and provenance filtering. One addition to consider: a test for an empty result set (query for a slug that has no history) to confirm the page type returns `{ items: [], hasNextPage: false, nextCursor: null }` cleanly.

## Summary

The plan is ready to implement with minor clarifications. The key additions I'd suggest before starting:
1. State that filters AND-compose
2. Add a runtime guard in `record()` for missing `subjectSlug`
3. Add a note about cursor validation error handling
4. Explicitly note MCP read surface is out of scope
5. Consider an empty-result-set test case
