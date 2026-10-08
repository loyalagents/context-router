# Step 09 Inputs To P2

- Status: design inputs, not an approved implementation plan
- Owner/sole writer: `/root`
- Sources: measured [P1 evidence](feasibility.md), read-only architecture/security
  and persistence/recovery investigators requested at Astra Extra High
- Gate: native selected-model proof passed; P2 must receive explicit independent
  approvals before product edits

These inputs preserve the reviewers' concrete findings before P2. The user
approved scoped Windows/Linux deferral and the corrected P1-N.2 run. Its two
fresh native sessions passed after the predecessor's preflight failure, as
recorded in the evidence.
These inputs do not extend P1's executable scope or approve a product
mechanism merely because its fixture worked.

## Native Mechanism And Managed Admission

AppKit status-menu compilation, real menu-selector dispatch, private pipes and
the existing combined custom-server bundle are feasible on the declared Mac.
The candidate remains one resident menu application, one native guardian and
the existing single application/model-admission owner. The real selected model
subsequently proved inherited lock retention in P1-N.2, supporting P2 selection.
No Electron/Tauri runtime or second application backend is justified by current
evidence. No new Node native addon is proposed.

Keep a private management envelope outside the strict stores:

```text
Context Router/managed-v1/
  installation.json
  owner.lock
  owner.json
  stores/<generated-store-id>/data/
  stores/<generated-store-id>/identity/
  models/
  sessions/
  exports/
  diagnostics/
```

One selected-store pointer keeps the data/identity pair together. Reserve this
namespace even when management metadata is missing/corrupt: current source or
manual tools must reject it without verified managed admission. Do not add
markers inside the strict data/identity roots. Independent unmanaged roots
retain their six existing supported modes.

The same guardian serializes running the application and offline installed CLI
administration. An environment boolean cannot authorize managed access. Candidate
admission is a fresh generation nonce delivered only through anonymous inherited
pipes, with only its hash durably journaled alongside installation/store identity,
canonical pair, role, generation, boot UUID and lock/root inode pins. No nonce in
argv, environment, logs or browser. Control loss permanently stops new admissions.

The native guardian's fixed `verify-inherited` subcommand can check the child's
inherited lock descriptor using `flock(LOCK_EX | LOCK_NB)` on the same open-file
description, never `LOCK_UN`. It must be bounded and tested. Verify once at managed
bootstrap/worker admission, then retain validated admission plus journal/pin
checks at storage boundaries; do not spawn a helper per SQL statement.

Enforce below the CLI/configuration layer in `SqliteDatabase` open/bootstrap/
recoverBootstrap/connect, `LocalIdentityFileStore` before root preparation and
mutation, and `SqliteBackup` before claiming/copying destinations. PostgreSQL
reference entrypoints must reject a managed identity root before connecting or
mutating it. Preserve existing native-owner checks and identity coordination.

Coordination uses worker threads with explicit `workerData` and empty environment:
carry the bounded admission explicitly and validate before worker database open.
Threads share the process lifetime FD and must not close it. PDF children are
separate processes: inherit only the lifetime FD as managed FD 3, without a
storage capability or guardian-control channel. Prove this through the actual
staged parser, including cancellation and forced parent loss. Manual stdio stays
unchanged. Inference receives only its lifetime FD and existing private credential
file arguments.

Historical pre-Step-09 binaries and arbitrary same-user programs cannot be
mechanically fenced by a new marker. Managed roots require compliant tools and
must not be opened concurrently with historical binaries. This cooperative
admission boundary is not protection from a compromised same-user account.

## Journal, Shutdown And Recovery

Keep lifecycle quiescence separate from administrative command success. Candidate
journal states are `active` and `quiescent`, with a separate fixed outcome.
Acquire/pin the never-unlinked lock, durably record active state before spawning
any state-accessing child, and record quiescence only after the necessary exact
exits and durability acknowledgements. Partial/corrupt metadata, substituted
inodes, uncertain publication or a same-boot abandoned generation fail closed.

Clean Restart needs stopped admissions, actual worker/parser completion, the
application's bounded drain acknowledgement, guardian-observed exits of both
direct owners and descriptor extinction. Then create fresh sessions/credentials.
An application SIGKILL loses parser-reaping evidence: stop/reap the direct pair
but retain uncertainty even after an orphan parser eventually exits. No inferred
PID cleanup, automatic latch reset or mutation replay. Guardian loss likewise
does not become safe merely because the lock is later available.

The native OS boot-session UUID is available on this Mac. A different verified
boot could establish that old processes cannot survive, but actual reboot and
sleep/wake behavior has not been measured. Until that recovery path is reviewed
and qualified, such uncertain generations remain blocked. Boot evidence does
not authorize silent repair, backup restoration or identity/session claim reuse.

## First Run, Compatibility And Restore

Preflight package/platform completeness and artifact trust before any backend
entrypoint. Under exclusion, validate management metadata and monotonic security
epoch before initialize, seed or upgrade. Listener-only checks are too late:
existing UI startup seeds before listening, and initialization can commit identity
before catalog seeding fails. Preserve that identity and diagnose the exact state;
never recreate it or replay an uncertain initialization automatically.

The durable minimum epoch lives outside both `.app` and matching-pair backup.
Code replacement, reinstall and restore cannot lower it. Exact existing SQLite
schema admission still applies. Older code within an accepted epoch can be
considered only after explicit compatibility checks; binary rollback never means
automatic data rollback. Partial replacement refuses without touching state.

Missing publisher identity leaves a real distinction: local candidate inventory
checks can exercise completeness/interruption logic, but cannot authenticate a
modified manifest. Do not invent a signer, trust-on-first-use publisher claim or
environment bypass. Signed distribution acceptance remains pending. Exact local
qualification versus signed-release admission is a P2 decision requiring review.

Reuse existing `SqliteBackup.create/restore` under offline exclusion. Restore into
a new absent generated store, keep the old selected pair intact, and persist a
bounded pending-restore record before work. Explicit activation names that store
and acknowledges restored preferences/history, human identity, MCP credentials,
revocations and grants. Allow explicit credential administration while listeners
remain stopped before publishing the single selected-store pointer. A crash
around publication requires inspection of the durable pointer, never silent
switch-back or retry. Preserve incomplete destinations for named recovery.

Managed admission must authorize two narrow existing cases explicitly:
`recoverBootstrap` validates an owned scratch database with the original identity
root, and restore opens a fresh destination pair. Do not add a generic bypass.

## Concrete Test Obligations For P2

Write failing tests before backend changes, then run targeted tests after each
small increment. Exact commands/CI discovery must be fixed in P2; native tests
are not automatically exercised by the current Ubuntu-only migration workflow.

- Wrong/missing FD or nonce, forged environment admission, stale generation,
  mixed roots, missing/corrupt management metadata and current manual/reference
  bypasses reject before mutation; independent unmanaged roots still work.
- Real coordination-worker propagation, installed CLI exclusion, scratch/restore
  destinations and actual PDF-child FD retention obey the same capability scope.
- Every journal publication/crash point, partial initial setup, post-identity
  seed failure, model loading/expiry/control loss and clean versus forced exit
  has an explicit observable outcome without retrying uncertain work.
- Below-floor/incompatible/incomplete replacement rejects before initializer,
  seed or upgrade; actual persisted bytes and identity remain preserved.
- Matching-pair backup/restore tests include revoked/rotated MCP authority and
  explicit cutover, not just matching principals or file hashes.
- Pinned first-run download uses tiny deterministic interruption/corruption/
  redirect/disk-full/concurrency fixtures before any separately authorized real
  asset transfer. Ordinary offline UI/MCP and non-AI availability remain usable.
- Final installed evidence includes browser-close persistence, real unlock/
  re-unlock, explicit Quit/Restart, safe uninstall/reinstall and preservation of
  all prior model E/H limitations. New live installed tests need bounded approval.

Keep hosted/operator workflows and developer/evaluation tools as explicit
reference contracts. Inventory the new managed entrypoints/download sinks and
registry dispositions before implementation; do not remove existing consumers,
six modes or twelve phases to make installation appear simpler.
