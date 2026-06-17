# Open-Schema Scoring Implementation Brainstorm A

- Status: implementation planning supplement
- Last updated: 2026-06-17
- Scope: first MCP open-schema eval after the known-schema MCP runner

## Summary

The open-schema eval should start small and keep the evaluation truth clear.
The first goal is not to decide whether every created slug is beautiful. The
first goal is to measure whether an agent can read the corpus, create or choose
usable memory schema, store active values, and let the existing backend
form-fill path complete the target form safely.

Recommended priority:

```text
form correctness
  -> active-memory value recovery
  -> schema diagnostics
  -> schema-quality judgment later
```

Do the scoring/artifact work before enabling live open-schema agent runs. That
keeps the evaluator stable before introducing the most variable part of the
system.

## Main Design Decisions

### 1. Open schema is not strict slug scoring

Known-schema scoring can say "this fact must be stored under one of these
accepted slugs." Open-schema scoring should not start there. A novel slug can
be useful and correct even when it does not match the accepted slug map.

The first memory score should ask:

```text
Did the expected value appear anywhere useful in active memory?
```

Accepted slugs should remain diagnostic:

- canonical slug match
- accepted alias match
- expected value under novel slug
- accepted slug present with wrong value
- conflicting values
- extra active values not mapped to target facts

### 2. Form correctness remains the headline

The final user-visible outcome is the filled form. Reuse the current form
scorer as the headline metric, including:

- correct known fields
- missing known fields
- wrong known fields
- correctly blank intentionally-missing fields
- hallucinated intentionally-missing fields
- structural overfills as diagnostics

This avoids over-investing in schema aesthetics before there are real outputs
to inspect.

### 3. Definition state must be treated as benchmark state

`resetMyMemory(MEMORY_ONLY)` clears values, not necessarily user-owned
definitions. That matters more in open schema than known schema. If previous
eval-created definitions remain visible, the next run is no longer a clean
schema-discovery run.

Pick one repeatability strategy before trusting live scores:

1. Fresh backend user per run.
   - Best isolation.
   - More operational setup.
2. Archive/delete prior eval-owned definitions before the run.
   - Good repeatability if backend APIs support it cleanly.
   - Needs careful safety guards so product definitions are not touched.
3. Keep prior definitions but record them as baseline context.
   - Easiest first smoke.
   - Good for debugging, weak as a benchmark.

For the first implementation, support a smoke mode even if schema cleanup is
not solved, but record definition baseline explicitly and label scores
accordingly.

### 4. The agent prompt should describe the task, not fixture truth

The open-schema prompt should include:

- staged corpus document paths and safe titles/categories
- user goal / scenario prompt
- form purpose, and possibly safe blank-form context
- MCP server name
- explicit instruction that the agent may create definitions and store memory
- completion marker

It should not include:

- `profile.yaml`
- manifest truth fields
- expected snapshots
- field maps
- accepted slug maps
- validation reports
- scorer output paths

If the target form is included, prefer the blank PDF or user-visible form
purpose over internal field-map truth. The eval should measure whether the
agent can create useful memory, not whether it can reverse engineer the fixture
answer key.

## Proposed Artifact Set

Keep known-schema artifacts stable. Add open-schema-specific artifacts rather
than forcing novel behavior into the existing known-schema reports.

New or updated artifacts:

- `memory-snapshot.json`
- `open-schema-database-score-report.json`
- `open-schema-combined-score-report.json`
- `mcp-agent-run.json`
- `mcp-agent-prompt.md`
- `mcp-agent-transcript.txt`
- existing `filled-form.json`
- existing `filled-form.pdf`
- existing `form-fill-response.json`
- existing `form-score-report.json`
- existing `evaluation-run.json`

`stored-preferences.json` can still be written for debugging/backward
comparison, but open-schema scoring should consume `memory-snapshot.json`.

## Memory Snapshot Shape

`memory-snapshot.json` should include active memory and visible definition
metadata in one artifact:

```json
{
  "schemaVersion": 1,
  "artifactType": "memory-snapshot",
  "runId": "mcp-open-schema-alex-i9-test-realistic-...",
  "evaluationMode": "mcp-open-schema",
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "scenarioId": "alex-i9-realistic",
  "preferences": [],
  "definitions": [],
  "suggestions": [],
  "definitionBaseline": {
    "capturedBeforeRun": true,
    "preexistingDefinitionIds": []
  },
  "diagnostics": {
    "backendUserId": "backend-user-id",
    "exportedAt": "2026-06-17T00:00:00.000Z",
    "schemaResetMode": "none|fresh-user|archive-eval-owned"
  }
}
```

Important details:

- Include all visible definitions, not only definitions referenced by active
  preferences.
- Join preferences to definitions by `definitionId` and slug where possible.
- Record owner/namespace/scope so user-owned vs catalog definitions are clear.
- Include suggestions only as diagnostics unless a later eval explicitly scores
  suggestion quality.
- Record whether definitions were preexisting or created during the run if the
  backend exposes enough metadata.

## Open-Schema Database Score

The DB score should be high precision and conservative. It is better to mark a
near match as diagnostic than to silently accept a wrong value.

Known-present classifications:

- `value_found_accepted_slug`
- `value_found_novel_slug`
- `value_found_only_suggestion`
- `value_missing`
- `accepted_slug_wrong_value`
- `conflict`

Intentionally-missing classifications:

- `missing_absent_correct`
- `missing_value_hallucinated`
- `missing_key_hallucinated`
- `missing_hallucinated`

Matching rules to keep in mind:

- Reuse existing typed normalization for dates, SSNs, phone numbers, enums, and
  arrays where possible.
- Avoid broad substring matching for short strings.
- Keep display-name/description similarity diagnostic. Do not use it as proof
  that a value is correct.
- If the same value plausibly matches multiple facts, report ambiguity instead
  of hiding it.
- Treat active values as scored. Suggested values should not count as recovered
  unless the report has an explicit suggestion-only bucket.

The summary should expose both user-goal and schema signals:

- value recovery rate
- accepted-slug recovery rate
- novel-slug recovery count
- intentionally-missing abstention rate
- hallucinated missing count
- conflict count
- novel definition count
- unused novel definition count
- unscored active preference count

## Open-Schema Combined Score

The combined report should attribute form outcomes to memory outcomes without
pretending novel slugs are wrong by default.

Useful buckets:

- `memory_found_form_correct`
- `memory_found_form_missing`
- `memory_found_form_wrong`
- `memory_missing_form_correct`
- `memory_missing_form_missing`
- `memory_missing_form_wrong`
- `missing_absent_form_absent`
- `missing_hallucinated_form_hallucinated`
- `missing_hallucinated_form_other`

`memory_missing_form_correct` is especially important. It usually means one of:

- the backend form-fill path found data outside scored active memory;
- the value matcher missed a valid normalization variant;
- the filled-form artifact was produced from different state than the memory
  snapshot;
- the form scorer expectation is wrong.

That bucket should be treated as a debugging signal, not a quiet success.

## Runner Flow

Add open-schema mode to the existing MCP runner only after the artifact/scorer
work exists.

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

Target stages:

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

Runner behavior:

- Do not call known-schema definition setup.
- Reset active memory values when requested.
- Record what definition cleanup/isolation strategy was used.
- Fail fast if MCP tools are unavailable or the completion marker is missing.
- Continue to write partial `evaluation-run.json` after each stage.
- Mark setup/schema-reset limitations clearly in artifacts.

## Suggested Implementation Checkpoints

### Checkpoint 1: Memory Snapshot Export

Add `memory-snapshot.json` export and schema validation.

Tests:

- artifact schema validation
- mapper joins preferences to definitions
- definitions with no active preferences are preserved
- active preferences with missing definition metadata are diagnostic
- token redaction still works

Stop point:

- A static backend export can write a valid memory snapshot.

### Checkpoint 2: Open-Schema DB Scorer

Add `open-schema-database-score-report.json` from `memory-snapshot.json`.

Tests:

- expected value found under accepted slug
- expected value found under novel slug
- expected value missing
- accepted slug wrong value
- conflict
- intentionally missing value absent
- intentionally missing value hallucinated
- suggestion-only recovery bucket
- ambiguous matching remains diagnostic

Stop point:

- A fixture memory snapshot can produce a stable DB report without running an
  agent.

### Checkpoint 3: Open-Schema Combined Report

Add open-schema combined attribution from DB report plus existing form score.

Tests:

- memory found + form correct
- memory found + form missing
- memory missing + form correct
- missing absent + form absent
- missing hallucinated + form hallucinated

Stop point:

- Static memory/form artifacts produce an attribution report.

### Checkpoint 4: Open-Schema Prompt And Runner Mode

Enable `--schema-mode open` in `eval:e2e-mcp-agent`.

Tests:

- reserved mode error is removed only for supported open mode
- known-schema setup is skipped
- open-schema setup records definition baseline
- prompt excludes hidden truth files and accepted slug maps
- prompt permits definition creation and preference writes
- partial failures skip later open-schema stages correctly

Stop point:

- Fake command-agent run completes all open-schema stages.

### Checkpoint 5: Live Smoke

Run one live Claude MCP smoke and compare artifacts manually.

Questions to answer:

- Did the agent create definitions or reuse existing visible definitions?
- Were expected values recovered anywhere in active memory?
- Did backend form fill improve, degrade, or skip more fields?
- Were missing facts hallucinated?
- Did prior definitions affect the run?

Stop point:

- A live smoke is documented as smoke-only or benchmark-usable depending on
  identity and schema isolation.

## Things To Avoid Initially

- Do not make schema-quality review a headline metric before reviewing real
  outputs.
- Do not hide form-fill mistakes by rewriting memory or auto-correcting source
  choices during scoring.
- Do not use LLM judgment inside deterministic score reports.
- Do not compare open-schema DB scores directly to known-schema strict slug
  scores.
- Do not treat prior user definitions as harmless. They are part of the schema
  surface the agent sees.
- Do not expose accepted slug maps or expected snapshots in the agent
  workspace.

## Open Questions

- Is a fresh backend user per live run practical, or should the runner implement
  guarded eval-owned definition cleanup?
- Should the first prompt include the blank target PDF, a safe field-label
  summary, or only the form purpose?
- Should global/core definitions count as accepted existing schema in open
  mode, or should they be diagnostics separate from agent-created definitions?
- Can the backend export created/updated timestamps for definitions and
  preferences so run-created objects are easy to identify?
- How strict should missing-fact hallucination be for novel schema, especially
  for broad categories like phone numbers and emails?

## Recommended Next Step

Start with `memory-snapshot.json` and the open-schema DB scorer. That is the
smallest durable foundation: it gives every future open-schema producer a
stable artifact boundary and makes live MCP runs debuggable before we tune the
agent prompt or schema-quality rubric.
