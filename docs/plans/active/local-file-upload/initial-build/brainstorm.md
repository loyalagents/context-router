# Local File Upload: Initial Build Summary

- Status: brainstorming
- Read when: aligning on local vs server orchestration for batch preference import
- Source of truth: conversation summary plus `apps/backend/src/modules/preferences/document-analysis/**`, `apps/backend/src/modules/preferences/preference/**`, `apps/backend/src/mcp/tools/preference-mutate.tool.ts`
- Last reviewed: 2026-04-26

## Context

We want a batch preference-import flow where a user can point at a local folder and import useful preferences into Context Router.

The current backend already provides useful primitives:

- `POST /api/preferences/analysis` analyzes one uploaded file and returns suggestions.
- `applyPreferenceSuggestions` persists selected analysis suggestions.
- GraphQL `setPreference` and `suggestPreference` can write values directly.
- MCP `mutatePreferences` can perform machine-oriented value and definition mutations.

The planned future extension is local filtering:

- a local sub-agent such as Codex, Claude Code, Ollama, or similar can decide whether a file is worth analyzing
- and/or decide whether a returned suggestion should actually be persisted

## Main Decisions

### 1. Build the first orchestrator locally

The first implementation should use a local orchestrator rather than a server-owned batch job.

Why:

- the source of truth for the input is a local folder
- local agents and local-only runtimes fit naturally on the client side
- local orchestration lets us avoid uploading obviously irrelevant files
- the repo already has server-side analysis and persistence primitives, so we do not need a new backend batch system for V1

### 2. Keep the server responsible for analysis and writes

Even though orchestration is local, the backend should still own:

- document analysis
- slug and value validation
- duplicate consolidation
- persistence
- provenance and audit behavior

The local side should decide what to send and what to keep. The server should decide what the file means and how accepted results are written safely.

### 3. Support a future server orchestrator without redesigning the flow

We want local orchestration now, but we do not want to trap ourselves in a client-only model.

The design should make it easy to add a server orchestrator later by:

- using explicit pipeline stages
- using shared run/result shapes
- keeping server APIs narrow and reusable
- avoiding tight coupling to Nest internals in the local runner

### 4. Place the local orchestrator in its own workspace

The current lean is to create:

- `apps/local-orchestrator`

rather than burying the first version inside `apps/backend/scripts`.

Why:

- it makes the local-agent aspect explicit
- it supports demos where the local agent is a first-class character in the story
- it gives the local tool its own dependencies, scripts, and growth path
- it reinforces that this is an external client of the backend, not a backend implementation detail

This costs a little more setup than `apps/backend/scripts`, but the extra overhead is modest and the intent is much clearer.

## Chosen Flow

The working flow is:

1. `discover`
2. `optional file filter`
3. `analyze`
4. `optional suggestion filter`
5. `optional apply`
6. `summary`

### Which side owns each step

For the initial local-orchestrated design:

- `discover`: local orchestrator
- `optional file filter`: local orchestrator
- `analyze`: local orchestrator sends file, server performs extraction
- `optional suggestion filter`: local orchestrator
- `optional apply`: local orchestrator chooses, server writes
- `summary`: local orchestrator

This is a hybrid execution model, but the orchestration loop itself lives locally.

## What Each Step Means

### Discover

The local orchestrator scans a folder recursively and builds a candidate file list.

Typical responsibilities:

- recurse through directories
- ignore unsupported or obviously irrelevant file types
- record file path, relative path, size, and MIME guess
- optionally compute file hashes later for dedupe/resume

### Optional File Filter

This is the first decision point: should the file be analyzed at all?

The default implementation can be passthrough.

Future implementations may include:

- heuristic filename/content checks
- local-model filters using Ollama, Codex, Claude Code, or similar

This step should be conservative. A false negative here means the file is never analyzed.

### Analyze

For each retained file, the local orchestrator calls:

- `POST /api/preferences/analysis`

The server handles:

- MIME/size validation
- AI extraction
- schema-bound slug matching
- duplicate consolidation
- returning `analysisId`, `status`, `suggestions`, and `filteredSuggestions`

Important clarification:

- this endpoint analyzes only
- it does not itself persist preferences

### Optional Suggestion Filter

This is the second decision point: given the returned suggestions, which should be kept?

This is the best place for future local-agent judgment.

Examples:

- apply everything
- skip low-confidence items
- skip ambiguous snippets
- skip categories we do not want to write automatically
- let a local model decide which extracted preferences are truly useful

If only one intelligent filter is added first, suggestion filtering is the stronger candidate. It is safer and better informed than file-level filtering alone.

### Optional Apply

If the run is not dry-run and some suggestions were accepted, the local orchestrator sends only those accepted suggestions back to the server.

The initial writer should be:

- `applyPreferenceSuggestions`

Why:

- it fits the current review-first document-analysis path
- it preserves inferred/document-analysis provenance
- it is a better import writer than raw GraphQL `setPreference`

Important clarification:

- raw GraphQL `setPreference` currently looks user-authored and is not the preferred first persistence path for imported suggestions

### Summary

The local orchestrator owns reporting for the run.

It should produce:

- console output
- optional JSON manifest

The summary should include:

- discovered files
- skipped files
- analysis results
- skipped suggestions
- applied suggestions
- errors and partial failures

## Why Local Orchestrator Wins For V1

### Strengths

- best fit for local folders
- best fit for local-only model runtimes
- minimizes unnecessary uploads to the remote server
- easy to experiment with filters and policies
- supports good dry-run workflows
- keeps the trust boundary cleaner

### Weaknesses

- workflow logic is split between client and server
- central observability is weaker unless we record local manifests
- the local tool needs its own retry/concurrency/summary logic
- behavior can drift if the local runner evolves without discipline

## Why We Are Not Starting With A Server Orchestrator

For a remote server, server orchestration has real downsides in this use case:

- the server cannot naturally see a local folder
- the client would need to upload files or manifests before the server can even decide what matters
- local-only agents become harder to integrate cleanly
- we would need more backend batch/job infrastructure earlier

Server orchestration is still attractive later when we care more about:

- shared UI-driven flows
- durable run history
- centralized retries and progress tracking
- standardized multi-client behavior

But it is premature for the first implementation.

## How We Make Server Orchestration Easy To Add Later

The design should assume that both local and server orchestrators may exist over time.

Important rule:

- the system can support both local and server orchestrators overall
- but each individual run should have one clear owner

To make later server orchestration straightforward, V1 should:

- define clear stage boundaries
- keep run/result types explicit
- isolate backend calls behind client adapters
- avoid importing backend internals directly into the local orchestrator
- treat the backend as a service even when running everything from the same repo

Possible future modes:

- local-orchestrated run
- server-orchestrated run
- hybrid handoff where local prefilters and the server owns the rest

## Initial Server Primitives To Build Around

The local orchestrator should initially rely on the existing server surfaces:

- `POST /api/preferences/analysis`
- GraphQL `applyPreferenceSuggestions`

Later, if we want direct machine writes, stronger provenance control, or definition mutation, the likely longer-term writer is:

- MCP `mutatePreferences`

That makes MCP a future persistence surface, not a blocker for the first build.

## Package Placement

Current preferred placement:

- `apps/local-orchestrator`

This gives the local tool:

- its own package boundary
- its own dependencies
- its own scripts and tests
- a clearer identity for demos and future local-agent work

This is slightly more setup than `apps/backend/scripts`, but not dramatically more.

## General Plan

### V1

Build a small local orchestrator package that:

- takes a folder path
- discovers files
- optionally file-filters them
- calls server analysis per file
- optionally suggestion-filters results
- supports dry-run by default
- optionally applies accepted suggestions
- writes a summary and optional manifest

### V2

Add stronger local filtering:

- local-agent file filtering
- local-agent suggestion filtering
- confidence thresholds
- file hash caching and skip-unchanged behavior

### V3

Add future server-oriented growth if needed:

- server-owned import runs
- shared run history and progress
- hybrid handoff mode
- optional switch from GraphQL apply to MCP mutation for richer machine-write behavior

## Initial Implementation Lean

The current lean is:

- local orchestrator now
- server analysis now
- server apply now
- package it as `apps/local-orchestrator`
- structure it so a server orchestrator can be added later without throwing the flow away

That gives us a local-first architecture that matches the actual source of the data while still leaving a clean path toward a later server-owned orchestration model.
