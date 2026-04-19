## MR2 Preferences Audit History Tab

### Summary
Add a new `History` tab inside `/dashboard/preferences`, alongside the existing preferences-management UI under a `Manage` tab. The new tab is read-only, uses the shipped `preferenceAuditHistory(input)` backend query, defaults to full user history, and provides compact event rows with expandable before/after details. The first pass stays lightweight: formatted JSON panels, lazy-loaded data, and advanced filters tucked behind a disclosure.

### Implementation Changes
- **Preferences page shell**
  - Update the preferences client to render two local tabs: `Manage` and `History`.
  - Keep the current inbox, document import, manual preference form, and active preferences list under `Manage` with no behavior change.
  - Keep both tab panels mounted and hide the inactive one with CSS so history scroll position, loaded pages, and expanded rows survive tab switches.
  - Lazy-load audit history only when the user first opens `History`; do not prefetch it on initial page load.

- **History tab UX**
  - Add a dedicated `AuditHistoryTab` client component under the preferences area.
  - Render a compact newest-first event list. Each collapsed row shows:
    - compact absolute timestamp
    - lighter relative-time text
    - humanized event label
    - `subjectSlug`
    - `targetType` badge
    - `origin` badge
    - actor badge: `actorClientKey` when present, otherwise `actorType`
  - Humanized event labels are fixed as:
    - `PREFERENCE_SET` → `Preference set`
    - `PREFERENCE_SUGGESTED_UPSERTED` → `Suggestion created`
    - `PREFERENCE_SUGGESTION_ACCEPTED` → `Suggestion accepted`
    - `PREFERENCE_SUGGESTION_REJECTED` → `Suggestion rejected`
    - `PREFERENCE_DELETED` → `Preference deleted`
    - `DEFINITION_CREATED` → `Definition created`
    - `DEFINITION_UPDATED` → `Definition updated`
    - `DEFINITION_ARCHIVED` → `Definition archived`
  - Each row expands inline to show `beforeState`, `afterState`, and `metadata`.
  - Expanded layout:
    - desktop: `before` and `after` side-by-side, `metadata` below
    - mobile: stack panels vertically
  - No rollback or revert controls in MR2.

- **Filters and pagination**
  - Default-visible filters:
    - `subjectSlug`
    - `eventType`
    - `targetType`
  - `More filters` disclosure contains:
    - `origin`
    - `actorClientKey`
    - `correlationId` labeled as “Correlation ID (groups events from one operation)”
    - `occurredFrom`
    - `occurredTo`
  - Use an explicit `Apply` action rather than refetching on every keystroke.
  - Add `Reset` to clear filters and reload the first page.
  - Show active-filter chips under the form.
  - Use cursor pagination with `Load more`; append results in place.
  - Do not show total count or page numbers.

- **Sensitive values and detail rendering**
  - Add a visible `Show sensitive values` toggle in the History tab; default it to off.
  - Treat an event as sensitive when its `subjectSlug` matches a sensitive definition in the current preference catalog.
  - Accept and document the MR2 gap: archived or deleted definitions may lose sensitivity detection in the UI because the current catalog is live-only.
  - When the toggle is off and an event is considered sensitive, replace the detail payloads with a redacted notice.
  - Render JSON details with formatted `JSON.stringify(value, null, 2)` in monospace `<pre>` blocks. No tree view in MR2.

- **Data plumbing and conventions**
  - Query only the existing backend API:
    - `items { id occurredAt subjectSlug targetType targetId eventType actorType actorClientKey origin correlationId beforeState afterState metadata }`
    - `hasNextPage`
    - `nextCursor`
  - Keep the frontend implementation consistent with the rest of the preferences area by using authenticated `fetch`-based GraphQL requests rather than Apollo hooks.
  - Add a brief code comment explaining that choice because the component lives inside `ApolloNextAppProvider`.
  - Refresh `apps/web/lib/generated/graphql.ts` via web codegen after adding the new query document.

- **States and copy**
  - Loading: inline spinner or skeleton inside the History tab content area, not a page-level loader.
  - Error: inline error banner with a Retry action.
  - Empty with no filters: `No audit history yet.`
  - Empty with filters: `No events match the current filters.` with Reset still visible.

- **Docs**
  - Add/update MR2 planning docs under `docs/plans/active/preference-extraction/audit-log/read-ui/`.
  - Update the audit-log `TODO.md` after implementation to reflect shipped UI behavior and the documented sensitivity-detection caveat.

### Test Plan
- **Repo checks**
  - `pnpm --filter web codegen`
  - `pnpm --filter web lint`
  - `pnpm --filter web build` if the local web env is healthy enough for a full build

- **Manual verification**
  - Preferences defaults to `Manage`, and existing manage flows still work unchanged.
  - Opening `History` loads the first audit page only once, then preserves state across tab switches.
  - Default-visible filters work; advanced filters are available under `More filters`.
  - `Apply`, `Reset`, active chips, and `Load more` all behave correctly with no duplicate rows.
  - Mixed preference and definition events render correctly, and `targetType` narrows them.
  - Sensitive events hide payloads by default and reveal them only when the toggle is enabled.
  - Archived-definition sensitivity gap is not fixed, but the rest of sensitivity masking works for live sensitive definitions.
  - Expanded rows show formatted `beforeState`, `afterState`, and `metadata`.
  - Loading, error, empty-without-filters, and empty-with-filters states render with the expected copy.

### Assumptions And Defaults
- The first UI lives as an in-page tab inside Preferences, not a separate route or drawer.
- Tabs use local component state, not URL-synced state.
- Default scope is full user history, not slug-first browsing.
- All current backend filters remain available, but only the common ones are visible by default.
- Visible timestamps are absolute, with relative time as secondary context.
- Sensitive payloads are hidden by default behind one global History-tab toggle.
- No backend changes are part of MR2; the archived-definition sensitivity gap is accepted and documented for now.
