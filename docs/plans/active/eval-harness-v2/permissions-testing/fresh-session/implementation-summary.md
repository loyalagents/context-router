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
  `freshnessCanaryPass` in every mode. `freshSessionPass` treats answer-level
  nonce or allowed recovery as conversation carryover only in `context-only`,
  where no durable memory substrate exists. In markdown/CR canary runs, nonce
  recovery is reported as a nonce-policy failure, and allowed fact recovery
  remains the positive-control requirement.
- Canary and main readback prompts now tell agents to use listed memory
  slugs/categories/descriptions for CR retrieval and not to search by task id.
- Freshness canary reports now include a CR-only `crAllowedStorage` diagnostic
  and `crAllowedStoredPass`, so CR snapshot storage can be distinguished from
  live agent readback recoverability.
- Readback and canary final-step setup scripts now clear `/tmp` and common
  `$HOME` scratch names before the final agent step, while preserving markdown
  memory through an internal `/app` temporary file.
- The filesystem freshness guarantee is complete for the task-visible `/app`
  workspace and `/tmp`. `$HOME` cleanup is pattern-scoped to common CR/scratch
  names and assumes non-adversarial agents; it is not an arbitrary `$HOME`
  stash-isolation guarantee.
- Normal `report_results.py` output now exposes and requires freshness canary
  pass/fail, fresh-session pass, memory-positive-control pass, nonce-policy
  pass, filesystem pass, nonce absence, and allowed recoverability fields.

## Validation

Passed:

```bash
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/check_sensitive_policy.py
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_task_soundness.py examples/eval-harbor/tasks/sensitive-policy-readback-v1 examples/eval-harbor/tasks/sensitive-policy-freshness-canary-v1
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_eval_preflight.py --task examples/eval-harbor/tasks/sensitive-policy-readback-v1 --job examples/eval-harbor/jobs/sensitive-policy-readback-v1-markdown.yaml --job examples/eval-harbor/jobs/sensitive-policy-readback-v1-cr-mcp.yaml
PYTHONPYCACHEPREFIX=/tmp/context-router-pycache python3 examples/eval-harbor/scripts/validate_eval_preflight.py --task examples/eval-harbor/tasks/sensitive-policy-freshness-canary-v1 --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-context-only.yaml --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-markdown.yaml --job examples/eval-harbor/jobs/sensitive-policy-freshness-canary-v1-cr-mcp.yaml
bash examples/eval-harbor/scripts/check_static.sh
git diff --check
```

## Live Result

Live Harbor/model validation passed on 2026-07-05 under:

- Run root: `/tmp/cr-harbor-fresh-session-search-20260705T201016Z`
- Agent/model: Codex `gpt-5.4-mini`
- Reasoning effort: `high`
- Service tier: `standard`
- Web search: `disabled`

Freshness canary passed for `context-only`, `markdown`, and `cr-mcp`:

- fresh session pass: yes;
- memory positive control pass: yes;
- nonce policy pass: yes;
- filesystem pass: yes;
- CR allowed stored pass: yes.

Fresh-session readback, `n=5`, `markdown` vs `cr-mcp`:

| Mode | Reward | Allowed utility | Blocked abstention | Persisted blocked leakage | Blocked output leakage |
| --- | ---: | ---: | ---: | ---: | ---: |
| `markdown` | 0/5 | 5/5 | 0/5 | 30/30; 5/5 samples | 30/30; 5/5 samples |
| `cr-mcp` | 5/5 | 5/5 | 5/5 | 0/30; 0/5 samples | 0/30; 0/5 samples |

Aggregate access reduction vs markdown: `1.000`.

Generated reports:

- `/tmp/cr-harbor-fresh-session-search-20260705T201016Z/freshness-canary-summary.md`
- `/tmp/cr-harbor-fresh-session-search-20260705T201016Z/readback-summary.md`

## Interpretation

This harness supports access prevention / readback reduction claims when the
freshness canary passes. It does not prove behavioral Do Not Use compliance,
because the intended CR behavior is that blocked data is unavailable after
handoff rather than available-but-refused.
