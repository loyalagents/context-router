# Brainstorm A: Local Folder Batch Upload And Future Filter

- Status: brainstorming
- Read when: scoping local batch preference upload and future local-agent filtering
- Source of truth: `apps/backend/src/modules/preferences/document-analysis/**`, `apps/backend/src/modules/preferences/preference/**`, `apps/backend/src/mcp/tools/preference-mutate.tool.ts`
- Last reviewed: 2026-04-26

## Goal

Allow a user to point at a local folder and run a batch import that:

- discovers candidate files
- extracts preference candidates from useful files
- optionally filters those candidates through a local sub-agent
- persists accepted results with clear provenance and auditability

The initial build should solve the batch job now without blocking a near-term filter step.

## Existing Repo Surfaces

The repo already has several relevant surfaces:

- `POST /api/preferences/analysis` accepts one file and returns review-first suggestions.
- `applyPreferenceSuggestions` applies multiple extracted suggestions in one GraphQL mutation.
- GraphQL `setPreference` writes active preferences directly.
- MCP `mutatePreferences` supports machine mutation flows including suggestion, active writes, deletes, and definition mutation.

Important behavior notes:

- The document-analysis path is schema-bound. It expects valid known slugs and returns suggestions rather than direct writes.
- `applyPreferenceSuggestions` writes imported results with machine-style provenance (`DOCUMENT_ANALYSIS` + inferred metadata).
- Raw GraphQL `setPreference` is a worse long-term target for import automation because it is currently stamped as a user-authored GraphQL mutation.
- MCP `mutatePreferences` is the strongest foundation if we want future local-agent filtering to stay clearly machine-authored and eventually create missing personal definitions.

## Integration Options

### 1. UI Folder Upload

The web app could expose a folder import flow and call backend APIs from the browser.

Pros:

- best eventual user experience
- good visibility into progress and results
- easy to combine with existing review UI later

Cons:

- browsers do not naturally let the server "point at a folder" on disk
- likely requires directory selection, zip upload, or many per-file uploads
- awkward place to run a local sub-agent such as Codex, Claude Code, or Ollama

Fit:

- better as a later UX layer than as the first implementation

### 2. Local Script Calling REST Analysis And GraphQL Apply

A local script walks a folder, uploads files one by one to `POST /api/preferences/analysis`, then optionally applies selected suggestions through `applyPreferenceSuggestions`.

Pros:

- fastest path with the current backend
- reuses existing extraction and batch-apply behavior
- straightforward `--dry-run` mode
- easy to keep out of the main web app initially

Cons:

- one analysis request per file
- still tied to existing known slugs
- needs local token handling
- future definition creation is awkward unless the writer changes

Fit:

- strongest option for the first batch-import build

### 3. Local Script Calling GraphQL Preference Mutations Directly

A local script skips document analysis and calls GraphQL `setPreference` or `suggestPreference` directly.

Pros:

- simple API surface
- good for structured inputs that are already normalized

Cons:

- poor fit for unstructured local files
- raw `setPreference` currently looks user-authored instead of machine-imported
- custom definitions remain a separate step

Fit:

- acceptable only for a narrow importer that already has trusted structured preference data

### 4. Local Agent Calling MCP `mutatePreferences`

A local runner or sub-agent reads files, decides what matters, and persists through MCP operations such as `SUGGEST_PREFERENCE`, `SET_PREFERENCE`, and definition mutation.

Pros:

- best long-term fit for agent-driven filtering
- preserves machine provenance more naturally
- supports future create-definition-then-write flows
- aligned with current MCP permission and audit model

Cons:

- more moving parts than the REST + GraphQL path
- higher implementation complexity for the first batch job
- per-suggestion operations may be noisier and slower than a simple batch apply

Fit:

- likely the right long-term writer once local-agent filtering is introduced

### 5. Backend Batch Endpoint Or Job

The backend exposes a new API that accepts a folder-derived manifest or batch payload and handles the whole import centrally.

Pros:

- one canonical import pipeline
- easier to add run history, resumability, and retries
- later UI and CLI can share the same backend contract

Cons:

- most work up front
- repo does not currently have a general batch-job framework for this
- harder to iterate quickly on local-agent experiments

Fit:

- good follow-up once the local flow proves out

### 6. Folder Watcher Daemon

A local process watches a folder and continuously imports new files.

Pros:

- useful if the real product is continuous sync

Cons:

- much more stateful
- requires dedupe, retry, backfill, and reprocessing rules
- harder to trust early

Fit:

- not a good first build

### 7. Direct Database Or Prisma Import

Pros:

- fast to prototype

Cons:

- bypasses service validation
- bypasses current provenance and audit patterns
- easy to create schema/value inconsistencies

Fit:

- should be avoided

## Filter Design

There are two distinct filters:

- file filter: should this file be analyzed at all
- suggestion filter: given extracted suggestions, which ones should be persisted

If only one filter is implemented first, suggestion filtering is the better starting point. It fits the existing backend much better than trying to predict file usefulness perfectly before extraction.

A clean pipeline shape is:

1. enumerate files from a folder
2. run `shouldAnalyzeFile(file)` to skip obvious junk
3. analyze remaining files
4. run `shouldApplySuggestion(suggestion)` on extracted results
5. persist accepted results
6. record a manifest for audit/debugging

This keeps the initial implementation simple while leaving a clear adapter point for a future local-agent decision step.

## Recommended Initial Build

The most practical first implementation is:

- a local Node/TypeScript CLI
- folder walk + per-file upload to `POST /api/preferences/analysis`
- `--dry-run` by default
- optional `--apply` mode that uses `applyPreferenceSuggestions`
- a manifest file or console report containing file path, analysis result, accepted suggestions, skipped suggestions, and errors
- a pluggable filter adapter with `passthrough` as the default implementation

Why this is the best first step:

- it reuses the current review-first extraction path
- it avoids building a new backend job system before the flow is proven
- it is easy to test against a real local folder
- it leaves a clean seam where a local agent can be inserted later

## Why Not Use Raw `setPreference` As The First Writer

`setPreference` is tempting because it is simple, but it is not the best foundation for this feature:

- it is not the existing document-import path
- it currently looks like a user-authored GraphQL mutation
- it does not naturally model “machine found this in a file”
- it is weaker than MCP for future definition-aware import flows

If the importer stays review-first, `applyPreferenceSuggestions` is the better writer.

If the importer evolves toward direct machine persistence and definition creation, MCP `mutatePreferences` is the better writer.

## Likely Evolution Path

V1 can be deliberately modest:

- local CLI
- existing document-analysis endpoint
- batch apply from extracted suggestions
- `passthrough` filter only

V2 can add:

- local-agent suggestion filter
- confidence thresholds
- file-type rules
- cached file hashes to skip unchanged files

V3 can shift the persistence layer toward MCP when needed:

- direct machine writes
- definition creation for missing user-owned slugs
- permission-aware agent execution

## Candidate Checkpoints

If this turns into implementation work, the checkpoints should end at clear testable states:

### Checkpoint 1

- add a local CLI that walks a folder and calls `POST /api/preferences/analysis`
- support `--dry-run`
- emit a readable run summary

Verification:

- targeted script-level smoke run against a small folder

### Checkpoint 2

- add `--apply`
- batch accepted suggestions through `applyPreferenceSuggestions`
- preserve file-to-analysis correlation in output

Verification:

- targeted backend e2e coverage for apply behavior if backend contracts change
- local smoke run against a known sample folder

### Checkpoint 3

- add a filter adapter interface
- ship `passthrough` first
- make room for `local-agent` later without changing the core pipeline

Verification:

- unit tests for filter adapter selection and skip/apply behavior

### Checkpoint 4

- evaluate whether persistence should move from GraphQL apply to MCP `mutatePreferences`
- do this only if the filter needs direct machine writes or definition mutation

Verification:

- targeted MCP e2e tests for the chosen operations

## Current Lean

The current lean is:

- build the batch job as a local CLI now
- use the existing document-analysis API for extraction
- use `applyPreferenceSuggestions` for initial persistence
- design the pipeline so the filter stage can be swapped from `passthrough` to a local-agent implementation soon
- treat MCP as the likely long-term mutation surface once the filter starts making stronger decisions
