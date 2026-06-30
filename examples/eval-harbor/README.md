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
