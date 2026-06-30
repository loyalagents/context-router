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

- `none`: agent context only
- `markdown`: naive local memory file
- `cr-mcp`: ContextRouter memory MCP sidecar

The task, documents, schemas, hidden expected answers, and verifier should stay
identical across these arms.

## Required Shape

Each task should have this shape:

```text
examples/eval-harbor/tasks/<task-id>/
  task.toml
  instruction.md
  environment/
    Dockerfile
    workspace/
      documents.json
      docs/
      forms/
  tests/
    test.sh
    score_<task>.py
    expected/
      forms.json
      source-trace.json      # required for migrated packet/form tasks
  solution/
    solve.sh                 # oracle solution
  mcp/
    catalog.json             # required when the cr-mcp arm needs task slugs
```

The agent-visible workspace is only `environment/workspace/`. Hidden truth must
stay under `tests/expected/`.

Multi-step tasks may also include:

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

For over-time tasks, use step setup scripts to reveal only the current batch.
If documents should disappear before the final task, the final step must expose
forms but not previous document files. Use `multi_step_reward_strategy = "final"`
when only the final step should determine the score.

## Authoring Workflow

1. Define the task contract.

   Write down the target user, document set, forms to fill, output paths, and
   which fields are required, unsupported, or intentionally unsolved.

2. Build the visible workspace.

   Put documents under `environment/workspace/docs/`, schemas under
   `environment/workspace/forms/`, and index every document in
   `environment/workspace/documents.json`.
   Agent-visible schemas may call abstention-scored fields `optionalFields`
   even when hidden expected answers call them `unsupportedFields`; avoid
   exposing hidden labels that tell the agent the answer.

3. Write the instruction.

   `instruction.md` should name the working directory, document index, schemas,
   output files, and JSON output shape. Do not expose expected answers,
   source-trace files, field maps, profile truth, or verifier paths.

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

- `documents.json` has the same files as `environment/workspace/docs/`.
- Hidden expected answers are not present in `environment/workspace/`.
- Every expected required value is supported by current, relevant documents.
- Transformed values are documented, for example SSN digits or date format.
- Unsupported fields have explicit expected behavior.
- `forms/*.schema.json` required fields match `tests/expected/forms.json`.
- `source-trace.json` fields match expected fields and values.
- The CR MCP catalog covers every fact slug needed by the task.
- The `none`, `markdown`, and `cr-mcp` jobs point at the same task directory.
- Multi-step tasks validate both top-level `documents.json` and every
  `steps/*/workdir/_step_documents.json` against the visible step docs.
- For over-time tasks, the final step does not expose prior document batches
  unless the task intentionally tests direct re-reading.
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
