# Harbor Eval Harness

This directory contains Harbor-native eval tasks for clean CR-vs-baseline
experiments. It is separate from `examples/eval`, which remains the product E2E
evaluation suite.

## Smoke Task

Run the first deterministic task with Harbor's oracle agent:

```bash
harbor run -p examples/eval-harbor/tasks/smoke-formfill -a oracle
```

Expected output:

- the agent writes `/app/outputs/forms/new-hire.json`
- the verifier writes `/logs/verifier/reward.json`
- the verifier writes `/logs/artifacts/score-summary.json`

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

Run the three modes into stable job roots:

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
missing/wrong/overfill counts, runtime, and artifact roots. The command exits
nonzero if required score or output artifacts are missing or malformed. Use
`--allow-invalid` only when intentionally reviewing a broken run.

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
