# Conflict Hardening PR4 Plan Feedback (Review 1)

- Status: review feedback
- Reviewed: 2026-06-27
- Scope: `packet-hard-conflict-v1` fixture plan in `implementation-plan.md`
- Method: read against the live validator (`examples/eval/scripts/validate.mjs`),
  the manifest schema (`examples/eval/schemas/manifest.schema.json`), the
  current `profile.yaml`, and the `packet-medium` / `packet-hard-ownership-v1`
  corpora.

This is an independent second pass. It complements the existing
`implementation-feedback-a.md`; where it agrees I say so briefly, and the new
material is in sections 2–5, which are grounded in the validator code and grep
results against the committed corpus.

## 1. Overall Assessment

Proceed after the fixes below. The plan is fixture-only, isolates one
difficulty family, and correctly bases the packet on `packet-medium` rather
than `packet-hard-ownership-v1` so conflict/temporal failures stay
attributable. I verified the load-bearing assumptions and they hold:

- Every manifest value the plan uses is a valid enum:
  `category` (`payroll-tax`, `hr-onboarding`, `employer-context`,
  `partial-conflicting`), `expectedUse` (`corroborate`, `guardrail`),
  `freshness` (`mixed`, `stale`), and `authority` (`low`/`medium`/`high`) all
  exist in `manifest.schema.json`. `challengeTags` is a free-form
  kebab-case array, so all suggested tags are accepted.
- The stated winning values exactly match `profile.yaml` (address
  `2846 Ashbury Street Apt 3D`, email `maya.chen@gmail.test`, title
  `Client Operations Associate`, start date `2026-07-06`, bank
  `Bay Harbor Credit Union` / `091000019` / `740182936451` / checking, filing
  status `single or married filing separately`, with `otherIncome`,
  `deductions`, `extraWithholding` all `null`).
- The `031`–`035` numbering is consistent: `packet-medium` ends at `030`, and
  documents live in per-category subdirectories, so the new files slot in the
  same way the ownership packet's `031`–`035` did.
- `artifactWorld.conflictDecoys` is safe to add: `artifactWorld` accepts
  arbitrary keys (the ownership packet added decoy entities there and validated
  clean).

## 2. Losing-Value Collisions — Three Of The Recommended Values Are Not Unique

This is the most important correctness issue and it is concrete. I grepped the
rendered `packet-medium` corpus for each recommended losing value:

| Recommended losing value | Hits in `packet-medium` | Verdict |
| --- | --- | --- |
| `Redwood Mutual Bank` | 0 | unique, keep |
| routing `121042882` | 0 | unique, keep |
| account `618270449305` | 0 | unique, keep |
| `1724 Parker Street ...` | 0 | unique, keep |
| `maya.l.chen@personalmail.test` | 0 | unique, keep |
| `Operations Coordinator` | 1 (manifest only) | **collides** |
| `2026-06-22` | 6 (3 doc bodies) | **collides** |
| `head of household` | 6 (3 doc bodies) | **collides** |

Details that matter for attribution:

- **`Operations Coordinator`** is already `artifactWorld.stale.oldTitle` in the
  `packet-medium` manifest. It does not currently appear in any *document body*
  (the single hit is metadata), so a body grep would still find only the new
  `033`. But reusing the established "old title" token conflates the inherited
  stale-title concept with the new conflict-title signal and makes human
  reasoning harder. Pick a title that is not `oldTitle` and not Maya truth, e.g.
  `Operations Support Specialist`.
- **`2026-06-22`** is the worst choice. It appears in three *current/legitimate*
  document bodies, including `hr-onboarding/006-hr-onboarding-profile-export.yaml`
  (a corroborating, current HR profile) plus `024-employee-profile-audit-log.txt`
  and `027-stale-onboarding-export.yaml`. It is also distinct from the existing
  `artifactWorld.stale.oldStartDate` (`2026-06-15`). Using it as the losing
  start date means a leaked `2026-06-22` cannot be attributed to PR4 at all, and
  may not even be wrong. Choose a date that is 0-hits in `packet-medium` and not
  adjacent to real timeline dates, e.g. `2026-06-30`.
- **`head of household`** already appears in three sample/instruction docs
  (`noise/015-blank-sample-w4-packet.txt`,
  `noise/029-other-employee-w4-tax-sample.txt`,
  `employer-context/014-w4-instructions.txt`). As a *memory-leakage grep marker*
  it is therefore non-unique. It is still meaningful as a *form-fill* conflict,
  because filing status maps to the W-4 checkbox branch and form scoring is
  value-independent — but note that filing-status options are a tiny closed set,
  so any losing status will collide with the existing W-4 samples. Treat
  filing-status leakage as a form-score signal, not a grep signal, and say so in
  the summary.

Recommendation: regenerate the "Suggested Losing Values" table so every losing
value is grep-verified 0-hits in **both** `packet-medium` and
`packet-hard-ownership-v1`, and add a grep step to the acceptance gate (see
section 6). `feedback-a` raised the title/start-date overlap; the filing-status
collision is additional and the start-date case is worse than described (it is
in a current doc body, not just "noisy timestamps").

## 3. `forbid` On Null Tax Facts Is A Validator No-Op

The plan's manifest rules say, for pure stale/lower-authority documents, "put
the affected current Maya fact paths in `factContract.forbid` so the stale
document is not allowed to contain the winning value." For the W-4 draft (`034`)
the affected facts are `tax.otherIncome`, `tax.deductions`, and
`tax.extraWithholding` — all `null` in `profile.yaml`.

In `validate.mjs`, the forbidden-fact check resolves the fact's *current profile
value* and, when that value is `null`, **skips the body check entirely**
(`if (factState.value == null) { ... continue; }`). So forbidding those three
tax paths produces no enforcement at all — there is no winning value string to
forbid because the winning state is "blank." The forbid is meaningful only for
facts with a concrete current value, i.e. `tax.filingStatus`
(`single or married filing separately`).

Consequences to fix in the plan:

- Do not present `forbid` on `otherIncome` / `deductions` / `extraWithholding`
  as protection. State plainly that these losing tax values (`450`, `1800`,
  `60`) are **manual-leakage-only** checks: they are not mapped/scored form
  fields and not enforceable via `forbid`. They can still leak into active
  memory as unscored preferences, which is worth a manual grep, but the plan
  should not imply validator coverage. (This sharpens `feedback-a` section 4
  with the validator-level reason.)
- For `034`, the only validator-meaningful forbid is `tax.filingStatus`, and the
  only automatically visible conflict is the filing-status checkbox on the W-4
  form.

## 4. `DOCUMENT_STALE_CUE_MISSING` Is Mandatory For Stale/Guardrail/Conflicting Docs

The validator raises `DOCUMENT_STALE_CUE_MISSING` whenever
`freshness === 'stale'` **or** `expectedUse === 'guardrail'` **or**
`category === 'partial-conflicting'` and the body lacks a stale cue. The cue
regex matches `stale|superseded|former|old|inactive|returned|do not use|
do-not-use|outdated`.

This directly governs the new conflict docs:

- `033` (stale + guardrail) and `034` (stale + guardrail) **must** contain one
  of those cue words, or they each emit a warning.
- Any document the plan routes to `category: partial-conflicting` (see section
  5) auto-inherits the same requirement regardless of its freshness.
- `031`/`032` (`mixed` + `corroborate`) and a `corroborate` choice for `035` do
  **not** trigger it.

There is a real design tension here worth naming in the plan: the brainstorm
wants the loser to be inferable from *source-native* cues (timestamp, draft
status, approval state) without "screaming trap," but the validator forces an
explicit lexical cue into stale/guardrail bodies. The good news is the cue
vocabulary (`former`, `old`, `superseded`, `outdated`) is natural in a
before/after or draft record ("former mailing address," "superseded by approved
profile"), so this is satisfiable without eval-flavored language. The plan
should make a deliberate choice rather than leaving it as "avoided or
explicitly explained": for `033`/`034`, commit to including a natural stale cue
so these documents validate clean, and reserve the "explain the warning" path
for genuine exceptions only.

## 5. Internal Contradiction On Category Assignment

The plan contradicts itself on `partial-conflicting`:

- The per-document list (Key Changes §4) assigns `033 → employer-context` and
  `034 → payroll-tax`.
- The "Manifest Rules" section says "Use `category: partial-conflicting` for
  pure stale or losing-value documents when that best matches the existing
  packet style."

`033` (recruiter draft, stale) and `034` (W-4 draft, stale) are exactly the
"pure stale/losing-value" documents that rule points at, and `packet-medium`'s
existing stale docs (`025`/`026`/`027`) all live under `partial-conflicting`.
An implementer cannot follow both instructions. Resolve it explicitly. I would
lean toward `partial-conflicting` for `033`/`034` to match the established
packet style (note this auto-triggers the section 4 stale-cue requirement, which
is fine), and keep `031`/`032` in their source families (`payroll-tax` /
`hr-onboarding`) since they are mixed corroborating audits. Whatever the choice,
state it once and remove the conflicting guidance.

## 6. Smaller, Grounded Notes

- **Anticipate new `DOCUMENT_SOURCE_PHONE_PRESENT` warnings.** `contact.phone`
  is intentionally missing, and the validator warns when a body contains
  phone-like text in that state. The conflict docs most likely to carry phone
  numbers are `032` (HR profile change history) and `035` (support thread). The
  ownership packet hit exactly this and documented it; the conflict plan's
  acceptance list does not mention it. Either keep phone strings out of those
  bodies or pre-declare the expected warnings, the way the ownership summary
  did.
- **`guardrail` documents cannot prove includes.** The validator only checks
  declared `include` facts for `extract`/`corroborate` documents
  (`checksBodyForDeclaredFacts`). So for `035`, the choice is binary, as
  `feedback-a` noted: `corroborate` + `mixed` *with* the current facts it proves,
  or `guardrail` with `include: []`. A `guardrail` doc with a non-empty
  `include` will not prove those facts (and `expectedUse: ignore` with includes
  hard-fails via `MANIFEST_IGNORE_FACT_KEYS`, though the plan doesn't use
  `ignore`). Decide `035` before authoring.
- **Avoid `partial-conflicting` + high-authority + current + extract.** The
  validator flags that exact combination
  (`MANIFEST_CONFLICTING_HIGH_AUTHORITY_EXTRACT`). None of the planned docs use
  `extract`, so this is just a guardrail to keep in mind if a doc is later
  promoted.

## 7. Acceptance-Gate Additions

Beyond the commands already listed, the gate should require:

- a grep over the committed corpus confirming each **new losing value** appears
  only in its intended document, and is 0-hits in `packet-medium` and
  `packet-hard-ownership-v1` before the new docs are added;
- two leakage tables in the summary (inherited `packet-medium` stale values vs.
  new PR4 losing values), so live-run attribution is unambiguous — agree with
  `feedback-a` here;
- warning counts split by code, with any `DOCUMENT_STALE_CUE_MISSING` or new
  `DOCUMENT_SOURCE_PHONE_PRESENT` warnings explained per-document, not just
  counted;
- explicit confirmation that `factsMissing`, `unsupportedDeclaredFacts`,
  `forbiddenFactsPresent`, and `withheldValuesPresent` are all zero on the
  focused corpus run.

## 8. Bottom Line

The plan is close and should ship after: (1) replacing the three colliding
losing values (`Operations Coordinator`, `2026-06-22`, `head of household`) with
grep-verified-unique ones and adding the grep step to the gate; (2) downgrading
the null-valued tax `forbid`s to documented manual-only checks; (3) committing
to natural stale cues for `033`/`034`; (4) resolving the `partial-conflicting`
category contradiction; and (5) pre-declaring the likely phone-present warnings.
None of these require runner, scorer, schema, or backend changes, so the
fixture-only boundary holds.
