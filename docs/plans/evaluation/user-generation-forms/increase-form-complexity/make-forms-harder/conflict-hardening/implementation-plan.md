# Conflict Hardening Packet PR Plan

- Status: implementation-ready
- Last updated: 2026-06-28

## Summary

Add one fixture-only packet, `packet-hard-conflict-v1`, to make Maya's
shared-dossier evaluation harder through conflict and temporal-validity cases.
Keep one shared corpus and three independent one-form scenarios. Do not change
runner, scorer, backend, MCP, form maps, schema, or Maya `profile.yaml`.

The difficulty comes from realistic records where a losing value is plausible
for Maya but should not be treated as current truth because it is stale, draft,
lower-authority, superseded, or only a before-value in an audit-style record.

## Baseline Decision

Create `packet-hard-conflict-v1` from `packet-medium`, not from
`packet-hard-ownership-v1`.

Reason:

- `packet-hard-conflict-v1` should isolate conflict and temporal failures from
  the subtle ownership failures introduced in PR2.
- `packet-medium` already has the full Maya shared dossier plus obvious stale,
  sample, and other-person noise.
- The conflict packet can still be compared directly against `packet-medium`
  and later against `packet-hard-ownership-v1` live results.

If a cumulative hard-mode packet is wanted later, create it as a separate
packet after both ownership and conflict are interpretable. Do not make PR4
both the isolated conflict packet and the cumulative packet.

## Key Changes

1. Update this plan first.
   - Incorporate any final choices about conflict document count and exact
     losing values.
   - Incorporate implementation-review decisions before updating the summary.
   - State that `implementation-summary.md` and `orchestration.md` are updated
     only at the end.

2. Create `examples/eval/users/maya-chen-newhire/corpora/packet-hard-conflict-v1/`
   from `packet-medium`.
   - Update `corpusId`, top-level `seed`, `artifactWorld.seed`, and `purpose`.
   - Rename copied document IDs to
     `maya-chen-newhire-packet-hard-conflict-v1-NNN`.
   - Regenerate, do not preserve, the copied `validation-report.json`.
   - Search the new corpus for stale `packet-medium` /
     `maya-chen-newhire__packet-medium` metadata before validation.

3. Extend `artifactWorld` with explicit conflict decoy values and timeline refs.
   - Keep Maya truth unchanged:
     - current address: `2846 Ashbury Street Apt 3D, Oakland, CA 94609`;
     - current personal email: `maya.chen@gmail.test`;
     - current title: `Client Operations Associate`;
     - current start date: `2026-07-06`;
     - current bank: `Bay Harbor Credit Union`, routing `091000019`, account
       `740182936451`, checking;
     - current W-4 filing status: `single or married filing separately`, with
       no extra withholding, other income, or deductions.
   - Add losing values under a clearly named private object such as
     `artifactWorld.conflictDecoys`.
   - Add timeline refs for old, draft, submitted, approved, and audit events so
     document bodies can make temporal order inferable without exposing eval
     labels.

4. Add five new conflict documents with source-native paths and titles.
   - `031-ledgerpay-deposit-change-audit.yaml`: bank before/after audit. The
     old bank value is present as a previous payment election, while the after
     value matches Maya's current direct deposit. `category: payroll-tax`,
     `expectedUse: corroborate`, `freshness: mixed`, `authority: medium` or
     `high`.
   - `032-harborhire-profile-change-history.json`: profile before/after change
     history. The old address and old personal email are present as replaced
     values, while the after values match Maya's current address/email.
     `category: hr-onboarding`, `expectedUse: corroborate`,
     `freshness: mixed`, `authority: medium` or `high`.
   - `033-recruiting-offer-draft-export.txt`: lower-authority recruiter draft
     with old title and old start date. It belongs to Maya, but should lose to
     the finalized offer/onboarding records already in the packet.
     `category: partial-conflicting`, `expectedUse: guardrail`,
     `freshness: stale`, `authority: low`.
   - `034-ledgerpay-w4-draft-autosave.yaml`: unsubmitted W-4 draft with losing
     tax values. It should lose to the current W-4 setup and payroll tax
     profile. `category: partial-conflicting`, `expectedUse: guardrail`,
     `freshness: stale`, `authority: low`.
   - `035-hr-support-correction-thread.txt`: low-authority support thread that
     mentions an incorrect start date or title, then points to the official HR
     profile/export as the source of truth. Implement this as
     `category: hr-onboarding`, `expectedUse: corroborate`,
     `freshness: mixed`, `authority: low`. Include only the current Maya facts
     it proves, such as `employment.title` and `employment.startDate`.

## Inherited Stale Signal

Because PR4 starts from `packet-medium`, it inherits existing stale/conflicting
documents. Do not attribute leakage from these values to the new PR4 documents
unless the same value also appears in a new PR4 document by deliberate design.

Implementation summaries and live-run summaries should keep two leakage tables:

- inherited `packet-medium` stale values;
- new PR4 losing values.

Inherited stale values to track separately:

| Document | Inherited stale signal |
| --- | --- |
| `025-stale-recruiter-profile.txt` | `maya.chen@oldmail.test`; `910 Juniper Avenue Apt 12, Berkeley, CA 94704` |
| `026-stale-payroll-bank-draft.txt` | Harbor Neighborhood Bank; routing `226070656`; masked account `5590...8172` |
| `027-stale-onboarding-export.yaml` | archived/superseded onboarding profile and plan values |

Existing manifest-only stale metadata also includes `Operations Coordinator`
and `2026-06-15`; do not reuse those as new PR4 losing values.

## Suggested Losing Values

Use values that are distinct from Maya truth, inherited `packet-medium` stale
values, and ownership decoys in `packet-hard-ownership-v1`.

Before authoring, grep candidate values against both existing corpora:

```bash
rg -n "CANDIDATE_VALUE" \
  examples/eval/users/maya-chen-newhire/corpora/packet-medium \
  examples/eval/users/maya-chen-newhire/corpora/packet-hard-ownership-v1
```

Prefer losing values that have zero hits. Filing status is the exception:
realistic W-4 statuses are a closed set and already appear in W-4 instructions
or samples, so filing-status leakage should be treated as a form-score/source
context signal rather than a bare grep marker.

Recommended first set:

| Fact family | Losing value | Winning value |
| --- | --- | --- |
| Banking institution | Redwood Mutual Bank | Bay Harbor Credit Union |
| Banking routing | `121042882` | `091000019` |
| Banking account | `618270449305` | `740182936451` |
| Banking account type | savings | checking |
| Address | `1724 Parker Street Unit 8, Berkeley, CA 94703` | `2846 Ashbury Street Apt 3D, Oakland, CA 94609` |
| Personal email | `maya.l.chen@personalmail.test` | `maya.chen@gmail.test` |
| Employment title | Operations Support Specialist | Client Operations Associate |
| Start date | `2026-06-30` | `2026-07-06` |
| W-4 filing status | head of household | single or married filing separately |
| W-4 other income | `913` | blank / null |
| W-4 deductions | `2475` | blank / null |
| W-4 extra withholding | `127` | blank / null |

These losing values should appear only in the new conflict documents unless a
deliberate document needs both before and after values. Current Maya values can
appear in mixed audit/change-history records when the record clearly marks them
as the after/current/approved value.

Manual-check caveats:

- `head of household` is not grep-unique because W-4 options already appear in
  inherited instructions and samples. Use W-4 form-fill scoring and source
  context to inspect this case.
- `tax.otherIncome`, `tax.deductions`, and `tax.extraWithholding` are `null` in
  `profile.yaml`. Validator `forbid` checks skip null current values, so the
  losing tax numbers are manual memory-leakage checks, not validator-enforced
  forbidden facts.
- Numeric tax values must be searched with enough context to avoid OCR
  coordinate or percentage collisions. Prefer exact field labels in the live
  artifact search, such as `otherIncome: 913`, `deductions: 2475`, or
  `extraWithholding: 127`.

## Manifest Rules For New Documents

- Use complete realistic-generated `sourceSpec` metadata for every new
  document.
- Use source-family categories for mixed before/after corroborating documents:
  `031` is `payroll-tax`, `032` is `hr-onboarding`, and `035` is
  `hr-onboarding`.
- Use `category: partial-conflicting` for pure stale or draft guardrail
  documents: `033` and `034`.
- Use `evaluationRole.expectedUse: guardrail` for documents that should teach
  the model not to use a losing value.
- Use `evaluationRole.expectedUse: corroborate` only when the document contains
  current Maya-owned facts that are safe to use.
- Use `evaluationRole.freshness: stale` for old/draft-only documents and
  `mixed` for before/after or correction-thread documents.
- Set `evaluationRole.authority` based on source authority, not usefulness.
  Draft recruiter exports and support notes should usually be `low`; payroll
  or HR structured audit exports can be `medium` or `high`.
- Make `035` a clear `corroborate`/`mixed` document with current facts, not a
  guardrail document with includes. The validator only proves included facts
  for `extract` and `corroborate` documents.
- Use `evaluationRole.challengeTags` to record intent.
- Use `factContract.include` only for current Maya-owned facts actually present
  in mixed docs.
- For pure stale/lower-authority documents, keep `factContract.include` empty
  and put the affected current Maya fact paths in `factContract.forbid` so the
  stale document is not allowed to contain the winning value.
- For null-valued tax facts such as `tax.otherIncome`, `tax.deductions`, and
  `tax.extraWithholding`, do not rely on `factContract.forbid`; the validator
  skips forbidden checks when the current profile value is null. Record those
  as manual leakage checks instead.
- Do not put losing values in `factContract.include`. Includes mean current
  Maya truth.
- Do not add new schema fields or scorer logic.
- Do not use eval labels like trap, decoy, benchmark, stale-value test, or
  wrong answer in document bodies.
- Do not rely only on file names. The body should make the loser/winner
  relationship inferable through source-native cues such as timestamp, status,
  submitted/approved state, before/after labels, correction notes, or source
  authority.
- Include natural stale-cue words in any document that is `freshness: stale`,
  `expectedUse: guardrail`, or `category: partial-conflicting`. The validator
  looks for words such as `stale`, `superseded`, `former`, `old`, `inactive`,
  `outdated`, or `do not use`. Prefer source-native wording such as
  "former payment election", "superseded draft", or "old values replaced by
  approved profile" rather than eval-flavored labels.
- Avoid phone-like strings in new documents unless they are important to the
  case. `contact.phone` remains intentionally missing, so phone strings can add
  `DOCUMENT_SOURCE_PHONE_PRESENT` warnings that must be explained.

Suggested challenge tags:

```text
conflict-current-vs-stale
conflict-authority
temporal-old-address
temporal-old-bank
temporal-old-email
temporal-draft-vs-approved
temporal-before-after
tax-draft-conflict
employment-draft-conflict
```

## Scenario Changes

Add three scenarios:

- `maya-chen-newhire-i9-packet-hard-conflict-v1`
- `maya-chen-newhire-fw4-packet-hard-conflict-v1`
- `maya-chen-newhire-direct-deposit-packet-hard-conflict-v1`

Match packet-medium and ownership packet scenario shape:

- `userId: maya-chen-newhire`;
- `corpusId: packet-hard-conflict-v1`;
- same form IDs: `i-9`, `fw4`, and `direct-deposit-sf1199a-24`;
- `expectedSnapshots: []`;
- no new multi-form scenario format.

## Validation And Acceptance

Run:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-hard-conflict-v1 --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-hard-conflict-v1
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-hard-conflict-v1
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-hard-conflict-v1
pnpm eval:validate
pnpm eval:test
git diff --check
```

Acceptance criteria:

- zero validation errors;
- zero missing declared Maya facts;
- focused corpus summary shows `factsMissing: 0`,
  `unsupportedDeclaredFacts: 0`, `forbiddenFactsPresent: 0`, and
  `withheldValuesPresent: 0`;
- current Maya profile truth remains unchanged;
- all losing bank, address, email, employment, and tax values are distinct from
  Maya truth, inherited `packet-medium` stale values, and ownership decoy
  values;
- before authoring, grep confirms new non-W-4-status losing values have zero
  hits in `packet-medium` and `packet-hard-ownership-v1`;
- after authoring, grep confirms each new losing value appears only in intended
  new PR4 documents, except closed-set W-4 filing-status labels that already
  appear in inherited instructions or samples;
- pure stale/lower-authority documents contain no forbidden current Maya values;
- `033` and `034` contain natural stale cues and should not introduce
  `DOCUMENT_STALE_CUE_MISSING` warnings;
- any new `DOCUMENT_STALE_CUE_MISSING` or `DOCUMENT_SOURCE_PHONE_PRESENT`
  warnings are explained by document in the implementation summary;
- expected inherited packet-medium warnings are not treated as new PR4
  failures;
- no live MCP/direct artifacts committed in this PR.

Record warning counts by code in the implementation summary. Split inherited
warnings from new PR4 warnings where practical.

Suggested grep checks after authoring:

```bash
rg -n "Redwood Mutual Bank|121042882|618270449305|1724 Parker Street|maya\\.l\\.chen@personalmail\\.test|Operations Support Specialist|2026-06-30|\\b913\\b|\\b2475\\b|\\b127\\b" \
  examples/eval/users/maya-chen-newhire/corpora/packet-hard-conflict-v1
```

For W-4 filing status, inspect source context and form-fill output instead of
using a bare `head of household` grep count.

## Manual Leakage Checklist

At implementation time, record the exact losing values in
`implementation-summary.md` and search for them in the follow-up live MCP/direct
artifacts.

For every new PR4 losing value, the implementation summary should record:

- document id and path;
- losing fact family;
- losing value;
- winning current value;
- source-native cue that makes the losing value lose;
- expected live artifact search target.

The first live-run readout should answer:

- Did an old bank account replace Maya's current direct deposit?
- Did an old address or old email get stored as active contact/profile memory?
- Did a draft title or start date beat finalized onboarding records?
- Did an unsubmitted W-4 draft fill current W-4 fields?
- Did the stored-memory MCP path and direct no-memory baseline fail in the same
  way, or did only one path preserve the losing value?

Search both stored-memory and direct artifacts, especially:

- `memory-snapshot.json`;
- open-schema score report `knownPresent`, `unscoredActivePreferences`, and
  `unscoredSuggestions`;
- direct `extraction.json`;
- per-form `filled-form.json` and score details.

## End-Of-PR Docs

At the very end, create
`docs/plans/evaluation/user-generation-forms/increase-form-complexity/make-forms-harder/conflict-hardening/implementation-summary.md`.

Include:

- what was added;
- document count and scenario IDs;
- exact losing values and winning current values;
- separate tables for inherited `packet-medium` stale values and new PR4
  losing values;
- grep verification results for new losing values;
- validation commands and results;
- focused corpus `corpusTruth.summary`;
- confirmation that `factsMissing`, `unsupportedDeclaredFacts`,
  `forbiddenFactsPresent`, and `withheldValuesPresent` are all zero;
- reviewed warning codes, split into inherited vs new where practical;
- document-specific rationale for any new `DOCUMENT_STALE_CUE_MISSING` or
  `DOCUMENT_SOURCE_PHONE_PRESENT` warnings;
- manual leakage checklist;
- note that live MCP/direct runs are deferred.

Then update
`docs/plans/evaluation/user-generation-forms/increase-form-complexity/make-forms-harder/orchestration.md`.

Include:

- link to the conflict implementation plan and summary;
- conflict fixture PR marked implemented/validated;
- whether `packet-hard-conflict-v1` was based on `packet-medium`;
- the next live-run signal to compare against `packet-medium`,
  `packet-hard-ownership-v1`, and direct no-memory results.

## Assumptions

- This PR creates one packet, not a cumulative hard-mode packet.
- The three scenarios remain independent one-form scenarios.
- `packet-medium` remains unchanged.
- `packet-hard-ownership-v1` remains unchanged.
- `contact.phone` remains intentionally missing.
- Challenge tags are tracking-only and not ingestion hints.
- Conflict failures should be classifiable as extraction, storage, authority,
  temporal-validity, or form-fill errors.
