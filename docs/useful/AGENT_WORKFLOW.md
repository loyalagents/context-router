# Agent Workflow And Model Selection

- Status: reference and repository working preferences
- Read when: assigning agents, choosing model/effort settings, or trading execution speed against task risk
- Last reviewed: 2026-09-23

Use this guide for general repository work. Explicit user instructions and
[`AGENTS.md`](../../AGENTS.md) govern the task; an active program's approved
plan and gates remain binding. This guide does not authorize extra scope,
external writes, weaker validation, or automatic merges. A small fix does not
need a migration-sized planning/review ceremony.

## Working Preferences

- Favor simplicity, extensibility, and maintainability over speculative frameworks.
- Optimize time to an accepted change, including review, fixes, validation, and
  human attention, not time to the first patch.
- Spend more reasoning on credentials, authorization, persisted state,
  concurrency, recovery, and other hard-to-reverse decisions. Slower execution
  is acceptable there; do not optimize those decisions for speed alone.
- Parallel investigation and multiple independent review waves are welcome.
  More agents, more PRs, and more reasoning are not evidence of correctness.
- Prefer one cohesive PR with internal testable checkpoints. Split only for a
  real independently useful landing boundary, not one PR per agent or phase.
  Migration-specific limits are in its orchestration document.

## Choose A Profile, Then Assign Roles

The following are project recommendations, not measured guarantees of model
performance. The current quality-first reference model is GPT-6 Astra
(`gpt-6-astra`). High, Extra High (`xhigh`), Max, and Ultra are effort settings,
not different model generations.

| Profile | Suitable work | Starting allocation | Tradeoff |
| --- | --- | --- | --- |
| Speed-focused | Reversible, narrowly specified edits with strong acceptance checks | High writer; Medium for factual inventory; fewer handoffs | Less exploration; escalate if assumptions or consequences are unclear |
| Balanced default | Ordinary features, bounded refactors, reviewed integration work | High writer/reviewers; Extra High for consequential design and coordination | Good scope control; coordinator must identify sensitive subproblems |
| Sensitive/quality-first | Identity, authorization, data loss, crash/concurrency, update integrity, new trust boundaries | Ultra coordinator when coordinating several investigations; Extra High critical writer and specialist reviewers; High routine work | More latency/usage is accepted; avoid duplicated investigation and speculative scope |

For a single difficult question, a focused Max investigation may be more useful
than creating a team. For a trivial task, one agent is enough. The coordinator
should state the profile and the concrete reason for it, not treat every backend
change as equally sensitive.

| Role | Recommended effort on Astra | Deliverable |
| --- | --- | --- |
| Coordinator | Extra High normally; Ultra for sensitive multi-agent work | Scope, ownership, decisions, review dispositions, integration evidence |
| Discovery/inventory | High normally; Medium for a speed-focused, factual scan | Verified paths/consumers and unanswered questions, not an unsolicited redesign |
| Planner | Extra High for cross-cutting design; High for bounded work | Smallest design, invariants, failure paths, checkpoints, exact validation |
| Sole writer | High for approved routine work; Extra High for sensitive logic | Tests first for backend behavior, incremental changes, targeted results |
| Architecture/maintainability reviewer | High; Extra High for boundaries or state/trust changes | Coupling, ownership, scope, unnecessary complexity, correctness implications |
| Compatibility/test reviewer | High; Extra High for persistence or authority semantics | Consumer effects, missing observable checks, regression evidence |
| Security/persistence/recovery reviewer | Extra High | Realistic failure/attack scenarios and the evidence needed to rule them out |
| Difficult-decision investigator | Max on a bounded unresolved question | Alternatives, counterexamples, tradeoffs, recommended disposition |

Final review is a role, not an automatic Ultra setting. Match reviewers to the
risks. An Ultra coordinator may reconcile their results; it must not substitute
its confidence for independent review or rerun every specialist's investigation.

## Requested Settings Versus Actual Settings

Before delegation, record the requested model and effort per role and verify
what the client/runtime actually supports. Do not claim a tier was used merely
because a prompt requested it. Report actual settings when observable and label
unverified settings honestly. If the preferred setting is unavailable, propose
an explicit fallback; obtain user agreement before downgrading a specifically
requested sensitive-work profile.

Subagents can inherit the parent's model and effort. Set both explicitly where
supported so an Ultra coordinator does not unintentionally make every inventory
Ultra. Explicit subagent requests also work below Ultra; model selection does
not change repository permissions. See the official
[subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Use one of these ownership arrangements:

- Coordinator is also the sole writer: select the appropriate effort for each
  phase where the client permits it; keep all other agents read-only.
- Coordinator delegates writing: name one writer for the branch/worktree,
  including plans, docs, staging, and commits; the coordinator and reviewers
  remain repository-read-only. Send corrections back to that writer.

Do not describe an Ultra parent as a High writer without actually changing the
setting or delegating to a configured High writer. Keep a compact role roster
in the task or active plan, not a new permanent document for every small edit.

Alternative models are an optional experiment, not an automatic downgrade:
pilot a currently available coding-oriented model for bounded implementation,
or an efficient model for extraction/inventory, behind unchanged acceptance
checks and stronger review. Confirm the exact version and supported effort;
do not assume similarly named models or effort levels are interchangeable.

## Parallel Work And Ownership

Start with independent read-only discovery, consumer inventory, test design,
and specialist review. Delegation is useful only when its result affects a
decision or validation; avoid several copies of "review everything."

Parallel writers need stable shared contracts, separate worktrees and resources,
explicit non-overlapping ownership, and one integrator. Keep one writer per
branch/worktree. Serialize lockfiles, generated output, schemas, composition
roots, shared test setup, and CI/gate edits. Independent test runs must not share
writable databases, ports, state roots, or build outputs. Dedicated concurrency
tests may intentionally share an isolated fixture under one test owner.

Scale to available agent slots and machine capacity. Two implementation tracks
plus reviewers can outperform many writers competing for integration and test
resources. If no meaningful independent work exists, stay serial.

## Review Without Repeated Full Approval Cycles

For work that requires independent plan and implementation review:

1. Establish the behavior and risk first. For durable state, enumerate the
   transitions, interruption points, concurrent actors, and recovery outcomes
   before choosing the mechanism.
2. Give fresh reviewers the relevant requirements, accepted decisions, exact
   revision/diff, and evidence. Do not rely only on the writer's interpretation.
   Cover architecture, compatibility, tests, security/privacy, and scope as
   applicable; add persistence or packaging expertise where needed.
3. Require findings to identify the affected behavior, plausible trigger,
   consequence, file/contract, and missing evidence or proposed fix. Label
   uncertainty. Hard-to-reproduce risks can still block when their consequence
   and evidence gap are material; a cosmetic preference is not automatically a
   blocker.
4. The coordinator records each disposition: fixed, rejected with evidence, or
   explicitly deferred with owner and any required approval. Unresolved blocking
   findings prevent approval. Resolve disagreement through evidence, not votes.
5. Bind approvals to a revision and named review areas/contracts. For changes,
   record the delta and affected dimensions. Re-review those dimensions; do not
   invalidate unrelated approvals just because the whole document hash changed.
   If impact is uncertain or cross-cutting, broaden the review. Never relabel a
   substantive change as editorial to preserve an approval.
6. Obtain fresh independent final review covering the complete base-to-candidate
   diff across the required dimensions. Keep the candidate frozen during review
   and validation. Subsequent fixes require impact assessment, affected tests,
   and reviewer rechecks; explicitly carry forward only unaffected coverage.

Use as many reviewers and waves as the findings justify. There is no arbitrary
two-reviewer or one-wave limit. Fresh agents can still share blind spots;
executable evidence and human review remain essential.

## Validation And Context Discipline

Follow existing tests-first and required gate rules. Use targeted tests during
implementation, and run required broader checks on the final candidate. Do not
rerun identical checks solely for each reviewer when valid evidence already
exists, but do not reuse results after their code, configuration, toolchain, or
other relevant inputs change. Record revision, command, environment, result,
and limitations. Changes to a gate require its own targeted tests too.

Run review and validation concurrently only against a stable snapshot with
isolated resources. Stronger models cannot replace real database, crash/restart,
browser, network, or supported-OS evidence. Report untested platforms honestly.

Preserve mandatory startup and required reading. Route additional reading to
the task; hand off current decisions and evidence rather than entire historical
conversations. Link authoritative details and verify them before relying on a
summary. Do not silently relax an active plan's reading or validation rules.

## Adjusting The Tradeoff

- Need more speed: narrow the task, remove duplicate reviews, parallelize
  independent reads/checks, keep routine writing at High, and reduce PR/hand-off
  overhead before downgrading sensitive reasoning.
- Need more assurance: add an early failure-model review, increase critical
  roles to Extra High/Max, use Ultra for substantive coordination, and improve
  fault-injection or real-runtime evidence. Do not add unrelated hardening.
- Have usage budget but are waiting on generation: consider available Fast
  mode, which trades higher usage for model speed. It does not speed up tests,
  builds, downloads, or human decisions; verify current availability and rates
  in the official [speed guidance](https://learn.chatgpt.com/docs/agent-configuration/speed).
- Unsure which allocation helps: compare representative tasks from the same
  base with the same acceptance checks. Track elapsed and active human time,
  accepted findings, rework, validation coverage, regressions, and usage.
  A small pilot is informative, not proof of unchanged defect rates.

## Reusable Task Brief

Include these fields in a prompt or an existing task plan; do not create extra
process artifacts unless the work needs them:

```text
Outcome and non-goals:
Base/branch and supported state:
Risk profile and why:
Coordinator, sole writer, reviewers; requested and verified model/effort:
Required reading and accepted contracts:
Owned paths, shared hotspots, permitted parallel work and resource isolation:
Internal checkpoints and intended PR count:
Validation commands and evidence required for completion:
Review dimensions, finding disposition and re-review triggers:
Decisions requiring user input; no automatic merge:
```

## Sources And Maintenance

Model recommendations above express this repository's preferences. Official
[model guidance](https://learn.chatgpt.com/docs/models) distinguishes reasoning
effort from model choice, describes Max and Ultra, and notes that availability
varies. No source establishes that Ultra always produces a better final review
or that lowering effort never reduces quality.

Recheck the official model, subagent, and speed pages when changing providers,
versions, or client configuration. Keep durable workflow rules here; do not
turn transient model rankings, community anecdotes, or current pricing into
permanent repository requirements.
