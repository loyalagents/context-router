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
- Plan reviewers:
- Implementation PR(s):
- Supported mode after merge:
- Last updated: YYYY-MM-DD

Delete instructional text from the copied plan. Keep the plan scoped to the next
implementable outcome; put later ideas in the owning roadmap step instead.

For a multi-PR step, replace the singular metadata with this ownership map. Each
branch has one sole writer; reviewers are read-only.

| PR/checkpoint | Branch and base | Sole writer | Reviewers | Supported mode after merge |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Outcome

State the user- or developer-visible result in one paragraph. Describe the
supported runtime that will work after merge.

## Required Reading

List the exact canonical docs and source/test areas needed for this step. Do not
require agents to load unrelated historical plans.

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

Each checkpoint ends with runnable tests and a reportable result.

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

Add or remove checkpoints to fit the step. One step may use multiple PRs when
each PR is independently useful and has a tested rollback or recovery path.

## Validation Matrix

| Surface | Automated command/test | Manual check | Required for merge |
| --- | --- | --- | --- |
| Unit |  |  | Yes/No |
| Integration |  |  | Yes/No |
| E2E/contract |  |  | Yes/No |
| Frontend/build |  |  | Yes/No |
| Clean install/process restart |  |  | Yes/No |
| Persisted-state upgrade/recovery |  |  | Yes/No |

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
