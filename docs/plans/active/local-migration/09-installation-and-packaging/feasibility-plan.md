# Step 09: Installation And Packaging

- Document status: P1 independently approved for bounded checkpoint 1 only; broad implementation still gated
- Program step: `09-installation-and-packaging`
- Target branch: `main`
- Planning base commit: `7328ceea63a784577594d52af18062be8b583855`
- Branch: `codex/local-migration-09-installation-and-packaging`; existing checkout only
- Change classification: `local-only` product addition; shared contract/gate/build surfaces require regression review
- Depends on: merged Steps 02–08; exact clean-base activation gate passed
- Planning owner, implementation owner, coordinator and sole repository writer: `/root`
- Risk profile: high — process authority, browser secrets, durable identity/data, download/update integrity and native distribution
- Plan reviewers: all independent architecture/scope, security/process, persistence/recovery and compatibility/platform mandates approved P1; see review ledger
- Implementation PR: not opened
- Intended PR count: one cohesive draft PR with internal checkpoints
- Supported mode after merge: declared Apple Silicon managed pilot plus preserved source/reference contracts; qualification limits explicit
- Last updated: 2026-10-04

## Outcome

Install a small resident Mac application that opens the existing dashboard,
keeps the combined backend/MCP runtime available when the browser closes,
provides terminal-free browser unlock and explicit Quit/Restart, and owns the
selected local inference process. Node and required production dependencies
ship with the app. Model weights require explicit first-run consent and pinned
integrity checks; non-AI use works without weights. Data and credentials survive
replacement/uninstall. Installed CLI administration and a tested manual MCP
connection remain available without a checkout or developer tools.

P1 proposes a bounded feasibility plan, not a selected architecture. Independent
approval of P1 authorizes checkpoint 1 probes only. A measured selection and P2
review are required before checkpoints 2–3 product implementation. No public
release, automatic merge, external-client configuration or new live-model run
is authorized by this document.

## Required Reading

- [Orchestration](../orchestration.md), [decision log](../decision-log.md),
  [agent execution](../agent-execution.md), [interface evolution](../tracks/interface-evolution.md),
  [agent workflow](../../../../useful/AGENT_WORKFLOW.md).
- [Contract baseline](../../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md)
  and [JSON registry](../../../../current/local-migration-contract-baseline.json).
- Step 08 [README](../08-local-ui/README.md), [plan](../08-local-ui/plan.md),
  [consumers](../08-local-ui/consumers.md), [acceptance](../08-local-ui/acceptance.md),
  [implementation](../08-local-ui/implementation.md) and [reviews](../08-local-ui/reviews.md).
- [Local UI](../../../../useful/LOCAL_UI.md), [model](../../../../useful/LOCAL_MODEL.md),
  [identity administration](../../../../useful/LOCAL_IDENTITY_ADMIN.md),
  [MCP setup](../../../../useful/MCP_LOCAL_SETUP.md).
- Retained Step 02 packaging, Step 03 R1, Step 05 matching-pair backup/restore,
  Step 06 selection/E/H and Step 07 transport/credential/recovery evidence.
- [MCP onboarding](../../mcp-onboarding/README.md) and [UI usability](../../ui-usability/README.md)
  remain deferred. Read actual web launcher, local composition, model service,
  SQLite coordination/backup, packaging smoke, migration gate and CI before edits.

## Agent Allocation

The [review ledger](reviews.md) records requested versus observable settings,
inventory assignments and capacity limits. Root writes every repository file,
test, generated artifact, commit and PR. Other agents stay read-only.

| Role | Requested model/effort | Ownership | Independent work |
| --- | --- | --- | --- |
| Coordinator and sole writer | Astra `xhigh`; actual serving settings unobservable | Whole branch | Reconcile evidence and all findings |
| Packaging/acceptance inventory | Astra `high`; dispatch accepted, internals unobservable | No writes | Closure, platform constraints, consumers and test discovery |
| Architecture/security review | Astra `xhigh` | No writes | Process authority, browser exchange, network and scope |
| Persistence/update review | Astra `xhigh` | No writes | Durable transitions, backup, replacement and recovery |
| Compatibility/platform review | Astra `high` | No writes | Observable acceptance, source/reference contracts, native support claims |

Escalate a specific unresolved interdependent lifecycle decision to Max/Ultra
only if needed; do not silently raise all agents. Inventory contributions do not
constitute plan approval. Fresh final full-diff review remains mandatory.

## Entry Criteria And Current Evidence

The [activation receipt](activation.md) establishes the exact clean source/base,
twelve passing phases, caller integrity, cleanup and timing. Current main and
the requested branch began at the verified merge; no user changes were present.

- `apps/web/local-ui.mjs` owns Next plus one Nest application and two loopback
  listeners. Both UI and MCP reuse the same application/model owner. Production
  staging uses offline `pnpm --filter web deploy --prod` plus `.next` assets;
  Next standalone does not contain this custom server. Existing smoke launches
  host Node, so it does not prove an installed runtime closure.
- `LocalModelService` is lazily claimed. Unlock immediately requests capabilities;
  probing `/props` while the model returns loading `503` permanently invalidates
  the session. Readiness must precede every adapter probe without disabling
  ordinary non-AI application services while the model loads.
- Browser, human identity, MCP and inference credentials are separate. Existing
  private bootstrap export is one-use/five-minute; browser sessions are bounded.
  Existing exact Host/Origin/header and MCP Origin denials remain authoritative.
- Model claims and uncertainty latches are irreversible. Step 06 E's narrow
  quality exception and H's possible manual recovery at unknown frequency retain
  the original failed qualification. New wrapper behavior cannot relabel it.
- SQLite v2 and identity coordination already provide matching-pair backup to
  an absent destination and explicit restore into absent roots. Backup contains
  credential authority; restoring an older pair can revive it. Initialization
  may commit identity before catalog seed fails; retry must inspect and reuse
  that valid identity, never recreate it.
- Only MacBookPro18,2/M1 Max/64 GiB/macOS 15.1.1 build 24B91 has retained native
  model evidence. Windows has concrete POSIX UID/mode/path and process-cleanup
  gaps. Linux CI and available engine artifacts are not native product proof.

## Scope And Non-Goals

Add a narrowly scoped Mac launcher, production staging/bundled runtime,
first-run roots/assets, authenticated local lifecycle control, CLI wrappers,
bounded private diagnostics, installed-artifact tests and release instructions.
Reuse existing domain/storage/model/UI boundaries. No new database format is
proposed. Extend only the lifecycle/readiness edges required by the managed mode.

Exclude C/C+ MCP onboarding, automatic personal client edits, LAN/stdio/hosting,
UI redesign, cloud migration/sync, automatic updates/login startup, external
daemon supervision, speculative multi-runtime abstraction and bulk import.
Launch-at-login remains deferred. Native Windows/Linux investigation is required;
shipping those applications is not assumed in this pilot.

## Contracts And Compatibility

| Contract | Intended disposition and consumer treatment |
| --- | --- |
| Application/use cases | Preserve shared UI/MCP operations, propose-before-apply, validation, provenance and uncertainty semantics |
| Storage | Preserve SQLite v2, transaction/audit/history and exact matching-pair recovery; no copying live SQLite as backup |
| Identity/principal | Preserve stable identity, human bearer, per-instance MCP credentials and grants; browser/model credentials remain separate |
| Model provider | Preserve selected llama.cpp b11146/Qwen3.5-9B Q4_K_M, both ports and E/H; add only reviewed managed readiness/lifecycle edge |
| GraphQL | Preserve registered static/dynamic contracts, `me`, deprecated `user(id)`, legacy apply, form-fill compatibility and retained `askVertexAI` wire name |
| Browser/REST | Preserve loopback Host/Origin/custom-header admission; lifecycle commands use inherited private control, no unauthenticated HTTP authority |
| MCP transport/tools | Preserve literal-loopback HTTP, six tools/six mutation operations, resources, real credential guard and separate Origin policy |
| Files/configuration | Add explicit managed roots and installed CLI mapping; preserve source/manual reference commands and reject mixed/ambiguous pairs |
| Packaging/tooling | Preserve six existing supported modes and all twelve gate phases; add installed coverage under reviewed commands without retiring reference checks |

Before checkpoint 2, create the exact consumer/outbound inventory with existing
registry tooling. Update registered consumers, fingerprint transitions and
outbound classifications in the same checkpoint as code. Installed product
excludes hosted/operator workflows, local-orchestrator command filters,
evaluation and Harbor tools; their source/reference coverage remains. Record
Step 09 dispositions through the existing migration-record process. No separate
bulk format is justified beyond backup/restore; keep any later need explicitly
deferred. Publish installed CLI/manual client guidance before retiring any path;
no public contract removal is currently proposed.

## Design Candidate To Qualify

### Shell, ownership and readiness

Test a small native AppKit menu-bar application opening the ordinary system
browser, with one guardian as direct parent of the combined Node application
and selected model child. This is a candidate, not an approved framework
selection. No embedded browser or second backend is proposed.

The guardian owns exact child handles and a dedicated process group per owned
cohort. Fixed bounded inherited pipes carry lifecycle commands/status, never
arbitrary shell strings, executable paths, PIDs or URLs supplied by the browser.
Browser close has no lifecycle meaning. Native explicit Quit and Restart stop
new admissions, settle/cancel admitted work, terminate and observe exact old
application/model owners and relevant descendants before fresh credentials.
No automatic inference retry or uncertain mutation replay is allowed.

Qualify a private persistent never-unlinked lock inode whose open-file
description is inherited by every cohort member. No holder explicitly unlocks
it while others can survive. A durable generation journal distinguishes clean
completion from uncertainty. Duplicate launch cannot replace the inode or
signal an inferred PID. Shell death closes its control pipe; a surviving
guardian must stop and reap the pair. Guardian death leaves surviving holders
blocking replacement. Later lock acquisition is not reaping evidence: an
uncertain generation must remain blocked until independently justified cleanup
observation or OS reboot. A reboot proof must distinguish the exact boot session;
wall-clock time or process absence alone is insufficient.

Current PDF children do not inherit extra stdio descriptors; native proof and
test-first propagation are required. The selected model must retain the same
descriptor throughout its lifetime. If this mechanism cannot establish the
required evidence within checkpoint 1, stop selection and review one smaller
alternative (for example OS-managed ownership); do not implement competing shells.

The application remains usable while weights are absent/downloading and while
the model loads or is unavailable. Candidate: a single configured adapter is
gated until the guardian observes bounded pinned-TLS public health `200`; status
before that returns unavailable without claiming/probing the adapter, and AI
calls fail without retry. Public health does not replace subsequent authenticated
qualification. Fixed private ready/failed control messages belong to the exact
new generation; stale messages cannot activate another session. No in-place
adapter/latch reset. Installing assets or explicitly recovering can restart the
pair, with clearly stated browser/MCP interruption.

### Roots, browser unlock and model assets

Candidate durable parent: private Application Support/Context Router, with
separate strict data, identity, model assets, session, export and diagnostics
subdirectories. Mutable state stays outside `.app`. Validate canonical ancestry,
owner, permissions, no symlinks/aliases and expected file kinds; do not weaken
existing strict root validators or silently discover/import a different pair.
Tests use owned temporary roots; personal installation changes require separate
bounded approval. Data/identity files remain private files initially; no unproven
multi-store Keychain transaction is introduced. Encryption-at-rest and hardware
power-loss durability are not implied by mode bits.

Native `New unlock code`, display and deliberate `Copy unlock code` reuse the
existing private bootstrap export over an inherited control channel. Open only
the exact public dashboard origin. No token in URL, argv, logs or HTML. Re-unlock
returns through the resident app. A clipboard clear, if used, checks both exact
content and change-count and is best-effort; one-use server expiry remains the
authority. Never clear unrelated clipboard content.

Bundle pinned Node, app production dependencies and the selected runtime's
verified native closure/licenses. Prefer an explicit small app plus first-run
model download. Weights stay absent until consent names size, model, purpose
and source. Use exact immutable provenance/hash/size, allowlisted HTTPS redirects,
private exclusive staging, bounded stream/time/space limits, final integrity
verification and atomic no-clobber publication. No partial asset is executable
or selectable. Cancel deletes only owned staging; retry is explicit and bounded,
not a silent resume/retry loop. Disk-full, corruption, truncation, redirect,
interruption and concurrent download cases need fixtures before implementation.

Generate each session's fresh API key and one-day loopback TLS certificate
without user-run OpenSSL. Existing Node/Apple inspection APIs do not themselves
issue X.509. Qualify a focused pinned certificate-generation dependency against
the current CA/self-signature/IP-SAN/date validator and actual runtime; inspect
immutable release, lock/installation scripts, licenses and outbound closure
before adding it. Do not hand-build a general certificate framework. Expired
credentials require a fresh pair after exact old-owner shutdown, not renewal in
place. Preserve selected runtime flags and no hosted fallback/substitution.

### Maintenance, updates and diagnostics

Installed CLI uses bundled Node and absolute compiled entrypoints, a sanitized
environment and exactly the selected managed roots. Candidate simplest policy:
Quit for offline administration/backup/restore, acquiring the same lifecycle
exclusion before touching state. Native backup action may perform the same
stop/reap, invoke existing matching-pair backup and report its destination; no
live-file copy. Restore requires absent destination roots and explicit operator
selection/authority decision before those restored credentials serve traffic.
Never restore an old pair as automatic app-update recovery.

Initial update is user-initiated verified manual `.app` replacement after Quit.
Record a compatibility manifest with app/security floor, SQLite/identity format,
runtime/model pins and artifact identity. Validate code completeness/authenticity
before launch and format compatibility before opening listeners. Interrupted or
incompatible replacement refuses safely while preserving current data. Binary
rollback is allowed only within a verified compatible security floor; it does
not imply data rollback. Exact distribution trust root and signing evidence
remain unresolved until the user supplies access/destination; ad-hoc signatures
and local checksums are not claimed as public publisher authenticity.

Bound diagnostics by fixed record schema/count/bytes and private rotation. Do
not log service secrets, user inputs, model prompts or raw child output by
default. Fixed safe errors preserve uncertainty and a useful next action.
Verify actual installed transitive telemetry/update behavior with blocked-network
tests and exact outbound inventory. Download traffic occurs only after explicit
consent; ordinary UI/MCP/AI requires no remote service after assets exist.
Default uninstall removes code only and preserves all user state. Destructive
reset/removal is a separate confirmed operation, not an implicit uninstall step.

## Checkpoints

### 1. Reviewed feasibility, support matrix and selection

P1 independently reviewed first. Then root alone creates bounded probes under
`scripts/local-migration/installation/` with all outputs/processes in owned
temporary roots. No personal roots, installation, external clients, enrollment,
public release or live inference. Deterministic fixtures first. Planned command:
`node --test scripts/local-migration/installation/feasibility.test.mjs`.
Keep fixture bounds explicit: at most two application generations per case,
20-second child lifetime, 5-second graceful and 5-second forced cleanup, at most
60 seconds per case, no unbounded polling/retry. Whole probe command at most
10 minutes; retain failure evidence and stop on uncertain ownership.

1. Native minimal launcher/guardian and fixture children: compile using available
   CLT, open a loopback fixture dashboard, close browser, explicit Quit/Restart,
   duplicate launch, occupied ports, shell loss, guardian loss, child loss,
   inherited-descriptor retention, inode substitution rejection and uncertain
   generation refusal. Tests assert observed exact exits, not just signals/ports.
   Compilation/output is temporary; no production shell selection is implied.
2. Production closure: stage current custom-server payload with the pinned
   existing Node binary in an isolated bundle. Source is unavailable to the
   child and PATH contains no developer runtime/toolchain. Verify Next/static,
   backend/SQLite worker, catalog/SDL, PDF assets and installed CLI startup with
   synthetic data. Inventory native dylibs and licenses. This provisional Node
   copy is not authenticated release proof; verify official signed archive
   provenance before a distribution candidate is accepted.
3. Readiness/authority model: isolated fixtures send loading/ready/failed/stale
   generation transitions, show non-AI availability, and prove no model claim or
   adapter probe before ready. Test private fixed control framing and bootstrap
   secrecy without changing product behavior in this checkpoint.
4. Certificate/provenance feasibility: first resolve an immutable focused library
   candidate and review closure. A temporary isolated fixture may generate and
   validate certificates with bundled Node; no product dependency changes until
   selection review. Metadata/downloads required for this probe must obey the
   user's separate large-download approval requirement.

Native pinned-model descriptor retention/TLS/loading proof, new live-model calls
or large downloads require a separately bounded request after P1 approval,
naming existing assets or exact acquisition, maximum generations/calls/time and
cleanup. No previous Step 06 permission is reused. If that proof or signing/native
platform resources are absent, mark the selection/evidence gaps rather than
claiming completion. Review measured selection and P2 design with affected
mandates before broader implementation; failed criteria lead to a revised plan.

### 2. Usable managed Mac installation and normal operation

After approved P2, write failing tests first for every backend behavior change.
Do not weaken existing tests unless an explicitly reviewed requirement changed.
Implement small increments: roots/first-run and installed CLI; exact lifecycle;
browser exchange; managed readiness; pinned download; real production staging.
Each increment ends with its targeted tests passing and a runnable supported
source/reference mode. Add native launcher behavior without domain dependence
on AppKit. Run current local-model/session/UI/MCP/SQLite tests at affected changes.

Introduce named commands for deterministic installation unit tests, native
fixture tests and installed artifact smoke; finalize exact names/CI mapping in
P2. Native compilation and artifact staging outputs are ignored/private, never
committed accidentally. Default state is no model and no login startup. Package
first-run, repeated launch, browser-close persistence, unlock/re-unlock, explicit
Quit and Restart before adding recovery/release acceptance. Record real red/green
results and update consumers/baseline at each interface change.

### 3. Installed failure/recovery/release proof and closeout

Test the actual staged `.app` and installed CLI in owned roots with no checkout
or toolchain in child reach. Cover interrupted setup/download, offline non-AI
and separately approved native AI, duplicate/port/slow-start/resource/expiry
failures, sleep/wake, every owner crash, exact-pair restart, backup/restore,
incompatible/interrupted replacement and uninstall/reinstall preserving state.
Retain failed, inconclusive and unrun results distinctly.

Freeze the complete base-to-candidate diff for fresh independent reviews across
all named dimensions. Full final `MIGRATION_GATE_BASE_SHA=<base> pnpm migration:gate`,
documentation/diff checks and targeted native tests use frozen inputs. Fixes
renew affected evidence/review. Open one draft PR using the migration template,
attach it to this chat, and verify applicable standard CI plus dedicated gate
on the exact final pushed head. Never merge or publish automatically.

After automated validation/reviews pass, provide one consolidated installed-app
human checklist with exact commands and explicit pending platform/signing/native
acceptance. Resolve defects before ready-for-human-review disposition; a draft
PR can honestly retain external qualification blockers.

## Validation Matrix And Platform Evidence

| Surface | Required evidence | State at P1 |
| --- | --- | --- |
| Clean-base activation | Exact source/base/toolchain, all 12 phases, caller integrity, owned cleanup | Passed; [receipt](activation.md) |
| Unit/integration contracts | Test-first roots/control/readiness/download transitions; existing model/UI/MCP/SQLite regressions | Not run for new behavior |
| Mac native lifecycle | Exact child/descendant exit and crash/lock/boot recovery; real target OS | Pending reviewed probes |
| Installed closure | Bundled Node/runtime/licenses, source unavailable, toolchain absent, real UI/MCP/CLI/PDF/SQLite | Pending |
| Offline/download | Transitive denial audit; pinned stage/cancel/retry/publish; approved real AI | Pending |
| Persistence/upgrade | Matching-pair quiescence, authority preservation/explicit restore, interrupted/incompatible update and uninstall | Pending |
| Browser acceptance | Terminal-free new/reunlock, no secret leakage, browser close, clipboard safety, UI/MCP interoperability | Pending |
| Mac support | Exact M1 Max/64 GiB/macOS 15.1.1 initially; other hardware needs evidence | Proposed pilot only |
| Windows native | UID/modes/ACL/reparse handling, process jobs/reaping, runtime/accelerator, restart | Machine/access pending; no qualification claim |
| Linux native | Declared distro/libc/GPU/driver/hardware, permissions, lifecycle, real installed runtime | Machine/access pending; CI is not proof |
| Signing/notarization | Publisher identity, nested binary signing, hardened runtime/entitlements, Gatekeeper/notarized artifact | Access/destination pending |
| Final source/CI | Full local gate, Markdown/diff checks, exact pushed-head standard and dedicated CI | Pending |

The user was asked early for pilot/native machines, signing/notarization identity
and private release destination, requesting no secrets. Continue safe work while
awaiting the answer. Native Windows/Linux gaps need explicit scoped deferral
before treating their requirement as satisfied. Missing signing is a release
limitation, not successful distribution evidence. Existing Mac model evidence
does not qualify every Apple Silicon machine or this future installed app.

## Independent Review And Parallel Work

[Reviews](reviews.md) bind verdicts to revision and named contracts. Four review
dimensions may be covered by three specialists when capacity requires it, with
architecture/security both at Extra High. A planner/writer cannot independently
approve its own plan. Every blocking finding requires a concrete disposition;
material deviations renew affected review before implementation continues.

Independent read-only inventory/reviews may overlap. Root serializes all writes,
generated output, native experiments, shared-file changes and Git/PR operations.
No development worktree. The gate's owned disposable validation workspace is
permitted. Never share real writable state, ports or child ownership between
probes. Review/isolated validation overlap only on frozen inputs.

## Privacy, Rollback And Open Decisions

New trust boundaries are native shell/control, guardian, downloads, packaged
binary provenance and durable generation metadata. Loopback is not authentication.
The plan preserves browser/MCP admission and separate credentials. Private files
do not defend against an already compromised same-user account; no stronger
isolation claim is made without evidence.

Before installation, reverting this branch returns to the clean merged Step 08
source state with no personal data change. After installed state exists, Quit
and exact-owner cleanup precede code replacement; preserve all mutable roots.
Never downgrade incompatible state, restore an older pair or clear a claim to
make rollback appear successful. Explicit matching-pair restore into new roots
is a separate operator decision with authority consequences.

Open decisions owned by root at checkpoint 1/P2: native ownership mechanism and
boot proof; model readiness boundary; immutable certificate library/runtime
closure; exact update authenticity/security floor; native machine availability
and approved deferral; signing/notarization and private destination. Personal
configuration, large downloads and live-model proof require separately bounded
authorization. None is resolved by the user's product preferences alone.

## Exit Criteria And Closeout

- Independently approved plan and measured selection; all blocking implementation
  findings resolved against the complete candidate.
- Actual installed supported mode and failure/recovery matrix demonstrated;
  truthful evidence/qualification and external acceptance state recorded.
- Required local gate, native checks, exact final-head CI and documentation pass.
- Lasting commands/data/updates/privacy behavior moved into canonical runbooks;
  registry dispositions and deferred outcomes reconciled without scope expansion.
- One draft PR and consolidated installed acceptance checklist delivered; no
  merge/release claim before the human's action and required evidence.

After human merge, record the concise outcome in orchestration. Retain only
downstream-needed planning evidence; Git and the PR preserve history. No new
standalone closeout/planning PR is planned.
