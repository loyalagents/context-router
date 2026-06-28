# Conflict Hardening PR4 Plan Feedback

- Status: review feedback
- Reviewed: 2026-06-28
- Scope: `packet-hard-conflict-v1` fixture plan in `implementation-plan.md`

## Overall Assessment

The PR4 plan is directionally sound and close to implementation-ready. The
largest correct decision is basing `packet-hard-conflict-v1` on
`packet-medium`, not `packet-hard-ownership-v1`, so conflict and temporal
failures remain attributable. The fixture-only boundary is also right: no
runner, scorer, backend, MCP, form-map, schema, or Maya profile changes should
be required for this PR.

I would proceed after tightening the plan in the areas below.

## What Looks Strong

- The packet isolates one difficulty family: conflict and temporal validity.
- The plan preserves the current shared-dossier shape: one Maya corpus and
  three normal one-form scenarios.
- The proposed winning values match current `profile.yaml` truth.
- The plan uses existing V2 manifest fields instead of adding schema or scorer
  concepts prematurely.
- The validation gate mirrors the ownership fixture PR and keeps live
  MCP/direct artifacts out of the fixture PR.

## Recommended Plan Adjustments

### 1. Separate Inherited Stale Cases From New PR4 Signal

`packet-medium` already contains stale/conflicting material:

- `025-stale-recruiter-profile.txt`: old email and old address.
- `026-stale-payroll-bank-draft.txt`: old bank, routing, and masked account.
- `027-stale-onboarding-export.yaml`: stale onboarding/employment guardrail.

Because PR4 is intentionally copied from `packet-medium`, the implementation
summary should include two leakage tables:

- inherited `packet-medium` stale values;
- new PR4 losing values.

Live-run interpretation should attribute failures to PR4 only when the leaked
value is one of the new losing values, or when the failure rate/regression is
clearly worse than the same `packet-medium` baseline.

Also make the suggested losing values distinct from `packet-medium`, not only
from ownership decoys. In particular, `Operations Coordinator` already exists
as `artifactWorld.stale.oldTitle`, and `2026-06-22` is noisy in existing
timestamp fields. Prefer a unique losing title and a start date such as
`2026-06-30` if the point is manual-searchable leakage.

### 2. Add A Manual Evidence Contract For Losing Values

The validator proves current profile facts and forbidden current values. It
does not prove that each intended losing value actually appears only in the
intended document. Add an explicit implementation-summary checklist with:

- document id and path;
- losing fact family;
- losing value;
- winning current value;
- source-native cue that makes the loser lose;
- expected live artifact search target.

Before acceptance, grep the committed corpus for every losing value and confirm
it appears only where intended. For mixed before/after documents, also confirm
the winning value is present and listed in `factContract.include`.

### 3. Be Precise About `expectedUse`

For mixed before/after documents, use `expectedUse: corroborate`,
`freshness: mixed`, and include only the current after/approved Maya facts that
the body proves.

For pure stale, draft, or lower-authority documents, keep
`factContract.include` empty, use `expectedUse: guardrail`, and put the affected
current fact paths in `factContract.forbid`.

For `035-hr-support-correction-thread.txt`, decide this before authoring:

- if the body contains current Maya facts worth proving, make it
  `corroborate`/`mixed` and include those current facts;
- if it is only a low-authority correction/guardrail note, make it
  `guardrail` with no includes.

Avoid `guardrail` plus `include`; the validator will not prove declared facts
for guardrail documents.

### 4. Call Out Manual-Only Checks

Some proposed losing W-4 values are useful traps but are not currently mapped
or scored form fields, especially other income, deductions, extra withholding,
and multiple-jobs-style values. They can still leak into active memory as
unscored preferences, but they should not be presented as automated form-score
coverage in PR4.

The strongest automatically visible W-4 conflict in this plan is filing status,
because it maps to the W-4 checkbox branch. Keep the other tax values, but
label them manual leakage checks unless scorer/form-map work is intentionally
split into a later PR.

### 5. Strengthen Acceptance Reporting

In addition to the planned commands, require the implementation summary to
record:

- focused corpus `corpusTruth.summary`;
- warning counts by code, split into inherited vs new where practical;
- confirmation that `factsMissing`, `unsupportedDeclaredFacts`,
  `forbiddenFactsPresent`, and `withheldValuesPresent` are all zero;
- any new `DOCUMENT_STALE_CUE_MISSING` warnings with document-specific
  rationale, not just a count.

The live follow-up should search both stored-memory and direct artifacts:

- `memory-snapshot.json`;
- open-schema database score report `knownPresent`, `unscoredActivePreferences`,
  and `unscoredSuggestions`;
- direct `extraction.json`;
- per-form `filled-form.json` score details.

## Bottom Line

The plan should stay fixture-only and should remain based on `packet-medium`.
The main improvement is making attribution unambiguous: new PR4 losing values
must be unique, explicitly documented, grep-verified in the corpus, and
searched in live artifacts separately from inherited `packet-medium` stale
values.
