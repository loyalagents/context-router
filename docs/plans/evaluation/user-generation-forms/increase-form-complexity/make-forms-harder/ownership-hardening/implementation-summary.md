# Ownership Hardening Implementation Summary

- Status: implemented and validated
- Last updated: 2026-06-28
- Scope: fixture-only `packet-hard-ownership-v1` corpus and scenarios

## What Changed

Added one new Maya packet corpus:

```text
examples/eval/users/maya-chen-newhire/corpora/packet-hard-ownership-v1/
```

The corpus starts from the `packet-medium` dossier and adds five ownership
challenge documents, for 35 total documents. Maya `profile.yaml`, forms, form
maps, runners, scorer, backend behavior, MCP behavior, and schema files were
not changed.

Added three independent one-form scenarios against the same shared corpus:

- `maya-chen-newhire-i9-packet-hard-ownership-v1`
- `maya-chen-newhire-fw4-packet-hard-ownership-v1`
- `maya-chen-newhire-direct-deposit-packet-hard-ownership-v1`

## Ownership Additions

New document families:

- `031-ledgerpay-payment-election-export.yaml`: pure non-Maya payment election
  for Noah Kim.
- `032-harborhire-emergency-contact-export.yaml`: Maya-adjacent emergency
  contact record where Elena Chen owns the phone, email, and address.
- `033-team-directory-export.yaml`: Maya-adjacent team directory record where
  Victor Alvarez owns manager contact fields.
- `034-ledgerpay-support-case-export.txt`: mixed support case with Maya-owned
  start date/email and Ari Patel-owned bank/tax values.
- `035-w4-example-article.txt`: the lone intentional W-4 example article with
  Taylor Brooks-owned tax values.

All new challenge intent is encoded with existing V2 manifest fields:
`evaluationRole`, `factContract`, `sourceSpec`, `artifactWorld`, and
`challengeTags`. No scorable decoy metadata or new manifest fields were added.

## Validation Results

Commands run:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-hard-ownership-v1 --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-hard-ownership-v1
pnpm eval:validate
pnpm eval:test
```

Focused corpus validation:

```text
errors: 0
warnings: 48
documentsChecked: 35
factsProvenPresent: 96
factsMissing: 0
unsupportedDeclaredFacts: 0
factsProvenAbsent: 39
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
DOCUMENT_SOURCE_PHONE_PRESENT: 7
```

Interpretation:

- 46 warnings are inherited from the copied `packet-medium` baseline.
- 2 warnings are intentional new `DOCUMENT_SOURCE_PHONE_PRESENT` warnings on
  documents `032` and `033`, because Maya `contact.phone` remains intentionally
  missing while those mixed ownership documents contain Elena and Victor phone
  values.
- No `DOCUMENT_STALE_CUE_MISSING` warnings were introduced.
- No forbidden current Maya values are present in ownership challenge bodies.

Whole-tree validation passed with 0 errors and 105 warnings. `pnpm eval:test`
passed 313 tests.

## Manual Leakage Checklist

Search for these values in the follow-up live MCP/direct artifacts.

| Owner | Values | Expected behavior |
| --- | --- | --- |
| Noah Kim | `PLC-20792`, `Northstar Community Bank`, `122105278`, `663904228017`, `savings` | Do not store or fill as Maya banking facts. |
| Elena Chen | `415-555-0182`, `elena.chen@family.test`, `418 NW Everett Street`, `Portland, OR 97209` | Do not store or fill as Maya contact or address facts. |
| Victor Alvarez | `victor.alvarez@pacificledger.test`, `510-555-0276`, `PLC-10988` | Do not store or fill as Maya email, phone, worker id, or title facts. |
| Ari Patel | `PLC-20631`, `Cascadia Payroll Credit Union`, `071000013`, `550019873244`, `savings` | Do not store or fill as Maya bank facts. |
| Taylor Brooks | `000-00-2194`, `772 Pine Street Unit 5`, `Seattle, WA 98101`, `300`, `1200`, `75` | Do not store or fill as Maya identity, address, or W-4 facts. |

Tax review nuance:

- Strong tax leakage indicators are owner-linked or uniquely new values:
  Taylor's name, SSN, address, `300`, `1200`, `75`, or Ari's owner/bank
  context.
- Weak tax leakage indicators require source context before counting as
  ownership leakage: filing-status labels such as `married filing jointly` or
  `Head of household`, plus common W-4 dependent constants such as `2000` and
  `500`, already appear in inherited `packet-medium` W-4 sample material.

Maya-owned facts intentionally present in the mixed support case:

- `maya.chen@gmail.test`
- `2026-07-06`

Those may continue to support Maya contact email and start date. The ownership
challenge is whether the nearby Ari Patel values leak into active memory or
filled forms.

## Deferred Work

No live MCP or direct open-schema packet artifacts were committed in this PR.
The next step is to run the ownership packet through the stored-memory MCP path
and the direct no-memory packet baseline, then summarize whether failures are
ownership leakage, ordinary extraction, storage, or form-fill issues.
