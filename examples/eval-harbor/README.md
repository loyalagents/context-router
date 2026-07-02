# ContextRouter Harbor Eval

This directory contains the Harbor-based research eval harness for comparing
memory substrates under the same task, same agent model, and same scorer.

The current default research path is staged/background-memory evaluation:
documents or events arrive over time, the agent maintains memory in one
continuous session, and downstream tasks later probe whether the retained memory
is useful. Product E2E evals for backend form fill and the full product stack
remain under `examples/eval`.

## Current Arms

The experimental variable is the memory substrate:

| Arm | External memory allowed | Durable state policy |
| --- | --- | --- |
| `context-only` | None | Same continuous agent conversation only |
| `markdown` | `/app/memory.md` | Exactly one Markdown memory file |
| `cr-mcp` | ContextRouter memory MCP | MCP memory only; no scratch memory files |

Generated jobs use the same task files, model, reasoning effort, web-search
policy, timeouts, verifier, and report path across arms.

## Stage Tokens

The shared staged contract uses three tokens:

| Token | Stage kind | Reveals new docs/events? | Reveals downstream task? | Scored? |
| --- | --- | ---: | ---: | ---: |
| `U` | `memory-update` | Yes | No | No |
| `T` | `downstream-task` | No | Yes | Yes |
| `UA` | `update-answer` | Yes | Yes | Yes |

`T` is close-book: raw docs are not exposed in the downstream stage. The answer
must come from the active conversation and the arm's allowed memory substrate.

Examples:

| Workflow | Meaning |
| --- | --- |
| `U -> T` | Update memory from one checkpoint, then answer that checkpoint's task |
| `U -> T -> U -> T` | Interleaved update/probe trajectory |
| `U -> U -> T` | Hide the downstream task until after two update stages |
| `U -> U -> U -> U -> T` | Long background-memory probe |
| `UA -> UA -> UA` | Native DynamicMem checkpoint style |

For `U` and `UA`, each selected checkpoint reveals only the new delta logs since
the previous selected checkpoint. Earlier information must be retained through
conversation context, Markdown memory, or CR MCP memory.

## Prerequisites

Harbor is an external runner. Use your local Harbor CLI path if `harbor` is not
on `PATH`.

Create a judge env file for DynamicMem scoring:

```bash
cat > /tmp/dynamicmem-judge.env <<'EOF'
DYNAMICMEM_LLM_JUDGE_API_KEY=<openrouter-key>
DYNAMICMEM_LLM_JUDGE_BASE_URL=https://openrouter.ai/api/v1
DYNAMICMEM_LLM_JUDGE_MODEL=google/gemini-3.5-flash
DYNAMICMEM_JUDGE_MODE=llm
EOF
```

Do not commit API keys. The runner should pass judge values explicitly with
`--verifier-env`; relying on a generic env file alone is easy to misconfigure.

## Build A DynamicMem Suite

Use the generic dataset entrypoint. It resolves DynamicMem from
`--source-root`, `DYNAMICMEM_SOURCE_ROOT`, repo-local external checkouts, cache,
or Hugging Face download.

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

The builder runs task and job preflight by default. It also records the selected
model, reasoning effort, web-search policy, timeouts, source dataset metadata,
and generated arms in the suite manifest.

Useful schedule examples:

```bash
# user003: U(cp0) -> T(cp0) -> U(cp1) -> T(cp1)
python3 examples/eval-harbor/scripts/build_dataset_suite.py \
  --dataset dynamicmem \
  --source-users user003 \
  --checkpoint-indices 0-1 \
  --stage-schedule U,T,U,T

# user007: U(cp0) -> U(cp1) -> T(cp1)
python3 examples/eval-harbor/scripts/build_dataset_suite.py \
  --dataset dynamicmem \
  --source-users user007 \
  --checkpoint-indices 0-1 \
  --stage-schedule U,U,T

# user008: U(cp0) -> U(cp1) -> U(cp2) -> U(cp3) -> T(cp3)
python3 examples/eval-harbor/scripts/build_dataset_suite.py \
  --dataset dynamicmem \
  --source-users user008 \
  --checkpoint-indices 0-3 \
  --stage-schedule U,U,U,U,T
```

`--max-users` and `--max-tasks` are suite-size caps. They do not define the
trajectory; `--checkpoint-indices` plus `--stage-schedule` define the trajectory.

## Run And Aggregate

Run all generated arms and samples:

```bash
python3 examples/eval-harbor/scripts/run_harbor_resamples.py \
  --manifest /tmp/cr-harbor/suite.json \
  --jobs-root /tmp/cr-harbor/jobs \
  --tasks-root /tmp/cr-harbor/tasks \
  --output-root /tmp/cr-harbor/runs \
  --harbor-bin harbor \
  --samples 3 \
  --n-concurrent 3 \
  --env-file /tmp/dynamicmem-judge.env
```

The runner performs preflight before Harbor starts and post-run validation after
each sample. For DynamicMem, it also bridges judge env-file values into the
Harbor verifier and rejects missing LLM-judge metrics, metadata failures,
missing checkpoint predictions, policy failures, or data-leak failures.

Aggregate repeated samples:

```bash
python3 examples/eval-harbor/scripts/aggregate_resamples.py \
  --root /tmp/cr-harbor/runs \
  --manifest /tmp/cr-harbor/suite.json \
  --output /tmp/cr-harbor/report.md \
  --json-output /tmp/cr-harbor/report.json
```

The report summarizes reward, accuracy, state/service reward, token usage,
cost, parse failures, metadata failures, validation failures, tool-policy
failures, runtime, model, reasoning effort, web-search policy, and timeout
settings. Official experiment reports must include token usage and cost. A run
with missing `totalTokens`, `costUsd`, `llmJudge.stateCompletion.meanScore`, or
`llmJudge.personalizedService.meanScore` is incomplete and should be rerun
rather than logged as a valid datapoint.

DynamicMem metric meanings:

| Metric | Meaning |
| --- | --- |
| `reward` | Primary score. Uses the configured LLM judge when available; otherwise records deterministic fallback. Metadata failure applies a penalty. |
| `fieldAccuracy` | State-completion accuracy over expected state keys. This is the same value reported as `stateCompletion.accuracy`. |
| `stateCompletion.accuracy` | `correct state keys / expected state keys` under deterministic diagnostics. |
| `personalizedService.meanScore` | Mean score for DynamicMem personalized-service/apply items. |
| `llmJudge.stateCompletion.meanScore` | LLM-as-judge mean score over state-completion items; reported as `LLM State Mean`. |
| `llmJudge.personalizedService.meanScore` | LLM-as-judge mean score over personalized-service items; reported as `LLM Service Mean`. |
| `inputTokens`, `outputTokens`, `totalTokens` | Agent token usage recorded from Harbor/Codex artifacts. |
| `costUsd` | Estimated run cost in USD recorded from Harbor/Codex artifacts. |
| `rewardSource` | `llm-judge`, `deterministic`, or `deterministic-fallback`. |

## Validation Gates

The official checks are automatic in the builder and resample runner, but they
can also be run directly while debugging:

```bash
python3 examples/eval-harbor/scripts/validate_eval_preflight.py \
  --task /tmp/cr-harbor/tasks/<task-id> \
  --job /tmp/cr-harbor/jobs/<task-id>-context-only.yaml \
  --job /tmp/cr-harbor/jobs/<task-id>-markdown.yaml \
  --job /tmp/cr-harbor/jobs/<task-id>-cr-mcp.yaml
```

Run validation checks include:

- downstream `T` stages do not expose raw docs or `documents.json`;
- stage logs match the expected stage order;
- hidden paths such as `/tests`, `/data/stages.json`, and `stages/payload.json`
  are not accessed;
- `web_search` is disabled;
- `context-only` does not create durable memory files;
- `markdown` writes durable memory only to `/app/memory.md`;
- `cr-mcp` uses MCP memory and does not create Markdown or scratch memory.

## Directory Map

| Path | Purpose |
| --- | --- |
| `framework/` | Shared staged-memory contract and workflow diagram |
| `scripts/build_dataset_suite.py` | Generic dataset-suite entrypoint |
| `scripts/build_dynamicmem_suite.py` | DynamicMem dataset adapter |
| `scripts/trajectory_framework.py` | Stage kinds and schedule parsing |
| `scripts/run_harbor_resamples.py` | Preflight, Harbor run, post-run validation |
| `scripts/aggregate_resamples.py` | Multi-sample report aggregation |
| `scripts/validate_eval_preflight.py` | Task, job, and run policy checks |
| `modes/` | Per-arm agent instructions |
| `arms/dynamicmem-default.json` | Default arm definitions |

For creating or reviewing tasks, use [`TASK_AUTHORING.md`](TASK_AUTHORING.md).
