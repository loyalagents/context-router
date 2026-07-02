# Eval Harbor Framework

This folder documents the general evaluation framework under
`examples/eval-harbor`. The goal is to keep the runner, task contract, memory
arms, and scoring boundary explicit so new datasets can be added without
rewriting the harness.

## What This Framework Measures

The framework asks:

> Given the same agent, documents/events, sandbox, downstream task, output
> contract, and scorer, how does the memory substrate change task performance?

The memory substrate is the experimental variable. The current arms are:

| Arm | Memory substrate | Allowed durable memory |
| --- | --- | --- |
| `context-only` | Agent conversation context only | No external memory file or MCP memory |
| `markdown` | Naive external memory | `/app/memory.md` |
| `cr-mcp` | ContextRouter memory | Memory-only CR MCP sidecar |

The task data, staged reveal sequence, output path, verifier, model, reasoning
effort, and service tier should stay fixed across arms.

## Architecture

![Harbor staged-memory workflow](workflow.svg)

PDF export: [`workflow.pdf`](workflow.pdf)

```mermaid
flowchart LR
  Dataset["Dataset adapter<br/>DynamicMem now, other datasets later"]
  Task["Harbor task pack<br/>instruction.md<br/>task.toml<br/>stages/payload.json"]
  Stage["stage-server sidecar<br/>reveals one stage at a time"]
  Agent["Agent container<br/>context-only / markdown / cr-mcp"]
  Memory["Memory substrate<br/>context / memory.md / CR MCP"]
  Output["outputs/prediction.json"]
  Verifier["verifier<br/>deterministic smoke<br/>LLM judge when configured"]
  Report["score-summary.json<br/>reward.json<br/>artifacts"]

  Dataset --> Task
  Task --> Stage
  Stage --> Agent
  Agent <--> Memory
  Agent --> Output
  Output --> Verifier
  Verifier --> Report
```

The shared stage vocabulary lives in
`examples/eval-harbor/scripts/trajectory_framework.py`. Dataset adapters should
emit this contract, then keep dataset-specific parsing and scoring in their own
builder/verifier.

## Turn Types

The framework uses three stage kinds:

| Stage kind | Shorthand | Agent-visible input | Expected output |
| --- | --- | --- | --- |
| `memory-update` | `U` | New documents/events only | Update the allowed memory substrate; do not write a prediction |
| `downstream-task` | `T` | A downstream task only | Write `outputs/prediction.json` from retained memory |
| `update-answer` | `UA` | New documents/events plus the current downstream task | Update memory and write or update a prediction for that checkpoint |

`U` and `UA` are both useful. `UA` preserves native checkpoint benchmarks where
each checkpoint asks questions immediately. `U -> ... -> T` is stricter for
background-memory evaluation because the downstream task is hidden until later.

## Current DynamicMem Adapter

The current dataset-backed adapter migrates native DynamicMem user trajectories
into Harbor staged tasks.

DynamicMem provides:

- chronological app logs for one user;
- checkpoint task packs;
- State Completion questions, which test retained personal state;
- Personalized Service tasks, which test downstream use of that state.

The adapter preserves DynamicMem semantics and only replaces the runner:

- raw app logs become staged document/event batches;
- sanitized task packs become agent-visible downstream tasks;
- hidden expected state, reference answers, scoring points, and gold evidence
  stay under `tests/expected/`;
- the agent writes the upstream-compatible `outputs/prediction.json`.

## Supported Workflows

### Native Checkpoint Trajectory

```text
UA(cp0) -> UA(cp1) -> UA(cp2)
```

Every stage reveals new logs and the current checkpoint's DynamicMem task. Every
checkpoint is scored. Use this when matching the original DynamicMem checkpoint
style.

Generated task example:

```text
examples/eval-harbor/tasks/dynamicmem-user001-cp00-02-trajectory-v1
```

### Hidden-Final Background Memory

```text
U(cp0 logs) -> U(cp1 delta logs) -> U(cp2 delta logs) -> T(cp2 task)
```

The first stages reveal only logs. The final stage reveals the downstream task
with no raw docs. Only the final checkpoint is scored. Use this to test whether
the memory substrate preserved useful information before knowing the final task.

Generated task example:

```text
examples/eval-harbor/tasks/dynamicmem-user001-cp00-02-memory-final-v1
```

## Running The Smoke Task

Use the tiny staged smoke to verify live Harbor/Codex plumbing without running
the larger DynamicMem corpus:

```bash
pnpm eval-harbor:check
pnpm eval-harbor:bootstrap
pnpm eval-harbor:smoke
```

Expected behavior:

- Harbor starts the `stage-server` sidecar.
- The live Codex agent runs `U -> U -> U -> T`.
- The verifier reports `reward = 1.0`, `correctFields = 3`, `exceptions = 0`.

The bootstrap command installs the pinned Harbor runner into
`${HARBOR_VENV:-/tmp/cr-harbor-cli-venv}`. The smoke wrapper uses
`${HARBOR_BIN:-/tmp/cr-harbor-cli-venv/bin/harbor}` and fails before starting
Docker if Harbor is missing. Docker must be running. Codex jobs pass
`--agent-env CODEX_FORCE_AUTH_JSON=true`, so local Codex auth must be available.

Run the three comparable DynamicMem arms only when you want an actual benchmark
smoke, not just runner validation:

```bash
pnpm eval-harbor:dynamicmem
```

The default command runs all three arms sequentially and fresh. For long local
runs, use:

```bash
pnpm eval-harbor:dynamicmem:resume      # skip arms with an existing result.json
pnpm eval-harbor:dynamicmem:fast        # skip existing arms, run remaining arms in parallel
pnpm eval-harbor:dynamicmem:fresh-fast  # rerun all selected arms in parallel
```

The underlying wrapper also supports `HARBOR_MODES=markdown,cr-mcp`,
`HARBOR_SKIP_EXISTING=1`, `HARBOR_PARALLEL=1`, `HARBOR_FORCE=1`, and
`HARBOR_CODEX_SERVICE_TIER=fast`.
Skip-existing only checks for Harbor's completed `result.json`; it does not
judge whether that result has a good score.

`HARBOR_CODEX_SERVICE_TIER=fast` is a convenience alias for Codex
`service_tier=priority`. The default is standard, which passes no service-tier
override. Fast can change usage/cost, so disclose it in benchmark reports.

For official DynamicMem semantic scoring, set the variables from
`examples/eval-harbor/judge.env.example` first. Without a judge API key, the
verifier may use deterministic fallback scoring; fallback rewards are useful
for plumbing checks but are not the official semantic score.

A container-level smoke can be used when the Harbor CLI is not installed. It
should verify that:

- `/app/next_stage` reveals `U -> U -> U -> T -> done`;
- `memory-update` stages do not expose `dynamicmem-task.json`;
- the final `downstream-task` stage exposes no raw docs;
- the verifier can score an oracle prediction with reward `1.0`.

## Creating New DynamicMem Tasks

Generate one task from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --checkpoint-indices 0-2 \
  --stage-pattern update-only-then-final \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --service-tier standard \
  --agent-timeout-sec 86400 \
  --verifier-timeout-sec 86400 \
  --build-timeout-sec 600
```

Generate a suite:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_suite.py \
  --source-root /path/to/DynamicMem \
  --checkpoint-indices 0-2 \
  --stage-pattern update-only-then-final \
  --max-users 5 \
  --max-tasks 5 \
  --arms-config examples/eval-harbor/arms/dynamicmem-default.json \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --service-tier standard \
  --agent-timeout-sec 86400 \
  --verifier-timeout-sec 86400 \
  --build-timeout-sec 600 \
  --manifest examples/eval-harbor/suites/dynamicmem-memory-final-smoke.json
```

Timeouts are part of the experiment contract, not hidden local defaults. The
DynamicMem builders write these values into generated `task.toml` files, and
the suite builder records them in the suite manifest under `timeouts`.

Use `--stage-pattern update-answer-every-checkpoint` for `UA -> UA -> ...`
tasks.

Use `--stage-schedule` when a task needs an explicit interleaved trajectory.
`U` and `UA` each consume one selected checkpoint; `T` consumes no new logs and
asks the downstream task for the most recently updated checkpoint. For example,
this creates `U(checkpoint 0) -> U(checkpoint 1) -> T(checkpoint 1) ->
U(checkpoint 2) -> T(checkpoint 2)`:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --checkpoint-indices 0-2 \
  --stage-schedule U,U,T,U,T \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --service-tier standard \
  --agent-timeout-sec 86400 \
  --verifier-timeout-sec 86400 \
  --build-timeout-sec 600
```

The builder rejects schedules that start with `T`, score the same checkpoint
twice, leave the final updated checkpoint unscored, or have a different number
of `U`/`UA` tokens than selected checkpoints.

## Adding A New Dataset

To add a new dataset, create a dataset adapter instead of changing the runner.
The adapter should:

1. Load the source dataset and select a user/session/task slice.
2. Emit ordered stages using the shared stage kinds.
3. Keep hidden truth under `tests/expected/`.
4. Write a verifier that reads `outputs/prediction.json`.
5. Reuse the same arm config pattern for `context-only`, `markdown`, and
   `cr-mcp`.
6. Add a soundness report that explains what is visible, what is hidden, what is
   scored, and why the task is valid.

After generation, run:

```bash
python3 -m py_compile \
  examples/eval-harbor/scripts/trajectory_framework.py \
  examples/eval-harbor/scripts/build_dynamicmem_task.py \
  examples/eval-harbor/scripts/build_dynamicmem_suite.py \
  examples/eval-harbor/scripts/validate_task_soundness.py

python3 examples/eval-harbor/scripts/validate_task_soundness.py \
  examples/eval-harbor/tasks/<task-id>

git diff --check
```

The benchmark is only useful if the task contract is sound. Do not merge tasks
that leak hidden answers, expose downstream tasks during `U` stages, hide
required evidence, or score fields that cannot be supported by the visible data.
