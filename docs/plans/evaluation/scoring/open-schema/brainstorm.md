# Open-Schema Evaluation Design

- Status: implementation-oriented brainstorm
- Last updated: 2026-06-17
- Scope: evaluating runs where eval-specific target definitions are not
  pre-created and the producer must choose or create useful memory schema

## Summary

Open-schema evaluation should answer one main question:

```text
Can the system complete the user's form-filling goal when the exact eval memory
schema is not supplied ahead of time?
```

The headline score should be the final form outcome. The second signal should
be whether expected values were recovered in active memory. Schema quality is
important, but the first version should keep it diagnostic until there are real
open-schema outputs to review.

Recommended priority:

```text
form correctness
  -> active-memory value recovery
  -> schema diagnostics
  -> reviewed schema-quality judgment later
```

Build artifact and scoring support before enabling live MCP
`--schema-mode open`. That keeps the judge stable before introducing the most
variable component: an agent creating or choosing schema during the run.

## Definitions

Known schema:

```text
accepted definitions/slugs already exist
  -> producer extracts values into those slugs
  -> database scorer checks expected values under accepted keys
  -> backend form fill reads active memory
```

Open schema:

```text
eval-specific target definitions/slugs are not pre-created
  -> producer identifies useful facts
  -> producer reuses existing visible definitions or creates user-owned ones
  -> producer stores active values
  -> backend form fill reads active memory
  -> scorer evaluates form correctness, value recovery, and schema diagnostics
```

Producer means the thing being evaluated:

- MCP/Claude agent using MCP tools.
- Future backend upload/schema-discovery product flow.
- Future manual or UI-driven flow, if it writes the same artifacts.

MCP `--schema-mode known` currently means "use the existing visible backend
schema." It is not a closed target-form-only schema. Open schema should be the
next controlled delta: do not create eval-specific target definitions during
setup, and require the producer to handle schema selection/creation.

## Design Principles

- Keep evaluation truth clean. Scoring should not auto-correct memory, rewrite
  slugs, hide backend mistakes, or feed score results back into the same run.
- Keep known-schema artifacts and scorers stable unless requirements force a
  change.
- Add open-schema-specific artifacts instead of stretching
  `stored-preferences.json` beyond its v1 contract.
- Treat definition state as benchmark state. Prior eval-created definitions can
  make a later run easier, so isolation must be recorded before live scores are
  trusted.
- Score active memory as the primary database signal. Suggested values can be
  useful diagnostics, but should not count as recovered unless they are reported
  in an explicit suggestion-only bucket.
- Keep LLM or human schema review separate from deterministic headline scoring.

## Target First Flow

The first implementation should reuse the known-schema MCP runner shape and the
existing backend form-fill path.

```text
validate-documents
  -> setup-open-schema-memory
  -> capture-definition-baseline
  -> run-mcp-agent
  -> export-memory-snapshot
  -> score-open-schema-database
  -> fill-form
  -> score-form
  -> score-open-schema-combined
```

The first open-schema MCP eval should let the backend fill the form after the
agent writes memory:

```text
agent document/schema/memory work
  -> active backend memory
  -> backend form-fill endpoint
  -> deterministic form scorer
```

That keeps attribution legible. Memory failures appear in the open-schema
database report; backend form-fill failures appear in the form and combined
reports.

## Primary Metric: Form Correctness

Question:

```text
Did the final filled form contain the right values and blanks?
```

Reuse the current form scorer as the headline metric:

- should-fill field correct
- should-fill field missing
- should-fill field wrong
- intentionally missing field correctly blank/skipped
- intentionally missing field hallucinated
- structural skips and overfills as diagnostics
- unsupported fields as diagnostics

For open schema, `sourceSlugAgreementRate` remains diagnostic only. A correct
form value may come from a novel slug that is useful even though it does not
match the accepted slug map.

## Secondary Metric: Active-Memory Value Recovery

Question:

```text
Did the expected value appear anywhere useful in active memory?
```

Open-schema database scoring should be value-led, not slug-led. Accepted slugs
should still be preserved as diagnostics.

Known-present classifications:

- `value_found_accepted_slug`
- `value_found_novel_slug`
- `value_found_only_suggestion`
- `value_missing`
- `accepted_slug_wrong_value`
- `conflict`

Intentionally missing classifications:

- `missing_absent_correct`
- `missing_value_hallucinated`
- `missing_key_hallucinated`
- `missing_hallucinated`

Matching should stay deterministic and conservative:

- Reuse existing typed normalization for dates, SSNs, A-numbers, state names,
  enums, arrays, and booleans where possible.
- Do not use broad substring matching for short strings.
- Keep display-name/description similarity diagnostic. It is not proof that a
  value is correct.
- If the same active value plausibly matches multiple expected facts, report
  ambiguity instead of silently choosing one.
- Near misses should be diagnostics, not accepted silently.

Useful summary fields:

- `knownPresentTotal`
- `valueFoundAnywhere`
- `valueFoundUnderAcceptedSlug`
- `valueFoundUnderNovelSlug`
- `valueFoundOnlySuggestion`
- `valueMissing`
- `acceptedSlugWrongValue`
- `conflict`
- `valueRecoveryRate`
- `acceptedSlugRecoveryRate`
- `intentionallyMissingTotal`
- `missingAbsentCorrect`
- `missingHallucinated`
- `missingAbstentionRate`
- `novelDefinitionCount`
- `unusedNovelDefinitionCount`
- `unscoredActivePreferenceCount`

## Diagnostic Metric: Schema Usefulness

Question:

```text
Was the value stored under a definition that is useful for future reuse?
```

Do not make this the first open-schema headline score.

The scorer should preserve enough metadata for later review:

- slug
- display name
- description
- value type
- options
- scope
- namespace and owner
- sensitivity/core flags
- active value
- source type, confidence, and evidence when available
- whether the slug matched a canonical or accepted alias slug
- whether the definition existed before the run, if known

Initial schema buckets can be simple diagnostics:

- `accepted_canonical_slug`
- `accepted_alias_slug`
- `novel_review_needed`
- `accepted_slug_wrong_value`
- `wrong_slug_for_value`
- `unused_novel_definition`

Later reviewed buckets can be added after real outputs exist:

- `novel_useful`
- `novel_too_broad`
- `novel_too_narrow`
- `novel_duplicate`
- `novel_ambiguous`
- `novel_form_overfit`

LLM or human review should be a separate layer, not hidden inside the primary
deterministic score.

## Artifact Contract

Keep known-schema artifacts stable. Add open-schema-specific artifacts.

New open-schema artifacts:

- `memory-snapshot.json`
- `open-schema-database-score-report.json`
- `open-schema-combined-score-report.json`

Existing artifacts to reuse:

- `validation-report.json`
- `mcp-agent-run.json`
- `mcp-agent-prompt.md`
- `mcp-agent-transcript.txt`
- `filled-form.json`
- `filled-form.pdf`
- `form-fill-response.json`
- `form-score-report.json`
- `evaluation-run.json`

`stored-preferences.json` can still be written for debugging and backward
comparison, but open-schema scoring should consume `memory-snapshot.json`.

### Memory Snapshot

`memory-snapshot.json` should join active values, suggestions, visible
definitions, and definition baseline metadata in one artifact.

Suggested shape:

```json
{
  "schemaVersion": 1,
  "artifactType": "memory-snapshot",
  "runId": "mcp-open-schema-alex-i9-test-realistic-...",
  "evaluationMode": "mcp-open-schema",
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "scenarioId": "alex-i9-realistic",
  "storageInput": {
    "schemaMode": "open",
    "producer": "mcp-agent",
    "statusesScored": ["ACTIVE"],
    "suggestionsWereAutoApplied": false
  },
  "preferences": [],
  "suggestions": [],
  "definitions": [],
  "definitionBaseline": {
    "capturedBeforeRun": true,
    "preexistingDefinitionIds": [],
    "preexistingSlugs": [],
    "strategy": "none|fresh-user|archive-eval-owned|baseline-only"
  },
  "diagnostics": {
    "backendUserId": "backend-user-id",
    "exportedAt": "2026-06-17T00:00:00.000Z",
    "graphqlUrl": "http://localhost:3000/graphql",
    "locationMode": "global-only",
    "locationId": null,
    "schemaResetMode": "none|fresh-user|archive-eval-owned|baseline-only"
  }
}
```

Important details:

- Include all visible unarchived definitions, not only definitions referenced
  by active preferences. This makes unused and duplicate created definitions
  visible.
- Join preferences to definitions by `definitionId` and slug where possible.
- Record owner/namespace/scope so user-owned and global definitions are clear.
- Include suggestions only as diagnostics unless a later eval explicitly scores
  suggestion quality.
- Record whether definitions were preexisting or created during the run when
  the backend exposes enough metadata. If timestamps or creation provenance are
  insufficient, record the limitation rather than inferring too much.
- Keep token redaction behavior consistent with the existing exporter.

## Open-Schema Database Report

Suggested output:

```text
open-schema-database-score-report.json
```

Example known-present row:

```json
{
  "factKey": "identity.legalName",
  "expectedValue": "Alex Jordan Rivera",
  "canonicalSlugs": ["profile.full_name"],
  "acceptedAliasSlugs": ["identity.legal_name"],
  "classification": "value_found_novel_slug",
  "valueFoundAnywhere": true,
  "valueFoundUnderAcceptedSlug": false,
  "candidateRows": [
    {
      "slug": "employee.legal_name",
      "definitionId": "definition-id",
      "displayName": "Employee Legal Name",
      "description": "Legal name used for employment forms.",
      "value": "Alex Jordan Rivera",
      "valueMatch": true,
      "schemaAssessment": "novel_review_needed"
    }
  ],
  "acceptedSlugRows": []
}
```

Example intentionally missing row:

```json
{
  "factKey": "contact.phone",
  "withheldValue": null,
  "classification": "missing_absent_correct",
  "valueFoundAnywhere": false,
  "acceptedSlugHasValue": false,
  "candidateRows": []
}
```

The report should also preserve:

- ignored non-active preferences
- suggestion-only matches
- unscored active preferences
- novel definitions with no active values
- ambiguous matches
- fixture-readiness blocking issues

## Open-Schema Combined Report

Suggested output:

```text
open-schema-combined-score-report.json
```

The combined report should attribute form outcomes to open-schema memory
outcomes without treating novel slugs as wrong by default.

Useful stage-attribution buckets:

- `memory_found_form_correct`
- `memory_found_form_missing`
- `memory_found_form_wrong`
- `memory_missing_form_correct`
- `memory_missing_form_missing`
- `memory_missing_form_wrong`
- `missing_absent_form_absent`
- `missing_absent_form_other`
- `missing_hallucinated_form_hallucinated`
- `missing_hallucinated_form_other`

`memory_missing_form_correct` is especially important. It usually means one of:

- backend form fill found data outside the scored active memory snapshot;
- the value matcher missed a valid normalization variant;
- the filled-form artifact was produced from different state than the memory
  snapshot;
- the form scorer expectation is wrong.

Treat that bucket as a debugging signal, not a quiet success.

## MCP Open-Schema Runner

Enable open mode only after `memory-snapshot.json` and the open-schema scorers
exist.

Target command:

```bash
pnpm eval:e2e-mcp-agent \
  --agent claude \
  --schema-mode open \
  --form-mode backend \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /private/tmp/alex-mcp-open-schema \
  --mcp-server context-router-local \
  --mcp-config /private/tmp/context-router-mcp.json \
  --reset-memory
```

Runner behavior:

- Do not run known-schema target-definition setup.
- Reset active memory values when requested.
- Capture visible definition baseline before the agent runs.
- Record the schema isolation strategy in `mcp-agent-run.json`,
  `memory-snapshot.json`, and `evaluation-run.json`.
- Fail fast if MCP tools are unavailable or the completion marker is missing.
- Continue to write partial `evaluation-run.json` after each stage.
- Mark setup/schema-reset limitations clearly in artifacts.
- Keep known-schema behavior unchanged.

Prompt requirements:

- Include staged corpus document paths and safe titles/categories.
- Include the scenario prompt and form purpose.
- Tell the agent it may create definitions and store active memory through MCP.
- Tell the agent to reuse existing definitions when they fit.
- Tell the agent not to guess unsupported values.
- Require the completion marker.
- Do not expose `profile.yaml`, manifests, validation reports, field maps,
  accepted slug maps, expected snapshots, or score outputs.

Whether to include the blank target PDF or a safe field-label summary remains a
prompt design choice. If included, it must be user-visible form context, not
fixture answer-key data.

## Definition State And Repeatability

`resetMyMemory(MEMORY_ONLY)` clears preference values, not necessarily
user-owned definitions. That matters more in open schema than known schema.

Possible repeatability strategies:

| Strategy | Use | Tradeoff |
| --- | --- | --- |
| Fresh backend user per run | Best benchmark isolation | More operational setup and auth/user management |
| Archive/delete prior eval-owned definitions | Repeatable with one user | Needs careful guards so product definitions are not touched |
| Baseline-only recording | First research/debug runs | Easy, but prior definitions can affect comparisons |

The first live implementation should support baseline-only recording and make
definition diffs visible in artifacts. Cleaner comparisons should use a
dedicated eval backend account/user until fresh-user or guarded cleanup tooling
is worth the added complexity. Hard MCP/backend identity proof can remain later
work unless the research process needs stronger guarantees.

## Backend Upload-Level Open Schema

Current backend document upload is known-schema only:

- the extraction prompt shows valid slugs;
- the model is instructed to use only those slugs;
- unknown slugs are filtered as `UNKNOWN_SLUG`;
- definition creation is separate from upload.

A later product-native open-schema flow could use one of these designs:

1. Upload proposes definitions and values.
   - Backend returns `proposedDefinitions[]` plus value suggestions.
   - User or runner applies definitions and values.
   - Easier to review.
2. Upload creates definitions automatically.
   - Backend writes definitions and values during ingestion.
   - Easier runner.
   - Higher risk of schema pollution.
3. Two-pass workflow.
   - First pass discovers candidate facts and definitions.
   - Second pass extracts values into the newly created schema.
   - Better attribution.
   - More latency and complexity.

Do this after MCP open-schema mode proves the artifact and scoring layer.

## Things To Avoid Initially

- Do not make schema-quality review a headline metric before reviewing real
  outputs.
- Do not hide form-fill mistakes by rewriting memory or auto-correcting source
  choices during scoring.
- Do not use LLM judgment inside deterministic score reports.
- Do not compare open-schema value-recovery scores directly to known-schema
  strict accepted-slug accuracy.
- Do not treat prior user definitions as harmless. They are part of the schema
  surface the producer sees.
- Do not expose accepted slug maps or expected snapshots in the agent
  workspace.

## Open Questions

- Is a fresh backend user per live run practical, or should the runner implement
  guarded eval-owned definition cleanup first?
- Should the first open-schema prompt include the blank target PDF, a safe
  field-label summary, or only the form purpose?
- Should global/core definitions count as existing accepted schema in open mode,
  or should they be diagnostics separate from agent-created definitions?
- Can the backend export definition/preference creation timestamps and audit
  provenance clearly enough to identify run-created objects?
- How strict should missing-fact hallucination be for novel broad categories
  such as phone numbers and emails?

## Recommended Next Step

Start with `memory-snapshot.json` and the open-schema database scorer. That is
the smallest durable foundation: it gives every future open-schema producer a
stable artifact boundary and makes live MCP runs debuggable before prompt tuning
or schema-quality review.
