## MR2 Preferences Audit History Tab

### Summary
MR2 shipped a read-only audit history UI inside the existing Preferences page. The preferences surface now has `Manage` and `History` tabs, with audit history loaded lazily when the user first opens the new tab.

### Shipped Behavior
- new `History` tab inside `/dashboard/preferences`
- local tab state with both panels kept mounted so history data and expanded rows persist across tab switches
- lazy-loaded audit history using the existing `preferenceAuditHistory(input)` GraphQL query
- compact event rows showing timestamp, event label, slug, target type, origin, and actor badge
- inline expandable details for `beforeState`, `afterState`, and `metadata`
- common filters visible by default: slug, event type, target type
- advanced filters behind `More filters`: origin, actor client key, correlation ID, occurred-from, occurred-to
- active-filter chips plus `Apply`, `Reset`, and cursor-based `Load more`
- sensitive-value toggle defaulted off, with masking based on the live preference catalog

### Important Caveat
- sensitivity masking in MR2 only uses the current live preference catalog
- archived or deleted definitions may lose sensitivity detection in the UI because no historical definition-metadata lookup exists yet

### Not Included
- rollback or revert controls
- URL-synced tab or filter state
- tree-view JSON rendering
- backend changes or new audit query fields

### Verification
- `pnpm --filter web codegen`
- `pnpm --filter web lint`
- `pnpm --filter web build`
