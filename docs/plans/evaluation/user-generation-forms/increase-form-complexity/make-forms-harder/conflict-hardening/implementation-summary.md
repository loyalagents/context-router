# Conflict Hardening Implementation Summary

- Status: implemented and validated
- Last updated: 2026-06-28
- Scope: fixture-only `packet-hard-conflict-v1` corpus and scenarios

## What Changed

Added one new Maya packet corpus:

```text
examples/eval/users/maya-chen-newhire/corpora/packet-hard-conflict-v1/
```

The corpus starts from the `packet-medium` dossier and adds five
conflict/temporal-validity challenge documents, for 35 total documents. Maya
`profile.yaml`, forms, form maps, runners, scorer, backend behavior, MCP
behavior, and schema files were not changed.

Added three independent one-form scenarios against the same shared corpus:

- `maya-chen-newhire-i9-packet-hard-conflict-v1`
- `maya-chen-newhire-fw4-packet-hard-conflict-v1`
- `maya-chen-newhire-direct-deposit-packet-hard-conflict-v1`

## Conflict Additions

New document families:

- `031-ledgerpay-deposit-change-audit.yaml`: before/after direct-deposit audit
  where the old bank loses to the active Bay Harbor Credit Union election.
- `032-harborhire-profile-change-history.json`: before/after profile change
  history where old address/email values lose to approved current values.
- `033-recruiting-offer-draft-export.txt`: superseded recruiter draft with
  losing title and start date.
- `034-ledgerpay-w4-draft-autosave.yaml`: old unsubmitted W-4 autosave with
  losing tax values.
- `035-hr-support-correction-thread.txt`: support correction thread that names
  lower-authority staging values and confirms current HR profile title/start
  date.

All new challenge intent is encoded with existing V2 manifest fields:
`evaluationRole`, `factContract`, `sourceSpec`, `artifactWorld`, and
`challengeTags`. No scorable decoy metadata or new manifest fields were added.

## Inherited Stale Values

Because this packet is based on `packet-medium`, live-run review should track
inherited stale values separately from new PR4 losing values.

| Source | Inherited stale signal |
| --- | --- |
| `025-stale-recruiter-profile.txt` | `maya.chen@oldmail.test`; `910 Juniper Avenue Apt 12, Berkeley, CA 94704` |
| `026-stale-payroll-bank-draft.txt` | Harbor Neighborhood Bank; routing `226070656`; masked account `5590...8172` |
| `027-stale-onboarding-export.yaml` | archived/superseded onboarding profile and plan values |

Existing manifest-only stale metadata includes `Operations Coordinator` and
`2026-06-15`; those were not reused as new PR4 losing values.

## New Losing Values

| Document | Fact family | Losing value | Winning value | Why losing loses |
| --- | --- | --- | --- | --- |
| `031` | banking | Redwood Mutual Bank; `121042882`; `618270449305`; savings | Bay Harbor Credit Union; `091000019`; `740182936451`; checking | The old values are in the `before`/former section; the `after` section is active. |
| `032` | address/email | `1724 Parker Street Unit 8, Berkeley, CA 94703`; `maya.l.chen@personalmail.test` | `2846 Ashbury Street Apt 3D, Oakland, CA 94609`; `maya.chen@gmail.test` | The old values are `previous_values`; `current_values` is approved and active. |
| `033` | employment | `Operations Support Specialist`; `2026-06-30` | Client Operations Associate; `2026-07-06` | The export is a superseded recruiter draft and says finalized onboarding records supersede it. |
| `034` | tax | head of household; other income `913`; deductions `2475`; extra withholding `127` | single or married filing separately; blanks/nulls for the numeric fields | The W-4 autosave is old, inactive, and unsubmitted. |
| `035` | employment | `Operations Support Specialist`; `2026-06-30` | Client Operations Associate; `2026-07-06` | A support reviewer identifies staging values as lower authority and confirms current HR profile values. |

Tax review nuance:

- `head of household` is not grep-unique because W-4 options appear in
  inherited instructions and samples. Treat it as a form-fill/source-context
  signal, not a bare grep marker.
- `tax.otherIncome`, `tax.deductions`, and `tax.extraWithholding` are null in
  Maya truth, so validator `forbid` cannot enforce blankness. Search the live
  artifacts for field-labeled numeric leakage such as `otherIncome: 913`,
  `deductions: 2475`, and `extraWithholding: 127`.

## Grep Verification

Pre-authoring uniqueness was verified with:

```bash
rg -n "Redwood Mutual Bank|121042882|618270449305|1724 Parker Street|maya\\.l\\.chen@personalmail\\.test|Operations Support Specialist|2026-06-30|\\b913\\b|\\b2475\\b|\\b127\\b" \
  examples/eval/users/maya-chen-newhire/corpora/packet-medium \
  examples/eval/users/maya-chen-newhire/corpora/packet-hard-ownership-v1
```

Result: 0 hits.

Post-authoring corpus search confirms the new values appear only in the
manifest's private `artifactWorld.conflictDecoys` object and intended new
documents:

- bank values in `031`;
- old address/email in `032`;
- draft employment values in `033` and `035`;
- draft numeric tax values in `034`.

The new corpus and scenarios contain no stale copied `packet-medium` /
`maya-chen-newhire__packet-medium` metadata.

## Validation Results

Commands run:

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-conflict-v1 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-conflict-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-conflict-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-conflict-v1
node examples/eval/scripts/validate.mjs
node --test examples/eval/scripts
git diff --check
```

The equivalent `pnpm eval:validate` wrapper was attempted first, but this
worktree had no dependencies installed. It populated dependencies and then
blocked on pnpm ignored-build/purge prompts. The direct Node commands above are
the package script entrypoints used by `pnpm`.

Focused corpus validation:

```text
errors: 0
warnings: 46
documentsChecked: 35
factsProvenPresent: 103
factsMissing: 0
unsupportedDeclaredFacts: 0
factsProvenAbsent: 13
forbiddenFactsPresent: 0
withheldValuesPresent: 0
hardFailures: 0
```

Warning breakdown:

```text
DOCUMENT_SOURCE_LENGTH_OUT_OF_RANGE: 23
DOCUMENT_TXT_MARKDOWN_STYLE: 1
DOCUMENT_NATIVE_SIGNAL_MISSING: 13
DOCUMENT_MISSING_FACT_PRESENT: 4
DOCUMENT_SOURCE_PHONE_PRESENT: 5
```

Interpretation:

- All 46 warnings are inherited from the copied `packet-medium` baseline.
- The new conflict documents `031`-`035` introduced no validation warnings.
- No `DOCUMENT_STALE_CUE_MISSING` warnings were introduced.
- No new `DOCUMENT_SOURCE_PHONE_PRESENT` warnings were introduced.
- No forbidden current Maya values are present in pure stale/draft challenge
  bodies.

Whole-tree validation passed with 0 errors and 151 warnings. The eval script
test suite passed 314 tests.

## Manual Leakage Checklist

Search these values in the follow-up live MCP/direct artifacts.

| Value family | Search targets | Expected behavior |
| --- | --- | --- |
| Old bank | `Redwood Mutual Bank`, `121042882`, `618270449305`, `savings` near Redwood | Do not store or fill as Maya's active direct-deposit facts. |
| Old address/email | `1724 Parker Street Unit 8`, `Berkeley, CA 94703`, `maya.l.chen@personalmail.test` | Do not store or fill as active contact/profile facts. |
| Draft employment | `Operations Support Specialist`, `2026-06-30` | Do not beat finalized HR profile title/start date. |
| Draft W-4 | `head of household`, `otherIncome: 913`, `deductions: 2475`, `extraWithholding: 127` | Do not fill W-4 from the unsubmitted draft; inspect numeric values as manual memory leakage. |

Inspect both stored-memory and direct artifacts:

- `memory-snapshot.json`;
- open-schema score report `knownPresent`, `unscoredActivePreferences`, and
  `unscoredSuggestions`;
- direct `extraction.json`;
- per-form `filled-form.json` and score details.

## Deferred Work

No live MCP or direct open-schema packet artifacts were committed in this PR.
The next step is to run the conflict packet through the stored-memory MCP path
and the direct no-memory packet baseline, then summarize whether failures are
conflict/temporal leakage, ordinary extraction, storage, authority, or
form-fill issues.
