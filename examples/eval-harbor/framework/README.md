# Staged Memory Framework

This framework keeps the eval runner, task data, model, verifier, and reporting
fixed while swapping only the memory substrate.

## Research Contract

The question is:

> Given the same stream of documents or events, which memory substrate lets an
> agent retain and use the right information over time?

Current arms:

| Arm | Memory substrate |
| --- | --- |
| `context-only` | Continuous agent conversation context only |
| `markdown` | A single `/app/memory.md` file |
| `cr-mcp` | ContextRouter memory through an MCP sidecar |

The framework should not include product-specific backend form-fill or
task-specific retrieval services. Those belong to product E2E evals.

## Stage Model

The shared stage vocabulary lives in `scripts/trajectory_framework.py`.

| Token | Stage kind | Agent action |
| --- | --- | --- |
| `U` | `memory-update` | Read newly revealed docs/events and update memory |
| `S` | `state-task` | Submit the state snapshot from retained memory |
| `A` | `service-task` | Submit personalized-service answers from retained memory |
| `T` | `downstream-task` | Legacy combined state+service task; no raw docs are revealed |

Supported shapes include `U -> S -> A`, `U -> S -> A -> U -> S -> A`,
`U -> U -> S -> A`, `U -> U -> U -> U -> S -> A`, and legacy `U -> T`.

## Runtime Flow

```mermaid
flowchart LR
  subgraph Harbor["Harbor job"]
    Agent["Continuous agent session"]
    Stage["/app/next_stage"]
    Memory["Allowed memory substrate"]
    Output["outputs/prediction.json"]
  end

  Stage -->|"U: new docs/events"| Agent
  Agent -->|"update"| Memory
  Stage -->|"S/A/T: close-book task only"| Agent
  Memory -->|"retrieve/use"| Agent
  Agent --> Output
```

The stage server reveals one stage at a time through `/app/next_stage`.
`U` stages expose only the new delta since the previous selected checkpoint.
`S`, `A`, and legacy `T` stages expose task files but not the source docs.
For DynamicMem, `S/A` is the preferred path because the submit helpers validate
that the current stage answer covers the expected keys/items before the stage
server can advance.

The whole trajectory runs in one continuous agent session. If the arm is
`context-only`, the only retained state is the live conversation. If the arm is
`markdown` or `cr-mcp`, the agent may also use that arm's allowed external
memory.

## Data Protection Invariants

Every valid task must satisfy:

- hidden truth stays under `tests/expected`;
- staged payloads and raw source metadata are not agent-readable;
- task stages (`S`, `A`, and legacy `T`) do not expose docs or `documents.json`;
- `web_search` is disabled unless an experiment explicitly changes that;
- mode policies are enforced by both prompt instructions and validators;
- post-run validation rejects hidden path reads and disallowed durable writes.

These checks are part of the experimental contract, not optional manual review.

## Dataset Adapter Contract

Dataset adapters translate external benchmarks into the shared staged contract.
They should emit:

- a Harbor task directory;
- staged payload with ordered `U`, `S`, `A`, and optional legacy `T` stages;
- hidden expected data for the verifier;
- one job per arm;
- a suite manifest with source metadata, selected users/checkpoints, model,
  reasoning effort, web-search policy, timeouts, arms, and sample count.

The generic entrypoint is:

```bash
python3 examples/eval-harbor/scripts/build_dataset_suite.py \
  --dataset dynamicmem \
  --source-users user008 \
  --checkpoint-indices 0-1 \
  --stage-schedule U,U,S,A
```

DynamicMem is the first adapter. Future datasets should plug into the same
entrypoint instead of adding a new runner.

## Scoring Contract

The verifier scores only agent outputs, not hidden memory internals. For
DynamicMem, LLM-as-judge reward is the primary score when judge credentials are
provided; deterministic state/service diagnostics are retained for debugging.

Reports should make every experimental setting explicit:

- dataset, task id, source user, checkpoint range, and stage schedule;
- arm, model, reasoning effort, web-search policy, and timeout settings;
- sample count and concurrency;
- judge model and judge mode;
- reward/accuracy statistics, LLM State Mean, LLM Service Mean, tokens, and cost;
- validation, tool-policy, parse, and metadata failures.

For DynamicMem experiments, missing token usage, cost, LLM State Mean, or LLM
Service Mean makes the run incomplete. Treat it as a failed reporting artifact
and rerun before updating the shared logbook.

The benchmark is only useful if the task contract is sound. Treat failed
preflight or post-run validation as a failed experiment, not a noisy datapoint.
