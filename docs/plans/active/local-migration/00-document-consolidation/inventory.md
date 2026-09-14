# Step 00 Documentation Disposition Inventory

- Status: not started
- Inventory base commit: to be recorded as a full SHA at the start of PR 00A
- Inventory scope: tracked legacy planning Markdown, excluding
  `docs/plans/active/local-migration/**`
- Last updated: 2026-09-13

The Step 00 planning agent populates this file during PR 00A from the recorded
commit:

```sh
git ls-tree -r --name-only <FULL_BASE_SHA> -- docs/plans \
  | rg '\.md$' \
  | rg -v '^docs/plans/active/local-migration/'
```

Include files outside `active/` and sort rows by path so the inventory can be
checked mechanically. Do not add this migration control tree to the table; its
lifecycle is specified in the Step 00 README and orchestration document.

Allowed dispositions are defined in [`README.md`](README.md). A
`DISTILL_AND_DELETE` row must name both the durable information to preserve and
its canonical destination. A deletion row must include enough evidence for an
independent reviewer to decide whether removal is safe.

| Path | Observed evidence | Durable information or open work | Final disposition | Destination kind | Exact destination path and section | Owner step | Evidence and rationale | Review decision | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _Populate during Step 00 planning_ |  |  |  |  |  |  |  | Pending |  |

## Inventory Checks

- The number of data rows equals the output count of the recorded scope command
  at the recorded base commit.
- Every path exists at the recorded base commit.
- No path appears more than once.
- Every disposition is from the Step 00 vocabulary.
- Every disposition/destination-kind pair matches the compatibility matrix in
  the Step 00 README.
- Every `REHOME_ACTIVE` or `DISTILL_AND_DELETE` row names an allowed destination
  kind and an exact path plus section when applicable.
- Every `KEEP_ACTIVE` row meets the owner/outcome/next-action/review-date gate.
- Review decision is exactly `Pending`, `Approved`, or `Changes requested`, and
  every approved row names its independent reviewer before action begins.
