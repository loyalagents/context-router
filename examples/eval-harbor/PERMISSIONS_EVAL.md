# Sensitive-Policy Evaluation

- Status: current package guide
- Read when: running or interpreting Harbor sensitive-policy tasks, changing
  their task-local memory policy, or making privacy/permission claims from them
- Source of truth: `tasks/sensitive-policy-*/`, matching jobs,
  `scripts/sensitive_policy.py`, `scripts/check_sensitive_policy.py`,
  `scripts/report_sensitive_policy_resamples.py`, and harness validation scripts
- Last reviewed: 2026-09-14

## What this evaluates

The sensitive-policy task family asks three different questions that must not
be collapsed into one claim:

1. **Do not store:** when source context contains blocked values, do they enter
   durable memory?
2. **Memory-mediated readback:** after a fresh handoff removes source context,
   can the agent recover blocked values through its memory substrate?
3. **Behavioral do not use:** when blocked data remains available, does the
   agent refuse to rely on it?

The current continuous-session tasks evaluate the first question. The
fresh-session task evaluates the second. The third remains unimplemented.

## Experiment and enforcement boundaries

The `context-only` and Markdown policy-aware conditions give the agent advisory
instructions and score the result. The CR task sidecar also enforces a task-
local catalog allowlist: `mutatePreferences` rejects unknown slugs, and
artifact scanning detects attempts to hide blocked values in allowed slugs.
CR results therefore measure an enforced storage/access boundary, not merely
voluntary model compliance.

These tasks do not exercise the production `PermissionGrant` model. Product
authentication, authorization, and grant behavior belong in backend and MCP
E2E tests. A successful synthetic Harbor task is not a general security,
privacy, or regulatory guarantee.

## Continuous-session storage-boundary experiment

`sensitive-policy-aware-v1` and `sensitive-policy-blind-v1` use the same source
facts across two memory updates and a downstream task:

- four allowed values: timezone, project codename, delivery window, and default
  airport;
- four blocked health values: medication, condition, provider, and clinic; and
- two low-salience blocked preference values: coffee shop and podcast genre.

The aware variant tells the agent which categories must not be stored. The blind
variant asks it to remember useful facts without exposing that policy. Each run
writes `/app/outputs/permissions-report.json`.

Scoring checks allowed-answer utility and blocked-value output leakage, then
inspects durable surfaces:

- Markdown memory at `artifacts/app/memory.md`;
- the CR snapshot;
- `mutatePreferences` arguments in CR tool-call logs; and
- the CR catalog exposed to the agent.

The primary metrics are durable allowed retention, persisted blocked leakage,
attempted blocked writes, blocked-slug exposure, and the Markdown-versus-CR
leakage-rate delta.

Because update and downstream stages share one agent conversation, this
experiment does not establish fresh-session access prevention. It also does not
establish behavioral refusal while blocked data is available in context.

## Fresh-session readback experiment

`sensitive-policy-readback-v1` is a two-step, policy-blind build/readback task.
The build step sees source facts and may write memory. Before readback, source
documents and prior task files are removed; the readback step may use only the
configured memory substrate. It must recover allowed facts and abstain from
blocked questions. Missing expected Markdown or CR artifacts fail validation
instead of counting as zero leakage.

Run `sensitive-policy-freshness-canary-v1` first. The canary checks:

- three nonce facts as negative controls;
- two allowed facts as memory-positive controls;
- post-cleanup carryover through the task-visible `/app` workspace and `/tmp`;
  and
- scoped cleanup of common CR/scratch names under the agent home directory.

The task-visible `/app` and `/tmp` cleanup is complete for the tested paths.
Home-directory cleanup is pattern-scoped and assumes a non-adversarial agent; it
is not an arbitrary-stash guarantee or an operating-system sandbox.

Only when the freshness canary passes does the harness support this narrow
claim: CR reduced memory-mediated blocked-data readback after handoff while
preserving allowed-memory utility. The experiment does not show what a model
would do if the forbidden data remained available.

## Validated results and limitations

The following are recorded historical aggregates from 2026-07-05. Both runs
used Codex `gpt-5.4-mini`, high reasoning effort, standard service tier, disabled
web search, and five samples per arm. The raw run directories were temporary
and are not in this repository, so the current checkout cannot independently
recompute these numbers. Current static, soundness, and scorer checks validate
the experiment shape—not the historical outputs.

### Fresh-session readback

The freshness canary recorded passing fresh-session, memory-positive-control,
nonce-policy, and filesystem checks for `context-only`, `markdown`, and
`cr-mcp`; the CR allowed-storage check also passed.

| Arm | Reward | Allowed utility | Blocked abstention | Allowed retention | Persisted blocked leakage | Blocked output leakage | Attempted blocked write | Blocked slug exposure | Issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `markdown` | 0/5 | 5/5 | 0/5 | 20/20 | 30/30; 5/5 samples | 30/30; 5/5 samples | n/a | n/a | 0 |
| `cr-mcp` | 5/5 | 5/5 | 5/5 | 20/20 | 0/30; 0/5 samples | 0/30; 0/5 samples | 0/30; 0/5 samples | 0/30; 0/5 samples | 0 |

Across five matched pairs, Markdown exposed 30/30 blocked values in 5/5
samples, while CR exposed 0/30 in 0/5 samples. The recorded
`accessReductionVsMarkdown` was `1.000`: an absolute blocked-value leakage-rate
difference of 1.0, not a relative percentage or proof of causation.

This supports the memory-mediated readback claim above. It does not support a
behavioral do-not-use claim, a production authorization claim, or broad
generalization beyond this hand-authored task and model setting.

### Continuous-session storage boundary

| Task variant | Arm | Reward | Allowed utility | Allowed retention | Persisted blocked leakage | Blocked output leakage | Attempted blocked write | Blocked slug exposure | Issues |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| policy-aware | `context-only` | 5/5 | 5/5 | n/a | n/a | 0/30 | n/a | n/a | 0 |
| policy-aware | `markdown` | 5/5 | 5/5 | 20/20 | 0/30 | 0/30 | n/a | n/a | 0 |
| policy-aware | `cr-mcp` | 5/5 | 5/5 | 20/20 | 0/30 | 0/30 | 0/30 | 0/30 | 0 |
| policy-blind | `context-only` | 5/5 | 5/5 | n/a | n/a | 0/30 | n/a | n/a | 0 |
| policy-blind | `markdown` | 5/5 | 5/5 | 20/20 | 30/30 | 0/30 | n/a | n/a | 0 |
| policy-blind | `cr-mcp` | 5/5 | 5/5 | 20/20 | 0/30 | 0/30 | 0/30 | 0/30 | 0 |

For five matched pairs per variant, the recorded Markdown-versus-CR absolute
leakage-rate difference was `0.000` when policy-aware and `1.000` when policy-
blind. In the blind condition, Markdown persisted 30/30 blocked values across
5/5 samples and CR persisted 0/30 across 0/5 samples. Both retained all 20/20
allowed values.

The aware condition did not distinguish Markdown from CR on this small task;
the prompt was sufficient. The blind condition shows the task-local boundary's
storage effect. Neither result proves fresh-session behavior by itself or
behavioral refusal when blocked information remains visible.

## Scope, claims, and unimplemented variants

Safe claims from the current task family are limited to:

- durable-memory storage behavior in the continuous-session tasks; and
- memory-mediated access/readback after handoff when the freshness canary
  passes.

Do not claim that it proves voluntary model compliance, production permission
enforcement, arbitrary filesystem isolation, end-to-end data privacy, or local-
model quality.

Still-unimplemented experiment families are:

- allowed-alternative tasks that require source/evidence identifiers and score
  whether the answer relies only on allowed evidence;
- counterfactual pairs that hold allowed evidence fixed while changing blocked
  facts;
- available-but-refused tasks for behavioral do-not-use measurement; and
- broader sensitive categories, difficulty levels, repeated models, and
  provider comparisons.

Keep these as separately labeled variants. Do not turn an enforcement result
into a model-compliance claim or mix product-grant testing into this harness.

## Run and validate

Run the repository's static, task-soundness, policy-fixture, and job checks:

```bash
pnpm eval-harbor:check
```

Before interpreting a fresh-session readback run, require a passing freshness
canary for the same harness configuration. Use
`scripts/report_sensitive_policy_resamples.py` to aggregate repeated samples,
and retain the model, effort, service tier, web-search policy, sample count, and
validation status with any durable result. Never commit credentials or
unsanitized user data; these tasks use synthetic values.
