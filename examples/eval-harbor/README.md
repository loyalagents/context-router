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
