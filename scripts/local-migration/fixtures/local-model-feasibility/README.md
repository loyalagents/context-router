# Step 06 Qualification Fixtures

The CP1 transport, session, stream and PDF engine copies in this directory are
**frozen historical feasibility fixtures, not authoritative product code**.
Their historical receipts apply to the exact Git revisions recorded in those
receipts. Do not silently update these copies to make an old result appear to
cover a later production fix. Rerunning historical CP1 evidence requires its
recorded revision and inputs.

The production implementation lives in
[`apps/backend/src/infrastructure/local-model/`](../../../../apps/backend/src/infrastructure/local-model/).
Production safety fixes and current regression tests belong there and in
`apps/backend/test/local-model/`. The `production-*` qualification harnesses in
this directory exercise the actual compiled Nest service. Their current frozen
manifests use the `-review.json` suffix; original manifests and receipts remain
unchanged as historical evidence. This distinction prevents accidental claims
that CP1 copies or an old compiled digest qualify a changed production build.

The `client-diagnostic*`, `client-observer` and `diagnostic-*` fixtures are the
separately approved client-only cancellation investigation. They preserve the
production build and all native settings, observe at most six inference calls,
and cannot restore qualification. The dedicated launcher discards raw runtime
and worker output before persistence; do not substitute the raw-log qualification
launcher or the full cancellation matrix. See the active Step 06 plan and frozen
`client-diagnostic-manifest.json` for limits and review/execution prerequisites.
