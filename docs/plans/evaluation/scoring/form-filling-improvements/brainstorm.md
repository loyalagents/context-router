# Form Filling Improvements Brainstorm

- Status: brainstorm
- Source run: live Claude MCP open-schema run
- Artifact root: `/tmp/context-router-open-claude-1`
- Run id: `mcp-open-schema-alex-i9-test-realistic-2026-06-17T07-52-57-059Z`
- Last updated: 2026-06-17

## Context

The first live Claude open-schema MCP run completed successfully end to end:

- `pnpm eval:e2e-mcp-agent --agent claude --schema-mode open --form-mode backend`
- Current-user reset used `--reset-demo-data`
- All runner stages passed
- Agent completion marker was observed
- Open-schema memory snapshot, database score, backend form fill, form score,
  and combined report were all produced

The run is useful because it separates three surfaces:

1. Open-schema memory creation by the MCP agent.
2. Deterministic scoring of active-memory value recovery.
3. Backend form filling from the active memory state.

The headline result is that memory did substantially better than final form
filling:

- Active-memory known-present recovery: `20 / 22`, or `90.9%`
- Known-present wrong memory values: `0`
- Intentionally missing phone hallucinations: `0`
- Known form fields correct: `11 / 17`, or `64.7%`
- Known form fields missing: `6`
- Known form fields wrong: `0`

The form failures are therefore not primarily extraction failures. Most of the
missing form fields had usable values in active memory, but the form filler did
not connect those open-schema preferences to the form policies that decide which
fields are active and fillable.

## Exact Missing Form Fields

The missing fields came from `form-score-report.json` and the backend skip
reasons came from `form-fill-response.json`.

| PDF field | Fact key | Expected | Actual | Backend reason |
| --- | --- | --- | --- | --- |
| `Employee Middle Initial (if any)` | `identity.middleInitial` | `J` | blank | `source slug "eval.identity.middle_initial" is not an active preference` |
| `CB_4` | `workAuthorization.citizenshipStatus` | checked | unchecked | `field policy inactive: workAuthorization.citizenshipStatus` |
| `Exp Date mmddyyyy` | `workAuthorization.workAuthorizationExpirationDate` | `09302028` | blank | `field policy inactive: workAuthorization.citizenshipStatus` |
| `USCIS ANumber` | `workAuthorization.uscisANumber` | `987654321` | blank | `field policy inactive: workAuthorization.citizenshipStatus` |
| `Form I94 Admission Number` | `workAuthorization.i94AdmissionNumber` | `11223344556` | blank | `field policy inactive: workAuthorization.citizenshipStatus` |
| `Foreign Passport Number and Country of IssuanceRow1` | `workAuthorization.foreignPassportNumber` | `XK1234567` | blank | `field policy inactive: workAuthorization.citizenshipStatus` |

## What Memory Had

For the work authorization branch, active memory contained the values needed to
fill the form:

| Active preference slug | Value |
| --- | --- |
| `work_auth.citizenship_status` | `"alien authorized to work"` |
| `work_auth.expiration_date` | `"2028-09-30"` |
| `work_auth.uscis_number` | `"987654321"` |
| `work_auth.i94_admission_number` | `"11223344556"` |
| `work_auth.foreign_passport_number` | `"XK1234567"` |

For middle initial, active memory contained:

| Active preference slug | Value |
| --- | --- |
| `profile.middle_name` | `"Jordan"` |

The scorer counted `identity.middleInitial` as missing because no active
preference directly represented `J`, and scoring currently does not derive a
middle initial from a stored middle name.

## Interpretation

Both failure groups are better understood as form-filling/schema-linking issues
than as memory extraction issues.

Middle initial:

- The form expected `identity.middleInitial = "J"`.
- The backend tried to use `eval.identity.middle_initial`.
- Claude stored a reasonable open-schema value, `profile.middle_name =
  "Jordan"`.
- The backend did not derive `J` from `Jordan`.
- This is a missing derived-fact capability, not a lack of evidence in memory.

Work authorization:

- Claude stored the citizenship status and all dependent work-authorization
  numbers/dates.
- The backend form policy gates the alien-authorized-to-work branch on
  `workAuthorization.citizenshipStatus`.
- In open-schema mode, the active value was under an agent-created slug
  (`work_auth.citizenship_status`) rather than the known-schema fact key.
- The conditional policy therefore stayed inactive and blocked the status
  checkbox and dependent fields.
- This is a policy activation / canonical fact resolution issue, not a failure
  to recover the values.

The short version: the form filler can read active preferences, but important
parts of its decision logic are still keyed to known-schema fact keys and
expected slugs. Open-schema agents can produce good values under reasonable
novel slugs, and the current form filler can still fail to use them.

## Likely Root Cause

The form-fill path has at least two slug-sensitive layers:

1. Source-policy matching: whether a proposed field value comes from an allowed
   source slug for that field.
2. Conditional activation: whether a branch, checkbox, or dependent field is
   active for the current user, such as the I-9 citizenship status branch.

Known-schema runs pre-create stable target slugs, so these layers have direct
keys to use. Open-schema runs deliberately do not require strict slug
correctness, so the backend needs a canonicalization or resolution layer between
active preferences and form policies.

Without that layer, the backend can have the right value but still answer:

- "source slug is not an active preference"
- "source slug not listed in field policy"
- "field policy inactive"

Those are useful guardrails for known-schema behavior, but they are too brittle
as the only path for open-schema form filling.

## Possible Improvements

### 1. Canonical Fact Resolution Before Form Fill

Build a deterministic resolver that maps active preferences onto form fact keys
before field-policy evaluation.

Inputs could include:

- Active preference slug
- Definition display name
- Definition description
- Value type
- Stored value
- Existing fact storage map aliases
- Form field policy metadata

Output should be a canonical fact-value map, for example:

- `work_auth.citizenship_status` -> `workAuthorization.citizenshipStatus`
- `work_auth.expiration_date` -> `workAuthorization.workAuthorizationExpirationDate`
- `profile.middle_name` -> `identity.middleName`

The form filler would then evaluate policies against canonical facts rather
than raw preference slugs.

This should be deterministic at first. Avoid adding LLM judgment into headline
eval scoring until the deterministic failure modes are understood.

### 2. Derived Facts

Add a small derived-fact layer for obvious transformations that forms commonly
need.

Initial derivations worth considering:

- `identity.middleInitial` from `identity.middleName` or `profile.middle_name`
- Date render variants from ISO dates, already partly handled in form rendering
- Digits-only SSN / dashed SSN normalization, already partly handled in scoring

Middle initial is the cleanest first case:

- If middle initial is missing
- And middle name is present as a non-empty string
- Then derive the first alphabetic character
- Preserve provenance so reports can say the field came from a derived value

### 3. Conditional Policy Activation From Canonical Values

Work-authorization fields should activate from canonical value semantics, not
only a specific raw slug.

For the I-9 case:

- Active memory had `"alien authorized to work"`.
- That should activate the alien-authorized branch.
- Once active, dependent fields should be eligible:
  - work authorization expiration date
  - USCIS/A-number
  - I-94 admission number
  - foreign passport number

This can be implemented after canonical fact resolution, so policy logic remains
simple:

- Evaluate `workAuthorization.citizenshipStatus` from the canonical fact map.
- Normalize status values into the branch categories the I-9 policy expects.
- Keep blocking inactive branches to avoid overfilling mutually exclusive
  checkbox groups.

### 4. Open-Schema Source Policy Compatibility

Do not remove source-policy validation. Instead, make it open-schema aware.

Possible approach:

- Let a field policy name accepted canonical facts rather than only raw slugs.
- Accept any active preference that resolves to that canonical fact.
- Report the raw source slug and the resolved canonical fact in diagnostics.

This preserves auditability while avoiding brittle slug dependence.

Example diagnostic target:

```json
{
  "pdfFieldName": "USCIS ANumber",
  "sourceSlug": "work_auth.uscis_number",
  "resolvedFactKey": "workAuthorization.uscisANumber",
  "policyMatch": "resolved-canonical-fact"
}
```

### 5. Better Eval Diagnostics

The current reports were enough to diagnose the problem, but future reports
could make this easier.

Helpful additions:

- In `form-fill-response.json`, include the active preference candidates
  considered for a blocked field.
- In `form-score-report.json`, include the resolved canonical fact, if any.
- In the open-schema combined report, separate:
  - memory missing
  - memory present but unresolved for form fill
  - memory present but condition inactive
  - memory present but renderer failed

That would let the combined report say "memory recovered, form policy blocked"
more directly.

## Suggested Checkpoint Order

### Checkpoint 1: Diagnostic-Only Resolver Prototype

Add a non-mutating diagnostic resolver that runs before form fill and writes a
report showing how active preferences would map to form fact keys.

Success criteria:

- No behavior change to known-schema form fill.
- The live open-schema run would show mappings for the five work-authorization
  values.
- Middle name would map to a canonical middle-name fact, even if middle initial
  is not derived yet.

### Checkpoint 2: Derived Middle Initial

Implement a narrowly scoped derived value for middle initial.

Success criteria:

- The I-9 middle initial field fills `J` when active memory has
  `profile.middle_name = "Jordan"`.
- Provenance shows that the filled value was derived.
- Existing known-schema behavior remains stable.

### Checkpoint 3: Canonical Fact Policy Matching

Use resolved canonical facts for source-policy matching.

Success criteria:

- Fields can accept open-schema slugs that resolve to their canonical fact.
- Reports still include the raw slug used.
- Known-schema slugs continue to work unchanged.

### Checkpoint 4: Conditional Activation From Resolved Facts

Evaluate conditional form policy using the canonical fact map.

Success criteria:

- `work_auth.citizenship_status = "alien authorized to work"` activates the
  correct I-9 branch.
- The status checkbox and dependent work-authorization fields become eligible.
- Mutually exclusive inactive branches still stay blocked.

### Checkpoint 5: Rerun Open-Schema Live Eval

Run the same live Claude open-schema command and compare:

- Memory score should remain roughly stable.
- Known form accuracy should improve from `11 / 17`.
- The six current missing fields should either fill correctly or have more
  precise diagnostics explaining why not.

## Open Questions

- Should canonical resolution live inside backend form fill, eval tooling, or a
  shared helper? For product behavior, it likely belongs in backend form fill.
- Should field policies list canonical facts, raw slugs, or both?
- How conservative should derived facts be? Middle initial is low risk, but
  broader derivations can become surprising.
- Should open-schema canonical resolution be deterministic only, or eventually
  allow LLM-assisted matching with a non-headline diagnostic score?
- How should provenance distinguish direct active memory, resolved alias, and
  derived values in user-facing or eval artifacts?

## Current Takeaway

Open-schema memory did its job well enough to expose the next bottleneck. The
form filler should not require strict slug correctness when the evaluation mode
is intentionally open schema. It needs a small, auditable resolution layer that
connects useful open-schema memory to canonical form facts before source-policy
and conditional activation logic runs.
