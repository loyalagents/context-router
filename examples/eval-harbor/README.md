# Harbor Eval Harness

This directory contains Harbor-native eval tasks for clean CR-vs-baseline
experiments. It is separate from `examples/eval`, which remains the product E2E
evaluation suite.

For creating new tasks, use [`TASK_AUTHORING.md`](TASK_AUTHORING.md). The README
is the runbook for executing tasks; the authoring guide is the soundness
checklist for adding task data, hidden truth, verifiers, and job configs.
For the general staged-memory framework contract, see
[`framework/README.md`](framework/README.md).

The Harbor CLI is an external runner dependency, not a binary checked into this
repo. Install it with Python 3.12+ before running jobs, or call an explicit
venv path such as `/tmp/cr-harbor-cli-venv/bin/harbor`.

## Task Families

Harbor is the evaluation runner. The task contract determines what research
question we are measuring. Keep these task families explicit:

| Family | Agent-visible input | Primary question | Main score |
| --- | --- | --- | --- |
| `task-aware-formfill` | Docs and form/schema are visible in the same task. | Can the agent extract the fields needed for a known downstream form? | Exact form output correctness. |
| `background-memory` | Docs/events arrive before future downstream tasks are visible. | Can the agent manage personal information over time? | Memory quality, plus downstream probe success. |

The current migrated packet tasks are mostly `task-aware-formfill`. They are
useful for harness debugging and clean form-output scoring. CR's stronger
research target is `background-memory`: the agent should decide what personal
facts are durable, current, user-owned, authoritative, uncertain, or stale
before knowing which downstream form or question will be asked.

A realistic background-memory flow should support interleaved stages:

```text
U -> U -> T -> U -> T -> U
```

- `U memory-update`: the agent sees new docs/events and updates the
  allowed memory substrate only.
- `T downstream-task`: the agent uses retained memory to answer a form,
  question, or audit task without re-reading the original docs.

Score memory quality after memory-management stages and score downstream task
success after downstream stages. Form filling is a downstream probe, not the
primary challenge.

## Smoke Task

Run the first deterministic task with Harbor's oracle agent:

```bash
harbor run -p examples/eval-harbor/tasks/smoke-formfill -a oracle
```

Expected output:

- the agent writes `/app/outputs/forms/new-hire.json`
- the verifier writes `/logs/verifier/reward.json`
- the verifier writes `/logs/artifacts/score-summary.json`

The smoke task is mainly a harness sanity check. Use the Maya packet task below
for the first meaningful CR-vs-baseline comparison.

## Codex Modes

Set Codex auth before running real-agent jobs. Harbor's Codex integration can
read `OPENAI_API_KEY`, or it can use the local Codex `auth.json`. Prefer passing
the auth-json switch explicitly with `--agent-env CODEX_FORCE_AUTH_JSON=true`
when running `harbor run`. The default Codex job configs use
`gpt-5.3-codex-spark`.

Codex reasoning effort is an explicit eval parameter. DynamicMem-generated jobs
write it into Harbor's Codex agent kwargs as `reasoning_effort`, which Harbor
passes to Codex as `model_reasoning_effort`. The default is `high`; pass
`--reasoning-effort low|medium|high|xhigh` when generating DynamicMem tasks or
suites to change it intentionally.

Run the no-memory baseline:

```bash
harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-none.yaml \
  --agent-env CODEX_FORCE_AUTH_JSON=true \
  --yes
```

Run the markdown-memory baseline:

```bash
harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-markdown.yaml \
  --agent-env CODEX_FORCE_AUTH_JSON=true \
  --yes
```

Run the CR MCP memory arm:

```bash
harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-cr-mcp.yaml \
  --agent-env CODEX_FORCE_AUTH_JSON=true \
  --yes
```

The CR MCP arm uses an eval-only FastMCP sidecar with only
`listPreferenceSlugs`, `searchPreferences`, and `mutatePreferences`. It does
not invoke product backend form-fill, document-analysis, workflows, or Vertex.
Reviewable artifacts include MCP config, tool-call trace, server log, CR memory
snapshot, final form output, and score summary.

## Compare Modes

Run the smoke-task three modes into stable job roots:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-none.yaml \
  --jobs-dir /tmp/cr-harbor-none \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-markdown.yaml \
  --jobs-dir /tmp/cr-harbor-markdown \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-cr-mcp.yaml \
  --jobs-dir /tmp/cr-harbor-cr-mcp \
  --yes
```

Create a comparison report:

```bash
python3 examples/eval-harbor/scripts/report_results.py \
  --run none=/tmp/cr-harbor-none/eval-harbor-smoke-formfill-none \
  --run markdown=/tmp/cr-harbor-markdown/eval-harbor-smoke-formfill-markdown \
  --run cr-mcp=/tmp/cr-harbor-cr-mcp/eval-harbor-smoke-formfill-cr-mcp \
  --output /tmp/cr-harbor-report.md \
  --json-output /tmp/cr-harbor-report.json
```

The report table includes agent, model, reasoning effort, reward, field
accuracy, parse failures, metadata failures, missing/wrong/overfill counts,
runtime, and artifact roots.
The command exits nonzero if required score or output artifacts are missing or
malformed. Use `--allow-invalid` only when intentionally reviewing a broken run.

## Scoring Contract

The verifier treats the output JSON as a form-fill artifact with a strict
top-level contract:

```json
{
  "schemaVersion": 1,
  "taskId": "...",
  "formId": "...",
  "fields": {},
  "abstentions": {},
  "notes": []
}
```

Scoring separates field quality from output-contract quality:

- `fieldAccuracy`: required-field value accuracy only.
- `metadataSuccess`: whether `schemaVersion`, `taskId`, and `formId` match the
  hidden expected contract for each form.
- `reward`: contract-aware score. It deducts wrong or missing required fields,
  nonblank unsupported fields, unknown overfilled fields, and metadata errors.

This means a run can have `fieldAccuracy = 1.0` but `reward < 1.0` if it fills
the right fields in an invalid JSON contract.

## Maya Packet-Medium Task

The first migrated packet task is:

```text
examples/eval-harbor/tasks/maya-packet-medium-formfill
```

It reuses the existing Maya `packet-medium` documents and asks the agent to fill
three local JSON forms in one Harbor run:

- `outputs/forms/i-9.json`
- `outputs/forms/fw4.json`
- `outputs/forms/direct-deposit-sf1199a-24.json`

The hidden expected forms are derived from the old Maya profile and field maps.
`tests/expected/source-trace.json` records the old scenario, field map,
`fieldIndex`, PDF field name, and fact key for each scored JSON field.

Run the no-memory baseline:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-none.yaml \
  --yes
```

Run the markdown-memory baseline:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-markdown.yaml \
  --yes
```

Run the CR MCP memory arm:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-cr-mcp.yaml \
  --yes
```

The CR MCP arm mounts a task-specific catalog into the eval-only memory sidecar.
It still avoids product backend form-fill, document-analysis, workflows, and
Vertex.

For a deterministic verifier sanity check, run the oracle:

```bash
harbor run \
  -p examples/eval-harbor/tasks/maya-packet-medium-formfill \
  -a oracle \
  --jobs-dir /tmp/cr-harbor-maya-oracle \
  --yes
```

For reviewable real-agent runs, use stable job roots:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-none.yaml \
  --jobs-dir /tmp/cr-harbor-maya-none \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-markdown.yaml \
  --jobs-dir /tmp/cr-harbor-maya-markdown \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-packet-medium-cr-mcp.yaml \
  --jobs-dir /tmp/cr-harbor-maya-cr-mcp \
  --yes
```

Create a Maya packet comparison report:

```bash
python3 examples/eval-harbor/scripts/report_results.py \
  --run none=/tmp/cr-harbor-maya-none/eval-harbor-maya-packet-medium-none \
  --run markdown=/tmp/cr-harbor-maya-markdown/eval-harbor-maya-packet-medium-markdown \
  --run cr-mcp=/tmp/cr-harbor-maya-cr-mcp/eval-harbor-maya-packet-medium-cr-mcp \
  --output /tmp/cr-harbor-maya-report.md \
  --json-output /tmp/cr-harbor-maya-report.json
```

Each trial artifact root should contain:

- `artifacts/logs/artifacts/score-summary.json`
- `artifacts/logs/artifacts/outputs/forms/*.json`
- `artifacts/app/outputs/forms/*.json`
- `artifacts/memory/cr-snapshot.json` for the `cr-mcp` arm
- `artifacts/mcp/tool-calls.jsonl` for the `cr-mcp` arm

## Maya Hard Packet Tasks

The first hard Harbor packet tasks keep the same Maya forms, schemas, verifier,
and hidden expected answers as `maya-packet-medium-formfill`. Only the visible
packet documents change, so failures are attributable to agent document
gathering, memory behavior, or field-value normalization rather than verifier
drift.

| Task | Source corpus | Primary pressure | Docs |
| --- | --- | --- | ---: |
| `maya-packet-hard-ownership-v1-formfill` | `packet-hard-ownership-v1` plus 3 Harbor adversarial docs | ownership/admissibility traps with nearby people and same-employer decoys | 38 |
| `maya-packet-hard-conflict-v1-formfill` | `packet-hard-conflict-v1` plus 3 Harbor adversarial docs | conflict plus temporal validity, including stale/draft/lower-authority records | 38 |
| `maya-packet-hard-required-v4-formfill` | `packet-hard-required-v4` plus 3 Harbor adversarial docs | evidence sufficiency through multi-hop code, directory lookups, and deprecated lookup traps | 41 |
| `maya-packet-hard-volume-v2-formfill` | `packet-hard-volume-v2` | long-context mixed stress with 100 operational near-miss documents | 100 |
| `maya-packet-hard-sufficiency-v1-formfill` | `packet-hard-required-v4` plus 5 Harbor sufficiency/abstention docs | optional-field evidence sufficiency with missing, ambiguous, rejected, and wrong-owner values | 46 |
| `maya-packet-hard-over-time-v1-formfill` | `packet-hard-over-time-v1` split into 3 sequential batches | over-time memory pressure with documents hidden before final fill and durable state required for downstream fill | 46 |

Run any hard task through the three comparable arms by replacing
`<corpus>` with one of `packet-hard-ownership-v1`, `packet-hard-conflict-v1`,
`packet-hard-required-v4`, `packet-hard-volume-v2`, or
`packet-hard-sufficiency-v1`:

```bash
harbor run \
  -p examples/eval-harbor/tasks/maya-<corpus>-formfill \
  -a oracle \
  --jobs-dir /tmp/cr-harbor-maya-<corpus>-oracle \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-<corpus>-none.yaml \
  --jobs-dir /tmp/cr-harbor-maya-<corpus>-none \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-<corpus>-markdown.yaml \
  --jobs-dir /tmp/cr-harbor-maya-<corpus>-markdown \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/maya-<corpus>-cr-mcp.yaml \
  --jobs-dir /tmp/cr-harbor-maya-<corpus>-cr-mcp \
  --yes
```

Create a hard-task comparison report:

```bash
python3 examples/eval-harbor/scripts/report_results.py \
  --run none=/tmp/cr-harbor-maya-<corpus>-none/eval-harbor-maya-<corpus>-none \
  --run markdown=/tmp/cr-harbor-maya-<corpus>-markdown/eval-harbor-maya-<corpus>-markdown \
  --run cr-mcp=/tmp/cr-harbor-maya-<corpus>-cr-mcp/eval-harbor-maya-<corpus>-cr-mcp \
  --output /tmp/cr-harbor-maya-<corpus>-report.md \
  --json-output /tmp/cr-harbor-maya-<corpus>-report.json
```

### Over-Time Memory-Pressure Task

`maya-packet-hard-over-time-v1-formfill` is a multi-step Harbor task. The agent
receives three document batches over time, then the final step removes the
documents and asks for four JSON forms:

- I-9
- W-4
- direct deposit
- onboarding audit

The `none` arm has no durable state between steps. The `markdown` arm may only
use `/app/memory.md`. The `cr-mcp` arm uses the eval-only ContextRouter memory
MCP sidecar.

This is a legacy memory-pressure/debug task, not the official continuous-session
baseline contract. For new background-memory tasks, use staged reveal with
`context-only`, `markdown`, and `cr-mcp`.

Run all three arms:

```bash
for mode in none markdown cr-mcp; do
  CODEX_FORCE_AUTH_JSON=1 harbor run \
    -c examples/eval-harbor/jobs/maya-packet-hard-over-time-v1-${mode}.yaml \
    --jobs-dir /tmp/cr-harbor-maya-packet-hard-over-time-v1-${mode} \
    --yes
done
```

Create the comparison report:

```bash
python3 examples/eval-harbor/scripts/report_results.py \
  --run none=/tmp/cr-harbor-maya-packet-hard-over-time-v1-none/eval-harbor-maya-packet-hard-over-time-v1-none \
  --run markdown=/tmp/cr-harbor-maya-packet-hard-over-time-v1-markdown/eval-harbor-maya-packet-hard-over-time-v1-markdown \
  --run cr-mcp=/tmp/cr-harbor-maya-packet-hard-over-time-v1-cr-mcp/eval-harbor-maya-packet-hard-over-time-v1-cr-mcp \
  --output /tmp/cr-harbor-maya-packet-hard-over-time-v1-report.md \
  --json-output /tmp/cr-harbor-maya-packet-hard-over-time-v1-report.json
```

Latest local sanity run:

| Mode | Model | Reward | Missing | Wrong |
| --- | --- | ---: | ---: | ---: |
| `none` | `gpt-5.3-codex-spark` | 0.000 | 37 | 0 |
| `markdown` | `gpt-5.3-codex-spark` | 0.946 | 0 | 2 |
| `cr-mcp` | `gpt-5.3-codex-spark` | 0.946 | 0 | 2 |

The oracle scores 1.000, so the hidden expected forms and verifier are
self-consistent. The markdown number is from a no-budget rerun of the markdown
arm. This task separates no-memory from durable-memory behavior, but it does not
currently separate markdown memory from CR MCP memory. In this run, markdown and
`cr-mcp` both missed two fields, with different error patterns.

This task has a `U -> U -> U -> T` shape. It is a bridge toward
background-memory evaluation, but the next research-focused task should be an
interleaved background-memory task with multiple memory update and downstream
use cycles.

## DynamicMem Native Checkpoint-Trajectory Task

`dynamicmem-user001-cp00-04-trajectory-v1` is the first dataset-backed
personal-memory task that preserves the native DynamicMem task contract across a
continuous checkpoint trajectory. It is generated from the public
[`xiewenya/dynamicmem`](https://huggingface.co/datasets/xiewenya/dynamicmem)
dataset, which is published under the MIT license.

Harbor only replaces the runner. The task preserves one DynamicMem user
trajectory end to end:

- raw `app_log_large.json` entries as chronological checkpoint deltas;
- each selected checkpoint's `state_completion_pack`;
- each selected checkpoint's `rq3_apply_service_qa` Personalized Service tasks;
- the upstream prediction contract at `outputs/prediction.json`.

It is a `background-memory` task:

```text
UA(cp0) -> UA(cp1) -> UA(cp2) -> UA(cp3) -> UA(cp4)
```

The DynamicMem adapter supports two stage contracts:

| Stage pattern | Flow | Use |
| --- | --- | --- |
| `update-answer-every-checkpoint` | `UA(cp0) -> UA(cp1) -> ...` | Native DynamicMem checkpoint trajectory. Every checkpoint reveals logs plus the current task and is scored. |
| `update-only-then-final` | `U(cp0) -> U(cp1) -> ... -> T(final)` | Stronger background-memory probe. Earlier stages reveal only logs; the final downstream task is hidden until the last stage and is scored alone. |

The task runs as one continuous Codex session. The agent reveals each stage by
running `/app/next_stage`; future stage files are held by the `stage-server`
sidecar and are not present in `/app` until revealed. Each stage reveals only
the new raw app-log delta and the current checkpoint's native task pack. The
agent updates memory, then answers both native task families for that checkpoint:
State Completion (`snapshot_state`) and Personalized Service
(`rq3_apply_answers`). The final `outputs/prediction.json` keeps predictions for
all revealed checkpoints.

The `context-only` arm has no external durable memory but can use the live
conversation context from earlier stages. The `markdown` arm may only use
`/app/memory.md`, and the `cr-mcp` arm uses the eval-only ContextRouter memory
MCP sidecar.

DynamicMem is a multi-file staged task: each checkpoint exposes
`current_stage/documents.json`, many `current_stage/docs/events/*.json` raw
app-log files, and one `current_stage/dynamicmem-task.json`. It is not a
heterogeneous packet-file benchmark. It covers app/API/event-source diversity,
but it does not replace packet-style tasks with mixed PDFs, OCR text, YAML,
emails, templates, folder hierarchy traps, and wrong-person documents.

For a shorter live-agent smoke before the full five-checkpoint run, use the
committed three-turn fixture:

```text
dynamicmem-user001-cp00-02-trajectory-v1
```

It preserves the same native DynamicMem contract but uses only checkpoints
`0,1,2`. Its suite manifest is:

```text
examples/eval-harbor/suites/dynamicmem-three-turn-smoke.json
```

For the stricter retained-memory smoke, use:

```text
dynamicmem-user001-cp00-02-memory-final-v1
```

It has a `U -> U -> U -> T` shape. The first three stages expose only raw log
deltas; the fourth stage exposes the final DynamicMem task with no raw docs.
Only the final checkpoint is scored. Its suite manifest is:

```text
examples/eval-harbor/suites/dynamicmem-memory-final-smoke.json
```

Regenerate the task from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --checkpoint-indices 0-4 \
  --stage-pattern update-answer-every-checkpoint \
  --model gpt-5.4-mini \
  --reasoning-effort high
```

Regenerate the three-turn smoke suite:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_suite.py \
  --source-root /path/to/DynamicMem \
  --checkpoint-indices 0-2 \
  --stage-pattern update-answer-every-checkpoint \
  --max-users 1 \
  --max-tasks 1 \
  --arms-config examples/eval-harbor/arms/dynamicmem-default.json \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --manifest examples/eval-harbor/suites/dynamicmem-three-turn-smoke.json
```

Run all three arms:

```bash
for mode in context-only markdown cr-mcp; do
  harbor run \
    -c examples/eval-harbor/jobs/dynamicmem-user001-cp00-04-trajectory-v1-${mode}.yaml \
    --jobs-dir /tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-${mode} \
    --agent-env CODEX_FORCE_AUTH_JSON=true \
    --yes
done
```

Create the comparison report:

```bash
python3 examples/eval-harbor/scripts/report_results.py \
  --run context-only=/tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-context-only/eval-harbor-dynamicmem-user001-cp00-04-trajectory-v1-context-only \
  --run markdown=/tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-markdown/eval-harbor-dynamicmem-user001-cp00-04-trajectory-v1-markdown \
  --run cr-mcp=/tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-cr-mcp/eval-harbor-dynamicmem-user001-cp00-04-trajectory-v1-cr-mcp \
  --output /tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-report.md \
  --json-output /tmp/cr-harbor-dynamicmem-user001-cp00-04-trajectory-v1-report.json
```

The Harbor verifier uses an LLM-as-judge semantic score for DynamicMem when a
judge API key is available. The generated tasks default to OpenRouter
`google/gemini-3.5-flash`:

```bash
export DYNAMICMEM_LLM_JUDGE_API_KEY="<openrouter-key>"
export DYNAMICMEM_LLM_JUDGE_BASE_URL="https://openrouter.ai/api/v1"
export DYNAMICMEM_LLM_JUDGE_MODEL="google/gemini-3.5-flash"
```

The score summary records `rewardSource`, `llmJudge`, and `deterministic`
diagnostic metrics. If no judge key is available, the verifier falls back to
the deterministic local proxy so oracle and smoke checks still run, but those
fallback rewards should not be treated as the official DynamicMem semantic
score.

### DynamicMem Suite Generation

Use the suite generator when scaling beyond the single `user001` task. It scans
DynamicMem user directories, maps each selected user's checkpoint sequence to one
Harbor trajectory task, and writes matching
`context-only`, `markdown`, and `cr-mcp` jobs.

The suite generator is a DynamicMem adapter on top of the shared trajectory
contract in `examples/eval-harbor/scripts/trajectory_framework.py`. Future
datasets should add their own adapter that emits the same staged contract rather
than copying DynamicMem-specific parsing or scoring code.

This is a native-semantics migration, not random task synthesis. The adapter
preserves DynamicMem's user timeline, raw app-log deltas, checkpoint identities,
`state_completion_pack`, `rq3_apply_service_qa`, and prediction contract. Harbor
only replaces the runner so every arm uses the same continuous-session sandbox,
stage reveal, output path, and verifier.

Task selection is deterministic. One generated task equals one DynamicMem user
trajectory over the selected checkpoint indices; there is no state-key chunking
or synthetic form schema generation. The generated suite manifest includes a
`coverage` block with users, checkpoints, checkpoints per task, observed-log
counts, state-completion key counts, Personalized Service item counts, and
service families. Review this coverage before spending live agent runs.

The arms are not hardcoded in the runner. The default arm config lives at
`examples/eval-harbor/arms/dynamicmem-default.json`. To add another arm, add a
new arm entry there, or pass another file with `--arms-config`. The suite
manifest records the arms it was generated with, and the resampling/aggregate
scripts read those arms by default.

Start with a dry run:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_suite.py \
  --source-root /path/to/DynamicMem \
  --checkpoint-indices 0-4 \
  --stage-pattern update-answer-every-checkpoint \
  --max-users 5 \
  --max-tasks 5 \
  --arms-config examples/eval-harbor/arms/dynamicmem-default.json \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --dry-run
```

Generate the smoke suite:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_suite.py \
  --source-root /path/to/DynamicMem \
  --checkpoint-indices 0-4 \
  --stage-pattern update-answer-every-checkpoint \
  --max-users 5 \
  --max-tasks 5 \
  --arms-config examples/eval-harbor/arms/dynamicmem-default.json \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --manifest examples/eval-harbor/suites/dynamicmem-smoke.json
```

Use `--stage-schedule` for explicit interleaved trajectories. `U` and `UA`
consume one selected checkpoint; `T` asks the downstream task for the most
recently updated checkpoint. For example, `--checkpoint-indices 0-2
--stage-schedule U,U,T,U,T` creates:

```text
U(checkpoint 0) -> U(checkpoint 1) -> T(checkpoint 1) -> U(checkpoint 2) -> T(checkpoint 2)
```

Inspect the native-source coverage:

```bash
python3 - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path("examples/eval-harbor/suites/dynamicmem-smoke.json").read_text())
print(json.dumps(manifest["coverage"], indent=2, sort_keys=True))
PY
```

Inspect task difficulty before running live agents:

```bash
python3 - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path("examples/eval-harbor/suites/dynamicmem-smoke.json").read_text())
for task in manifest["tasks"]:
    totals = task["difficulty"]["totals"]
    print(task["taskId"], totals)
    print("  soundness:", f"examples/eval-harbor/tasks/{task['taskId']}/tests/expected/soundness-report.md")
PY
```

Validate every generated task before any live agent run:

```bash
python3 examples/eval-harbor/scripts/validate_task_soundness.py \
  $(python3 - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path("examples/eval-harbor/suites/dynamicmem-smoke.json").read_text())
for task in manifest["tasks"]:
    print(f"examples/eval-harbor/tasks/{task['taskId']}")
PY
  )
```

Run three robustness samples per task and arm only after validation passes:

```bash
python3 examples/eval-harbor/scripts/run_harbor_resamples.py \
  --manifest examples/eval-harbor/suites/dynamicmem-smoke.json \
  --samples 3 \
  --harbor-bin /path/to/harbor \
  --output-root /tmp/cr-harbor-dynamicmem-smoke
```

Aggregate the repeated samples:

```bash
python3 examples/eval-harbor/scripts/aggregate_resamples.py \
  --root /tmp/cr-harbor-dynamicmem-smoke \
  --manifest examples/eval-harbor/suites/dynamicmem-smoke.json \
  --output /tmp/cr-harbor-dynamicmem-smoke-report.md \
  --json-output /tmp/cr-harbor-dynamicmem-smoke-report.json
```

Scale gradually. A 5-task smoke suite already means `5 tasks x 3 arms x 3
samples = 45` live agent runs. A 30-task suite is 270 runs, so use
`gpt-5.4-mini` for shakeout and reserve larger models for selected reruns.

## Version Control

This harness is developed on the fork integration branch
`codex/eval-harbor-harness-v2`. For each phase:

1. Branch from `codex/eval-harbor-harness-v2`.
2. Open a small PR back into that integration branch.
3. Merge the phase PR only after local Harbor verification is recorded.
4. Consider an upstream PR only after the feature train is coherent.

The existing `examples/eval` product E2E suite is intentionally left untouched.
It remains the place for backend form-fill, document-analysis, Vertex, and full
product workflow checks.
