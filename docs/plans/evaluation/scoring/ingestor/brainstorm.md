# Ingestor Brainstorm

- Status: active brainstorm
- Last updated: 2026-06-02

## Goal

Record the ingestion benchmark split before implementing an ingestor. The main
risk is building a document-upload benchmark and accidentally treating it as a
slug-discovery benchmark.

## Shared Flow

```text
load fixture
  -> authenticate/call me
  -> reset current backend user's memory
  -> optionally seed starting values
  -> optionally ensure accepted eval definitions exist
  -> upload docs
  -> optionally auto-apply only suggestions returned by each upload response
  -> export stored preferences
  -> score
```

The eval fixture user and backend authenticated user are separate concepts:

- Eval user: fixture identity such as `alex-i9-test`.
- Backend user: authenticated database user returned by GraphQL `me`.

The ingestor should record both in its run summary.

## Current Backend Reality

- Document upload can extract values into existing preference definitions.
- Document upload currently does not create new preference definitions/slugs.
- The extraction prompt shows the current preference schema and instructs the
  model to use only valid slugs from that schema.
- Unknown slugs are filtered as `UNKNOWN_SLUG`.
- `createPreferenceDefinition` can create a slug without a value, but it is a
  separate GraphQL mutation, not part of document upload.
- Upload returns the current document's `analysisId` and complete
  `suggestions[]`; auto-apply should use only that response, not the suggestion
  inbox.
- `resetMyMemory(MEMORY_ONLY)` can clear current-user preference rows for local
  benchmark isolation.

## Benchmark Tracks

Known-schema document ingestion:

- Pre-create or ensure accepted preference definitions exist.
- Upload corpus documents through the current product upload endpoint.
- Auto-apply only suggestions returned by each upload response.
- Export active preferences and score them against fixture truth.
- Measures whether upload extraction can recover values when the memory schema
  already contains useful slugs.

Open-schema ingestion:

- Do not pre-create eval-specific definitions.
- The system or agent must decide whether existing slugs fit, create useful new
  definitions/slugs when needed, and store extracted values.
- Measures slug discovery plus value storage.
- MCP/Codex/Claude can test this today because MCP can create definitions and
  write preferences.
- Upload-level open-schema ingestion would require backend changes, likely a
  `proposedDefinitions` shape plus an apply flow that creates definitions before
  values.

We likely want both open-schema surfaces:

- MCP/Codex/Claude runner for agent-driven schema discovery.
- Upload-level schema discovery for product document analysis.

The order is not decided yet.

## Initial Implementation Direction

The known-schema ingestor can be implemented first with existing APIs:

- `me`
- `resetMyMemory(MEMORY_ONLY)`
- optional `createPreferenceDefinition`
- optional `setPreference` for explicit seed values
- `POST /api/preferences/analysis`
- `applyPreferenceSuggestions`
- `activePreferences` via the stored-preferences exporter

This should be labeled as known-schema ingestion, not open-schema discovery.

For upload auto-apply, the ingestor should reject pagination-looking upload
responses until pagination support exists. A response with `nextCursor`,
`pageInfo`, `hasNextPage`, or similar fields should fail clearly because the
ingestor assumes `suggestions[]` is complete.
