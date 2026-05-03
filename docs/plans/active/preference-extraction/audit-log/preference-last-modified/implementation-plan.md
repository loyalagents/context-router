# Preference Last Modified Attribution

## Summary

Implement `lastModifiedBy` on live preference rows so the preferences UI can show who last changed each preference without querying audit history.

V1 will not add source-detail attribution. The existing `sourceType` field continues to power the broad `AI` badge. Detailed source labels like `AI · codex` are deferred to a future pass.

## Documentation Steps

- Create `docs/plans/active/preference-extraction/audit-log/preference-last-modified/`.
- Write this plan to `preference-last-modified/implementation-plan.md` before code changes.
- At the end, write `preference-last-modified/implementation-summary.md` covering schema, backend, frontend, tests, and deviations.
- At the end, update `/Users/lucasnovak/loyal-agents/context-router/docs/plans/active/preference-extraction/audit-log/TODO.md` with any remaining follow-ups.

## Key Changes

- Add nullable columns to `user_preferences`:
  - `last_actor_type` using existing `AuditActorType`
  - `last_actor_client_key` as nullable string
  - `last_origin` using existing `AuditOrigin`
- Add a GraphQL object type `PreferenceAttribution { actorType, actorClientKey, origin }`.
- Add nullable `lastModifiedBy: PreferenceAttribution` to `Preference`.
- Keep mutation provenance separate from value provenance:
  - Keep `PreferenceProvenanceOptions` focused on `sourceType`, `confidence`, and `evidence`.
  - Add a separate repository write parameter derived from `MutationContext`, e.g. `PreferenceMutationAttribution`.
- Update `buildPreferenceAuditSnapshot` and its input type in `snapshot-builders.ts` to include the new last-modifier fields.

## Attribution Rules

- Manual GraphQL `setPreference`:
  - `lastModifiedBy = USER / GRAPHQL`
- MCP `SET_PREFERENCE` and `SUGGEST_PREFERENCE`:
  - `lastModifiedBy = MCP_CLIENT / <clientKey> / MCP`
- Accept suggestion:
  - keep existing behavior that copies `sourceType`, `confidence`, and `evidence` from the suggestion to the active row
  - set active row `lastModifiedBy = USER / GRAPHQL`
- Document-analysis apply:
  - keep `sourceType = INFERRED`
  - set `lastModifiedBy = USER / DOCUMENT_ANALYSIS`
- Reject suggestion:
  - do not add last-modifier plumbing for rejected tombstone rows in v1
  - rely on the existing audit event for rejection attribution

## Frontend Behavior

- Update active/suggested preference GraphQL selections to request `lastModifiedBy`.
- Update local frontend `Preference` interfaces and mutation result fragments where preference rows are returned.
- Render:
  - `Modified by you` for `USER + GRAPHQL`
  - `Modified by document analysis` for `origin = DOCUMENT_ANALYSIS`
  - `Modified by codex`, `Modified by claude`, etc. for MCP client keys
- Keep the existing `AI` badge based only on `sourceType === INFERRED`.
- Do not hand-edit `apps/backend/src/schema.gql`; regenerate it through NestJS/schema generation and run web GraphQL codegen after schema changes.

## Checkpoints And Tests

1. Docs and schema checkpoint:
   - Create the plan folder and `implementation-plan.md`.
   - Add backend tests first for repository writes persisting last-modifier attribution.
   - Add Prisma migration and regenerate backend Prisma client.
   - Run targeted repository tests.

2. Backend checkpoint:
   - Update preference repository write methods to accept separate mutation attribution.
   - Update service call sites for GraphQL, MCP, accept-suggestion, and document-analysis apply.
   - Update GraphQL model fields and audit snapshots.
   - Add e2e coverage for manual set, MCP set, MCP suggestion, suggestion accept, and document-analysis apply.
   - Run targeted backend tests.

3. Frontend and wrap-up checkpoint:
   - Update preference queries/types/components.
   - Run web GraphQL codegen and type/build checks where available.
   - Write `implementation-summary.md`.
   - Update the audit-log `TODO.md`.

## Assumptions

- Old rows may have `lastModifiedBy = null` until rewritten.
- Backwards compatibility for existing rows is not a priority.
- Preference-definition attribution is out of scope.
- Source-detail attribution beyond `sourceType` is a follow-up, not part of v1.
