# Agent workflow efficiency

- Status: overview/workflow clarifications implemented; approved narrow CI selection in validation
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

The product owner approved a modification-only, nine-file migration CI exception
on 2026-10-15. The exact allowlist, mandatory consumers, failure handling and
receipt distinction live in the existing
[contract policy](../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md#nonruntime-ci-selection).
No broad documentation/script exemption or individual-test selection is added.
Standard CI and the default full local gate remain unchanged. Separating
documentation CI definitions is deferred: that could avoid application-suite
dispatch for documentation-test definition edits, but leaves the migration
critical path and adds another workflow boundary. Keeping routing unchanged has
no selection-maintenance cost but retains the observed qualification cost.

Measured from the naturally occurring #186 runs (not performance experiments):

| Run/check | Event-to-final-job elapsed | Summed runner occupancy |
| --- | ---: | ---: |
| [Regular CI](https://github.com/loyalagents/context-router/actions/runs/38698847195) | 8m25s | 26m36s |
| Documentation job within regular CI | 12s job duration | 12s |
| [Migration](https://github.com/loyalagents/context-router/actions/runs/38698846895) | 17m11s | 32m06s |

Source took 15m00s, packaging 16m48s and aggregation 18s; packaging was the
critical path. Both workflows totalled 58m42s occupancy (50m36s Linux, 8m06s
macOS), not billed minutes or dollar costs. Recent completed migration runs
[38694303197](https://github.com/loyalagents/context-router/actions/runs/38694303197)
and [38695450063](https://github.com/loyalagents/context-router/actions/runs/38695450063)
took 15m54s–17m36s elapsed and 26m38s–34m04s runner occupancy.

Estimate, not measurement: a 1–3 minute lightweight path would save roughly
13–17 minutes elapsed and 24–33 runner-minutes per eligible run. Actual eligible
Actions duration remains unmeasured. Standard suites already skip for these
nine paths, so their #186 cost is not an additional saving. #186 itself remains
ineligible because it changed CI and added files. Confirm scheduling and summaries
on the first naturally occurring eligible run; no metrics subsystem is added.

Implementation base is freshly fetched `4d68bcf`, including merged #185's separate
database timing fixes; the reviewed policy base was `f7514fa`. Main agent is the
sole writer. Requested coordinator and independent plan/final reviewers are
GPT-6 Astra/xhigh. Plan-review spawn explicitly accepted those settings; exact
coordinator settings and independent runtime attestation are unavailable. The
read-only plan review found no blockers; complete-diff final review is pending.
The agreed freeze follows resolved corrections, green focused checks and ready
docs, then one draft PR, exact-head CI, full local gate and fresh final review.
This CI implementation requires full qualification. Reverting the cohesive PR
restores unconditional lanes; receipt meanings never change. Final evidence
belongs in the PR, not a pass-announcement commit.

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
