# Implementation Feedback 1

> Note on this file: it previously held a **plan-stage** review titled
> "Conflict Hardening PR4 Plan Feedback (Review 1)". That content is preserved in
> git history. This pass reviews the **implemented** `packet-hard-conflict-v1`
> fixture, not the plan.

- Status: review feedback (implementation)
- Reviewed: 2026-06-27
- Scope: implemented `packet-hard-conflict-v1` corpus, the three new scenarios,
  and the conflict-hardening docs (`orchestration.md`,
  `implementation-summary.md`).
- Method: read all five new conflict documents and their manifest entries
  against `profile.yaml`, the manifest `artifactWorld`, and the
  `packet-medium` / `packet-hard-ownership-v1` corpora; ran the validator and
  grep checks listed under Validation Run.

## Summary

The fixture is sound and ships the intended difficulty family. It is correctly
based on `packet-medium` (not on the ownership packet), the copied documents are
re-identified to `packet-hard-conflict-v1` with no stale `packet-medium` or
`maya-chen-newhire__packet-medium` tokens, all five conflict documents are
realistic and clearly harder than the existing stale docs, current Maya truth
stays supported by authoritative records, the manifest metadata matches the
document bodies, losing values are scoped only to their intended documents, and
the three scenarios point at the new corpus. Focused validation is 0 errors / 46
warnings, all inherited from the copied baseline; the new docs `031`–`035`
introduce no warnings. I did not find a fixture-blocking correctness defect.

The main thing worth a decision before merge is about packaging rather than the
fixture itself: the branch carries non-fixture commits. The standing residual
risk is that this packet has no scorable assertion that the winning value beats
the losing value — leakage detection is entirely manual.

This is an independent second implementation pass. An earlier implementation
review already exists in `implementation-feedback-a.md`; where I confirm its
findings I say so.

## Findings

Ordered by severity.

1. **Branch carries non-fixture changes (PR scope).** `git diff main...HEAD`
   includes more than the fixture:
   - `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts`
     (+ `.spec.ts` and `form-fill.types.ts`) — from the earlier
     "harden form filling" commits (`c0cfc3f`, `a2c09fb`).
   - `examples/eval/scripts/direct-open-schema.mjs`,
     `direct-open-schema.test.mjs`, and `direct-open-schema-packet.mjs`.
   The conflict-fixture commit (`1af8039`) is itself scoped correctly, but if
   this is opened as a "fixture-only" PR against `main`, the diff will not be
   fixture-only. Either base the PR on the parent of `1af8039`, or broaden the
   PR description/validation to cover the backend form-fill and eval-script
   changes. This confirms the scope caveat in `implementation-feedback-a.md`.

2. **No scorable winner/loser assertion (design limitation, by design).** The
   entire conflict signal lives in `evaluationRole.challengeTags` and the private
   `artifactWorld.conflictDecoys` object. Neither the validator nor any test
   asserts that the winning value beats the losing value; a regression where
   `Redwood Mutual Bank`, `1724 Parker Street`, `Operations Support Specialist`,
   `head of household`, etc. ends up stored or filled would pass validation and
   the eval test suite silently. This is consistent with `orchestration.md`
   ("Future Scoring Notes" and Non-Goals) and is acceptable for a fixture-only
   PR, but it is the real residual risk and should be the headline of the
   deferred live-run readout. The manual leakage checklist in
   `implementation-summary.md:160-178` is currently the only safety net.

3. **Null-valued tax decoys are manual-only (correctly documented).** `913`,
   `2475`, `127` map to `tax.otherIncome` / `tax.deductions` /
   `tax.extraWithholding`, which are `null` in `profile.yaml`, so
   `factContract.forbid` is a no-op for them and `034` only forbids
   `tax.filingStatus`. The summary states this accurately
   (`implementation-summary.md:74-78`). No change needed; just make sure the
   live-run actually runs the field-labeled searches (`otherIncome: 913`, etc.),
   since they are the only coverage for these values.

4. **`035` is a `corroborate` document that contains losing values (nit /
   note for future scorer authors).** `035-hr-support-correction-thread.txt`
   carries the losing employment values (`Operations Support Specialist`,
   `2026-06-30`) in its body and is `expectedUse: corroborate` with an empty
   `forbid`. This is intentional and correct for a correction thread (it names
   the lower-authority staging values, then confirms the current HR profile), and
   it is needed so the doc can prove `employment.title` / `employment.startDate`.
   Worth recording for whoever later builds a leakage scorer: `corroborate` here
   does **not** imply "free of losing values," so a naive "any conflictDecoy
   value in a non-guardrail doc = failure" rule would mis-flag `031`, `032`, and
   `035`.

## Non-Blocking Notes

- `005-work-authorization-intake-field-export.txt:38` differs from the
  `packet-medium` original by trailing-whitespace cleanup. No fixture change is
  recommended; restore byte parity only if exact copied-baseline parity becomes
  a repo convention.

## Should Address Before PR

- Decide and document the PR base/scope (Finding #1). State explicitly whether
  the backend form-fill and `direct-open-schema*` changes are part of this PR or
  belong to an earlier one.

## Nice To Have

- In the deferred live-run summary, lead with the winner/loser outcome per fact
  family (Finding #2) and explicitly run the field-labeled numeric/filing-status
  searches (Finding #3), since those are not validator-enforced.

## Validation Run

```text
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-conflict-v1
  -> errors=0 warnings=46 (all on inherited docs 020-030; none on 031-035)

node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-conflict-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-conflict-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-conflict-v1
  -> each: errors=0 warnings=46
```

Spot checks I ran:

- Identifiers: all 35 manifest document ids are
  `maya-chen-newhire-packet-hard-conflict-v1-001..035`; `corpusId`, top-level
  `seed`, and `artifactWorld.seed` are all `...packet-hard-conflict-v1`;
  `rg packet-medium` over the corpus and scenarios = 0 hits.
- Corpus truth summary (committed `validation-report.json`):
  `factsProvenPresent=103`, `factsMissing=0`, `unsupportedDeclaredFacts=0`,
  `forbiddenFactsPresent=0`, `withheldValuesPresent=0`, `factsProvenAbsent=13`.
  Report is freshly regenerated (127 `packet-hard-conflict-v1` refs, 0
  `packet-medium` refs).
- Losing-value scoping: `Redwood Mutual Bank|121042882|618270449305|1724 Parker
  Street|maya.l.chen@personalmail.test|Operations Support Specialist|2026-06-30`
  = 0 hits in `packet-medium` and `packet-hard-ownership-v1`; within the new
  corpus each appears only in its intended doc (bank → `031`, address/email →
  `032`, employment → `033` + `035`). Bare `913|2475|127` = 0 hits in the other
  two corpora and only in `034`.
- Winning-value support: `Bay Harbor Credit Union` / `091000019` /
  `740182936451` corroborated by `016`/`017`/`018` + `031.after`; current
  address/email by `006`/`007`/`021`/... + `032.current_values`; title/start
  date `Client Operations Associate` / `2026-07-06` by `006`/`008`/`009` + `035`.
- Manifest fidelity: all `factContract.include`/`forbid` paths resolve to real
  `profile.yaml` facts; all `sourceSpec.worldRefs` and `timelineRefs` for
  `031`–`035` resolve in `artifactWorld` (`conflictDecoys`, `employer`,
  `banking`, `timeline`).
- Temporal realism: draft/before timestamps precede their approved/after
  counterparts (W-4 draft `2026-06-24T11:26` < approved `w4SavedAt`
  `2026-06-25T13:28`; recruiter draft `2026-06-18` < finalized offer
  `2026-06-21T16:35`; profile/deposit audits exported after their approval
  events). Document body timestamps match the `artifactWorld.timeline` refs.
- Diff vs `packet-medium/documents`: only the five new files plus the
  whitespace-only delta on `005`.

I did not re-run `node --test examples/eval/scripts` (the summary and
`implementation-feedback-a.md` report 314 passing); nothing I changed would
affect it.

## Open Questions

- For Lucas: is the intended PR base the parent of `1af8039` (fixture-only), or
  is the branch meant to ship the backend form-fill + `direct-open-schema`
  changes together? (Finding #1)
- Is a scorable decoy contract (document id / challenge tag / decoy value /
  expected behavior) planned before the first live run, or will the first run
  rely entirely on the manual leakage checklist? (Finding #2)
