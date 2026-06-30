# Harbor-Based Eval Harness V2

- Status: active extension
- Target branch: `codex/eval-harbor-harness-v2`
- Epic: <https://github.com/ShenzheZhu/context-router/issues/1>
- Phase issues: <https://github.com/ShenzheZhu/context-router/issues/2>, <https://github.com/ShenzheZhu/context-router/issues/3>, <https://github.com/ShenzheZhu/context-router/issues/4>, <https://github.com/ShenzheZhu/context-router/issues/5>, <https://github.com/ShenzheZhu/context-router/issues/6>, <https://github.com/ShenzheZhu/context-router/issues/12>, <https://github.com/ShenzheZhu/context-router/issues/14>
- Harbor reference checked: local clone of `harbor-framework/harbor` at `89359f5`
- Harbor cookbook reference checked: local clone of `harbor-framework/harbor-cookbook` at `e093c9a`
- Last updated: 2026-06-30

## Decision

Use Harbor directly as the v2 eval runner unless a feasibility spike proves that
Harbor cannot cover a required ContextRouter setting.

We should not reimplement task execution, sandbox lifecycle, artifact collection,
agent adapters, multi-step execution, or verifier plumbing if Harbor already
provides those primitives. The work owned by this repo should be the
ContextRouter-specific layer:

- Harbor task packs for our document-to-task workflows
- Harbor job configs for baseline vs CR comparisons
- verifier scripts and score summaries
- a memory-only CR MCP sidecar or server adapter
- data generation and challenge design

## Why

The current `examples/eval` pipeline is useful as a product E2E evaluation, but
it couples several variables:

- document reading and extraction
- memory construction
- CR backend memory and preference services
- backend form-fill behavior
- provider-specific model execution
- Vertex and product workflow modules

That is too entangled for the clean question we want to ask:

> Holding agent, documents, task environment, output contract, and scorer
> constant, how much does the memory substrate change downstream task
> performance?

Harbor already covers the general harness mechanics. Rewriting those mechanics
inside this repo would create another eval framework to maintain before we have
proved a Harbor blocker.

## Harbor Coverage Check

| Need | Harbor support | Implication |
| --- | --- | --- |
| Sandbox/task environment | Harbor task directories with `task.toml`, `environment/`, `instruction.md`, and tests | Use native Harbor tasks. |
| Claude Code and Codex-style agents | Harbor has installed-agent integrations, including Claude Code and Codex CLI | Use Harbor agents instead of custom local adapters first. |
| MCP server access | `[[environment.mcp_servers]]` plus Docker Compose sidecars | Use a CR memory-only MCP sidecar for the `cr-mcp` arm. |
| Artifacts | `/logs/artifacts/` convention and configured artifact collection | Store outputs, memory snapshots, logs, and score evidence as Harbor artifacts. |
| Deterministic verifier | `tests/test.sh` and `reward.json` / `reward.txt` | Score form JSON locally after the agent exits. |
| LLM-as-judge | Verifier scripts can call LLM APIs and write named scores | Add later for memory representation scoring if deterministic rules are too brittle. |
| Long-horizon / over-time tasks | Multi-step tasks share one environment across ordered steps | Use later for dynamic memory update experiments. |

Cookbook recipes that map directly to this work:

| Cookbook recipe | Use here |
| --- | --- |
| `mcp-tools` | Pattern for exposing CR memory tools through a local FastMCP/HTTP sidecar. |
| `multi-container` | Pattern for adding local services through Docker Compose while Harbor owns the main agent container. |
| `multi-reward` | Pattern for reporting multiple named metrics instead of one opaque score. |
| `multi-step` | Pattern for over-time memory updates where files arrive in batches across ordered steps. |
| `simulated-user` | Possible future pattern for tasks where missing or low-confidence information should trigger a question. |

## Relationship To Existing Evaluation

`examples/eval` remains the canonical home for the existing product evaluation
suite. It should continue to cover shipped E2E flows, including backend
form-fill behavior and provider-specific operational concerns.

Eval harness v2 is a separate research harness. It should initially live beside
the existing suite, not replace it:

```text
examples/eval/             # Existing product E2E evals
examples/eval-harbor/      # New Harbor-native CR-vs-baseline evals
  tasks/
  jobs/
  verifiers/
  reports/
```

The two suites can reuse fixture concepts, but v2 should not call the old
backend form-fill or document-analysis pipelines in its first version.

## V1 Non-Goals

- Do not reimplement Harbor's runner, sandbox lifecycle, artifact collection, or
  agent adapter layer.
- Do not use Vertex in the v1 Harbor eval.
- Do not call backend form-fill in the v1 Harbor eval.
- Do not call product document-analysis workflows in the v1 Harbor eval.
- Do not generate or score PDF form output first; use local structured JSON.
- Do not delete or rewrite the existing `examples/eval` suite.

If Harbor cannot cover a required setting, document the blocker with a minimal
repro before adding a custom wrapper.

## Experimental Arms

The core comparison keeps task, documents, agent, model, output contract, and
verifier fixed. The only intended variable is memory substrate.

| Arm | Harbor shape | Memory substrate | CR involved? | Purpose |
| --- | --- | --- | --- | --- |
| `none` | Harbor task with no MCP sidecar and no memory file instructions | Agent context only | No | Pure agent baseline. |
| `markdown` | Same Harbor task plus mode instruction to maintain `memory.md` | Free-form local file | No | Naive external-memory baseline. |
| `cr-mcp` | Same Harbor task plus CR memory-only MCP sidecar | CR preference memory through MCP tools | Yes, memory only | Tests CR as durable structured memory. |

Mode-specific instructions should be injected through Harbor job config or a
thin task-generation step so that document files, output schema, and verifier
stay identical across arms.

## CR MCP Boundary

The `cr-mcp` arm should use memory-only CR, not the full product backend, if
possible. The harness should avoid product form-fill, document-analysis, and
workflow modules.

The target MCP surface is:

- `listPreferenceSlugs`
- `searchPreferences`
- `mutatePreferences`

If the current backend wiring is too coupled, add an eval-only
`MemoryOnlyMcpModule` or eval-only MCP server that imports preference memory
services without importing Vertex-backed product workflow modules.

Acceptable short-term limitation: use the existing backend MCP only with a strict
allowlist for memory tools, while documenting that this is not the final clean
boundary.

## Harbor Task Shape

Initial tasks should be Harbor-native directories:

```text
examples/eval-harbor/tasks/<task-id>/
  task.toml
  instruction.md
  environment/
    Dockerfile
    docker-compose.yaml        # only for CR MCP sidecar tasks
  tests/
    test.sh
    score_form_outputs.py
    expected/
      forms.json
  workdir/
    docs/
    forms/
```

The agent should receive the documents and blank form schemas in the task
workspace. Hidden truth stays in `tests/expected/` and is only used by the
verifier after the agent exits.

For `cr-mcp`, the task can declare:

```toml
[[environment.mcp_servers]]
name = "context-router-memory"
transport = "streamable-http"
url = "http://context-router-memory:8000/mcp"
```

## Agent Output Contract

The agent writes structured JSON instead of a PDF form. This keeps the first
Harbor task focused on information use rather than rendering or product
form-fill.

Example:

```json
{
  "schemaVersion": 1,
  "taskId": "maya-newhire-formfill-v1",
  "formId": "i9",
  "fields": {
    "employee.firstName": "Maya",
    "employee.lastName": "Chen",
    "employee.dateOfBirth": "1996-04-12"
  },
  "abstentions": {},
  "notes": []
}
```

The verifier should score fields against hidden truth and report missing,
wrong-value, overfill, and abstention counts. LLM-as-judge can be introduced
later for memory-state scoring where equivalent representations are difficult to
handle with rules.

## Artifact Contract

Use Harbor's normal trial directories plus collected artifacts. The task should
write reviewable outputs under `/logs/artifacts/`:

```text
/logs/artifacts/
  outputs/
    forms/
      i9.json
      w4.json
      direct-deposit.json
  memory/
    memory.md            # markdown arm only
    cr-snapshot.json     # cr-mcp arm only
  score-summary.json
```

Harbor will place collected artifacts under the trial output directory and also
write its own `result.json`.

## CLI Shape

Proposed direct Harbor commands:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-none.yaml \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-markdown.yaml \
  --yes

CODEX_FORCE_AUTH_JSON=1 harbor run \
  -c examples/eval-harbor/jobs/smoke-formfill-cr-mcp.yaml \
  --yes
```

If the CR sidecar can be toggled cleanly without a separate task directory, keep
one task and switch modes by job config. If Harbor requires separate task
directories for compose vs non-compose environments, generate or maintain the
task variants from shared source files to prevent benchmark drift.

Phase 3 implements the first `cr-mcp` arm with an eval-only FastMCP sidecar
rather than the product Nest backend. This is intentional for v1 because the
current product `McpModule` imports workflow-backed tools. The sidecar exposes
only `listPreferenceSlugs`, `searchPreferences`, and `mutatePreferences`, and
Harbor collects its MCP config, tool-call trace, server log, and memory snapshot
as artifacts.

## Phase Plan

| Phase | Issue | Deliverable |
| --- | --- | --- |
| 0 | #2 | Harbor feasibility decision, task/output/memory/artifact contract, and non-goals. |
| 1 | #3 | Minimal Harbor task with deterministic verifier and `none` arm. |
| 2 | #4 | Codex run configs plus `markdown` memory baseline. |
| 3 | #5 | `cr-mcp` memory mode with memory-only MCP sidecar/boundary. |
| 4 | #6 | Comparison reports, docs, and fork PR workflow. |
| 5 | #12 | Final audit cleanup for stale plan decisions. |
| 6 | #14 | Migrate Maya packet-medium I-9, W-4, and direct-deposit into one Harbor task. |

## Branch And PR Discipline

Use `codex/eval-harbor-harness-v2` as the fork integration branch for this
feature train. Open small PRs from phase branches into that integration branch.
After the train is coherent, open one final PR from the fork integration branch
to upstream `main`.

Each phase PR should link its issue, include verification commands, and avoid
expanding scope into the next phase.

## Operating Rules

- Treat task shift as a serious failure mode. Work should follow the planned
  Harbor-based route unless a new issue or explicit checkpoint changes the
  route. If a new idea appears, record it as a follow-up instead of silently
  expanding the active phase.
- Treat code style and repository hygiene as part of correctness. Do not add or
  keep unused files, speculative abstractions, stale comments, debug artifacts,
  or redundant wrappers. Prefer the smallest Harbor-native implementation that
  satisfies the current issue.
- Prefer simple, effective solutions over heavy machinery. Use Harbor-native
  task, verifier, artifact, and job primitives directly before adding wrappers,
  generators, services, or repo dependencies.

## Verification Strategy

- Phase 0: docs diff, Harbor capability check, stale-reference search, and issue
  links.
- Phase 1: `harbor run` with oracle or a simple command agent over one minimal
  task; deterministic verifier writes `reward.json`.
- Phase 2: `harbor run` with Codex in `none` and `markdown` modes over the
  same task content.
- Phase 3: `harbor run` with `cr-mcp` mode and evidence that no Vertex, backend
  form-fill, or product document-analysis path is invoked.
- Phase 4: comparison table generated from Harbor trial `result.json` files and
  collected `score-summary.json` artifacts.

Phase 4 adds `examples/eval-harbor/scripts/report_results.py` for the first
three-arm comparison. The script reads Harbor job or trial directories, validates
that score and final output artifacts exist and parse, and emits Markdown plus
optional JSON. It exits nonzero when required artifacts are missing or malformed
unless `--allow-invalid` is explicitly passed.

Phase 6 adds the first migrated packet task:
`examples/eval-harbor/tasks/maya-packet-medium-formfill`. This is a parity task,
not a new hard-trap benchmark. It uses the old Maya `packet-medium` documents and
fills I-9, W-4, and direct-deposit JSON outputs in one Harbor run. Hidden
expected outputs are derived from the old profile and field maps, and
`source-trace.json` records the old field-map lineage for auditability.

## Resolved Decisions

- The first task uses a small synthetic fixture to validate Harbor wiring before
  porting larger Maya packet data.
- Mode differences are implemented through Harbor job configs and
  `extra_instruction_paths`; the `cr-mcp` mode adds a Docker Compose sidecar from
  its job config.
- V1 scoring is deterministic JSON form-field scoring. Memory-state scoring and
  LLM-as-judge remain follow-up work for representation-sensitive memory evals.
- Packet-medium migration uses one Harbor task for the three old Maya scenarios
  rather than three separate tasks, so each memory substrate reads the dossier
  once and produces all downstream forms.

## Follow-Ups

- Port the harder packet/document-trap datasets into Harbor tasks after the Maya
  packet-medium parity task is reviewed.
- Add over-time/multi-step tasks using Harbor's multi-step pattern.
- Add optional memory-state scoring when final-task scoring is too indirect for
  debugging extraction failures.
