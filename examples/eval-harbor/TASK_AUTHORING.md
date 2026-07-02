# Harbor Task Authoring

Soundness comes first. A task is useful only if all arms see the same evidence,
the downstream answer is verifiable, and failures can be attributed to memory
management rather than leaked data or different task inputs.

## What A Task Should Test

Current tasks should focus on background information management:

1. New documents or events arrive over time.
2. The agent updates memory without necessarily knowing the future task.
3. A downstream `T` stage later asks for an answer from retained memory.
4. The same task, scorer, model, and settings run across `context-only`,
   `markdown`, and `cr-mcp`.

Form filling can be a downstream probe, but it should not be the only task type.
State-completion, profile reconstruction, preference lookup, and other
close-book downstream probes are valid if they have hidden ground truth.

## Stage Schedules

Use the shared tokens:

| Token | Meaning |
| --- | --- |
| `U` | Update memory from new docs/events; no score |
| `T` | Answer a downstream task from retained memory; scored |
| `UA` | Update memory and answer at the same checkpoint; scored |

Common schedules:

| Goal | CLI settings |
| --- | --- |
| One checkpoint smoke test | `--checkpoint-indices 0 --stage-schedule U,T` |
| Interleaved probes | `--checkpoint-indices 0-1 --stage-schedule U,T,U,T` |
| Hidden final task | `--checkpoint-indices 0-1 --stage-schedule U,U,T` |
| Long background memory | `--checkpoint-indices 0-3 --stage-schedule U,U,U,U,T` |
| Native DynamicMem style | `--stage-pattern update-answer-every-checkpoint` |

`U` and `UA` consume selected checkpoints. `T` consumes no new checkpoint; it
asks the downstream task for the most recently updated checkpoint.

## DynamicMem Task Creation

Use the generic builder so future datasets can share the same interface:

```bash
python3 examples/eval-harbor/scripts/build_dataset_suite.py \
  --dataset dynamicmem \
  --source-users user008 \
  --checkpoint-indices 0 \
  --stage-schedule U,T \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --codex-web-search disabled \
  --tasks-root /tmp/cr-harbor/tasks \
  --jobs-root /tmp/cr-harbor/jobs \
  --manifest /tmp/cr-harbor/suite.json
```

Source resolution order:

1. `--source-root`;
2. `DYNAMICMEM_SOURCE_ROOT`;
3. repo-local external dataset checkouts;
4. local dataset cache;
5. Hugging Face download, unless `--no-download` is set.

`--max-users` and `--max-tasks` cap suite size only. Prefer
`--source-users`, `--checkpoint-indices`, and `--stage-schedule` for exact task
selection.

## Difficulty Selection

Prefer tasks that can plausibly separate memory substrates:

- many logs or long event histories;
- many state keys;
- multiple checkpoints with real updates over time;
- diverse service families rather than one repeated app;
- hidden final task, especially `U -> U -> ... -> T`;
- stale, updated, conflicting, ambiguous, or ownership-sensitive facts;
- downstream answers that require retained state, not a visible final clue.

Avoid tasks where all answers are obvious from the final visible file or where
the verifier accepts vague summaries.

## Required Soundness Checks

Before running expensive live agents, confirm:

- generated stage events reconstruct the original source logs;
- `T` stages do not expose docs or `documents.json`;
- hidden expected data stays under `tests/expected`;
- no hidden paths are mentioned in visible instructions;
- jobs set `web_search: disabled`;
- jobs set `model_auto_compact_token_limit`;
- the same task id has jobs for `context-only`, `markdown`, and `cr-mcp`;
- the `cr-mcp` catalog covers the state keys needed by the task;
- the verifier can score an output and writes `score-summary.json`.

The builder runs these checks automatically. Direct debugging command:

```bash
python3 examples/eval-harbor/scripts/validate_eval_preflight.py \
  --task /tmp/cr-harbor/tasks/<task-id> \
  --job /tmp/cr-harbor/jobs/<task-id>-context-only.yaml \
  --job /tmp/cr-harbor/jobs/<task-id>-markdown.yaml \
  --job /tmp/cr-harbor/jobs/<task-id>-cr-mcp.yaml
```

After every live run, post-run validation must also pass:

- `context-only` created no durable memory files;
- `markdown` used only `/app/memory.md` for durable memory;
- `cr-mcp` used MCP memory and did not create Markdown/scratch memory;
- hidden files such as `/tests`, `/data/stages.json`, and
  `stages/payload.json` were not read;
- `web_search` was not called;
- stage order matched the task contract.

## Minimal Live Eval Loop

1. Build the suite.
2. Run all arms and samples.
3. Aggregate the report.
4. Inspect validation failures before interpreting rewards.

```bash
python3 examples/eval-harbor/scripts/run_harbor_resamples.py \
  --manifest /tmp/cr-harbor/suite.json \
  --jobs-root /tmp/cr-harbor/jobs \
  --tasks-root /tmp/cr-harbor/tasks \
  --output-root /tmp/cr-harbor/runs \
  --harbor-bin harbor \
  --samples 3 \
  --n-concurrent 3 \
  --env-file /tmp/dynamicmem-judge.env \
  --verifier-env 'DYNAMICMEM_LLM_JUDGE_API_KEY=${DYNAMICMEM_LLM_JUDGE_API_KEY}' \
  --verifier-env 'DYNAMICMEM_LLM_JUDGE_BASE_URL=${DYNAMICMEM_LLM_JUDGE_BASE_URL}' \
  --verifier-env 'DYNAMICMEM_LLM_JUDGE_MODEL=${DYNAMICMEM_LLM_JUDGE_MODEL}' \
  --verifier-env 'DYNAMICMEM_JUDGE_MODE=${DYNAMICMEM_JUDGE_MODE}'

python3 examples/eval-harbor/scripts/aggregate_resamples.py \
  --root /tmp/cr-harbor/runs \
  --manifest /tmp/cr-harbor/suite.json \
  --output /tmp/cr-harbor/report.md \
  --json-output /tmp/cr-harbor/report.json
```

## Experiment Report Template

Every experiment should record:

| Field | What to write |
| --- | --- |
| Dataset/tasks | Dataset name, task ids, source users, checkpoints, schedule |
| Settings | Model, reasoning effort, web-search policy, timeout settings, judge model |
| Runs | Arms, sample count, concurrency, failures/retries |
| Metrics | Mean/std/min/max reward, accuracy, state reward, service reward |
| Validation | Preflight status, post-run policy failures, parse/metadata failures |
| Interpretation | What failed, whether failures are memory-related, limitations |

Do not compare arms if the task, visible evidence, model, scorer, or validation
status differs between arms.

## Adding Another Dataset

Add a dataset adapter rather than a new runner. The adapter should emit the
same staged contract, reuse `trajectory_framework.py`, and plug into
`build_dataset_suite.py --dataset <name>`.

New adapters must provide:

- source resolution;
- task planning and deterministic selection;
- staged payload generation;
- hidden expected data;
- verifier/scorer;
- jobs for all configured arms;
- suite manifest metadata;
- preflight compatibility.

Keep adapter-specific complexity inside the adapter. The Harbor runner,
resampler, validator, and aggregator should stay dataset-agnostic.
