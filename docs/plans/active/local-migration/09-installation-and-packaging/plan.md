# Step 09: Installation And Packaging

- Revision/status: P2.3 independently approved for implementation; see review ledger
- Program step: `09-installation-and-packaging`; target `main`; `local-only`
- Base: `7328ceea63a784577594d52af18062be8b583855`
- Branch: `codex/local-migration-09-installation-and-packaging`; existing checkout
- Coordinator and sole writer of code, tests, docs, generated output and Git: `/root`
- Requested coordinator: GPT-6 Astra `xhigh`; serving settings unobservable
- Risk: process authority, credentials, persistent state and artifact integrity
- PR: one cohesive draft PR; no automatic merge or public release
- Prerequisites: merged Steps 02–08; clean-base twelve-phase activation passed
- Supported outcome: managed local candidate on the exact qualified Apple Silicon pilot, preserving all six source/reference modes
- Last updated: 2026-10-06

## Outcome And Authorization

Build a resident native menu application that opens the existing browser dashboard,
keeps its combined UI/MCP backend running after browser close, and provides explicit
Quit, Restart local runtime, unlock/re-unlock and consented model download. Bundle
Node and the real production dependencies. Keep data/identity/models outside code,
reuse existing administration and matching-pair backup/restore, and require no
checkout, development toolchain, OpenSSL or external model product at runtime.

The user's latest instruction authorizes implementation and bounded installed-app
qualification as well as P1-N.2. Technical plan approval remains independent.
Root defines concrete execution bounds before native qualification; no unbounded
retries or experimentation. Actual signing access and private release destination
are still absent. Produce a locally built candidate and draft PR; never label it
a publisher-authenticated, notarized or Gatekeeper-qualified distribution.
Human acceptance remains a real user action, not an agent-approved result.

The [P1 feasibility plan](feasibility-plan.md), [evidence](feasibility.md),
[review ledger](reviews.md) and [design inputs](implementation-inputs.md) retain
previous results and failures. P2 replaces P1's candidate design for product work.

## Required Reading And Reviews

Read the [orchestration](../orchestration.md), [decision log](../decision-log.md),
[agent allocation](../agent-execution.md), [interface policy](../tracks/interface-evolution.md),
[workflow](../../../../useful/AGENT_WORKFLOW.md), canonical contract baseline and
JSON registry. Retain Step 08 plan/consumer/implementation/review/acceptance limits,
Step 03 R1, Step 05 recovery/backup and Step 06 E/H. Canonical local UI, model,
identity administration and MCP runbooks remain reference contracts.

Architecture/process/security and persistence/update reviewers use requested
Astra `xhigh`; ordinary compatibility/platform inventory uses requested Astra
`high`. Dispatch acceptance is not verification of serving settings. Reviewers
are read-only: no edits, builds, tests, downloads or native execution. Root owns
all mutations. The review ledger binds named approvals to P2 and later deltas.

## Measured Selection And Scope

Select AppKit plus a native guardian, bundled Node 24.21.0 and the existing custom
Next/Nest server. P1 proved the actual staged UI/MCP/CLI/SQLite/PDF production closure
without source/toolchain access; the uncompressed payload was about 788 MB. This
is a relatively large Next dependency closure, not an assumed tiny standalone
build. Select the already inspected X.509 dependency closure for WebCrypto-based
one-day certificates and the authenticated cached Node archive. Pin adopted
package versions/integrities and licenses in the product lockfile.

P1-N.2 passed two fresh native sessions in 33.394 seconds. Public pinned TLS was
ready in 26.851 and 0.848 seconds; exact model exit and inherited lock retention
passed in both. This selects inherited-descriptor lifetime exclusion for the
pinned b11146/Qwen3.5-9B Q4_K_M runtime. Preserve its flags, template, context,
one-slot admission, original failed quality result and accepted E/H limitations.
Do not substitute models or automatically retry uncertain inference.

The exact pilot is MacBookPro18,2, M1 Max, 64 GiB, macOS 15.1.1 build 24B91, arm64.
Only this host receives a qualified result after installed evidence. Other Macs
remain unqualified. The user approved scoped native Windows/Linux deferral;
neither is supported. Linux CI is regression evidence only.

Add `apps/desktop` for native shell/guardian, runtime preparation, asset download,
installed administration and packaging metadata. Reuse application services and
existing UI. No Electron/Tauri, new Node addon, second application backend, new
SQLite schema, background updater, login item, C/C+ onboarding, external-client
configuration, LAN/stdio/hosting, cloud migration or bulk-import system.

## Contracts And Consumers

### Post-review correction checkpoints

The user authorized the external-review corrections on 2026-10-07. Root remains
sole writer; independent read-only reviewers requested Astra `xhigh`, with actual
serving settings unobservable. The reviewed correction plan preserves P2.3's
ownership proofs and uses the existing PR:

1. Separate shell delivery failure from child completion, tolerate fully validated
   stale controls, and retain uncertainty for malformed application records.
   Add deterministic model-child lifecycle/descriptor/termination coverage.
2. Distinguish orderly maintenance cancellation from lost protocol/ownership.
   Require matching acknowledgment, actual normal exit, native drain and no force;
   preserve completion racing a late quit write. Retry the final fresh-descriptor
   lock acquisition for at most 250 ms, then retain all identity checks and refusal.
3. Add explicit native-only `cleanup-downloads` after complete inventory preflight,
   only for ready/quiescent installations without pending restore. Bind its metadata
   journal to the selected store; delete only verified private stages or the exact
   two-link model publication pair. Preserve uncertainty on abrupt interruption.
   Qualify a rebuilt committed candidate and rerun affected reviews/full gates.

Each checkpoint has targeted tests. Existing tests remain intact; new fixtures
cover the missed transitions. No model inference/download or human/signing result
is inferred from these fixtures; the separately proposed live bounds still apply.

### Re-review lifecycle corrections

The user authorized these corrections on 2026-10-07 after N1–N3 were reproduced
against Candidate06 (`9b9c5ab`). Root remains sole writer; affected independent
reviewers are requested Astra `xhigh`, with serving settings unobservable.

1. **Ephemeral unlock delivery:** retain exact generation, shape, origin and
   export-path checks for every application record, including during stopping.
   Skip file delivery checks for discarded late records. While running, a missing
   token is an expired/replaced delivery, not malformed drain evidence. Drop stale
   unlock events; retain readiness even if its initial token has disappeared so
   the menu can request a fresh code. Apply the same missing-file handling in the
   menu, which still validates existing files and rechecks before reading secrets.
   Queued menu records retain wire/path validation during Quit/Restart but never
   pin/read/display tokens then; deferred show/copy callbacks recheck lifecycle.
   Missing-token reads clear only token display/copy state, preserving readiness
   and the ability to request a replacement code.
   A narrow shared unlock-file availability helper preserves strict private-file
   validation and tolerates only observed ENOENT; persistent metadata validation
   is unchanged. Tests cover deletion during close/startup, replacement, menu
   delivery, unsafe files and malformed late records.
2. **Direct child signals:** distinguish an orderly signal request from explicit
   quit, EOF and protocol failure. SIGINT/SIGTERM/SIGHUP through the managed child
   handler may acknowledge cancellation only after native-owner drain and normal
   matching exit. Signals cannot upgrade prior EOF/failure or incomplete input
   into successful completion. Tests use actual managed/maintenance/prepare-store
   entrypoints with controlled backend work, both child-only and paired signals,
   plus retained broken-channel/forced-exit negatives and real SQLite recovery.
3. **Operator clarity and qualification:** retain strict root/models inventory;
   document the exact Finder `.DS_Store` refusal and narrowly scoped offline
   remedy, with a nonmutating-refusal regression. Correct the stale signal test
   comment, conservative late-cancellation wording, crash/I/O cleanup limits and
   journal-operation rollback rule. Label Candidate06 as historical once code
   changes; bind the rebuilt candidate, installed smoke, full local gate and both
   CI workflows to the new clean commit on the existing draft PR.

Each checkpoint ends with targeted tests; affected plan review precedes product
edits, and implementation review precedes qualification. No live inference,
download, human acceptance, merge or distribution is added by these corrections.

### Human acceptance: dashboard navigation after Restart

On 2026-10-09 the user reported that fresh unlock codes failed in the existing
browser tab after Restart, while Open dashboard worked. The menu requests an
ephemeral UI port for each generation but opens the browser only on first launch.
The old tab therefore keeps addressing the stopped generation. Root remains sole
writer; affected independent review is requested on Astra `xhigh` (actual serving
settings unobservable), covering menu lifecycle, browser guidance and regression
coverage. The bounded correction has two checkpoints:

1. Add a failing native menu regression with distinct old/new origins. After an
   explicit Restart, open the new validated dashboard origin exactly once at
   readiness, never while stopping/quitting or on failed startup. Preserve fresh
   browser authentication, ephemeral ports, private control, drain/reaping and
   all persisted state. Tests intercept browser opening; they do not operate the
   user's browser or installation.
2. Clarify the restart confirmation and local unlock guidance for the Mac menu
   and retained terminal launcher. Old tabs need Open dashboard; no port scanning,
   redirects, credential transfer or automatic unlock is introduced. Run targeted
   menu and browser checks, affected independent review, then qualify a separate
   rebuilt candidate and final gates. Candidate 08 and the user's running copy
   remain unchanged; no model download/inference or human acceptance is inferred.

### Human acceptance: disconnected dashboard tabs

On 2026-10-10 the user retried `$app` after staging Candidate 09 in `$next_app`;
read-only process inspection confirmed the older app remained running. Separately,
Candidate 09's auto-open behavior still leaves the old tab offering an unusable
unlock form. The user requests either a reusable tab or an explicitly retired
page. Root remains sole writer; the existing affected reviewer is requested on
Astra `xhigh` (actual serving settings unobservable).

1. Add real-browser regressions for an authenticated tab losing its original
   runtime and an already locked tab attempting unlock at an unreachable address.
   Clear private browser state and replace the entire authenticated/unlock UI with
   a disconnected screen. Distinguish connection failure from a live server's
   expired/invalid session or busy response; preserve valid same-origin re-unlock.
2. Implement only browser connection-failure presentation at session restoration,
   focus/visibility revalidation and unlock. Direct the user to close the obsolete
   tab and use the dashboard opened by Restart or CR → Open dashboard; retain
   terminal-launcher guidance. Do not close browser tabs programmatically, discover
   ports, redirect credentials, retry writes, preserve authentication across
   Restart or change native/backend/storage contracts.

Run the focused new regressions plus affected session/browser cases against a
fresh web production build, then renew affected independent review. Per the user's
incremental-validation instruction, rebuild a separate app for human retesting
with the necessary artifact checks, but defer the full local gate, complete
installed qualification, final review and exact-head CI to the agreed final
candidate. Existing candidate evidence remains historical for changed web inputs;
unaffected native, storage and transport coverage is carried explicitly.

### Retained consumer contracts

Preserve all GraphQL, browser REST and MCP tool/resource payloads and credential
boundaries. The native lifecycle channel is inherited and private; no new HTTP
lifecycle authority. UI and MCP retain one application and one model admission
owner. No hosted fallback or normal-runtime remote calls.

Add managed-only admission below configuration at SQLite open/bootstrap/recovery/
connect, identity root preparation and mutation, and backup/restore destinations.
All current local entrypoints lacking admission reject the reserved managed
namespace; independent unmanaged roots preserve existing behavior. PostgreSQL
reference paths must reject managed identity roots before connect/mutation.
Historical binaries and arbitrary same-user programs cannot be fenced by new
metadata; managed roots require compliant tools. This is cooperative lifecycle
exclusion, not protection from a compromised same-user account.

Before product changes, inventory and register native launcher/guardian, prepare,
downloader and installed CLI consumers, artifact/model manifests and outbound
sinks through the existing LM-008 registry process. Preserve all six supported
modes, twelve gate phases, hosted/operator and developer/evaluation reference
coverage. Exclude those reference tools from the installed payload without deleting
their source contracts. New downloader HTTPS is consented provisioning traffic;
normal application traffic stays loopback. Update fingerprints with code.

Make desktop discovery executable in `check-contract-baseline.mjs`: add
`apps/desktop` to `EXPECTED_PACKAGES`, `CONTRACT_REFERENCE_ROOTS` and
`OUTBOUND_SINK_ROOTS`; include `.c`, `.m` and `.mm` in the appropriate source
collectors. Add a bounded native sink vocabulary for fork/exec/posix_spawn,
Foundation task launch/URL opening, native socket/connect and NSURLSession/CFNetwork
request entrypoints alongside existing JavaScript download/spawn detection.
Inventory actual native calls and fingerprints in the JSON registry; this source
tripwire is not a general C/Objective-C security analyzer. Extend collector/sink
tests so an unregistered desktop JavaScript download or native spawn/network call
fails, and generated native build directories are excluded without excluding
source. Preserve every existing root and registered reference consumer. Registry
entries land with their real source paths in the same implementation increment;
the planned consumer map precedes product edits, rather than adding nonexistent
paths to a registry that requires every source to exist.

## Native Topology And Private Protocol

The menu app starts one native guardian through retained pipes. The guardian uses
`fork`/`exec` with explicit descriptor duplication/closing (not assumed NSTask FD
inheritance), and is the direct parent of prepare, application, model and optional
downloader children. Native code uses Foundation for bounded JSON, CommonCrypto
for digests and arc4random_buf for nonces; there is no general RPC or
arbitrary command service. Executables/entrypoints resolve from its own bundle.

After admission and active journal publication, run one finite bundled-Node prepare
child. It verifies/initializes the selected pair as allowed below and generates
fresh session material. Observe its actual exit before launching the existing
combined application and optional model as direct children. Keep the lifetime lock
held continuously across preparation and runtime. No resident JavaScript manager.

Fixed shell commands are `unlock`, `restart`, `download`, `cancel-download` and
`quit`, with version/generation checks. Administrative command arguments go through
the installed CLI parser, never through browser messages. Bound messages to 16 KiB,
reject unknown fields/commands, stale generations, overlong/partial EOF frames and
control loss. No arbitrary executable, PID, shell text or browser-supplied URL.
The guardian relays fixed status/origins/private unlock-export metadata to the menu.
It does not print credentials. AppKit opens only the validated literal-loopback
public dashboard origin; it never opens a credential URL.

The application owns its PDF subprocess; SQLite coordination workers are threads.
Pass the lifetime descriptor as FD3 to all separate cohort processes, including
PDF and downloader. No holder calls LOCK_UN. A model/PDF/downloader gets no storage
capability. Each prepare/application/maintenance process gets a distinct bounded
anonymous FD4 message containing its role-scoped capability; pipes are not reused.
Workers receive validated admission explicitly through workerData with empty env
and share the process lifetime FD without closing it. A shared atomic admission
flag propagates parent control loss to worker guards; application control EOF
permanently revokes new storage/model admissions and begins shutdown. The flag
alone never authorizes access; all capability/journal/FD checks still apply.

The same compiled native guardian has a fixed bounded `verify-inherited` operation:
perform `flock(LOCK_EX|LOCK_NB)` on inherited FD3, check its private regular inode,
and exit without unlocking. Run once at process/worker managed admission; subsequent
storage admissions check retained capability, journal generation and pinned paths,
not a subprocess per SQL statement. A reopened lock FD cannot impersonate the
held open-file description. Verify this with actual native fixtures and staged PDF.

## Durable Envelope And Admission

Default root: `~/Library/Application Support/Context Router/managed-v1`. The shell
resolves home natively and passes an explicit canonical path; no backend HOME/dotenv
fallback. Installed CLI may accept an explicit private root for isolated testing
or deliberate operator choice, but its basename must remain `managed-v1`.
Reserve that namespace at any ancestor of data/identity paths even if management
metadata is missing/corrupt. Do not put markers inside strict store roots.

```text
managed-v1/
  installation.json             # installation ID, selected store, minimum epoch, setup/restore status
  owner.lock                    # private, never unlinked/replaced
  owner.json                    # durable generation and outcome
  stores/<random-store-id>/data/
  stores/<random-store-id>/identity/
  models/
  sessions/<random-generation>/
  exports/
  diagnostics/
```

All mutable directories are private owner-only, files 0600; reject symlinks,
hardlinks, wrong owner/mode, noncanonical/mixed roots and changed inode pins using
existing validation rules. Bound JSON sizes and exact fields. Durable publications
use exclusive staging, fsync, atomic rename and parent-directory fsync. Leftover
staging or ambiguous publication is a diagnosed state, not disposable debris.

Native guardian acquires/pins the lock and validates installation metadata before
any persistent-data child. A fresh empty management envelope can reserve exactly
one random absent pair with setup state `initializing`; never infer fresh intent
from a missing database beside existing identity. Root/lock/installation pins,
random generation, OS boot-session UUID, role, selected/pending pair and nonce hash
are recorded before child admission. The raw fresh nonce exists only in private
inherited messages/memory. No nonce in argv, environment, journal, browser or logs.

Prepare bootstrap admission permits exactly that reserved empty pair before the
logical database target exists. Successful prepare verifies schema/identity/target,
pins the resulting roots and target, and publishes setup `ready` before application
admission. Fresh setup explicitly performs the existing v1-to-v2 upgrade before
ready. Existing startup only verifies the selected pair; it never initializes
or upgrades implicitly. A failed setup is retained. Explicit `resume-setup` inspects
whether a valid identity/pair already exists and may complete idempotent catalog
seeding and explicit v1-to-v2 upgrade before ready; it never reinitializes that pair.
Partial bootstrap/identity operations require their existing named recovery,
not generic retry. No principal recreation after a seed failure.

Implementation clarification from the persistence review: named identity recovery
uses a distinct maintenance capability bound to the exact existing private pair;
the existing recovery validator resolves the target and reconciles operation,
candidate and canonical artifacts. If successful recovery leaves an empty identity,
the operator may explicitly select `initialize-recovered` for that same reserved
non-ready pair. Require the preceding successful quiescent identity-recovery or
bootstrap-recovery journal, existing pinned data and empty database principals;
identity must be empty, or may be absent only after bootstrap recovery. Open the
existing database and retain its target before creating identity material. Ordinary
initialize remains fresh-only; resume never initializes. Finite offline preparation
acknowledges controlled failure only after actual native-owner drain with intact
private control, matching its nonzero exit; lost/mismatched completion remains
uncertain. This preserves explicit recovery after transient preparation failures.

Thread capability propagation and special recovery paths are explicit: bootstrap
recovery may validate its exact owned scratch database with the original identity;
restore may create/open the exact absent pair named in the pending record. Preserve
all existing native-owner checks and mutation guards. No general bypass flag.

## Lifecycle, Readiness And Recovery States

Journal lifecycle is `active` or `quiescent`; operation outcome is separate (`ok`,
`failed`, `uncertain`). `active` is durable before prepare or any state-accessing
child. A quiescent result requires all required top-level exits, application drain
acknowledgment after actual worker/PDF exit, and lifetime lock-holder extinction.
Administrative failure can be quiescent while still requiring named reconciliation.
A lost/forced application exit without drain acknowledgment is uncertain even if
all descriptors later close. Available lock, missing port and elapsed time are not
reaping evidence. Corrupt metadata and same-boot abandoned generations block launch.

Explicit Quit/Restart stops admissions and download, asks application to drain,
allows 15 seconds then signals exact retained children, allows five seconds before
exact-child SIGKILL and five more to observe exit. A forced path cannot claim a
clean application drain. Do not signal recorded/inferred PIDs or process names.
Only a proven quiescent generation may restart with new credentials. Browser close
has no effect. Model failure keeps non-AI services usable while blocking new AI;
an explicit restart drains/reaps the whole old pair, then creates a fresh session.
No in-place claim/latch clearing, inference retry or uncertain mutation replay.

Guardian loss leaves surviving FD holders and an active journal. Application and
prepare detect private control EOF and stop new admission; model ownership may
remain uncertain. No auto-relaunch. Cross-boot recovery stays an explicit named
operation; unless actual boot identity transition and required recovery evidence
are qualified, refuse that path and preserve all state. Do not invent successful
reboot evidence or destructive repair to make the candidate usable.

For model loading, extract strict read-only session inspection from the existing
claim validator. A generation-bound readiness controller reads only validated
certificate/port input and polls unauthenticated pinned-TLS health, at most once
per 200 ms, with 60 seconds monotonic startup budget and clamped per-request timeout.
It runs independently of browser/MCP status call cancellation. Before ready, both
AI ports/status return unavailable without claim/authenticated probe, while ordinary
UI/MCP remains available. After ready the existing service performs its normal
single claim, negative-key/authenticated qualification and admission. A terminal
startup/control/expiry failure never returns to ready in that generation.
The private installed-shell status distinguishes healthy loading from terminal
unavailability; public AI status remains unavailable before readiness.

Keep current one-day certificates. Refuse new AI before expiry, abort/settle
in-flight inference through existing limits, and require explicit whole-generation
restart. AppKit workspace sleep/wake notifications invalidate AI admission; no
automatic restart or inference replay on wake. Non-AI services may continue if their
process is healthy. Test native notification wiring and deterministic timing; actual
sleep/wake remains visibly pending until exercised on the pilot host.

## Browser Experience And Model Assets

Menu actions: Open dashboard, New unlock code, Copy unlock code, Download model,
Cancel download, Restart local runtime and Quit. Reuse existing one-use/five-minute
unlock export and separate browser session. Native display/copy is deliberate; no
service secret enters URLs/arguments/logs. If clipboard clearing is implemented,
clear only matching content plus unchanged change-count, best effort. Server expiry
and consumption remain authoritative. Fixed status explains loading/unavailable and
that Restart interrupts browser/MCP connections. No full onboarding/UI redesign.

Bundle the pinned native runtime and its libraries/licenses; weights remain absent
until an explicit consent dialog names model, purpose, source and 5,680,522,464-byte
size. Downloader is a guardian-owned Node child with no storage capability. Use
pinned immutable HTTPS source, explicit redirect host allowlist, no credentials,
maximum five redirects, exact content-size/sha256, 30-second idle and 60-minute total
limits, exclusive private stage and no-clobber publication after fsync. Bound progress
messages to twice a second. No automatic retry/resume. Cancel/failed checks remove
only that child's owned stage after actual exit; crash leftovers are named and
explicitly cleaned, never selected. Verify free space with a conservative required
size plus 1 GiB margin; disk-full remains a tested failure, not a guaranteed reserve.

Non-AI remains available throughout download. Completion offers explicit Restart;
no hot adapter replacement. Tests use tiny local fixture bytes and injected source
configuration confined to test modules, not a production arbitrary-URL override.
Qualification reuses verified cached weights; no new 5.7 GB download is necessary.

Reviewed implementation clarification: the menu requests MCP port 8787, matching
the existing manual client setup, while UI stays ephemeral. Before envelope
admission the guardian checks each requested nonzero loopback port with Node's
SO_REUSEADDR semantics, then closes the probe. An occupied listener is preserved;
no fallback or process killing occurs. The probe is not a reservation: a later
race can still fail startup and leave an uncertain generation. Actual fixed-port
restart after MCP traffic is included in installed qualification.

## Installed CLI, Backup, Restore And Updates

Bundle `Contents/MacOS/context-router` as a native guardian CLI entrypoint selecting
fixed packaged Node scripts. No PATH-installed shim. Require the app to be quit for
offline maintenance; acquire the same lock/journal exclusion. Preserve existing CLI
argument validation and private exclusive credential exports. Include list/provision/
rotate/revoke/policy/grants, human rotation/named recovery, upgrade, backup and restore.
No raw credentials in general diagnostics or menu state.

Backup reuses SqliteBackup under proved exclusion into an absent private destination.
Restore reserves a new random store ID and pending record but leaves the destination
absent for the existing restore implementation to create. Preserve current selected
pair. Bind the pending record to the source completed-bundle digest, generated
destination and expected current selection. A pending restore blocks normal launch
until explicit activation or abandonment; abandonment preserves its destination.
Provide offline CLI operations against exactly the pending pair to inspect,
rotate human authority and revoke restored MCP credentials before activation.
`activate-restore <store-id> --acknowledge-restored-authority` explicitly acknowledges
restored data/history/preferences, human credential, MCP credentials/revocations/grants.
Activation durably changes one selected-store pointer under exclusion. A crash around
publication requires reading the durable pointer and named reconciliation, never
silent switch-back/replay. No automatic backup restoration during startup/update.

An immutable package manifest records payload paths/sizes/digests, platform,
Node/model pins, SQLite/identity format support and security epoch 1. Native preflight
verifies bundle completeness and platform before executing bundled Node; prepare
checks persisted minimum epoch and management admission before every state-accessing
entrypoint, including offline administration/restore and SQLite open. Existing
filesystem admission precedes native open; exact schema/target admission precedes
application mutation. Preserve Step 05's narrow exception for intrinsic SQLite
hot-journal recovery before logical schema/target validation. Do not introduce raw
schema parsing or copy validation. Floor is outside code and backup, monotonically
increased and never lowered by reinstall/restore. Below-floor code rejects before
SQLite access; unknown/newer schema rejects application mutation under the retained
intrinsic-recovery contract. A durably raised floor remains raised even if
later startup fails; missing/corrupt existing metadata never recreates a lower floor.
Epoch 1 includes Step 08 history masking; historical
same-schema binaries are not accepted as safe packaged downgrades.

For this local candidate, digests establish completeness relative to a trusted local
build, with source identity and an external artifact digest retained in its build
receipt; they do not authenticate a modified manifest or publisher. Distribution kind
is explicitly `local-candidate`. Signed-release admission, nested signing, notarization
and Gatekeeper tests remain unavailable until real publisher access/destination exist;
no invented signer, TOFU claim or environment bypass. Manual replacement means Quit,
replace the entire compatible candidate, then launch. Test interruption, altered/missing
files, old/new overlap and incompatibility. Compatible code rollback preserves the
current pair; never imply database rollback. Default uninstall removes only the `.app`;
reinstall preserves data/identity/models/backups. No destructive reset action in this PR.

Private diagnostics contain fixed categories and release/platform identifiers only,
at most 256 records / 64 KiB per file, two files. Do not persist raw model/app stderr,
prompts, files, SQL, tokens, user paths or preference/history values. Test canaries and
bounded malformed output. Actual offline acceptance denies remote networking to the
installed cohort and audits transitive telemetry/update behavior.

## Checkpoints And Validation

All checkpoints stay on this branch and one draft PR. Existing source/manual modes
remain supported throughout; the installed candidate is not claimed usable until
checkpoint 2 integration passes. Write backend tests first, record red signal, make
small changes, and run targeted tests after each increment. Do not weaken existing
assertions because new code fails them.

### 1. Complete Measured Selection And Product Plan

P1 measured bundle, TLS, AppKit, guardian and selected-model results are complete.
Record N.2 evidence and user deferral. Freeze P2 and obtain explicit independent
architecture/security, persistence/update/recovery and compatibility/test/platform
approvals; resolve blockers before product code. Inventory/register consumers and
outbound additions before their implementation.

### 2. Managed Candidate In Small Testable Increments

1. Failing managed-admission unit/local-database tests: missing/forged capability,
   reopened/wrong FD, stale nonce/gen, substituted paths/lock, missing metadata,
   source/manual/reference bypass, worker propagation, scratch and pending restore.
   Then implement the guard and native verifier. Test unmanaged regressions.
2. Failing real LocalModelService and both-transport tests for no early claim,
   loading non-AI use, cancellation isolation, failure/expiry/control loss. Add
   readiness boundary and actual PDF FD3 propagation with cancellation/exit evidence.
3. Failing native guardian/prepare tests for every durable transition, duplicate
   launch, occupied port, slow prepare, shell/control/owner loss, forced shutdown,
   exact parser/worker drain, fresh restart and CLI exclusion. Implement finite
   prepare and installed bootstrap; qualify real packaged FD inheritance.
4. Failing tiny downloader and package/floor tests, then implement assets, native
   menu, staging and CLI/backup/restore. Verify unlock/re-unlock with real browser,
   private exports and simultaneous UI/MCP non-AI use; browser-close persistence.

Target commands use pinned Node/pnpm. Backend unit/local-database test projects run
through existing Jest discovery/build prerequisites. Node tests in `apps/desktop/test`
run via `pnpm --filter desktop test`; native owner tests run via
`pnpm --filter desktop test:native` on Darwin. Build through
`pnpm --filter desktop package --out <owned-absent-path> --node-archive <path> --model-archive <path> --model-license <path>` using pinned cached
Node/runtime inputs or an explicitly verified acquisition; no personal install.
Final exact scripts/CI path filters are introduced together with the package.

The concrete discovery contract is:

- `apps/desktop/package.json`: `test` runs `node --test test/*.test.mjs` for
  platform-neutral metadata/admission/download/packaging tests; `test:native` runs
  `node --test --test-concurrency=1 test/native/*.test.mjs` and requires Darwin
  arm64 rather than silently skipping; `build:native` compiles the real native
  menu/guardian with the installed Apple compiler and Foundation/AppKit. Ordinary
  workspace build validates JavaScript on Linux and identifies native output as
  unbuilt there; Linux does not require an Apple compiler.
- Append exact argv `["pnpm","--filter","desktop","test"]` to the existing
  `backend-unit-build` phase after backend build/model/UI prerequisites. Update
  `scripts/local-migration/gate-phases.json`, the matching command allowlist in
  `gate-runner.mjs`, and exact-matrix/discovery tests in `gate-phases.test.mjs`
  and `gate-runner.test.mjs` together. Retain all existing commands, twelve phases,
  six modes and timeout budgets; investigate any real budget failure explicitly.
- Add `desktop` changes output/filter and `desktop-native` job to
  `.github/workflows/ci.yml`. Use `macos-15` with an explicit Darwin/arm64
  assertion, pinned Node 24.21.0/pnpm 10.25.0, frozen install, compiler/SDK check,
  backend Prisma generation/build, then desktop `test`, `build:native` and
  `test:native`. Headless fixtures exercise the production guardian with owned
  fixture payloads, exact FD/child lifetimes, journal transitions and package
  completeness/floor logic. No live AI or WindowServer test is silently skipped
  and counted as this job's success; those are separate local artifact evidence.
  The [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
  lists `macos-15` as arm64; runtime assertion detects a changed runner contract.
- Desktop filter includes `apps/desktop/**`, `apps/backend/**`, `apps/web/**`, both
  workflow files, `.nvmrc`, `.npmrc`, root package/lock/workspace files,
  `scripts/check-toolchain.mjs`, `scripts/local-migration/**` and the contract
  registry. Add `apps/desktop/**` to shared backend/frontend filters. Keep all
  orchestrator/eval filters and jobs. The dedicated migration workflow already
  runs on every main PR/push; its new exact phase command supplies portable
  desktop coverage without a Darwin dependency.
- Extend `ci-path-filters.test.mjs` to require the new job/filter, desktop-only
  and shared-boundary routing, exact Darwin architecture/commands, explicit native
  test discovery, and unchanged Linux reference coverage. Tests must fail if
  desktop edits select no job or Darwin native coverage becomes a skip.
- CI validates native compilation/headless behavior and packaging logic only;
  it needs no model or Node release archive acquisition. Actual production `.app`
  packaging uses the verified local cached Node/runtime inputs and is qualified
  separately against the frozen source-bound local artifact. Do not label the
  CI fixture payload as that full production closure.

### 3. Installed Artifact, Failure Proof And Closeout

Exercise copied actual `.app` payload in a private temporary installation root with
source/developer-tool reads denied, empty PATH and only bundled executable paths.
Use the real UI/MCP/SQLite/PDF/CLI plus deterministic model fixtures first. Prove
setup/seed failure, interrupted/corrupt download, duplicate/occupied-port startup,
explicit Quit/Restart, application/guardian loss with surviving parser, offline
operation, expiry/sleep notification, backup/restore authority, compatible/incompatible
replacement and uninstall/reinstall preservation. No observer may change personal
client configuration or reuse personal application state.

One bounded real installed-model series is authorized by the latest user request,
subject to separate reviewed executable manifest: at most four fresh generations,
eight synthetic completions total, 128 output tokens each, 60 seconds per completion,
15 minutes total including reserved cleanup; cached selected assets only. No retries
of uncertain calls, no intentional unbounded native orphan and stop at first failed
or uncertain check. Fixture-only failures can be fixed and re-tested under normal
implementation authority; changing live-series bounds renews affected review.
The manifest must be concrete and reviewed after the actual candidate exists.

Mac native CI must compile/test headless guardian/FD/lifecycle and package logic.
AppKit WindowServer and actual native AI remain exact local-host evidence, not a
claim that Ubuntu CI exercises them. Add new paths to both CI triggers/filters and
retain standard builds/tests and all twelve migration phases. Put platform-neutral
managed tests in an existing gate phase rather than silently creating a seventh
supported baseline mode or replacing coverage. Run one final complete local gate:
`MIGRATION_GATE_BASE_SHA=7328ceea63a784577594d52af18062be8b583855 pnpm migration:gate`.
Record copied source identity, dirty status, phase results, caller integrity, cleanup
and timing. Run Markdown links and diff checks.

Freeze the full base-to-candidate diff for fresh independent final reviewers across
all named dimensions. Resolve blockers, renew affected tests/reviews, then commit/push
one candidate and verify standard plus dedicated migration CI on that exact head.
Open/attach one draft PR using the migration template; no merge/release. Final user
handoff includes actual install/run commands, exact hardware/evidence/limitations,
review verdicts and one consolidated human acceptance checklist. Missing signing,
actual sleep/reboot or user acceptance stays visibly pending, never silently passed.
Restore acceptance uses actual MCP guard and grant behavior for credentials revoked
or rotated since the backup, including before and after explicit authority cutover.

## Recovery, Review Changes And Exit Criteria

A code-only revert before installation leaves existing user data untouched. After
installation, proved Quit precedes replacement. Preserve envelope, selected pair,
models and backups. Uncertain generations remain blocked until reviewed named
recovery with real quiescence evidence; do not clear metadata to resume. Default
uninstall never deletes data. No automatic older-backup or authority restoration.

Material changes renew affected named review before implementation. Inventory and
read-only reviews may run in parallel; shared files, native execution, state roots,
ports, generated output and Git remain sole-writer resources. Final review/testing
may overlap only on frozen inputs and isolated resources.

Exit: actual installed candidate and failure matrix demonstrated; preserved reference
contracts pass; independent full-diff reviews, final local gate and exact-head CI pass;
canonical runbooks/registry are updated; one draft PR and acceptance checklist are
available. Signing/notarization and unperformed human/platform checks remain explicit
release limitations. No standalone planning or closeout PR.
