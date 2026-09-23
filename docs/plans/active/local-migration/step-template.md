# Step NN: Short Name

- Document status: template
- Status after copying: draft plan
- Program step: `NN-short-name`
- Target branch: `main`
- Planning base commit:
- Branch/PR owners:
- Change classification: `local-only`, `hosted-only`, or `shared`
- Depends on:
- Planning owner:
- Implementation owner:
- Coordinator and sole repository writer (identify whether they are the same):
- Risk profile and rationale:
- Plan reviewers:
- Implementation PR(s):
- Intended PR count and rationale for any split:
- Supported mode after merge:
- Last updated: YYYY-MM-DD

Delete instructional text from the copied plan. Keep the plan scoped to the next
implementable outcome; put later ideas in the owning roadmap step instead.
Rebase relative links when copying into a step directory: `orchestration.md`
and `agent-execution.md` become `../orchestration.md` and
`../agent-execution.md`; the general guide becomes
`../../../../useful/AGENT_WORKFLOW.md`. Run the repository Markdown link check.

Default to one PR with internal checkpoints. A second PR needs a reviewed,
concrete independently useful or safer landing boundary; more than two needs an
explicit human decision under [`orchestration.md`](orchestration.md). Do not split
planning, implementation, tests, docs, or reviews into PRs merely as process phases.

For an approved multi-PR step, replace the singular metadata with this ownership
map. Each branch has one sole writer; reviewers and a separate coordinator are
read-only. The writer owns plans/docs as well as product edits and commits.

| PR | Branch and base | Sole writer | Reviewers | Supported mode after merge |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Outcome

State the user- or developer-visible result in one paragraph. Describe the
supported runtime that will work after merge.

## Required Reading

List the exact canonical docs and source/test areas needed for this step. Do not
require agents to load unrelated historical plans.

For Steps 04–11, include [`agent-execution.md`](agent-execution.md) and the
[general agent workflow guide](../../../useful/AGENT_WORKFLOW.md). Do not copy
their full contents into this plan.

## Agent Allocation

Name the agents and use the step's risk-weighted allocation. Verify settings
before claiming they were used. Record an agreed fallback if unavailable.

| Role/agent | Mandate and owned paths | Requested model/effort | Verified setting or limitation | Independent parallel work |
| --- | --- | --- | --- | --- |
| Coordinator |  |  |  |  |
| Sole writer |  |  |  |  |
| Read-only reviewers (one row per mandate) |  |  |  |  |

The coordinator may also be the sole writer; otherwise it remains read-only.
Assign reviewers by architecture, compatibility, tests, security/privacy, scope,
and any persistence/packaging risks. Add reviewers/waves when justified, not to
meet an arbitrary count. Identify decisions requiring deeper investigation.

## Entry Criteria

- List facts that must already be true.
- Link evidence from completed prerequisite steps.
- Stop planning if an unmet criterion changes the intended design.

## Current Evidence

Describe relevant current behavior with links to source files and tests. Clearly
separate observed behavior from assumptions.

## Scope

- List the behaviors and files this step is expected to change.

## Non-Goals

- List adjacent work that must remain out of this step.

## Contracts And Compatibility

For each affected interface, state whether it is preserved, added, deprecated,
or intentionally removed:

- Application/use-case contract
- Storage contract
- Identity/principal contract
- Model-provider contract
- GraphQL contract
- REST route and payload contract
- MCP transport contract
- MCP tool/resource contract
- Configuration and filesystem contract

Name every in-repo consumer that must move in the same checkpoint or remain
compatible through an adapter/alias. For a public surface, also inventory known
external clients and configuration docs, state the compatibility window, and
provide release/migration guidance before removal.

## Design

Record the smallest design that achieves the outcome. Link any new program-level
decision added to `decision-log.md`.

## Checkpoints

Each checkpoint ends with runnable tests and a reportable result. Map checkpoints
to the intended PR(s); multiple checkpoints normally belong to the same PR.

### Checkpoint 1: Contract/test setup

- Write or update tests first when backend behavior changes.
- State the expected failing signal before implementation.
- List the targeted validation command.

### Checkpoint 2: Smallest implementation

- Implement one boundary or vertical behavior.
- Run the targeted validation command.
- Confirm the supported runtime still starts.

### Checkpoint 3: Integration and closeout

- Run broader affected tests/builds.
- Exercise restart, failure, and negative paths when applicable.
- Update canonical docs and remove temporary scaffolding that has expired.

Add or remove checkpoints to fit the step without treating them as PR boundaries.
Any approved split still needs independently useful, supported merge states and
tested rollback or recovery paths.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Unit |  |  | Yes/No |
| Integration |  |  | Yes/No |
| E2E/contract |  |  | Yes/No |
| Frontend/build |  |  | Yes/No |
| Clean install/process restart |  |  | Yes/No |
| Persisted-state upgrade/recovery |  |  | Yes/No |

For migration implementation, include the exact-base activation and final full
local `pnpm migration:gate`, applicable final pushed-head standard CI and the
dedicated migration workflow, plus targeted checkpoint commands. Record source
revision, toolchain, base comparison, caller integrity, phases, cleanup, timing,
and limitations. Do not silently substitute targeted tests for required gates.

## Independent Review And Evidence

Record plan and implementation review dispositions by revision and named
contracts/areas. For each change, identify affected reviews and tests; carry
forward unrelated approvals only with an explicit impact assessment. Material
changes need renewed affected review before implementation continues. Keep
fresh independent final review of the complete candidate diff across required
dimensions; an unchanged whole-document checksum is not the approval policy.

| Revision | Reviewer/mandate | Finding and disposition/evidence | Approval or required recheck |
| --- | --- | --- | --- |
|  |  |  |  |

## Parallel Work And Conflict Surfaces

List safe parallel work, files that require one owner, and the required landing
order for concurrent PRs. Record any exclusive paths reserved by this step.

## Privacy And Security

Explain network exposure, credential handling, local data locations, remote-call
behavior, and any new trust boundary. Local listeners must consider Host/Origin
validation, browser CSRF/DNS rebinding, and the difference between human and MCP
client identity where relevant. State `not applicable` only with a reason.

## Rollback Or Recovery

Explain how to return to the pre-step supported state without destructive or
ambiguous commands. If persisted state changes, cover backup and compatibility.

## Risks And Open Questions

Only list questions that can change this step. Assign each question an owner or
decision point.

## Exit Criteria

- The outcome and supported runtime are demonstrated.
- Required validation passes.
- Plan review findings are resolved.
- Implementation review findings are resolved.
- Canonical docs describe lasting behavior.
- Follow-up work is assigned to a roadmap step.

## Closeout

After merge, record the PR and concise outcome in `orchestration.md`. Delete this
detailed plan once no active downstream step needs it; Git and the PR preserve
the implementation history.
