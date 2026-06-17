# Open-Schema Direct Vertex Baseline Brainstorm

- Status: brainstorm
- Last updated: 2026-06-17
- Scope: no-storage open-schema baseline where Vertex sees all source
  documents, extracts useful facts, and fills a form without backend memory,
  preference definitions, MCP tools, or database writes

## Summary

This baseline should answer:

```text
Given all source documents at once, can Vertex extract the needed information
and use it to fill the form without persistent memory/schema/database tooling?
```

This is different from backend known-schema ingestion and from MCP open-schema
runs. It is a no-storage, all-context baseline. It should help distinguish
model/form difficulty from failures introduced by schema setup, memory writes,
memory reads, MCP/tooling, stale active values, or backend persistence.

Recommended first shape:

```text
all corpus docs + safe scenario/form context
  -> Vertex extracts open-schema facts
  -> Vertex fills the form from only those extracted facts
  -> existing filled-form.json and form scorer judge the final form
  -> optional synthetic memory snapshot and open-schema scorer judge extraction
```

The important constraint is that the form-fill step should not receive the raw
corpus documents again. It should receive only the extracted facts. Otherwise
this collapses back into the existing one-shot direct-document baseline.

## Existing Baselines For Context

### Existing Direct-Document Form Baseline

`pnpm eval:fill-form-from-docs` currently sends local evidence documents plus
PDF field metadata to Vertex in one prompt. Vertex returns direct form actions:

```json
{
  "fillActions": [
    {
      "fieldName": "exact PDF field name",
      "action": "SET_TEXT | CHECK | UNCHECK | SELECT_OPTION | SKIP",
      "value": "required only for SET_TEXT and SELECT_OPTION",
      "sourceSlugs": ["doc:document-id"],
      "confidence": 0.0,
      "skipReason": "required when action is SKIP"
    }
  ]
}
```

That baseline is useful, but it does not expose a middle extraction step. If the
form is wrong, it is hard to tell whether Vertex failed to extract the right
fact or extracted it but failed to apply it to the form.

### Backend Known-Schema Ingestion

Backend document analysis asks Vertex for known-schema preference suggestions:

```json
{
  "suggestions": [
    {
      "slug": "string from schema",
      "operation": "CREATE | UPDATE",
      "oldValue": null,
      "newValue": "...",
      "confidence": 0.0,
      "sourceSnippet": "...",
      "sourceMeta": { "page": null, "line": null }
    }
  ],
  "documentSummary": "..."
}
```

That is not open schema. The prompt provides valid slugs and instructs the
model to use only those slugs.

## Proposed Open-Schema Baseline

Use two Vertex calls.

### Stage 1: Extract Open Facts

Inputs:

- all declared corpus documents, as text where supported;
- safe scenario/form purpose;
- possibly safe blank-form context or field-label summary;
- no `profile.yaml`;
- no validation report;
- no field map answer key;
- no accepted slug map;
- no expected filled-form snapshot;
- no score reports.

Ask Vertex to produce clean JSON with model-authored facts, not
`memory-snapshot.json`.

Suggested output artifact:

```text
open-schema-extraction.json
```

Suggested model response shape:

```json
{
  "facts": [
    {
      "slug": "identity.legal_name",
      "label": "Legal name",
      "description": "Full legal name for employment and onboarding forms.",
      "valueType": "STRING",
      "value": "Alex Jordan Rivera",
      "confidence": 0.96,
      "evidence": [
        {
          "documentPath": "identity/002-name-history-note.md",
          "quote": "short supporting quote"
        }
      ]
    }
  ],
  "unresolvedFacts": [
    {
      "label": "Phone number",
      "reason": "No current source document provided a phone number."
    }
  ],
  "documentSummaries": [
    {
      "documentPath": "identity/002-name-history-note.md",
      "summary": "Contains legal name history."
    }
  ]
}
```

Notes:

- The model may choose slugs because this is open schema.
- The prompt should ask for concise durable slugs, reuse common categories when
  obvious, and avoid one-off form-field slugs when a reusable fact is clearer.
- The prompt should tell the model not to output unsupported values.
- Evidence should support the value, not just the label or surrounding form
  context.
- `unresolvedFacts[]` is diagnostic. It should not become a scored failure by
  itself.

The eval script should validate this response. It can accept markdown fences
for robustness, strip them, parse JSON, validate basic shape, and write the raw
artifact plus parse diagnostics.

### Stage 2: Fill From Extracted Facts

Inputs:

- PDF field metadata;
- safe field policies / skip guidance;
- scenario/form purpose;
- `facts[]` from `open-schema-extraction.json`.

Do not pass the raw corpus documents to this step.

Ask Vertex to return the existing fill-action shape:

```json
{
  "fillActions": [
    {
      "fieldName": "Last Name (Family Name)",
      "action": "SET_TEXT",
      "value": "Rivera",
      "sourceSlugs": ["identity.legal_name"],
      "confidence": 0.92
    }
  ]
}
```

For this baseline, `sourceSlugs` should refer to extracted fact slugs, not
backend memory slugs and not document refs. The response artifact should label
that clearly because the existing form scorer's source-slug agreement metric is
not a headline metric for this run.

The runner then fills the PDF and writes the existing `filled-form.json` shape
so the current form scorer can run unchanged.

## Artifacts

Minimum v1 artifacts:

- `open-schema-extraction.json`
- `direct-open-schema-fill-response.json`
- `filled-form.json`
- `filled-form.pdf`
- `form-score-report.json`
- `evaluation-run.json`

Optional extraction-scoring artifacts:

- `synthetic-memory-snapshot.json`
- `open-schema-database-score-report.json`
- `open-schema-combined-score-report.json`

The minimum v1 can answer:

```text
Can Vertex extract and fill well enough to produce a correct final form?
```

The optional extraction-scoring layer can answer:

```text
Did Vertex extract the correct values before form filling?
Did it hallucinate intentionally missing values?
Did the form-filler fail despite extraction having the right value?
```

## Synthetic Memory Snapshot

If open-schema `memory-snapshot.json` and scorer contracts exist, the direct
baseline can deterministically convert `open-schema-extraction.json` into a
synthetic memory snapshot for scoring.

Vertex should not generate this artifact directly.

Flow:

```text
Vertex output open-schema-extraction.json
  -> deterministic eval adapter
  -> synthetic-memory-snapshot.json
  -> open-schema value-recovery scorer
```

The deterministic adapter maps each fact:

```text
fact.slug        -> definition.slug and preference.slug
fact.label       -> definition.displayName
fact.description -> definition.description
fact.valueType   -> definition.valueType
fact.value       -> preference.value
fact.evidence    -> preference.evidence
```

Synthetic IDs should be generated deterministically, for example:

```text
definitionId = synthetic-definition:<hash(slug)>
preferenceId = synthetic-preference:<hash(slug + value)>
```

The adapter owns eval bookkeeping fields:

- `schemaVersion`
- `artifactType`
- `runId`
- `userId`
- `corpusId`
- `scenarioId`
- `storageInput`
- `definitionBaseline`
- diagnostics

This keeps malformed eval metadata from becoming model behavior. If the model
extracts the wrong value, scoring catches it. If the synthetic artifact is
malformed, that is an adapter bug.

Suggested synthetic snapshot semantics:

- `producer`: `direct-document-open-schema-baseline`
- `schemaMode`: `open`
- `namespace`: `SYNTHETIC`
- `statusesScored`: `["ACTIVE"]`
- `definitionBaseline.strategy`: `synthetic-no-backend`
- `diagnostics.backendUserId`: `null`
- no real backend IDs or namespace ownership

## Why PR 1 And PR 2 Help

The direct baseline can be built without the MCP open-schema runner.

It benefits from the open-schema artifact/scorer PRs:

- PR 1 (`memory-snapshot.json` contract/export) defines the normalized scoring
  shape. The direct baseline can emit a synthetic version of that shape instead
  of inventing a one-off extraction scoring format.
- PR 2 (open-schema DB and combined scorers) lets the direct baseline score
  extraction/value recovery separately from final form correctness.

It is not blocked by:

- MCP `--schema-mode open`;
- MCP/backend identity preflight;
- live Claude smoke reliability;
- backend upload-level schema discovery.

If implemented before PR 1/2, keep it simple:

```text
open-schema-extraction.json
  -> fill from extracted facts
  -> form-score-report.json
```

Then add synthetic memory snapshot scoring once the shared contracts exist.

## What This Baseline Does And Does Not Test

It tests:

- all-context extraction from the corpus;
- model-chosen open schema/fact labels;
- whether a second form-fill pass can use only extracted facts;
- final form correctness without backend memory;
- hallucination/abstention behavior if extraction scoring is added.

It does not test:

- persistent memory;
- database writes or reads;
- MCP tools;
- user-owned definition creation;
- schema pollution;
- active vs suggested state;
- incremental document ingestion;
- stale memory;
- retrieval over a large long-lived corpus;
- user correction loops;
- backend form-fill use of stored memory.

Interpretation:

```text
Direct Vertex is the no-storage, all-context baseline.
Storage should justify itself by matching it on one-off accuracy when possible,
and beating it on persistence, reuse, scale, auditability, corrections, and
multi-run reliability.
```

If direct Vertex fails, the corpus/form/prompt/model are hard. If direct Vertex
succeeds but storage-based runs fail, the likely issue is ingestion, schema,
memory write/read, retrieval, or form-fill use of memory. If storage succeeds
where direct Vertex fails, that is strong evidence the storage system adds value
beyond raw model context.

## Implementation Difficulty

This is medium-low if v1 only scores the final form:

- reuse document loading from `eval:fill-form-from-docs`;
- add an extraction prompt and parser;
- pass extracted facts into a second fill prompt;
- reuse PDF fill, `filled-form.json`, and form scoring code.

It becomes medium if extraction-level scoring is included immediately:

- add `open-schema-extraction.json` schema;
- add deterministic adapter to synthetic memory snapshot;
- depend on open-schema snapshot/scorer contracts or create temporary
  placeholders.

Recommended implementation order:

1. Build two-stage direct baseline with `open-schema-extraction.json` and form
   scoring.
2. Add synthetic memory snapshot mapping after the open-schema snapshot/scorer
   contracts exist.
3. Compare direct baseline, MCP open schema, and backend known-schema runs by
   reading their shared score reports.

## Open Questions

- Should Stage 1 see blank target PDF field labels, a short form purpose, or no
  form context beyond the scenario?
- Should Stage 1 extract generally useful memory or only facts likely needed
  for the target form?
- Should Stage 2 use the backend form-fill prompt builder style, the existing
  direct-doc fill prompt style, or a new prompt tuned for extracted facts?
- Should `sourceSlugs` in Stage 2 be extracted fact slugs, synthetic preference
  IDs, or both?
- Should `unresolvedFacts[]` be free-form diagnostics or constrained to fields
  the model thinks are relevant?
- Should this baseline have its own `evaluation-run.json` mode, for example
  `direct-open-schema-baseline`?
