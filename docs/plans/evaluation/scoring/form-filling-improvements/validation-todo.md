# Form Fill Validation TODO

- Status: TODO
- Last updated: 2026-06-18
- Scope: backend form-fill validation for open-schema form filling

## Current Temporary Behavior

The backend validator has a narrow open-schema fallback for
`workAuthorization.citizenshipStatus`: when a conditional field policy does not
have a resolved canonical fact or declared condition source slugs, it may match
the condition against active memory values after deterministic normalization.

This is intentionally scoped to the I-9 authorized-to-work branch so reasonable
open-schema slugs such as `profile.citizenship_immigration_status` can activate
dependent fields without adding every slug variant to the alias table.

## Why This Is Temporary

This still leaves the validator doing implicit condition-source discovery. That
is acceptable for the current eval fix, but it is not the final design for
arbitrary forms.

## Follow-Up Direction

Replace the fallback with explicit field-to-memory mapping validation:

- The model should identify which active memory source satisfies each conditional
  policy.
- The backend should verify that cited condition source is active, non-conflicting,
  value-compatible, and allowed for the field risk level.
- Conditional validation should remain fail-closed when the model does not cite a
  usable condition source.
- Scoring should continue to report missing fields honestly and should not
  auto-correct form-fill mistakes.

