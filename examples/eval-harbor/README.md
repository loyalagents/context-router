# Harbor Eval Harness

This directory contains Harbor-native eval tasks for clean CR-vs-baseline
experiments. It is separate from `examples/eval`, which remains the product E2E
evaluation suite.

For creating new tasks, use [`TASK_AUTHORING.md`](TASK_AUTHORING.md). The README
is the runbook for executing tasks; the authoring guide is the soundness
checklist for adding task data, hidden truth, verifiers, and job configs.

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

Set Codex auth in the shell before running real-agent jobs. Harbor's Codex
integration can read `OPENAI_API_KEY`, or it can use the local Codex
`auth.json` by setting `CODEX_FORCE_AUTH_JSON=1`. The default Codex job configs
use `gpt-5.3-codex-spark`.

Run the no-memory baseline:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-none.yaml \
  --yes
```

Run the markdown-memory baseline:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-markdown.yaml \
  --yes
```

Run the CR MCP memory arm:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-cr-mcp.yaml \
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

The report table includes agent, model, reward, field accuracy, parse failures,
metadata failures, missing/wrong/overfill counts, runtime, and artifact roots.
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
| `maya-packet-hard-over-time-v1-formfill` | `packet-hard-over-time-v1` split into 3 sequential batches | over-time memory pressure with documents hidden before final fill, bounded markdown scratchpad, and CR MCP durable memory | 46 |

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
use `/app/memory.md`; its job config sets `MARKDOWN_MEMORY_BUDGET_BYTES=1600`
so it behaves like a small scratchpad rather than an unlimited synthetic
database. The `cr-mcp` arm uses the eval-only ContextRouter memory MCP sidecar.

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
| `markdown` | `gpt-5.3-codex-spark` | 0.324 | 25 | 0 |
| `cr-mcp` | `gpt-5.3-codex-spark` | 0.946 | 0 | 2 |

The oracle scores 1.000, so the hidden expected forms and verifier are
self-consistent. The `cr-mcp` miss in this run was two direct-deposit name
fields where the agent used `Maya L Chen` instead of `Maya Lin Chen`.

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
