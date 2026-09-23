# Steps 04–11: Agent Execution Strategy

- Status: agreed execution preferences; future steps remain inactive until activated
- Owner: migration coordinator; sole writer is assigned per activated branch
- Last reviewed: 2026-09-23
- Read when: activating/planning Steps 04–11 or assigning their agents

This is a staffing, risk, and sequencing guide, not an approved implementation
plan for any future step. It does not mark Step 03 merged, activate another step,
choose a database/model runtime, or authorize overlapping writers. Follow
[`orchestration.md`](orchestration.md), [`decision-log.md`](decision-log.md),
and the active step's plan. Create detailed step directories only at activation.

General role definitions, review mechanics, settings verification, and speed
tradeoffs live in the [agent workflow guide](../../../useful/AGENT_WORKFLOW.md).
Do not copy that entire guide into each step plan.

## Agreed Preferences

- Simplicity, extensibility, maintainability, and correctness come first.
- Steps 04–05 justify slower, higher-effort work: use an Astra Ultra coordinator
  with Extra High critical implementers/reviewers and High routine work. Ultra
  is an effort/delegation choice, not a guarantee of correctness.
- Other steps use the risk-based allocation below. Escalate a specific hard
  decision rather than making every task Ultra. Explicitly configure children
  and verify settings; the parent does not silently change its own tier.
- Prefer one PR per step with internal testable checkpoints. Apply the exact
  split/approval rule in orchestration; planning, tests, docs, and reviews do
  not each need their own PR.
- Multiple specialist reviewers and multiple review waves are welcome. Reduce
  duplicate investigation and unrelated reapproval, not useful scrutiny.
- No historical hosted-data/user migration or cloud sync. Fresh installation
  does not excuse losing data or identity created after installation.

## Role Allocation By Step

All settings below use GPT-6 Astra (`gpt-6-astra`). H = High; X = Extra High
(`xhigh`); U = Ultra. Max is available for a bounded unresolved decision or
review dispute. These are requested allocations; record actual availability
and any agreed fallback in the activated plan. The sole writer owns all edits,
including plans and docs; a separate coordinator remains read-only.

| Step | Coordinator / planning | Sole-writer allocation | Independent review allocation |
| --- | --- | --- | --- |
| 04 storage boundaries | U coordinator; X boundary/failure-model planning | X transaction, coordination and identity boundaries; H mechanical consumer conversions | X persistence/recovery and architecture; H compatibility, test inventory and scope |
| 05 local database | U coordinator; X library/runtime and recovery design | X transaction/concurrency/recovery logic; H reviewed schema/repository wiring | X data semantics, security, crash/restart and packaging feasibility; H consumer inventory and routine test coverage |
| 06 local model | X coordinator; H bounded plan, X capability/privacy/process decisions | H adapter and deterministic tests; X sensitive lifecycle logic | X privacy, cancellation and unintended outbound calls; H capabilities and evaluation coverage |
| 07 local MCP | X coordinator and transport/authorization planning | X credentials and authority; H reviewed tool/transport wiring | X authorization, local-network/browser threats; H clients, tools, scope and test coverage |
| 08 local UI | X coordinator; H UI plan, X browser-session/trust design | H UI and routine integration; X session/security logic | X credential/session/CSRF boundaries and auth-contract removal; H usability, accessibility and ordinary consumers |
| 09 installation/packaging | X coordinator/planning; U for interdependent lifecycle decisions when useful | X update/recovery/process authority; H reviewed scripts and platform glue | X first run, backup/recovery, signing/update and process safety; H usability/platform evidence |
| 10 LAN MCP (optional) | X coordinator/planning; U for a broad unresolved threat-design investigation | X pairing/revocation/exposure; H setup UX and fixtures | X remote trust/security; H client compatibility and network-test coverage |
| 11 hosting portability (optional) | X coordinator and bounded-proof planning | H alternate composition; X semantic/authority changes if needed | X boundary leakage, concurrency and parity; H scope, maintainability and test coverage |

Final review covers the complete candidate diff through these specialist
mandates, not an automatic extra Ultra approval. The coordinator reconciles
findings and checks evidence. A planner/writer does not approve its own work as
an independent reviewer. Keep one writer even when effort changes by task.

## Sequencing And Safe Overlap

Subject to activation and a reviewed ownership agreement:

```text
Step 03 human-merged
    +-- 04 storage boundaries --> 05 local DB --+-- 07 non-AI MCP --+
    |                                         +-- 08 non-AI UI ---+
    +-- 06 local model ------------------------------------------+
                                                                v
                                                     09 packaged local app
                                                       +-- 10 LAN (optional)
                                                       +-- 11 hosting (optional)
```

Step 06 enables AI-backed tools/pages before the complete Step 09 acceptance
run. Steps 10 and 11 are independent optional follow-ups, not release blockers
and not prerequisites for each other. This diagram is not activation authority;
the current status and overlap restrictions remain in orchestration.

- Keep 04 and 05 implementation sequential. Early Step 05 feasibility research
  may inform 04, but do not implement a second adapter against unsettled ports.
- Step 06 is the clearest separate product lane alongside 04–05, after explicit
  non-overlap approval. Existing AI ports make independent work plausible.
- Before 07 and 08 overlap, agree listener ownership, local principal/session
  exchange, backend address/configuration, capability discovery, and human/MCP/
  browser credential separation. Assign one owner for shared files.
- Packaging research and OS/native-dependency feasibility can start early;
  final packaging waits for the local runtime. Run OS-specific validation in
  parallel only with isolated outputs/resources and the same source revision.
- Start with at most two implementation lanes as an operating preference, not
  a reviewer limit. Add a lane only if ownership, dependencies, test resources,
  and integration capacity justify it. Follow the sole-writer and shared-hotspot
  rules in orchestration.

## Planning Inputs And Internal Checkpoint Sketches

These sketches guide activation; the approved step plan must supply exact
contracts, commands, owners, supported modes, rollback/recovery, and acceptance
criteria. Checkpoints below are not separate PRs. All steps retain applicable
independent plan/final review and aggregate-gate requirements.

### 04: Storage Boundaries

Risk: cross-cutting behavior-preserving refactor with PostgreSQL as the reference.

1. Inventory persistence consumers and define behavioral contracts plus tests:
   transaction/unit-of-work ownership, mutation-plus-audit atomicity, uniqueness
   and archival state, location precedence, deterministic ordering, cascades,
   concurrent updates, reset rollback, and idempotent seeding. Keep best-effort
   access logging distinct from atomic mutation auditing.
2. Extract the smallest useful ports and convert consumers incrementally while
   PostgreSQL remains green. Include the identity coordination/session contract;
   merely hiding a concrete PostgreSQL session type behind another import is
   insufficient. Avoid a generic repository framework or one interface per CRUD
   method without a use-case need.
3. Prove retained behavior and required baseline dispositions, including seed
   cleanup, through real-adapter contracts, supported-mode restart, consumer
   checks, and the full migration gate.

Parallel discovery can split identity/recovery, preferences/audit, and grants/
queries/reset. Front-load X persistence and architecture review before broad
consumer conversion. Step 06 may own a separate approved lane.

### 05: Local Database Runtime

Risk: actual persistence replacement with possible silent corruption, lost
identity, or unrecoverable state after interruption.

1. Validate provisional SQLite/library/bootstrap choices through a bounded,
   approved feasibility checkpoint before full adapter implementation. Challenge
   JSON/null/date/uniqueness semantics, foreign keys, concurrent writers,
   mutation/audit rollback, and native/package closure on the pinned toolchain.
   Record the failure model and database choice before committing to it.
2. Implement a fresh local adapter against Step 04's contract suite. Replace
   temporary PostgreSQL identity coordination with equivalent safety and
   explicit recovery; preserve stable principal/credential behavior across
   restart, concurrent initialization, rotation, ambiguous commits, and crashes.
3. Exercise real local-database conformance, interruption/concurrency/recovery,
   consistent backup/restore feasibility, and packaged restart. Expand local
   gate evidence before retiring any supported adapter or coverage. Step 09
   still owns final installation/backup UX and platform credential protection.

LM-015 remains binding: durable operation/candidate, empty/exact reconciliation,
and fencing guarantees cannot disappear during adapter replacement. SQLite
need not mimic PostgreSQL advisory-lock SQL, but a different protocol requires
reviewed equivalent evidence and an explicit decision-log update if it changes
the accepted protocol. No historical data translation/backfill is required.

Parallelize driver/package investigation, semantic-test design, and independent
failure-model review; keep protocol ownership with one writer. Real crash and
concurrency tests, not an Ultra verdict, are the acceptance evidence.

### 06: Local Model

Settle a capability matrix and explicit download/offline/privacy policy; then
implement the local adapter behind existing ports and validate it. Separate
deterministic merge tests from declared live-model evidence. Cover timeouts,
cancellation, malformed structured output, unavailable runtime and unsupported
file/multimodal features. Preserve application validation of model proposals;
never silently fall back to a hosted model. Evaluation-fixture work and privacy
review can run alongside the sole writer.

### 07: Local MCP

Choose transport and distinct MCP credential/grant authority, then wire useful
non-AI tools, followed by client and security evidence. Preserve or deliberately
evolve registered tool/mutation/consumer contracts. Test missing, wrong, revoked
and overbroad authority plus applicable Host/Origin/CSRF/DNS-rebinding cases.
Loopback is not authentication, and the human file bearer is not an MCP token.
Run client inventory, threat analysis, and protocol-test design independently.

### 08: Local UI

Agree a safe browser/session exchange, deliver non-AI flows and capability-gated
AI UI, then prove browser integration and auth removal. Do not expose the private
human bearer to browser code. Inventory consumers before final `user(id)` or
route removal through LM-008. Visual components and state fixtures can proceed
in parallel with MCP after shared contract/ownership agreement; shared API
clients, auth, configuration, and generated schemas need coordinated changes.

### 09: Installation And Packaging

Confirm supported platforms and lifecycle design, implement the smallest
installable product, then prove clean install/offline use, restart, logs,
backup/restore, interruption, update authenticity/rollback, and non-surprising
uninstall. Include model assets and final credential/data locations. Real target
OS evidence cannot be replaced by a model review; do not imply Windows support
from macOS/Linux tests. A second PR is justified only by a genuinely useful,
safe landing boundary, not by separating scripts, tests, and docs.

### 10: LAN MCP (Optional)

After the packaged local app is stable, review the new remote trust boundary
before implementation: opt-in exposure, pairing, per-client authority,
revocation, TLS expectations, discovery leakage, and hostile-network behavior.
Implement the agreed controls and verify with independent clients/hosts. Keep
loopback the default. Do not make this a prerequisite for the local release.

### 11: Hosting Portability Check (Optional)

Choose one bounded proof that alternate identity/storage/model adapters can use
the same core; implement the minimal alternate composition and run the relevant
contract suites. Challenge single-user, filesystem, transaction, and concurrency
assumptions. This is not cloud sync, data migration, a production deployment
program, or a mandate to keep all old hosted adapters indefinitely. Read-only
portability observations may inform earlier steps without expanding their scope.

## Activation Handoff

At each activation, read current prerequisite merge evidence, not an old prompt's
SHA. Follow the required base/toolchain/worktree checks and exact-base activation
gate. The step plan records the role/effort roster, named sole writer, approved
parallel lanes, internal checkpoints, intended PR count, review dimensions,
failure evidence, and exact validation commands using
[`step-template.md`](step-template.md).

Use targeted tests between checkpoints and retain the final full local migration
gate plus applicable final pushed-head CI. Review and validation may overlap on
a frozen candidate with isolated resources; fixes invalidate affected evidence.
Keep human merge ownership and close the previous step while activating the
next, not through a standalone closeout PR.
