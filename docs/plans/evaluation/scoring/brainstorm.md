# First-Pass Evaluation Scoring Brainstorm

- Status: brainstorming
- Scope: first-pass ingestion/storage/form-fill scoring for generated user corpora
- Last updated: 2026-06-01

## Summary

The first-pass evaluation stack should be simple and extensible. The core idea is
to separate three responsibilities:

```text
runners
  perform side effects: ingest documents, write preferences, fill forms

exporters
  snapshot backend/output state into stable eval artifacts

scorers
  read artifacts and fixture truth, then write deterministic score reports
```

This split lets us evaluate different producers with the same scoring layer:

- automated document-analysis ingestion
- manual UI upload and manual apply
- Codex or Claude using MCP
- deterministic hydration baselines
- future browser/UI-driven runs

The first-pass scorer should evaluate only the facts the eval intentionally
controls:

1. Facts known to be present in the source corpus.
2. Facts intentionally absent, null, or withheld from the source corpus.

Everything else can be reported for manual or LLM review, but should not affect
the primary score yet.

## Why Split Runner, Exporter, And Scorer

The scorer should not call the backend, upload files, invoke models, or mutate
state. It should be boring and deterministic.

This matters because the same scoring logic should work after any of these
flows:

```text
Automated ingestion:
  ingest-documents -> export-stored-preferences -> score-database

Manual UI upload:
  user uploads/applies manually -> export-stored-preferences -> score-database

Codex/Claude over MCP:
  agent reads/uploads/writes via MCP -> export-stored-preferences -> score-database

Form fill:
  any form-fill runner -> filled-form snapshot -> score-form-fill
```

The ingestor may call the exporter at the end for convenience, but the exporter
should be a standalone command. That way manual and agent-driven runs are still
scorable.

## Evaluation Stages

There are two primary headline scores.

### 1. Database Storage

Question: after the chosen ingestion method finishes, did the expected values
exist in active stored memory?

The storage scorer should evaluate exported active preferences. In this repo,
that means preference values joined to preference definition slugs:

- storage row: `user_preferences`
- key: `preference_definitions.slug`
- value: `user_preferences.value`
- primary status scored: `ACTIVE`

Document analysis may produce `SUGGESTED` rows before apply. Those can be
included as diagnostics, but the primary DB score should use `ACTIVE`
preferences because form fill reads active memory.

### 2. Form Fill

Question: after form filling, did the expected values appear in the expected form
fields, and did intentionally missing values stay blank/skipped?

The form scorer should aggregate the existing `filled-form.json` snapshot shape
rather than inventing a parallel field classifier. If a field classification is
wrong, fix the snapshot builder/runner so there is one source of truth.

## Simple Ingestion Runner

The scoring plan should include a simple ingestion runner, but not entangle the
runner with scoring.

The first useful ingestor can be small:

```text
documents for a user/corpus
  -> upload/analyze each document
  -> collect suggestions/results as diagnostics
  -> auto-apply accepted suggestions into ACTIVE preferences
  -> optionally call export-stored-preferences
```

Expected command shape:

```bash
pnpm eval:ingest-documents \
  --user alex-i9-test \
  --corpus realistic \
  --backend-url http://localhost:3000 \
  --auto-apply \
  --out /private/tmp/alex-ingestion-run
```

The runner should auto-apply suggestions because the first end-to-end goal is to
measure active database state and then fill forms from that state. Raw
suggestions remain useful diagnostics, but they are not the primary storage
score.

The runner likely needs setup steps:

- reset or isolate the eval user's memory when requested
- create any needed user-owned eval preference definitions
- upload/analyze corpus documents
- apply accepted suggestions
- record analysis/apply diagnostics

The exact ingestion implementation can evolve later. The scorer only depends on
the exported artifacts.

## Exported Artifacts

The shared artifact boundary is the most important contract.

### Stored Preferences

`stored-preferences.json` is produced by an exporter, not by the scorer. It is a
normalized snapshot of backend state after ingestion/manual/agent work.

Example:

```json
{
  "schemaVersion": 1,
  "artifactType": "stored-preferences",
  "runId": "alex-i9-test-realistic-20260601-123000",
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "storageInput": {
    "ingestionMode": "document-analysis",
    "statusesScored": ["ACTIVE"],
    "suggestionsWereAutoApplied": true
  },
  "preferences": [
    {
      "slug": "profile.full_name",
      "value": "Alex Jordan Rivera",
      "status": "ACTIVE",
      "sourceType": "INFERRED",
      "confidence": 0.91,
      "evidence": {}
    }
  ],
  "diagnostics": {
    "analysisSuggestionsPath": "analysis-suggestions.json"
  }
}
```

Useful commands:

```bash
pnpm eval:export-stored-preferences \
  --user alex-i9-test \
  --out /private/tmp/alex-run/stored-preferences.json

pnpm eval:score-database \
  --user alex-i9-test \
  --corpus realistic \
  --stored-preferences /private/tmp/alex-run/stored-preferences.json \
  --out /private/tmp/alex-run/database-score-report.json
```

### Analysis Suggestions

`analysis-suggestions.json` is optional diagnostics. It can capture raw
document-analysis results or apply outcomes, but should not be mixed into the
primary active-storage score.

### Filled Form

`filled-form.json` already exists as the form-fill snapshot. It contains expected
actions, actual values, source slugs, and field classifications.

The form scorer should read this snapshot and summarize it.

## Fixture Readiness Gate

Before scoring ingestion/storage quality, the scorer should verify that the
fixture itself is scorable.

At minimum, mark a run unscorable when:

- corpus validation has hard errors
- `validation-report.json` has blocking corpus-truth failures
- a fact selected for scoring is declared present but is not proven present in
  corpus truth
- an intentionally missing fact is not actually represented as null, absent, or
  intentionally missing in the fixture contract

Example:

```json
{
  "fixtureReadiness": {
    "scorable": false,
    "blockingIssues": [
      {
        "factKey": "identity.dateOfBirth",
        "reason": "declared in manifest but not proven present by corpusTruth"
      }
    ]
  }
}
```

This avoids blaming the backend, model, or agent for broken fixtures.

## Core Terms

- `factKey`: canonical eval fact, for example `identity.legalName`.
- `expectedValue`: the known correct value for a present fact.
- `intentionallyMissing`: a fact the corpus intentionally does not support.
- `acceptedSlugs`: storage slugs accepted for a fact.
- `storedPreference`: exported active preference row with `{ slug, value }`.
- `filledField`: field observed in the filled-form snapshot.
- `structuralSkip`: field-map skip that is not a fact-abstention test.

## Accepted Slugs

The first pass should use explicit storage expectations. It should not infer
semantic slug similarity.

To avoid drift, split storage expectations into canonical and alias slugs:

```json
{
  "schemaVersion": 1,
  "facts": {
    "identity.legalName": {
      "canonicalSlugs": ["profile.full_name"],
      "acceptedAliasSlugs": [
        "profile.legal_name",
        "identity.full_name",
        "identity.legal_name"
      ],
      "valueType": "string"
    }
  }
}
```

For scoring:

```text
acceptedSlugs = canonicalSlugs + acceptedAliasSlugs
```

For the first pass, accepted aliases can count as correct. The report should
still preserve whether the match used a canonical slug or alias so we can split
that metric later if needed.

The backend currently expects lowercase, dot-delimited slugs with underscore word
separators. Human shorthand like `profile.fullName` should be treated as a
conceptual alias, not necessarily a valid persisted slug.

The accepted-slug map should live globally under `examples/eval/scoring/` unless
a real scenario-specific override becomes necessary.

## Schema Setup For Ingestion

The accepted-slug map is not enough by itself. The backend rejects unknown
preference slugs.

If the eval expects storage under non-core slugs such as
`eval.identity.date_of_birth`, the ingestion runner needs a setup phase that
creates user-owned preference definitions before documents are analyzed/applied.

This is setup, not scoring. The scorer only reads the exported rows and compares
them to the accepted slug contract.

## Known-Present Fact Metrics

For facts known to be present in the corpus, score two headline metrics.

### Value Recovery

Question: did the expected value appear anywhere in active stored memory?

This catches cases where the extractor found the value but placed it under an
unexpected slug.

### Accepted-Slug Accuracy

Question: did the expected value appear under one of the accepted slugs for that
fact?

This measures whether the system used the expected storage surface.

### Useful Per-Fact Booleans

The report should keep booleans so failures can be inspected without inventing
too many categories:

- `expectedValueFoundAnywhere`
- `expectedValueFoundUnderAcceptedSlug`
- `acceptedSlugPopulated`
- `acceptedSlugHasWrongValue`
- `canonicalSlugCorrect`
- `acceptedAliasCorrect`

### Suggested Classifications

```text
known_present_correct
  Expected value was found under an accepted slug.

known_present_wrong_slug
  Expected value was found somewhere in memory, but not under an accepted slug.

known_present_wrong_value
  An accepted slug was populated, but its value did not match the expected value.

known_present_conflict
  An accepted slug has both recoverable correct value evidence and conflicting
  wrong active value evidence. This is not counted as clean correctness.

known_present_missing
  Expected value was not found anywhere, and no accepted slug had the correct
  value.
```

## Intentionally Missing Fact Metrics

For intentionally missing or withheld facts, score absence.

There are two useful kinds of missing facts:

```text
profile_null_missing
  The profile fact is null or inapplicable. There is no concrete withheld value.

withheld_value_missing
  The evaluator knows a real value, but the corpus intentionally withholds it.
```

Most current fixtures use profile-null missing facts, such as `contact.phone:
null`. For those, the scorer can check accepted-key absence but cannot check a
withheld value leak unless a concrete withheld value is added to the fixture
contract.

### Value Absence

Question: did the withheld value fail to appear anywhere in active stored memory?

This only applies when the eval has a concrete withheld value.

### Accepted-Key Absence

Question: are the accepted slugs for the missing fact absent, null, empty, or
unset?

This catches cases where the system invents a value under the expected key.

### Suggested Classifications

```text
missing_absent_correct
  No withheld value was found and no accepted slug was populated.

missing_value_hallucinated
  A concrete withheld value appeared somewhere in stored memory.

missing_key_hallucinated
  An accepted slug for the missing fact was populated.

missing_hallucinated
  Aggregate failure bucket when either value absence or accepted-key absence
  fails.
```

Important distinction: `factContract.forbid` is not the same as
`intentionallyMissing`. A fact can be forbidden in a noise document but still
legitimately present elsewhere in the corpus. Storage missingness should come
from profile-null facts and `intentionallyMissing[]`, not from per-document
`forbid`.

## Extra Stored Preferences

The first pass should not classify every extra slug.

For example, if a lease document says pets are not allowed and the system stores
`housing.pet_policy = "No cats"`, that may be useful behavior. It should not be
penalized just because the I-9 eval focuses on identity, address, contact, and
work-authorization facts.

Instead, include unscored extras in the report for manual or LLM review:

```json
{
  "unscoredStoredPreferences": [
    {
      "slug": "housing.pet_policy",
      "value": "No cats"
    }
  ]
}
```

Future scorers may classify extras into benign, target-related, contradictory,
or unknown buckets. That is out of scope for the first pass.

## Database Score Report Shape

Example:

```json
{
  "schemaVersion": 1,
  "scoreType": "database-storage",
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "storageInput": {
    "statusesScored": ["ACTIVE"],
    "ingestionMode": "document-analysis",
    "suggestionsWereAutoApplied": true
  },
  "fixtureReadiness": {
    "scorable": true,
    "blockingIssues": []
  },
  "summary": {
    "knownPresentTotal": 7,
    "knownPresentCorrect": 5,
    "knownPresentWrongSlug": 1,
    "knownPresentWrongValue": 0,
    "knownPresentConflict": 0,
    "knownPresentMissing": 1,
    "valueRecoveryRate": 0.857,
    "acceptedSlugAccuracy": 0.714,
    "acceptedSlugRecoveryRate": 0.857,
    "intentionallyMissingTotal": 2,
    "missingAbsentCorrect": 2,
    "missingHallucinated": 0,
    "missingAbstentionRate": 1,
    "ignoredStoredPreferenceCount": 0,
    "unscoredStoredPreferenceCount": 1
  },
  "knownPresent": [
    {
      "factKey": "identity.legalName",
      "expectedValue": "Alex Jordan Rivera",
      "canonicalSlugs": ["profile.full_name"],
      "acceptedAliasSlugs": ["identity.legal_name"],
      "expectedValueFoundAnywhere": true,
      "expectedValueFoundUnderAcceptedSlug": true,
      "canonicalSlugCorrect": true,
      "acceptedAliasCorrect": false,
      "matchingRows": [
        {
          "slug": "profile.full_name",
          "value": "Alex Jordan Rivera",
          "status": "ACTIVE",
          "sourceType": "INFERRED",
          "confidence": 0.94
        }
      ],
      "acceptedSlugRows": [
        {
          "slug": "profile.full_name",
          "value": "Alex Jordan Rivera",
          "status": "ACTIVE",
          "sourceType": "INFERRED",
          "confidence": 0.94
        }
      ],
      "classification": "known_present_correct"
    }
  ],
  "intentionallyMissing": [
    {
      "factKey": "contact.phone",
      "missingKind": "profile_null_missing",
      "withheldValue": null,
      "canonicalSlugs": ["contact.phone"],
      "acceptedAliasSlugs": ["profile.phone"],
      "valueFoundAnywhere": false,
      "acceptedSlugHasValue": false,
      "valueRows": [],
      "acceptedSlugRows": [],
      "classification": "missing_absent_correct"
    }
  ],
  "unscoredStoredPreferences": [
    {
      "slug": "housing.pet_policy",
      "value": "No cats",
      "status": "ACTIVE",
      "sourceType": "INFERRED",
      "confidence": 0.88
    }
  ]
}
```

## Form-Fill Scoring

The form-fill scorer should aggregate the existing `filled-form.json` snapshot.
It should not recompute detailed classifications independently.

It should first classify fields into three denominator groups:

| Class | Rule | Scored? |
| --- | --- | --- |
| `should-fill` | `fieldMap.mode === "fact"` and expected action fills a value/selection/check | yes |
| `abstention-test` | `fieldMap.mode === "fact"` and expected action is `SKIP` due to null or intentionally missing fact | yes |
| `structural-skip` | `fieldMap.mode === "skip"` such as out-of-scope, manual attestation, unmapped | no, report count only |

Then aggregate snapshot classifications:

```text
correct
  known field correct

missing
  known field missing

incorrect
  known field wrong

skipped-correctly
  abstention-test absent-correct, or structural-skip ignored depending on class

hallucinated
  abstention-test hallucinated

unsupported
  separate bucket, not silently folded into wrong
```

Useful summary metrics:

- `knownFieldAccuracy`
- `knownFieldMissingRate`
- `knownFieldWrongRate`
- `missingFieldAbstentionRate`
- `missingFieldHallucinationRate`
- `unsupportedFieldCount`
- `structuralSkipCount`
- `sourceSlugAgreementRate`

For first-pass form correctness, final field value is enough. Source-slug
agreement should be reported separately as a diagnostic: it tells us whether the
right value came from an expected storage path.

## Form-Fill Score Report Shape

Example:

```json
{
  "schemaVersion": 1,
  "scoreType": "form-fill",
  "scenarioId": "alex-i9-realistic",
  "summary": {
    "knownFieldTotal": 12,
    "knownFieldCorrect": 10,
    "knownFieldMissing": 1,
    "knownFieldWrong": 1,
    "abstentionFieldTotal": 3,
    "abstentionFieldAbsentCorrect": 3,
    "abstentionFieldHallucinated": 0,
    "structuralSkipCount": 30,
    "unsupportedFieldCount": 0,
    "sourceSlugAgreementRate": 0.9
  },
  "fields": [
    {
      "pdfFieldName": "Last Name",
      "factKey": "identity.lastName",
      "fieldClass": "should-fill",
      "expectedValue": "Rivera",
      "actualValue": "Rivera",
      "sourceSlugs": ["profile.last_name"],
      "sourceSlugAgrees": true,
      "classification": "form_known_correct"
    }
  ]
}
```

## Combined Fact-Keyed Report

DB and form summaries should stay separate, but the most useful artifact is a
joined fact-keyed report.

Example:

```json
{
  "schemaVersion": 1,
  "scoreType": "combined",
  "facts": [
    {
      "factKey": "identity.ssn",
      "expectedValue": "000-00-0292",
      "storage": {
        "classification": "known_present_correct",
        "matchingSlug": "eval.identity.ssn"
      },
      "form": {
        "fields": [
          {
            "fieldIndex": 16,
            "pdfFieldName": "Social Security Number",
            "classification": "form_known_correct",
            "renderedValue": "000000292"
          }
        ]
      },
      "storageClass": "known_present_correct",
      "formStatus": "correct",
      "stageAttribution": "stored_correct_form_correct"
    }
  ]
}
```

Useful stage-attribution buckets:

```text
stored_correct_form_correct
stored_correct_form_wrong
stored_correct_form_missing
stored_conflict_form_correct
stored_conflict_form_wrong
stored_conflict_form_missing
stored_wrong_slug_form_missing
stored_wrong_value_form_wrong
stored_wrong_value_form_missing
stored_missing_form_missing
stored_missing_form_hallucinated
missing_absent_form_absent
missing_hallucinated_form_hallucinated
other
```

This makes cross-stage failures legible without collapsing the underlying
storage and form metrics.

## Matching Rules

Value matching should be deterministic and conservative.

Good first-pass normalizations:

- Trim surrounding whitespace.
- Compare typed JSON values when possible.
- Use normalized whole-value equality, not broad substring search over arbitrary
  JSON.
- Normalize date renderings for known date facts and form-rendered dates.
- Normalize simple identifiers where the fact/render rule explicitly supports it,
  such as SSN digits with or without dashes.
- Treat `null`, missing, empty string, and empty arrays as absent for missing-key
  checks, unless a slug's value type requires different semantics.

Avoid for the first pass:

- Broad fuzzy matching.
- LLM-based semantic equality.
- Address parsing or name derivation.
- Inferring `firstName` and `lastName` from `fullName`.
- Treating smart search as proof of storage correctness.
- Broad string containment for common values like first names, state codes,
  cities, or single letters.

One shared normalizer should be used by both the DB scorer and form scorer so
storage and form outcomes do not disagree on date, SSN, enum, or simple rendered
value formats.

## Derivation Rules

Derivation rules should be deferred until strict scoring produces repeated,
actionable false negatives.

A later derived score may allow facts like:

- `identity.firstName` derived from `profile.full_name`
- compact SSN derived from dashed SSN
- state abbreviation derived from state name

For now, if only `profile.full_name = "Alex Jordan Rivera"` is stored:

- `identity.legalName` can score correct if `profile.full_name` is accepted for
  that fact.
- `identity.firstName` should score missing unless `profile.first_name` or
  another accepted first-name slug is stored.
- `identity.lastName` should score missing unless `profile.last_name` or another
  accepted last-name slug is stored.

This keeps the metric honest about what was actually stored.

## Smart Search

Smart search should not be part of strict database scoring.

It is better treated as a separate retrieval eval:

- strict DB score: did the right values land in the right stored slots?
- form-fill score: did the final form output match expected fields?
- smart-search score later: can the system retrieve relevant stored memory for a
  natural-language task?

Using smart search inside the strict DB scorer would blur storage correctness
with retrieval behavior.

## Suggested First-Pass Inputs

Scorers likely need:

- `profile.yaml`
- corpus `manifest.json`
- corpus `validation-report.json`
- accepted slug map under `examples/eval/scoring/`
- `stored-preferences.json`
- `filled-form.json`
- `field-map.json`

Runners/exporters likely need:

- backend URL/auth context
- user id and corpus id
- corpus document root
- accepted slug map or setup manifest for eval definitions
- output directory for run artifacts

## Suggested First-Pass Outputs

Useful artifacts:

- `stored-preferences.json`
- optional `analysis-suggestions.json`
- `database-score-report.json`
- `form-fill-score-report.json`
- `combined-score-report.json`

The combined report should make it easy to answer:

1. Which known facts were recovered anywhere?
2. Which known facts were stored under accepted slugs?
3. Which known facts were missing, wrong, or conflicting?
4. Which intentionally missing facts stayed absent?
5. Which intentionally missing facts were hallucinated?
6. Which form fields were filled correctly, skipped, or wrong?
7. Which failures happened in storage versus form fill?
8. What extra stored preferences should a human/LLM review?

## Implementation Order

Recommended first pass:

1. Define `stored-preferences.json` and score-report artifact shapes.
2. Add an accepted-slug map under `examples/eval/scoring/`.
3. Implement the pure DB scorer against hand-authored good and bad
   `stored-preferences.json` fixtures.
4. Implement the form summary scorer over existing `filled-form.json`.
5. Implement combined fact-keyed stage attribution.
6. Add `export-stored-preferences` as a standalone backend-state snapshot tool.
7. Add a simple `ingest-documents` runner that uploads/analyzes corpus documents,
   auto-applies suggestions, and optionally calls the exporter.

This order lets scorer work start immediately while ingestion remains a separate
side-effectful producer.

## Open Questions

- Should the first document-analysis eval always auto-apply suggestions before
  scoring, or should some runs intentionally leave suggestions unapplied and mark
  DB scoring as not applicable?
- What is the first target corpus for ingestion scoring: Alex realistic I-9 is
  probably more useful than template-smoke.
- Should non-core accepted slugs use `eval.*` user-owned definitions, or should
  the backend catalog grow real identity/address/work-authorization slugs?
- Should the scorer fail when a scored fact is unsupported by `corpusTruth`, or
  include it as `fixture_unverified` and exclude it from rates?
- Where should withheld-but-known missing values live if we want value-leak
  scoring for facts absent from the corpus?
- Should source-slug agreement affect form correctness later, or remain a
  diagnostic only?

## Proposed MVP Line

Build now:

1. pure database scorer over controlled facts and explicit accepted slugs
2. pure form scorer that aggregates existing filled-form snapshots
3. combined fact-keyed report with stage attribution
4. standalone stored-preferences exporter
5. simple document ingestor that auto-applies suggestions into active memory
6. raw unscored preference output for manual/LLM review

Do not build yet:

- broad extra-slug categorization
- semantic slug similarity
- derivation rules
- smart-search-based scoring
- LLM-judged value equality
- full Codex/Claude MCP agent runner
