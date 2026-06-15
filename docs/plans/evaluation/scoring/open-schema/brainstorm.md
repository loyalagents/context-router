# Open-Schema Scoring Brainstorm

- Status: brainstorming
- Last updated: 2026-06-14
- Scope: scoring runs where the system or agent may create its own
  definitions/slugs instead of using a pre-created eval schema

## Summary

Open-schema scoring should evaluate whether the system can complete the user's
goal when the exact storage schema is not supplied.

The main goal is **successful form completion**. Schema correctness matters
because it affects reuse, maintainability, and future form fill, but exact slug
matching should not dominate the first open-schema metric.

In other words:

```text
form correctness > value recovery > schema correctness
```

If the system stores the right value under a reasonable but unexpected slug and
the form fills correctly, that is a useful success. If the system creates a
beautiful slug but the form remains wrong or blank, that is a failure for this
eval's main purpose.

## What Open Schema Means

Known schema:

```text
accepted definitions/slugs already exist
  -> system extracts values into those slugs
  -> scorer checks values and accepted keys
```

Open schema:

```text
eval-specific definitions/slugs are not pre-created
  -> system or agent identifies useful facts
  -> system or agent creates definitions/slugs
  -> system or agent stores active values
  -> form fill tries to use the stored memory
  -> scorer evaluates task success
```

Open schema can be tested through at least two producers:

- MCP/Codex/Claude agent creates definitions and values through tools.
- Backend upload/schema-discovery flow proposes or creates definitions itself.

These should share the same scoring artifacts where possible.

## Primary Metrics

### 1. Form Correctness

Question: did the final form contain the right values and blanks?

This should be the headline score. It directly measures whether the storage
created by an open-schema run was useful for the form task.

Useful buckets:

- should-fill field correct
- should-fill field missing
- should-fill field wrong
- abstention field correctly blank/skipped
- abstention field hallucinated
- unsupported/structural fields excluded from primary score

The existing form scorer should remain the primary form metric.

### 2. Value Recovery

Question: did the expected value appear anywhere in active memory?

This score intentionally ignores slug correctness at first. It tells us whether
the system found and stored the right information at all.

Useful buckets:

- expected value found anywhere in active memory
- expected value missing from active memory
- expected value only found in suggestions/diagnostics, not active memory
- intentionally missing value absent from active memory
- intentionally missing value hallucinated anywhere in active memory

Value comparison should be deterministic where possible:

- dates allow known render variants
- SSNs allow dashed and digits-only variants
- phone numbers allow punctuation variants
- arrays compare normalized typed values
- short strings should avoid broad substring matching

If values are close but not equivalent, report them as diagnostics rather than
quietly accepting them.

### 3. Schema Usefulness

Question: did the system store the value under a slug/definition that is useful
for this fact and future form fill?

For first-pass open-schema scoring, schema usefulness should be diagnostic, not
the main headline score.

Useful buckets:

- accepted/canonical slug
- accepted alias slug
- novel but semantically useful slug
- novel but too broad or ambiguous slug
- wrong slug for the value
- correct slug with wrong value

Novel slug review may require human or LLM assistance because the meaning may be
spread across:

- slug string
- display name
- description
- value type
- examples or evidence

The scorer should preserve enough metadata for this review.

## Why Form Success Should Lead

The user does not primarily care whether the system chose
`profile.full_name` versus `identity.legal_name`. The user cares whether the form
gets filled correctly and safely.

Schema quality still matters because:

- poor slugs may fail future form fills
- overly broad slugs may cause wrong reuse
- duplicate slugs may fragment memory
- ambiguous definitions make retrieval harder

But if we optimize the first open-schema score around exact schema matching, we
may penalize useful behavior before we understand what slugs agents/systems
naturally create.

## Suggested Score Report Shape

Open-schema reports should make manual review easy.

For each target fact:

```json
{
  "factKey": "identity.legalName",
  "expectedValue": "Alex Jordan Rivera",
  "valueRecovery": "found_anywhere",
  "strictAcceptedSlug": false,
  "candidateRows": [
    {
      "slug": "employee.full_name",
      "definitionName": "Employee Full Name",
      "definitionDescription": "Legal name used on onboarding paperwork.",
      "value": "Alex Jordan Rivera",
      "valueMatch": true,
      "slugAssessment": "novel_review_needed"
    }
  ],
  "relatedFormFields": [
    {
      "fieldId": "employee_name",
      "classification": "correct"
    }
  ]
}
```

For intentionally missing facts:

```json
{
  "factKey": "contact.phone",
  "expectedValue": null,
  "abstention": "absent_correct",
  "candidateRows": []
}
```

## Artifact Needs

The existing `stored-preferences.json` is enough for known-schema scoring, but
open-schema scoring likely needs definition metadata.

Options:

1. Extend `stored-preferences.json`.
   - Include a `definitions[]` section for definitions referenced by exported
     preferences.
   - Simple single artifact.
   - Slightly broadens the current exporter contract.

2. Add `preference-schema-snapshot.json`.
   - Keeps stored values separate from schema state.
   - More explicit for open-schema review.
   - Requires the scorer to load another artifact.

Either is fine. The important part is that open-schema scoring can see the slug,
display name, description, and value type for created definitions.

## Deterministic Versus Review-Based Scoring

Primary scores should remain deterministic:

- form field correctness
- expected values present/absent
- exact or accepted slug matches

Review-based diagnostics can be added for novel schema quality:

- human review
- LLM-assisted review with a stable rubric
- sampled review rather than every run

Do not hide LLM judgment inside the primary score at first. It should be
separate so score changes are explainable.

## Open Questions

- Should novel but useful slugs count as correct in the primary database score,
  or only in a secondary reviewed score?
- Should open-schema setup start with no eval definitions at all, or with a
  small global catalog of common human concepts?
- How do we prevent systems from creating one-off slugs that only work for a
  single form?
- Should the form-fill backend be taught to use definition descriptions for
  novel slugs?
- Should MCP agent runs and backend schema-discovery runs share one open-schema
  score report, or have separate producer-specific diagnostics?

## Recommended First Cut

For the first open-schema scorer:

1. Keep the form score as the headline metric.
2. Score value recovery and abstention deterministically from active memory.
3. Keep exact/accepted slug correctness as a diagnostic.
4. Preserve novel slug candidates and definition metadata for review.
5. Add reviewed schema-quality scoring only after seeing real outputs.

This keeps the eval focused on whether the system can complete forms while still
making schema mistakes visible for follow-up work.
