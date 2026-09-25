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
