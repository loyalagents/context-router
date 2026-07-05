# Fresh-Session Permission-Boundary Readback Implementation Summary

## Summary

Implemented the first-pass fresh-session permission-boundary readback harness.
This evaluates blocked-data access/readback after source documents are removed,
not model-side Do Not Use compliance.

Paper-safe claim supported by this harness shape:

> CR permissioned memory reduces downstream access to blocked data after source
> documents and prior task files are removed, while preserving allowed-memory
> utility.

## Added

- Main readback task: `examples/eval-harbor/tasks/sensitive-policy-readback-v1`
  - two-step multi-step task;
  - policy-blind memory-build step;
  - readback step with no source docs and neutral question ids;
  - hidden `evaluationKind: "fresh-session-readback"` expected schema;
  - task-local readback scorer with reward based on allowed utility and blocked abstention.
- Main jobs:
  - `examples/eval-harbor/jobs/sensitive-policy-readback-v1-markdown.yaml`
  - `examples/eval-harbor/jobs/sensitive-policy-readback-v1-cr-mcp.yaml`
- Freshness canary task: `examples/eval-harbor/tasks/sensitive-policy-freshness-canary-v1`
  - context-only negative-control nonce check;
  - markdown/CR positive-control allowed-memory recoverability check;
  - `/app`, `/tmp`, and `$HOME` filesystem carryover probe;
  - machine-readable `freshness-probe-runtime.json` artifact.
- Canary jobs:
  - `examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-context-only.yaml`
  - `examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-markdown.yaml`
  - `examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-cr-mcp.yaml`

## Harness Updates

- Sensitive-policy artifact scans now fail loudly when expected markdown or CR
  artifacts are missing instead of treating missing files as zero leakage.
- Sensitive-policy comparisons now carry `evaluationKind` and group by task,
  evaluation kind, and variant.
- Readback score summaries require numeric `blockedAbstentionAccuracy`.
- Resample reporting now displays blocked abstention alongside allowed utility.
- Task soundness validation now supports multi-step
  `evaluationKind: "fresh-session-readback"` tasks without staged payloads.
- Soundness validation allows blocked values in hidden expected data and
  build-step source docs, while rejecting them from visible instructions,
  readback files, setup scripts, schemas, and non-hidden helper scripts.
- Deterministic checks now cover readback scoring, missing memory artifacts,
  CR value smuggling into allowed slugs, and hidden expected blocked values.
- Freshness canary scoring now separates pre-cleanup `/app` persistence from
  post-cleanup agent-visible carryover. Pre-cleanup `/app` persistence is
  informational because the multi-step workdir is expected to persist long
  enough for setup cleanup to run.
- Freshness canary scoring now exposes separate aggregate booleans for
  `freshSessionPass`, `memoryPositiveControlPass`, `noncePolicyPass`, and
  `filesystemPass`.
- Recovery of nonce facts now fails `noncePolicyPass` and the aggregate
  `freshnessCanaryPass` in every mode. In `context-only`, recovery of allowed
  canary facts also fails the freshness gate as conversation carryover. In
  markdown/CR canary runs, allowed fact recovery remains the positive-control
  requirement.
- Readback and canary final-step setup scripts now clear `/tmp` and common
  `$HOME` scratch names before the final agent step, while preserving markdown
  memory through an internal `/app` temporary file.
- Normal `report_results.py` output now exposes and requires freshness canary
  pass/fail, fresh-session pass, memory-positive-control pass, nonce-policy
  pass, filesystem pass, nonce absence, and allowed recoverability fields.

## Validation Run

Passed:

```bash
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/check_sensitive_policy.py
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_task_soundness.py examples/eval-harbor/tasks/sensitive-policy-readback-v1 examples/eval-harbor/tasks/sensitive-policy-freshness-canary-v1
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_eval_preflight.py --task examples/eval-harbor/tasks/sensitive-policy-readback-v1 --job examples/eval-harbor/jobs/sensitive-policy-readback-v1-markdown.yaml --job examples/eval-harbor/jobs/sensitive-policy-readback-v1-cr-mcp.yaml
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_eval_preflight.py --task examples/eval-harbor/tasks/sensitive-policy-freshness-canary-v1 --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-context-only.yaml --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-markdown.yaml --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-cr-mcp.yaml
bash examples/eval-harbor/scripts/check_static.sh
git diff --check
```

Live Harbor/model runs were not executed in this implementation pass. No
fresh-session claim is supported until live canary runs pass under the same
Harbor version, agent, and job settings as the main readback runs. Before using
readback results, run the freshness canary first, then one markdown and one CR
readback sample, then resample if the canary passes.

## Interpretation

This harness supports access prevention / readback reduction claims when the
freshness canary passes. It does not prove behavioral Do Not Use compliance,
because the intended CR behavior is that blocked data is unavailable after
handoff rather than available-but-refused.
