# Agent Workflow And Model Selection

- Status: reference and repository working preferences
- Read when: validating changes, assigning agents, choosing model/effort settings, or trading execution speed against task risk
- Last reviewed: 2026-10-16

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
  Use the [portfolio](../plans/README.md) and the relevant brief for current scope;
  the completed migration's numbered plans are historical, not activation gates.

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

The user's main checkout is the integrated playground. Assign one writer/
integrator there and do not switch its branch or overwrite build/runtime state
under another active task. Independent implementation uses separately owned
worktrees with an agreed base and landing order. A task's pilot priority does
not establish worktree safety. Read-only investigation/review needs no worktree.

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

This policy applies to backend, web, native, packaging, and documentation work.
The default is sufficient focused local checks plus all applicable exact-candidate
CI, with remaining platform, artifact and manual evidence explicitly identified.
A runtime PR does **not** automatically require a duplicate full local
`pnpm migration:gate`. The command and its coverage remain unchanged and available;
tests-first requirements, CI triggers/checks, independent reviews and human safety
boundaries remain in force.

### Default And Exceptions

Apply every relevant row; record the selection and any evidence gaps in the existing
task or plan. A backend change alone neither establishes nor rules out Mac-specific
risk: paths, locking, rename/fsync, permissions, child processes and signals can
cross that boundary. Broad impact or uncertainty widens focused testing and review;
it does not by itself require a full local run. Name the relevant evidence that a
full run would add beyond applicable CI and focused checks.

| Change or delivery | Required local and final evidence | When the full local migration gate is required |
| --- | --- | --- |
| Every runtime change (baseline) | Backend tests first; focused tests for changed behavior and affected consumers, including real integration/browser/native/persistence/recovery coverage as needed; all applicable CI on the final candidate. | When another row identifies additional evidence the full run supplies, or a current scoped commitment below requires it. No automatic local duplicate of full CI. |
| Mac filesystem, process, persistence, native dependency, toolchain, packaging or composition behavior | Identify what CI does and does not prove on the target Mac; run supported affected Mac checks below and record remaining platform evidence. | When a named gap requires aggregate lifecycle/cross-phase evidence or other Mac coverage supplied by the full run beyond those checks and CI. |
| Gate or CI mechanism | Focused tests of the changed mechanism and required full CI qualification; retain routing, receipt and failure semantics. | When the local runner or its coverage is affected, or a named gap needs its aggregate evidence. A CI-only delta with unchanged local inputs does not by itself require a full local run. |
| Artifact delivered for testing or release | Verify the actual artifact and compare its source/build inputs with the source CI tested, as specified below; perform applicable installed, replacement, recovery and manual acceptance checks. Green source CI does not qualify a delivered artifact. | Apply the other relevant rows and current scoped delivery commitments; installed-artifact qualification remains separate. |
| Documentation or tests only | Affected readers/checkers/tests, links and whitespace, plus exact-candidate CI under existing routing. Carry forward only evidence with unchanged relevant inputs and an explicit impact assessment. | When an exception above applies; otherwise no full local gate or application build beyond what the affected tests require. |

New or amended requirements for a full local run must identify the task or delivery,
triggering risk, relevant source/artifact and evidence CI misses. Existing requirements
for still-outstanding work, including pilot delivery, remain binding as written
until explicitly reconciled with their owner; they do not lapse for lacking those
new rationale fields. Completed or merged implementation-candidate
requirements do not govern new PRs merely because their documents remain under
`active/`; separately outstanding delivery, recovery or manual acceptance may
survive a code merge, which does not attest their completion. Backlog requirements
are proposals to reconcile at activation, not current task approval. Current
operation-specific runbook requirements still apply. Generic instructions to run
a full local gate for every runtime PR are superseded by this matrix. Plans should
record only scoped additions and link here; preserve historical receipts.

Linux migration CI and a Mac full local run are not interchangeable just because
they share twelve phase IDs. Mac-specific staged dependencies, filesystem/process
behavior and browser execution need relevant target-platform evidence. The existing
macOS native CI lane remains required when applicable; the full local migration
gate does not itself run `build:native`/`test:native` or qualify the real installed
Mac bundle. Select the missing evidence explicitly rather than treating either
source CI or the full local command as complete platform/artifact qualification.

Select supported Mac checks for the named gap, with isolated state and prerequisites:

- Native changes: `pnpm --filter desktop build:native` and
  `pnpm --filter desktop test:native`, with the Apple compiler/SDK and generated
  Prisma client plus backend/worker build required
  by the fixtures, as in the existing macOS CI lane.
- Persistence and UI: `pnpm --filter backend test:local-database` includes its
  generation/build prerequisite; `pnpm --filter web test:local-ui` needs backend
  and web builds and the [pinned browser](LOCAL_UI.md#automated-and-human-validation).
- Restart and staged composition: supported `pnpm migration:smoke:restart` and
  `pnpm migration:smoke:packaging`, with the pinned toolchain, frozen dependencies,
  browser and isolated database prerequisites in the
  [gate reference](../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md#local-migration-baseline-gate).
- Actual artifact: [isolated packaging](INSTALLED_MAC_APP.md#build-and-evidence)
  with trusted pinned archives, then the
  [installed smoke](../../scripts/local-migration/installation/installed-smoke.mjs)
  and applicable delivery checks on that verified bundle, using the approved
  synthetic-state boundaries.

Standalone packaging smoke is supported target-native staged evidence with its
own source, lifecycle, cleanup and integrity checks. It does not supply the
full local gate's independent outer lifecycle verification or terminal summary with
source binding and merge-base comparison. Lane qualification receipts are produced
only by the CI profiles.
If the change needs that boundary or cross-phase Mac evidence, require the full
local gate and name what it adds. Do not invent arbitrary phase skipping or treat
every web/docs edit included in a package as a change to that boundary.

### Iterative Correction

For an optional starting point, `pnpm test:plan --base <ref>` prints advisory
focused checks and prerequisites; see the [testing guide](HOSTED_DEVELOPMENT.md#testing).
It does not execute checks or certify coverage. Review unresolved impacts and
affected consumers before choosing validation.

Run the smallest sufficient checks for changed behavior and affected consumers.
Include real integration, browser, native, persistence, or recovery coverage when
the risk requires it; a small diff is not proof of low risk. Docs-only edits normally
need link/consistency and whitespace checks **plus affected tests/checkers that read
the edited or moved files**, with builds only as those checks require and a full
local gate only under the matrix exceptions. Discover those consumers with `rg`
across tests/scripts and other repository readers: search the
old/new paths, filename alone, and distinctive asserted content. Full-path searches
alone miss readers such as `read("README.md")` and constructed paths. Preserve
content assertions when updating a reader to an intentionally moved document.
Changes to a gate require that gate's own targeted tests too.

Batch related corrections from a review/acceptance round. Renew affected reviews
and tests; do not automatically restart every independent review, rebuild the
entire package, or run the full migration gate after each edit. An approved plan
may require an earlier broad check for a concrete risk: identify that requirement,
or obtain an affected plan amendment rather than silently bypassing it.

### Trial Build For Human Retesting

If feedback needs a new app, rebuild it and perform the artifact verification and
risk-appropriate checks/reviews necessary for the named retest. Record source
revision, dirty status/copied-input identity where applicable, artifact identity,
permitted test scope, passed checks and remaining qualification in the existing
handoff or evidence record. Report: "Targeted checks passed; final validation pending."

A trial label does not authorize unsafe testing, additional live-model runs,
downloads, personal-state/client changes or recovery shortcuts. Use isolated
synthetic state unless separately authorized. Relevant credential, persistence,
process-ownership and recovery checks precede exposure, even during iteration.
Trial observations are scoped evidence, not complete human acceptance or merge/
release readiness. Keep known failures and untested cases visible.

### Final Candidate Qualification

Agree the finalization milestone once in the task/plan: known corrections and
affected reviews resolved, and the agreed exploratory human-feedback round ended
or its remaining checks explicitly scheduled for final qualification. During an
active user acceptance round, agree that boundary with the user rather than treating
each reported fix as a new final candidate. This is not permission to defer required
checks beyond merge or create an approval request before every routine test.

Do not start final qualification while a known blocking finding still requires
a candidate change. A broad run diagnosing a named integration risk may come
earlier; record its purpose and input revision. It is diagnostic, not final
qualification; carry forward only unaffected results under the evidence rules
below.

Freeze the source and relevant build/runtime/test inputs and identify the actual
artifact when one is delivered. Complete the checks selected by the matrix and
scoped plan: focused local evidence, any required full local gate, applicable
installed-artifact qualification, independent complete-diff review, required manual
acceptance and exact-candidate CI. Valid trial evidence can contribute
only after explicit input/impact assessment; do not rebuild solely to rename an
unchanged trial artifact "final."

Once the agreed candidate is stable and required documentation is ready, commit
and push/open its draft PR promptly. Run exact-candidate remote CI, required full
local qualification and independent complete-diff review concurrently when their
inputs and resources are isolated. Do not add a serial CI waiting period by
finishing every local check and review before pushing. Record the actual local
source separately from PR head and test-merge checkout identities. Put final run
links/results in the PR description or receipts where possible; avoid commits
solely to announce a pass.

If corrections follow, return to targeted iteration and renew affected review;
then renew affected final evidence on the corrected frozen candidate. Reassess
the matrix and scoped obligations to decide whether a full local rerun is needed;
if an exception still applies and a correction changes its relevant inputs, renew
that full local evidence. Unrelated prose does not invalidate it. Explicitly carry
forward only unaffected coverage; do not require a full rerun merely because a
migration runtime file changed. Cover affected
consumers and applicable artifact qualification, not just the formerly failing
test. Existing CI triggers still run during iteration; do not skip/cancel required
checks or change CI rules to implement this policy.

CI green means every applicable required job/status and receipt succeeds for the
final PR head and actual tested merge/source identity. Record those identities
separately; one green job or a previous head's pass is insufficient. Required
native CI remains part of that assessment. Missing Mac, artifact or manual evidence
stays explicit even when all source CI is green.
Unavailable or unbound required CI remains pending; a full local run, including
a named diagnostic run, never substitutes for it.

For a delivered artifact, record the actual source commit, dirty status and
copied-input identity where applicable, build/runtime/dependency/toolchain inputs,
and artifact digest. Compare those relevant inputs with the actual CI-tested
source/test-merge checkout, not just its PR head label. Transfer evidence only for
matching inputs or an explicit delta/impact assessment with coverage for the
differences. Product source-code changes in a final artifact must be included in
the final candidate covered by applicable CI. Local evidence may close assessed
PR-head/test-merge, build or platform gaps; it cannot qualify additional dirty
product changes against another candidate's green CI. Do not claim final
artifact qualification until the gaps are resolved. Bounded dirty/copied trial
builds remain permitted for named retests; their observations alone are not final
source/package qualification.

### Evidence And Expensive Runs

Keep a compact change-to-evidence record in the existing task/plan, not a new
process document per fix. Record revision, relevant inputs (code, configuration,
dependencies, toolchain, fixtures, environment and artifact), command, result and
limitations. Reuse only unaffected evidence with an explicit impact assessment;
never present an older pass for changed inputs. Do not repeat valid identical
checks solely for each reviewer. Broaden focused checks/review when impact is
uncertain; that alone does not select a full local run.

For the three migration CI profiles, a durable passed summary is committed only
after bounded finalization and required receipt publication. A pending or failed
summary cannot confer qualification; when full qualification is selected, all three
workflow jobs and same-attempt receipts must succeed. The narrow approved
[nonruntime CI policy](../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md#nonruntime-ci-selection)
instead requires its documentation/contract consumers and an independently
verified not-applicable decision. It produces no source/UI/package qualification
receipt and does not change the full local gate or human-review obligations.
The maintained Markdown category covers content-only edits in the named root
files and `docs/IMPORTANT`, `docs/current`, `docs/useful` and `docs/plans`, subject
to the policy's path/type/mode constraints and preserved exact-file exemptions.
Its fixed lane includes the backend launch-topology, web runtime and orchestrator
operator-document consumers. A new consumer must join that lane or the affected
document must lose its exemption before the consumer ships. These roots hold
prose, not runtime/evaluation inputs. Frozen evidence, registries, other paths,
structural changes and mixed changes still receive full migration CI. Receipt
semantics and standard CI routing are unchanged.
CI/gate changes receive full final CI qualification; their local requirement is
determined by the matrix above.
Compare runner identities using the explicit
[CI compatibility policy](../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md#ci-qualification-profiles):
retain actual release/patch values, allow only supported patch drift, and require
matching image family, pinned runtimes and browser identity.

Before an expensive run, state its command/purpose, what relevant inputs changed
since the previous pass, and why it is needed now, including any approved-plan
requirement. Preflight the pinned toolchain and required resources before starting.
The explanation is not a new permission gate; existing approval boundaries remain.

Run review and validation concurrently only against a stable snapshot with
isolated resources. Stronger models cannot replace real database, crash/restart,
browser, network, or supported-OS evidence. Report untested platforms honestly.

Preserve mandatory startup and required reading. Route additional reading to
the task. Give delegated agents a bounded question or review scope, relevant
paths/contracts, current decisions, and the revision and evidence to inspect.
Request findings with source pointers and, for checks, the command, revision,
result, limitations and log location when retained. Prefer concise summaries with
relevant failure excerpts over pasted raw logs or entire historical conversations.
Final review still covers the complete diff. A handoff does not replace required
reading or independent verification of primary sources. Do not silently relax an
active plan's reading or validation rules.

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
Validation commands by iteration, trial handoff, and final qualification:
Agreed finalization milestone; trial scope and outstanding checks:
Evidence inputs, affected rechecks, and justified carry-forward:
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
