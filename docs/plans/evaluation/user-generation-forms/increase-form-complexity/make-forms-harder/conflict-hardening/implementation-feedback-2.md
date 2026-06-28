# Conflict Hardening PR4 Plan Feedback (Review 2)

- Status: review feedback
- Reviewed: 2026-06-27
- Scope: revised `packet-hard-conflict-v1` plan in `implementation-plan.md`
- Method: re-read against the validator, schema, `profile.yaml`, and grep
  checks over `packet-medium` and `packet-hard-ownership-v1`.

## Verdict

The revision resolves every substantive item from `implementation-feedback-a.md`
and `implementation-feedback-1.md`, and the new factual claims hold up:

- Replaced losing title `Operations Support Specialist`, start date
  `2026-06-30`, bank `Redwood Mutual Bank` / `121042882` / `618270449305`,
  address `1724 Parker Street`, email `maya.l.chen@personalmail.test`, and tax
  values `913` / `2475` are all grep-confirmed 0 hits in both corpora.
- The "Inherited Stale Signal" table is accurate: `026-stale-payroll-bank-draft.txt`
  really does carry routing `226070656` and masked account `5590...8172`, and
  the `Operations Coordinator` / `2026-06-15` manifest-only values are correctly
  flagged as not-for-reuse.
- The null-tax-`forbid` no-op, the mandatory stale-cue rule, the
  `partial-conflicting` category fix, the `035` corroborate decision, and the
  phone-warning anticipation are all now stated correctly.

This plan is implementation-ready. The single item below is minor and does not
block; it is a one-line consistency fix.

## The One Residual: `86` Contradicts The Plan's Own Zero-Hits Gate

The recommended W-4 extra-withholding losing value is `86`. As a bare token it
has 4 substring hits across `packet-medium` / `packet-hard-ownership-v1` (it
appears inside larger numbers and timestamps). That conflicts with the plan's
own acceptance criterion:

> before authoring, grep confirms new non-W-4-status losing values have zero
> hits in `packet-medium` and `packet-hard-ownership-v1`

`86` is a non-W-4-status losing value, so a literal run of that gate flags it as
a failure, even though the plan elsewhere (the "Manual-check caveats" and
"Suggested grep checks" sections) already says numeric tax values should be
searched with field-label context such as `extraWithholding: 86`. So the gate
and the caveat disagree on `86`.

Pick one of these, not both:

1. **Preferred:** choose a more distinctive extra-withholding amount that is
   grep-clean as a bare token (a realistic 3-digit value works; `913` and `2475`
   already pass as 0-hit, so the same approach applies here). Then the blanket
   zero-hits gate holds with no special case.
2. Or explicitly exempt short numeric tax decoys from the bare zero-hits gate
   the same way filing status is exempted, and rely solely on the
   context-qualified search (`extraWithholding: 86`) for those values.

Either way, the deductions/other-income values (`2475` / `913`) are already
distinctive enough; only the 2-digit extra-withholding value needs the call.

## Nothing Else

No further changes are needed. The fixture-only boundary still holds, no schema
or scorer work is implied, and attribution between inherited and new stale
values is now unambiguous.
