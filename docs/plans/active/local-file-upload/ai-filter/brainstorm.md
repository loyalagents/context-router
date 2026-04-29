# AI Filter Brainstorm

- Status: brainstorming
- Read when: planning local AI-assisted filtering for `apps/local-orchestrator`
- Source of truth: `apps/local-orchestrator/**`, `apps/backend/src/modules/preferences/document-analysis/**`, `apps/backend/src/modules/preferences/audit/**`, `apps/web/app/dashboard/preferences/components/AuditHistoryTab.tsx`
- Last reviewed: 2026-04-28

## Goal

Add an optional local AI filter to the local file upload flow so a run can:

- skip files that are unlikely to contain useful preferences
- keep only the extracted suggestions that match a specific import goal
- preserve auditability by recording local decisions in the manifest and correlating applied writes with backend audit history

This should extend the current local orchestrator rather than replace the existing backend analysis and apply flow.

## Current Flow

Today the local orchestrator pipeline is:

1. discover files
2. file filter
3. backend analysis
4. suggestion filter
5. apply
6. summary / manifest

Important current behavior:

- discovery is extension-based and skips hidden files by default
- the local file filter and local suggestion filter are both passthrough-only in V1
- the current suggestion filter interface is per-suggestion, which is fine for passthrough but the wrong shape for local AI batching
- semantic filtering already happens on the backend after extraction
- backend analysis filters unknown slugs, duplicate groups, and no-change writes
- applied suggestions are persisted through `applyPreferenceSuggestions`

Relevant implementation entry points:

- `apps/local-orchestrator/src/discover.ts`
- `apps/local-orchestrator/src/run-import.ts`
- `apps/local-orchestrator/src/filters/file-filter.ts`
- `apps/local-orchestrator/src/filters/suggestion-filter.ts`
- `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts`

## What "Filter Stage" Means

The stage is where the local AI makes a decision in the pipeline.

### File Stage

This runs before upload.

Question:

- should this file be sent to `POST /api/preferences/analysis` at all?

Examples:

- skip build logs, dependency lockfiles, screenshots, or random exports
- analyze notes, resumes, markdown profiles, personal docs, and structured config-like files

### Suggestion Stage

This runs after backend analysis returns candidate suggestions.

Question:

- which extracted suggestions should survive to `--apply`?

Examples:

- keep only communication and tooling preferences
- skip temporary project details or one-off facts
- skip ambiguous low-value suggestions even if the backend accepted them as valid

### Both

This runs both stages:

1. local AI triages files before upload
2. local AI curates extracted suggestions before apply

## Main Recommendation

If only one AI stage is built first, it should be the suggestion stage.

Why:

- it is safer than file-stage filtering because a bad decision drops one suggestion instead of an entire file
- it has better context because the backend has already extracted structured candidates
- the user-provided "what should I look for?" instruction maps naturally to suggestion curation
- it works across all currently supported backend-analyzed file types, including PDFs and images, because the backend already handled the interpretation step

File-stage AI filtering is still useful later, especially for cost control, but it should not be the first intelligent filter.

## Guiding Principles

### Keep the Server Responsible for Meaning and Writes

The backend should continue to own:

- document interpretation
- slug validation
- duplicate consolidation
- no-change filtering
- write provenance and audit history

The local AI should decide what to send and what to keep, not redefine backend safety rules.

### Prefer Suggestion Curation Before File Triage

Suggestion filtering is lower risk and better informed than pre-upload file filtering.

### Let AI Narrow, Never Override, Backend Decisions

The AI filter should only further narrow what the backend already accepted.

It should never:

- revive backend-filtered suggestions
- override unknown-slug or no-change filtering
- act like a prompt that changes backend extraction behavior

### Make the Model Integration Replaceable

Do not hard-code Codex, Claude Code, or Ollama directly into the orchestration logic.

Use an adapter boundary so the orchestrator can support:

- `codex`
- `claude-code`
- `ollama`
- a generic `command` adapter

Named model choices should be presets over a stable local adapter contract.

### Keep Decisions Auditable

Local AI decisions that never reach the backend still need a durable trail. The manifest should be the audit record for:

- file skips
- suggestion skips
- local model configuration
- local decision reasons and scores

Backend audit history should remain the source of truth for writes that actually happened.

### Keep the Default Path Simple

The default run should remain:

- deterministic
- dry-run by default
- passthrough when AI flags are not enabled

Adding AI filtering should not change baseline behavior for existing commands.

### Avoid One Model Call Per Suggestion

The first useful suggestion-stage AI filter should evaluate all suggestions for one analyzed file in one shot.

The current per-suggestion filter interface is the wrong cost and latency shape for a local model.

### Require Explicit User Intent For AI Curation

AI filtering should run only when the user has provided a specific curation intent.

A vague default like "keep durable preferences" is too adapter-dependent and too close to what the backend already does. The first implementation should require either:

- an explicit `--ai-goal`
- or a later built-in named policy that expands to a stable prompt

### Do Not Broaden Writes On AI Failure

If the AI adapter fails during a dry-run, the run can safely fall back to passthrough decisions for observability.

If the AI adapter fails during an apply run, the orchestrator should not silently widen the write set by accepting everything. It is safer to:

- record the adapter failure in the manifest
- mark the affected file or batch as failed
- skip applying that file's suggestions

This keeps model flakiness from turning into unintended writes.

## Proposed User-Facing Shape

Rough CLI direction:

- `--ai-filter`
- `--ai-filter-stage suggestion|file|both`
- `--ai-adapter command|ollama|codex|claude-code`
- `--ai-goal "<instruction>"`

Possible defaults:

- `--ai-filter` off by default
- `--ai-filter-stage suggestion`
- `--ai-goal` required when AI filtering is enabled, unless a future named policy mode is added

Example goal strings:

- `Only keep stable communication and coding workflow preferences`
- `Only keep preferences that would help an LLM assistant personalize responses`
- `Only keep food, travel, and scheduling preferences`

## Recommended Adapter Design

The orchestrator should own a small local model adapter boundary.

Conceptually:

- input: structured filter context
- output: structured decisions with `apply|skip` or `analyze|skip`, plus reason and optional score

This should likely be command-oriented first because it is the least coupled foundation.

The adapter contract should be strong enough that the orchestrator can:

- pass a JSON request
- expect a JSON response
- validate the response locally
- record invalid adapter responses as manifest failures

The adapter contract should be introduced together with the first real suggestion-stage AI filter, not after it.

Near-term adapter recommendation:

- first adapter: generic `command`
- likely next adapter: built-in `ollama`
- later presets or wrappers: `codex`, `claude-code`

The command adapter is the cleanest first seam for experiments, but it should not block adding a more ergonomic built-in adapter soon after if usage friction is high.

## Interface Direction

The current per-suggestion `SuggestionFilter` interface should become batch-oriented before AI suggestion filtering is implemented.

Preferred direction:

- change the existing suggestion filter contract to operate on one analyzed file at a time
- have passthrough implement the batch interface trivially
- update `run-import.ts` to ask for one decision set per analyzed file

This is cleaner than building caching tricks inside an AI filter while leaving the outer interface per-suggestion.

Likely batch shape:

- input: file, analysis, suggestions, goal, adapter config
- output: `SuggestionDecision[]`

There is no meaningful external compatibility constraint here because the current filter interface is package-local.

The file-filter interface may remain simpler at first, but a future AI file-stage filter will likely need a richer context than metadata alone.

## Suggested Context Shape

### File Stage Context

The current file filter only receives `DiscoveredFile`, which is mostly metadata. That is not enough for useful AI filtering.

The file-stage AI will likely need one of:

- a text preview for text-like files
- a lazy file reader
- a preview builder that reads the first `N` KB or `N` lines

The first file-stage implementation should probably stay text-first.

PDF and image triage should not be assumed to work well unless the chosen local model is known to be multimodal.

### Suggestion Stage Context

The suggestion-stage AI should operate on one analyzed file at a time.

Likely inputs:

- file metadata
- relative path
- document summary
- accepted backend suggestions
- backend filtered suggestions for context
- user goal

Likely outputs:

- one decision per suggestion
- `action`
- `reason`
- optional `score`
- optional short details

## Audit Model

There are two separate audit surfaces and they should stay separate.

### Local Audit: Manifest

The manifest should be the durable local audit trail for AI filtering decisions.

What to store at run level:

- whether AI filtering was enabled
- which stage it ran at
- which model/adapter was used
- the user goal
- prompt or policy version if applicable

What to store at file level:

- file-stage decision
- reason
- score
- short explanation

What to store at suggestion level:

- suggestion-stage decision
- reason
- score
- short explanation

### Backend Audit: Preference Audit History

The backend already records applied writes in preference audit history.

Important current behavior:

- `applyPreferenceSuggestions` uses `analysisId` as the backend `correlationId`
- applied writes carry `origin: DOCUMENT_ANALYSIS`
- preference audit history is queryable and visible in `/dashboard/history`

This means:

- the manifest should record `analysisId` for each analyzed file
- backend audit events can be correlated with the manifest using `correlationId == analysisId`

### Bridge Between The Two

The manifest is the full story for local AI decisions.

Backend history is the durable story for writes that actually happened.

The bridge between them is:

- `analysisId` in the manifest
- `correlationId` in backend audit history

## Manifest Direction

Roughly, the manifest should be extended to include AI configuration and richer decision detail.

This should be treated as a manifest schema change and should bump the manifest version from `1` to `2`.

Examples of useful additions:

- `config.aiFilter.enabled`
- `config.aiFilter.stage`
- `config.aiFilter.adapter`
- `config.aiFilter.goal`
- `config.aiFilter.promptVersion`
- `config.aiFilter.failurePolicy`

And decision shapes like:

- file decision: `action`, `reason`, `score`, `details`
- suggestion decision: `suggestionId`, `action`, `reason`, `score`, `details`

Accepted suggestions may also carry a small `filterAudit` object inside the apply evidence so some local filter context survives into backend audit snapshots.

That is optional, but useful for accepted writes.

Skipped files and skipped suggestions will still only exist in the local manifest unless a future server-owned import history is added.

The core AI manifest fields should ship with the first AI filter checkpoint rather than being added later as a separate retrofit.

## Rough Plan

### Checkpoint 1: Wiring Refactor

- add CLI/config support for AI filter options
- replace hard-coded passthrough filter construction with filter factories
- widen `CliOptions` and `RunConfig` for AI filter metadata
- prepare the manifest for `version: 2`
- keep `passthrough` as the default behavior
- add tests for flag parsing and filter selection

Verification:

- `local-orchestrator` tests stay green
- existing dry-run behavior is unchanged without AI flags

### Checkpoint 2: Adapter Contract And Suggestion-Stage AI Filter

- change the suggestion filter interface to a batch-oriented shape
- define the adapter contract in the same checkpoint
- implement the first adapter, likely `command`
- add a batch-oriented suggestion-stage AI filter
- evaluate all suggestions for one analyzed file in one adapter call
- require an explicit `--ai-goal` when AI filtering is enabled
- record decisions, reasons, and scores in the manifest
- record adapter failures in the manifest with explicit dry-run vs apply behavior

Verification:

- targeted tests for accepted/skipped suggestion decisions
- manifest captures AI configuration and decisions
- adapter failure behavior is covered for both dry-run and apply
- dry-run shows clear counts for accepted vs skipped

### Checkpoint 3: Additional Adapters And Hardening

- add a built-in `ollama` adapter if ergonomics justify it
- optionally add named presets or wrappers for `codex` and `claude-code`
- validate adapter output locally and fail safely when malformed
- harden timeout and refusal handling

Verification:

- mocked adapter tests cover success, malformed JSON, timeout, and refusal cases
- manifest records adapter failures without crashing the whole run

### Checkpoint 4: Audit Bridge And File-Stage Preparation

- consider carrying a compact `filterAudit` object into apply evidence for accepted suggestions
- document how to correlate manifest `analysisId` with backend audit `correlationId`
- decide whether the file-stage preview size needs a CLI or config surface

Verification:

- manifest contains enough data to explain why a suggestion was skipped or applied
- accepted writes can be traced into `/dashboard/history`

### Checkpoint 5: Add File-Stage AI Filter

- widen the file-filter context so AI can see more than metadata
- start with text preview support for text-like files
- keep file-stage AI optional and conservative
- support `--ai-filter-stage both`

Verification:

- tests cover file skips vs analyzed files
- manifest captures file-stage decision reasons
- unsupported file types remain governed by existing discovery and backend MIME rules

## Non-Goals For The First AI Filter Pass

- changing backend MIME support
- replacing backend extraction with local extraction
- broadening supported file types by itself
- migrating the writer from `applyPreferenceSuggestions` to MCP immediately
- building server-owned import history
- adding dedupe/resume in the same change

## Open Questions

- Should file-stage AI ever run on PDFs/images without a clearly multimodal local adapter?
- Should accepted suggestions include local filter metadata in `evidence`, or should that stay manifest-only?
- Should a built-in named policy mode exist later, or should all AI runs require free-form `--ai-goal` text?
- At what point does it make sense to introduce an MCP writer for stronger machine-authored semantics?

## Practical Recommendation

The first implementation should be:

- local orchestrator
- existing backend analysis
- existing GraphQL apply path
- optional suggestion-stage AI filter
- batch-oriented suggestion filtering
- adapter boundary introduced with the first AI filter
- manifest version `2` with decision metadata from day one
- manifest-first audit trail with `analysisId` to `correlationId` traceability

This gives the highest-value version of AI filtering with the lowest risk to correctness and provenance.
