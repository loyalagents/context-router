# Harbor Task Authoring Guide

Use this guide when adding new tasks under `examples/eval-harbor/tasks/`.

The standard is soundness first: a bad benchmark is worse than no benchmark.
Every task should make failures attributable to agent or memory behavior, not to
fixture drift, hidden-answer leaks, ambiguous truth, or verifier bugs.

## When To Add A Task

Add a new task when you want to change the documents, downstream objective,
answer contract, or challenge type.

Do not add a new task just to change the memory substrate. Use the same task with
different job configs or mode instructions for:

- `context-only`: current agent conversation context only, with no external memory
- `markdown`: naive local memory file
- `cr-mcp`: ContextRouter memory MCP sidecar

The task, documents, schemas, hidden expected answers, and verifier should stay
identical across these arms.

Agent model and reasoning effort are controlled variables, not local machine
defaults. DynamicMem job generation writes `agents[].model_name` and
`agents[].kwargs.reasoning_effort` into every Harbor job. Use the same values
across arms unless the experiment is explicitly a model/effort ablation, and
make sure reports show both fields.

For DynamicMem-backed suites, define arms in
`examples/eval-harbor/arms/dynamicmem-default.json` or pass another JSON file
with `--arms-config`. Do not duplicate runner logic to add an arm. A new arm
should be expressible as:

- `mode`: stable arm label used in job names and reports.
- `memoryMode`: value exposed as `EVAL_MEMORY_MODE`.
- `instructionPath`: mode-specific instruction file.
- `compose`: currently `staged` or `cr-mcp`.
- optional `mcpServers` and `artifacts` when the arm exposes an MCP sidecar.

Legacy task-aware form-fill smoke tasks may still use the older `none` label.
For background-memory tasks, prefer `context-only` so the baseline is not
mistaken for a fresh-session or no-context ablation.

## Task Types

Use a named task type in the task docs and PR description.

| Type | Purpose | Agent-visible input | Primary score |
| --- | --- | --- | --- |
| `task-aware-formfill` | Debug extraction and output scoring for a known downstream task. | Docs plus form/schema in the same stage. | Exact form output correctness. |
| `background-memory` | Test personal information management before future demand is known. | Docs/events during memory stages; downstream forms/questions only during downstream stages. | Memory quality diagnostics, plus downstream probe success. |

Prefer `background-memory` for CR-focused research tasks. Form filling can still
be included, but it should be a downstream probe that checks whether retained
memory supports a later application.

### Background-Memory Stage Contract

Background-memory tasks use two stage types that may be interleaved:

```text
T1 -> T1 -> T2 -> T1 -> T2 -> T1
```

`T1 memory-management` stages:

- reveal only the current docs/events batch;
- do not reveal future forms, field lists, expected answers, or downstream
  questions;
- allow only the selected memory substrate for durable state, for example
  `/app/memory.md` or CR MCP memory;
- should evaluate whether memory updates keep current, user-owned, durable,
  authoritative facts and ignore stale, wrong-owner, unsupported, or transient
  facts.

`T2 downstream-task` stages:

- reveal the downstream task, such as a form, question, or audit request;
- do not reveal the original docs/events unless the task explicitly tests
  re-reading;
- use retained memory as the source of truth;
- score downstream success separately from memory quality.

The task should make it possible to attribute failures to at least one of:
missing memory, wrong memory, stale memory, wrong-owner memory, unsupported
memory, downstream retrieval/use error, or output-format error.

Prefer a single Harbor agent step with staged reveal for continuous-session
background-memory tasks. The agent should reveal each stage through a task-local
tool such as `/app/next_stage`, while future stage payloads remain outside the
main `/app` workspace, usually in the `stage-server` sidecar. Use Harbor
multi-step only for a deliberate fresh-phase ablation or when the agent adapter
is known to resume the same model conversation across steps.

## Required Shape

Each task should have this shape:

```text
examples/eval-harbor/tasks/<task-id>/
  task.toml
  instruction.md
  environment/
    Dockerfile
    workspace/
      documents.json          # task-aware formfill tasks
      docs/                   # task-aware formfill tasks
      forms/                  # task-aware formfill tasks
      next_stage              # continuous background-memory tasks
  stages/
    payload.json              # continuous background-memory tasks
  tests/
    test.sh
    score_<task>.py
    expected/
      forms.json
      difficulty.json         # required for staged background-memory tasks
      soundness-report.md     # required for staged background-memory tasks
      source-trace.json      # required for migrated packet/form tasks
  solution/
    solve.sh                 # oracle solution
  mcp/
    catalog.json             # required when the cr-mcp arm needs task slugs
```

The agent-visible workspace is only `environment/workspace/`. Hidden truth must
stay under `tests/expected/`.

Continuous background-memory tasks should include a staged payload:

```text
stages/payload.json
```

The staged payload should contain ordered stage instructions and files. Only the
currently revealed stage should be materialized in `/app/current_stage`.

Harbor multi-step tasks may also include:

```text
steps/
  01-name/
    instruction.md
    workdir/
      setup.sh
      _step_documents.json
      _step_docs/
  02-final/
    instruction.md
    workdir/
      setup.sh
      _step_forms/
```

For over-time tasks that intentionally use Harbor multi-step, use step setup
scripts to reveal only the current batch. If documents should disappear before
the final task, the final step must expose forms but not previous document
files. Use `multi_step_reward_strategy = "final"` when only the final step
should determine the score. Do not use Harbor multi-step as the default
continuous-session baseline unless the selected agent adapter preserves the same
conversation.

## Authoring Workflow

1. Define the task contract.

   Write down the task type, target user, document/event set, stage sequence,
   output paths, and which facts or fields are required, unsupported, or
   intentionally unsolved.

2. Build the visible workspace.

   For task-aware form-fill tasks, put documents under
   `environment/workspace/docs/`, schemas under `environment/workspace/forms/`,
   and index every document in `environment/workspace/documents.json`.

   For continuous background-memory tasks, put only the reveal client, for
   example `/app/next_stage`, in the initial workspace. Put stage documents,
   schemas, and stage instructions in `stages/payload.json`, and mount that
   payload into a reveal sidecar. This avoids leaking future forms or later docs
   into `/app` before the task flow reaches them.
   Agent-visible schemas may call abstention-scored fields `optionalFields`
   even when hidden expected answers call them `unsupportedFields`; avoid
   exposing hidden labels that tell the agent the answer.

For external dataset-backed tasks, vendor only the task subset needed for the
benchmark. Record the source dataset, license, source user/split, and
regeneration command in the task README. Do not copy hidden answer files into
the agent-visible workspace.
For DynamicMem-backed suites, migrate native task semantics instead of inventing
random mixtures: preserve raw app-log deltas, checkpoint identity,
`state_completion_pack`, `rq3_apply_service_qa`, and the upstream prediction
contract across the selected checkpoint trajectory. Each update-and-answer stage
may expose only sanitized queries, templates, and output shape for its current
checkpoint; it must not expose reference answers, reference outputs, scoring
points, gold evidence ids, validated snapshot state, or expected snapshot state.
The suite manifest must include coverage over source users, checkpoints,
checkpoints per task, observed-log counts, state-completion keys, Personalized
Service items, and service families. Do not call a generated suite comprehensive
until the coverage block supports that claim.
Each generated task must also include a human-reviewable difficulty/soundness
report. A reviewer should be able to answer, without reading generator code:
what the agent sees in each stage, what memory-management action is expected,
what the final downstream task asks for, which fields are scored, what evidence
supports each expected state, and how the verifier awards or subtracts credit.

3. Write the instruction.

   `instruction.md` should name the working directory, document index, schemas,
   output files, and JSON output shape. Do not expose expected answers,
   source-trace files, field maps, profile truth, or verifier paths.
   For background-memory `T1` stages, also avoid exposing downstream forms,
   field lists, or future questions.

4. Write hidden expected answers.

   `tests/expected/forms.json` should include:

   ```json
   {
     "schemaVersion": 1,
     "taskId": "<task-id>",
     "forms": {
       "<form-id>": {
         "fields": {},
         "unsupportedFields": {}
       }
     }
   }
   ```

   Every required field must have clear admissible evidence in the visible
   documents. Every unsupported field should describe the expected behavior.
   If a visible schema uses `optionalFields`, its keys must match the hidden
   `unsupportedFields` keys.

5. Add source trace.

   For migrated packet/form tasks, `source-trace.json` should map each scored
   field to its evidence lineage: expected value, old fact key if applicable,
   old scenario or PDF field if applicable, and rendering rule if the value is
   transformed.

6. Implement the verifier.

   The verifier should write:

   - `/logs/verifier/reward.json`
   - `/logs/artifacts/score-summary.json`
   - copied final outputs under `/logs/artifacts/outputs/forms/`

   The summary should include reward, field accuracy, parse success, metadata
   success, missing fields, wrong fields, overfill fields, metadata errors, and
   per-form scores.

7. Add an oracle solution.

   `solution/solve.sh` should produce perfect outputs from the hidden truth
   contract. The Harbor oracle must score `1.0` before any real-agent run.

8. Add job configs.

   Add one job per arm under `examples/eval-harbor/jobs/`. The job configs may
   change mode instructions and MCP sidecars, but should not change the task
   data or verifier.

## Verifier Requirements

A verifier is sound only if it catches all of these:

- missing output file
- malformed JSON
- top-level output is not an object
- `fields` is missing or not an object
- missing required field
- wrong required value
- unknown field overfill
- nonblank unsupported field fill
- wrong or missing `schemaVersion`
- wrong or missing `taskId`
- wrong or missing `formId`

Keep `fieldAccuracy` field-only. Use `reward` as the contract-aware score that
deducts field errors, overfills, unsupported fills, and metadata errors.

## Data Soundness Checklist

Before opening or updating a PR, check:

- For task-aware tasks, `documents.json` has the same files as
  `environment/workspace/docs/`.
- For staged background-memory tasks, initial `environment/workspace/` does not
  contain future docs, future forms, hidden expected answers, or source task
  packs.
- For staged background-memory tasks, `stages/payload.json` has ordered stages,
  each stage has one instruction, and every listed file has a safe relative
  path.
- Hidden expected answers are not present in `environment/workspace/`.
- Background-memory `T1` stages do not expose downstream forms, field lists, or
  future questions.
- Every expected required value is supported by current, relevant documents.
- Transformed values are documented, for example SSN digits or date format.
- Unsupported fields have explicit expected behavior.
- `forms/*.schema.json` required fields match `tests/expected/forms.json`.
- `source-trace.json` fields match expected fields and values.
- The CR MCP catalog covers every fact slug needed by the task.
- The `context-only`, `markdown`, and `cr-mcp` jobs point at the same task
  directory for background-memory tasks.
- Multi-step tasks validate both top-level `documents.json` and every
  `steps/*/workdir/_step_documents.json` against the visible step docs.
- For over-time tasks, the final step does not expose prior document batches
  unless the task intentionally tests direct re-reading.
- External dataset tasks include source, license, subset, and regeneration
  notes, and their visible workspace contains only task inputs.
- DynamicMem native tasks preserve one upstream user trajectory per Harbor task;
  they do not chunk selected state keys or generate synthetic form schemas.
- DynamicMem native tasks expose sanitized current-checkpoint queries only; hidden
  reference answers, reference outputs, scoring points, gold evidence ids,
  validated snapshot state, and expected snapshot state stay under
  `tests/expected/`.
- The oracle run scores `1.0` reward, field accuracy, metadata success, and
  parse success.
- At least one negative verifier probe proves metadata and overfill failures are
  counted.

Useful static checks:

```bash
python3 -m py_compile \
  examples/eval-harbor/scripts/report_results.py \
  examples/eval-harbor/scripts/validate_task_soundness.py \
  examples/eval-harbor/tasks/<task-id>/tests/score_<task>.py

python3 examples/eval-harbor/scripts/validate_task_soundness.py \
  examples/eval-harbor/tasks/<task-id>

python3 - <<'PY'
import json
from pathlib import Path
for path in Path("examples/eval-harbor").rglob("*.json"):
    json.loads(path.read_text())
PY

git diff --check
```

Useful oracle check:

```bash
harbor run \
  -p examples/eval-harbor/tasks/<task-id> \
  -a oracle \
  --jobs-dir /tmp/cr-harbor-<task-id>-oracle \
  --yes
```

Required real-agent check for every new task:

```bash
for mode in context-only markdown cr-mcp; do
  harbor run \
    -c examples/eval-harbor/jobs/<task-id>-${mode}.yaml \
    --jobs-dir /tmp/cr-harbor-<task-id>-${mode} \
    --agent-env CODEX_FORCE_AUTH_JSON=true \
    --yes
done
```

For dataset-backed suites, prefer the resampling runner instead of hand-running
single samples:

```bash
python3 examples/eval-harbor/scripts/run_harbor_resamples.py \
  --manifest examples/eval-harbor/suites/<suite>.json \
  --samples 3 \
  --harbor-bin /path/to/harbor \
  --output-root /tmp/cr-harbor-<suite>

python3 examples/eval-harbor/scripts/aggregate_resamples.py \
  --root /tmp/cr-harbor-<suite> \
  --manifest examples/eval-harbor/suites/<suite>.json \
  --output /tmp/cr-harbor-<suite>-report.md \
  --json-output /tmp/cr-harbor-<suite>-report.json
```

After the three arms run, generate a report and decide whether the task is
actually difficult. A useful hard task should have:

- oracle reward `1.0`;
- all three arms using the same task data and verifier;
- no parse or metadata failures unless the task intentionally tests output
  formatting;
- lower baseline performance for a meaningful reason, not hidden-answer drift or
  brittle representation scoring;
- field-level errors that are traceable to memory gathering, memory management,
  or downstream use.

If a task is too easy or the errors are mostly scorer-format artifacts, revise
the task or verifier before calling it ready.

## Common Mistakes

- Putting `tests/expected`, old field maps, profile truth, or validation reports
  into the visible workspace.
- Changing documents separately per arm. That makes the memory comparison
  uninterpretable.
- Scoring a field whose value is not actually supported by visible documents.
- Treating unsupported fields as optional required fields instead of overfill
  traps.
- Letting the oracle pass while metadata is invalid.
- Leaving prior-step documents visible in the final step of an over-time task.
- Calling a task background-memory when downstream forms or field lists are
  visible during memory-management stages.
- Adding product backend form-fill, document-analysis, workflows, or Vertex to
  the Harbor v1 task path.
- Creating a hard task before the easy version has an oracle and verifier
  sanity check.

## Relationship To Challenge Design

Layer 1 task difficulty should come from information gathering over documents:

- admissibility / ownership
- temporal validity
- conflict / authority
- evidence sufficiency / abstention

Prefer one primary challenge per new task until the isolated failure mode is
understood. Mixed stress tests are useful later, after isolated tasks are
sound.
