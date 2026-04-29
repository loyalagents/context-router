# AI Filtering For Local Upload

## Summary

Implement AI-assisted filtering in `apps/local-orchestrator` in two milestones:

1. ship suggestion-stage AI filtering only, using a `command` adapter, explicit `--ai-goal`, explicit `--ai-command`, manifest v2, and conservative apply behavior
2. add file-stage filtering later, then introduce `--ai-filter-stage file|suggestion|both`

There is no backwards-compatibility requirement. Remove the old CLI filter flags entirely. Keep the internal filter interfaces and passthrough implementations; when AI is off, the orchestrator still uses passthrough filters internally.

## Public Interface Changes

- Remove `--file-filter` and `--suggestion-filter` from CLI parsing, help text, `CliOptions`, `RunConfig`, tests, and manifest config.
- Add AI CLI flags for the first milestone:
  - `--ai-filter`
  - `--ai-adapter <name>` with initial allowed value `command`
  - `--ai-command <path-or-name>` required when `--ai-adapter command` is active
  - `--ai-goal <text>` required when `--ai-filter` is set
  - `--ai-timeout-ms <n>` optional, default `30000`
- Validation rules:
  - any `--ai-*` flag without `--ai-filter` is an error
  - `--ai-command` is required for `--ai-adapter command`
  - `--ai-command` is an error for any non-`command` adapter
  - `--ai-goal` is required whenever AI filtering is enabled
- Do not add `--ai-filter-stage` in milestone 1. AI filtering means suggestion-stage filtering only. Add `--ai-filter-stage suggestion|file|both` only when file-stage support ships.
- Bump manifest schema from `version: 1` to `version: 2` for all runs, even when AI is disabled. Non-AI runs emit v2 with `config.aiFilter.enabled: false`.
- Manifest v2 adds `config.aiFilter`:
  - `enabled`
  - `stage`
  - `adapter`
  - `command`
  - `goal`
  - `timeoutMs`
  - `promptVersion`
  - `failurePolicy`

## Core Interfaces And Behavior

### Suggestion Filter Refactor

Replace the current per-suggestion contract with a batch-oriented contract.

New shape:

```ts
interface SuggestionFilter {
  readonly name: string;
  decide(context: BatchSuggestionFilterContext): Promise<SuggestionDecision[]>;
}

interface BatchSuggestionFilterContext {
  file: DiscoveredFile;
  analysis: DocumentAnalysisResult;
  suggestions: PreferenceSuggestion[];
}
```

- `run-import.ts` calls the suggestion filter once per successful analysis result.
- Passthrough suggestion filtering remains and becomes a trivial batch mapper over `suggestions`.
- File filter interface remains as-is for milestone 1.

### Command Adapter Contract

- The orchestrator spawns the subprocess named by `--ai-command`.
- Command resolution happens at invocation time, not CLI parse time. Spawn failures like `ENOENT` and `EACCES` are treated as adapter failures and surfaced clearly in manifest and terminal output.
- Suggestion-stage request shape:

```json
{
  "stage": "suggestion",
  "goal": "Only keep communication preferences",
  "file": {
    "path": "/abs/path/file.md",
    "relativePath": "file.md",
    "extension": ".md",
    "sizeBytes": 1234,
    "originalMimeType": "text/markdown",
    "uploadMimeType": "text/plain",
    "coercedToPlainText": true
  },
  "analysis": {
    "analysisId": "uuid",
    "documentSummary": "Short summary",
    "status": "success",
    "filteredCount": 1
  },
  "suggestions": [
    {
      "id": "uuid:candidate:1",
      "slug": "system.response_tone",
      "operation": "CREATE",
      "newValue": "brief",
      "confidence": 0.93,
      "sourceSnippet": "brief responses",
      "sourceMeta": { "line": 2 }
    }
  ],
  "filteredSuggestions": [
    {
      "id": "uuid:filtered:1",
      "slug": "custom.unknown",
      "filterReason": "UNKNOWN_SLUG",
      "filterDetails": "Slug is not in the catalog"
    }
  ]
}
```

- Response shape:

```json
{
  "promptVersion": "optional-string",
  "decisions": [
    {
      "suggestionId": "uuid:candidate:1",
      "action": "apply",
      "reason": "Stable communication preference",
      "score": 0.91,
      "details": "Durable personalization signal"
    }
  ]
}
```

- Strict response validation:
  - exactly one decision per input suggestion
  - no unknown suggestion IDs
  - no duplicates
  - `action` in `apply|skip`
  - non-empty `reason`
  - optional `score` in `0..1`
- Any response validation failure is treated the same as any other adapter failure.

### AI Filtering Rules

- AI filtering only narrows backend-accepted suggestions.
- Backend-filtered suggestions are included as context only; they are never revived or applied.
- `promptVersion` is adapter-reported and optional.
- `--concurrency` remains the only concurrency control in v1. It already bounds the full per-file pipeline, including adapter calls. Default `1` is the safe local-model setting.

## Checkpoints

### Checkpoint 1: CLI Cleanup And Manifest v2 Foundation

- Remove legacy filter flags from CLI, types, tests, and manifest config.
- Add AI flags, defaults, and validation rules.
- Add manifest v2 scaffolding and `config.aiFilter`.
- Keep runtime behavior unchanged when AI is off by constructing passthrough filters internally.

Verification:
- existing non-AI tests still pass after refactor
- CLI tests cover required goal, required command, adapter default, timeout default, invalid AI flag combinations, and v2 manifest config defaults

### Checkpoint 2a: Batch Suggestion Filter Refactor With No Behavior Change

- Replace the suggestion filter contract with the batch interface above.
- Update passthrough suggestion filtering to implement the new interface.
- Update `run-import.ts` to call suggestion filtering once per analysis result.
- Keep manifest contents and summary output unchanged apart from internal refactor.

Verification:
- all existing `run-import` tests still pass with unchanged behavior
- one new test confirms one suggestion-filter call per analyzed file

### Checkpoint 2b: Command Adapter And Suggestion-Stage AI Filtering

- Implement the `command` adapter using `--ai-command`, stdin/stdout JSON, and `--ai-timeout-ms`.
- Add suggestion-stage AI filtering using the adapter and goal text.
- Record per-suggestion decisions in the manifest:
  - `suggestionId`
  - `action`
  - `reason`
  - `score`
  - `details`
- Record optional adapter-reported `promptVersion`.
- Include backend-filtered suggestions in adapter input.

Failure behavior:
- dry-run:
  - record adapter failure
  - mark the run degraded
  - fall back to passthrough for that file
  - surface fallback clearly in terminal summary
- apply:
  - record adapter failure
  - mark the file failed
  - skip apply for that file
  - continue the rest of the run
- in both modes, adapter failure yields failure status and non-zero exit

Summary output changes land here:
- show AI-applied suggestion counts
- show AI-skipped suggestion counts
- show passthrough-fallback suggestion counts
- show degraded-run status clearly in terminal output

Verification:
- adapter tests cover valid response, invalid JSON, schema mismatch, timeout, non-zero exit, and bad command invocation
- runner tests cover dry-run fallback and apply skip behavior
- summary tests confirm degraded dry-runs are visibly different from normal dry-runs

### Checkpoint 3: Audit Bridge And Manifest Hardening

- Add run/file-level AI metadata to manifest v2:
  - adapter failure records
  - per-file fallback/skip state
  - promptVersion when provided
- Extend apply evidence with optional `filterAudit` for accepted suggestions:
  - `stage`
  - `adapter`
  - `goal`
  - `decision`
  - `score`
  - `reason`
- Keep `analysisId` as the bridge to backend audit `correlationId`.

Verification:
- manifest tests confirm v2 schema and AI metadata
- apply request tests confirm `filterAudit` appears only for accepted suggestions
- accepted suggestions remain traceable from manifest to backend audit via `analysisId`

### Checkpoint 4: File-Stage AI Filtering

- Add file-stage support and then introduce `--ai-filter-stage suggestion|file|both`.
- Extend file-stage context with conservative preview generation for text-like files:
  - decode as UTF-8 with replacement
  - cap preview at 8 KiB and 200 lines
  - no preview-size CLI flag in v1
- Keep file-stage AI conservative and text-first.
- For non-text-like files in file-stage mode:
  - bypass local file-stage AI
  - continue through existing discovery/analysis rules
  - record the bypass reason in the manifest
- Document known limitation: a misnamed binary text-like file may produce garbage preview text and therefore poor AI triage.

Verification:
- tests cover preview generation
- tests cover file-stage decisions and manifest records
- tests cover `both` mode sequencing
- tests confirm PDFs/images are not locally previewed in v1 but still follow backend analysis rules

### Checkpoint 5: Adapter Hardening

- Keep shipped adapter scope to `command` only.
- Harden subprocess lifecycle:
  - timeout kill path
  - stdout/stderr capture for diagnostics
  - robust JSON parse and schema validation errors
- If all of this is fully completed in Checkpoint 2b, this checkpoint can collapse into additional verification only rather than new behavior.

Verification:
- targeted adapter tests for timeout cleanup and diagnostics
- package docs and CLI help examples match actual adapter behavior

### Checkpoint 6: Docs Closeout

- Add `docs/plans/active/local-file-upload/ai-filter/implementation-summary.md`.
- Summarize:
  - shipped scope
  - final CLI contract
  - manifest v2 shape
  - command adapter contract
  - timeout and failure behavior
  - summary-output changes
  - tests run
  - known limitations, including file-stage preview limitations if that milestone shipped
- Update `docs/plans/active/local-file-upload/TODO.md`:
  - remove completed suggestion-stage AI filter follow-ups
  - leave deferred work such as extra adapters, named policies, multimodal local filtering, MCP writer migration, dedupe/resume, pacing, and auth ergonomics
- If file-stage AI does not ship in the same change, state that clearly in the implementation summary and leave the `--ai-filter-stage` follow-up in `TODO.md`.

## Test Plan

- CLI parsing:
  - legacy filter flags removed
  - `--ai-filter` requires `--ai-goal`
  - `--ai-adapter` defaults to `command`
  - `--ai-command` required for `command`
  - `--ai-timeout-ms` defaults to `30000`
  - invalid AI flag combinations fail
- Batch refactor:
  - passthrough behavior unchanged
  - one suggestion-filter call per analyzed file
- Command adapter:
  - happy path
  - invalid JSON
  - wrong schema
  - duplicate/missing decision IDs
  - non-zero exit
  - bad command invocation
  - timeout and process cleanup
  - validation failures treated as adapter failures
- Runner behavior:
  - AI decisions gate apply requests
  - dry-run fallback is visible and marks run degraded
  - apply skips failed AI files and continues
  - non-zero exit when adapter failures occur
- Manifest v2:
  - all runs emit v2
  - AI config recorded
  - suggestion decisions recorded
  - fallback and failure records recorded
  - accepted suggestions retain `analysisId` traceability
- Summary output:
  - AI accepted/skipped counts
  - fallback counts
  - degraded-run visibility
  - apply-skip counts
- File-stage follow-up:
  - preview generation for text-like files
  - `suggestion|file|both` behavior
  - non-text bypass records

## Assumptions And Defaults

- No backwards compatibility is required for the old CLI filter flags.
- First shipped adapter is `command` only.
- `--ai-command` is the only way to specify the subprocess in v1.
- Suggestion-stage AI filtering ships before file-stage filtering.
- `--ai-goal` is required whenever AI filtering is enabled.
- Initial AI timeout default is `30000ms`.
- All runs emit manifest v2 after this change, even when AI is disabled.
- AI filtering only narrows backend-accepted suggestions; it never revives backend-filtered output.
- Dry-run adapter failures use passthrough fallback but are surfaced loudly and still fail the run.
- Apply-run adapter failures skip that file’s apply step and still fail the run.
- `--concurrency` remains the only concurrency control in v1 and covers adapter calls as well as backend analysis.
