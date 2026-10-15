# Agent workflow efficiency

- Status: bounded overview and workflow clarifications implemented; broader experiments deferred
- Owner: the product owner selects the next implementation slice
- Updated: 2026-10-15
- Policy: [agent workflow](../../../useful/AGENT_WORKFLOW.md)

Reduce repeated orientation and invalidated qualification while preserving
required tests, independent review and personal-state protections. Start with
small changes whose immediate effect can be measured; no new telemetry service,
mandatory startup document or broad workflow rewrite.

The [structure script](../../../../print-repo-structure.sh) uses one Bash renderer
with a default depth of four and an explicit `--depth N` option (1–64).
It skips excluded entries before descent, preserves directory hierarchy, does
not follow symlinks, and reports traversal failures. Output does not depend on
`tree` availability. [AGENTS.md](../../../../AGENTS.md) and the workflow clarify
task-relevant reading, verifiable handoffs and known-blocker handling.

## Evidence and limits

Repository observations at `071b329`:

- Original structure script: `tree` limits depth
  to four; fallback `find` has no depth bound and filters excluded paths rather
  than pruning traversal. The observed fallback output was about 3,200 lines.
- The [demo plan](../../active/in-app-demo-mode/plan.md) was 1,199 lines / about
  90 KB, mixing current design with successive correction and acceptance rounds.

Recent chat observations: “Set up native demo assistant” used six subagents;
[PR #184 qualification](https://github.com/loyalagents/context-router/actions/runs/38685217694)
recorded source at 19m01s and packaging at 15m40s, overlapping. Broad checks also
started on a candidate with a known review finding before its correction.
“Explore MCP client identification” spent about 72 minutes on main integration,
conflicts, a browser-test correction and renewed qualification; limited disk
headroom serialized local work. These are examples, not a time breakdown or
proof that the checks were unnecessary: review/testing found real defects.

No complete per-agent usage totals or causal speedup measurements are available.
Local test duration is not model-generation time. Repeated reading, reasoning,
tool output and coordination can consume tokens; overlap must not be counted
twice when measuring elapsed time.

## Verification and output size

Run `node --test scripts/print-repo-structure.test.mjs`. The seven fixture tests
cover depth, hierarchy, exclusions, spaces, symlinks, argument validation and
unreadable directories. PATH fixtures prove identical output with `tree` absent,
present, or failing; the renderer never invokes it. CI runs this suite alongside
the existing documentation-validator tests. Local execution used macOS Bash 3.2;
Linux execution remains for CI.

Measured on 2026-10-15 against the same file inventory (`071b329` plus this change):

| Renderer | Lines | Bytes |
| --- | ---: | ---: |
| Original fallback from `071b329` | 3,230 | 138,020 |
| New renderer, empty PATH directory | 727 | 23,968 |
| New renderer, failing `tree` stub on PATH | 727 | 23,968 |

The old `tree` path was unavailable and is unmeasured. The new outputs are
byte-identical; the stub is never called. The original fallback count includes
the added test file, explaining the difference from the earlier observation.
Output bytes fell about 83%; billed-token and elapsed-task savings remain unproved.

## Other options

| Option | Hypothesized benefit | Boundary or cost |
| --- | --- | --- |
| Route additional reading by task; use a short current-state entry point in the existing plan | Less repeated orientation | Defer substantial plan compaction until closure or an approved owner-led change; preserve mandatory reading, live obligations, links and evidence |
| Use one planning/implementation owner and risk-specific independent reviews | Fewer handoffs and repeated investigations | Existing plan/final-review obligations remain; no blanket reviewer cap or automatic setting downgrade |

## Lightweight follow-up

When the product owner designates a comparison task, its coordinator adds a short
summary to the existing handoff using the workflow's
[comparison measures](../../../useful/AGENT_WORKFLOW.md#adjusting-the-tradeoff).
Identify overlap, human pauses and concrete rerun reasons; report usage only when
available. Do not create a report per fix or infer tokens from minutes. Keep this
note current rather than appending a transcript. Agent count alone does not show
waste, and resource pressure can justify serial checks. Use the existing guidance
for effort selection and qualification; defer broader experiments until measured.
