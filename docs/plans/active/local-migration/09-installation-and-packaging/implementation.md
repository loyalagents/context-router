# Step 09 Implementation Evidence

- Sole writer: `/root`; approved technical plan P2.3
- State: unsigned installed candidate implemented; final qualification/review in progress; no PR yet
- Source base: `7328ceea63a784577594d52af18062be8b583855`

## Managed Namespace Denial

Tests were written first against the actual SQLite/identity entrypoints. Initial
`managed-admission.spec.ts` result: six expected failures and one unmanaged pass.
Missing/forged metadata, mixed identity/data roots, empty-root recovery, existing
database open and identity directory creation were not previously fenced.

Added the reserved `managed-v1` ancestor detector and default-deny storage guard
before SQLite open/bootstrap/recoverBootstrap and identity preparation/mutation
lease callbacks. Targeted managed admission plus existing bootstrap tests passed:
53 tests, 21.536 seconds. No existing bootstrap assertions were weakened.

Next, two additional tests failed as expected: direct identity administration
acquired its repository before rejecting managed access, and PostgreSQL reference
configuration accepted managed identity roots. Added identity access assertion
before session acquisition and unconditional managed-namespace rejection in the
PostgreSQL configuration parser. Three existing identity unit stubs gained the new
required `assertAccess` method; their prior assertions/semantics stayed unchanged.

Targeted command:

```sh
pnpm --filter backend exec jest --selectProjects unit local-database --runInBand \
  --runTestsByPath test/local-database/managed-admission.spec.ts \
  src/config/local-identity.config.spec.ts \
  src/modules/auth/local-identity-filesystem.spec.ts \
  src/modules/auth/local-identity-state.service.spec.ts
```

Result: four suites / 165 tests passed in 14.628 seconds, Node 24.21.0,
pnpm 10.25.0. The positive guardian-issued capability path, native descriptor
verification, worker propagation and remaining backup/recovery scopes are next;
this default-deny increment alone is not an installed product claim.

## Inherited Admission And Storage Scopes

Added strict versioned capability parsing, one-shot bounded anonymous FD4 admission,
actual native FD3 `flock` verification, boot-session binding, installation epoch and
journal/nonce checks, private canonical ancestry/inode pins and permanent shared
revocation. Every existing SQLite connection checks admission before operations;
close remains available after revocation. Coordination workers receive explicit
validated workerData with the same shared atomic flag and retain empty environment.
They never consume FD4 or close the shared lifetime descriptor.

The first native run exposed a blocking pipe-read timeout and the missing existing-
handle/worker guards. Switched the capability reader to libuv nonblocking pipe I/O;
the stalled input now rejects and exits after its five-second deadline. macOS
`kern.bootsessionuuid` is denied by the tool sandbox; native fixtures ran with the
approved host access against private temporary roots, without live model execution.

After targeted corrections, 21 native fixtures passed in 7.983 seconds. Cases include
actual inherited versus reopened descriptors, private-file validation, stale nonce/
generation, substituted lock pin, epoch floor, oversized/partial/stalled pipe input,
existing-handle and before-COMMIT revocation, journal replacement, real SQLite worker
admission, already-revoked worker rejection, matching-pair backup, pending restore
into an absent destination, and exact named-bootstrap scratch delegation. Backend
build passed. Earlier targeted managed/bootstrap/identity checks: 90 tests passed in
23.592 seconds. Additional before-destination backup/restore tests both failed first;
after their guards, the full existing backup suite passed all 25 tests in 17.935
seconds, preserving interrupted publication and authority restoration cases.

Backup admission currently selects exactly `exports/<generation>`; restore selects
exactly the pending store and checks the completed-source marker digest before
claiming that absent destination. Neither helper changes the selected pointer.
The native lifecycle/installed CLI remains to implement and qualify. A read-only
independent persistence review of this frozen increment is in progress; its findings
must be resolved before treating this boundary as complete.

## Package Inventory And Executable Discovery

Added portable package completeness/epoch/platform checks with deterministic file
hashes, internal-only symlinks, hardlink/writable-code rejection, exact fields and
missing/extra/altered-file rejection. Seven portable tests pass. This is build-time
inventory evidence, not native launch admission or publisher authentication yet.

Desktop test discovery is included in the existing backend-unit-build phase without
changing its budget, six modes or twelve phases. Its environment strips hosted
fixture URLs. Standard CI gains an explicit Darwin/arm64 `macos-15` headless native
job with pinned toolchain, compiled backend prerequisite and actual native tests.
The scanner discovers desktop/native extensions and bounded native spawn/network
sinks, synchronous JS process calls and actual Python acquisition calls. Generated
native output is excluded. Negative tests exercise configured discovery, not only
a synthetic sink map. All 154 targeted scanner/gate/CI contract tests passed.

Registry additions classify actual product/build/P1 sources. The checker passes:
41 capabilities, 58 GraphQL types, 57 static consumers, 19 catalog definitions,
136 contract references and 79 outbound-source entries. The larger sink census
includes previously missed synchronous/native calls in retained source tooling;
no existing reference was removed. Standalone checker base comparison was skipped;
the required full final gate will perform that comparison on the frozen candidate.

## Reviewed Storage And Model Lifecycle Increments

The independent persistence recheck approved the storage increment after three
findings were fixed: identity purpose checks now precede lease acquisition and
also guard lower-level mutations; revocation tests witness real writes and verify
rollback after actual connection/worker exit; native fixture cleanup preserves
roots if child-exit evidence is missing. Results: 26 native tests and 183 targeted
backend tests passed. Approval is scoped to storage admission, not the unfinished
full guardian. Its revision binding is in the review ledger.

Managed model startup now strictly inspects only the certificate/port, polls
unauthenticated pinned TLS within its finite window, and leaves the one-use claim
untouched until ready. Status-call cancellation is independent. Expiry and authority
loss permanently invalidate the generation's AI. Actual admitted-service fixtures
found and reproduced main-thread and early worker-establishment revocation gaps;
all paths now abort the active completion, including missing/malformed journals
before worker establishment. Worker revocation notifies the parent's shared flag.

The PDF child inherits only FD3 lifetime authority. Shutdown separately awaits
actual child exit, including after the caller's bounded reap-observation deadline;
a canceled asynchronous setup never spawns. The retained drain promise resolves
without retaining parsed document text. The independent readiness/PDF reviewer
approved the corrected increment. Before the final early-worker correction, 84
combined native/model/parser tests passed in 26.656 seconds. After that correction,
all nine affected native/parser checks passed in 4.126 seconds; the complete ten-test
PDF suite then passed in 2.640 seconds. These fixtures contain no live inference.

Native preflight now verifies the entire own-bundle manifest, platform/epoch,
mandatory entrypoints, stable file hashes, file kinds/modes and internal symlinks
before any Node execution. All eleven native package tests pass, including altered,
missing, extra, writable, hardlinked, escaped and malformed payloads. The immutable
local build manifest still supplies completeness, not publisher authentication.

### Native envelope and finite preparation review corrections

The next persistence review found and reproduced three failures: named recovery
could not enter with an absent canonical identity, failed lock reacquisition left
an unlocked descriptor usable by a retained owner, and quiescent journals accepted
impossible role/operation combinations. The native owner now shares its admission
matrix with journal validation and permanently poisons itself when holder-extinction
proof fails. A survivor fixture proves subsequent assert/begin/publish/finish all
refuse while the inherited holder lives; the active journal remains intact.

Narrow `maintenance/recover-identity` delegates candidate/operation/canonical
reconciliation to the existing SQLite identity validator, including absent canonical
state. Native recovery binds the exact private pair and leaves target resolution to
that validator. Ordinary application/admin admission still requires canonical target
and root pins. `prepare/initialize-recovered` is an explicit transition only after
successful quiescent named identity recovery on the same non-ready reserved pair;
native admission requires an empty private identity directory, and backend prepare
checks empty identity and database principals before initialization. It opens the
existing database, preserving its target. `resume-setup` cannot initialize identity.

Targeted evidence: all 12 native envelope checks passed (10.278 s), seven admission/
prepare/identity-purpose checks passed (2.938 s), and two actual operation/candidate
reconciliation checks passed (0.775 s). Fixtures retain uncertain roots and observe
exact child exits. These are component results; full guardian integration and final
review are still pending.

### Native runtime, download and installed maintenance integration

The native guardian now owns finite prepare, application, model and downloader
children through exact retained process objects. Private control writes and reads
are bounded and nonblocking. It requires application drain plus actual exits and
FD-holder extinction before quiescence or restart. Unsuccessful application exit,
even after a drain acknowledgment, cannot restart successfully. Lost wait ownership
permanently disables later signaling. The status-EOF and unsuccessful-exit
regressions were red before correction; a stalled first red fixture needed a normal
SIGTERM to its exact owned guardian, which then drained and reaped its application.
The corrected fixtures have explicit deadlines and preserve uncertain roots.

The downloader receives inherited lifetime FD3 and private control FD5/FD6; a native
probe verifies FD4 is absent before Node can reuse that descriptor internally. It
validates exact active application metadata, pinned model provenance, redirect and
size limits, private exclusive staging and no-clobber publication. Cancellation
reports success only after proved owned-stage cleanup. A real tiny loopback HTTPS
test reproduced an abort while waiting for a body chunk, then passed after transport
abort normalization. No external model download occurred. Native cancellation and
Quit tests verify application continuity and exact downloader exit. Repeated cycles
initially leaked two native descriptors each; retiring reaped downloader objects
fixed the measured descriptor count.

Installed native CLI commands now select fixed maintenance entrypoints and require
matching private completion, actual exit and native drain/extinction. Backup uses
an absent generation export. Restore reserves an absent pair and retains selection;
pending administration requires an explicit store ID. Activation immediately verifies
the pending pair and finishes that generation with holder extinction before the
native-only metadata transition. Abandon can retain a partial pending directory.
The new offline prepare entrypoint handles explicit setup recovery without creating
model-session material. Maintenance stdout remains direct requested CLI output;
it is never treated as control or persisted as diagnostics.

The AppKit menu implements dashboard opening, private unlock display/copy, explicit
download consent, cancellation, restart and Quit. Review found duplicate cancellation,
a post-launch exit-monitor gap and sleep notifications lost before queued startup;
corrections and deterministic menu coverage passed independent review. Actual sleep/wake and
human desktop acceptance remain pending. Fixed-category diagnostics rotate at 256
records into two private files, each below 64 KiB, with no raw application/model
stderr or credential content.

Component evidence on 2026-10-07: 29 portable desktop tests passed before the added
lifetime cases; 24 focused download/lifetime tests passed; the expanded native suite
passed all 96 tests in 82.014 s. Four subsequent diagnostics/process tests passed in
6.409 s, including pre-Node descriptor isolation. The deterministic menu regression
passed in 1.731 s. These are incremental results, not the final full gate or CI.

### First actual installed candidate

The isolated packager built an unsigned local `.app` with fresh backend/web/native
builds, pinned Node archive, production dependency closures, native llama runtime,
licenses and complete native-verified inventory. Model weights are not included.
Candidate 01 contains 39,538 files and 816,885,339 bytes. Its archive SHA-256 is
`4d152e9fa44e33e74db99c981fd52c9e6639a8758fee44a9e102db9f5d15e99b`;
manifest SHA-256 is
`f96284315553c4a69f6e1164cbf51b8bd7b29f7134fefaf3755b632342ae3ee8`.
Source copied-input hash is
`9d3c163c79b360a4ba927217b8e4f12863f8b7723781410921312935abecefd5`
at base HEAD with the recorded dirty implementation snapshot. Packaging completed
in 197.973 s with caller dependency/build integrity verified. The receipt is
`/private/tmp/context-router-step09-candidate-20261007-01/build-receipt.json`.

Actual bundle smoke passed first-run initialization, dashboard delivery, active-app
CLI exclusion, installed MCP provision/list/authentication, fresh explicit restart,
backup, pending restore, pending credential revocation and acknowledged activation.
Revoked authority remained rejected after activation. All observed guardians exited
zero and published quiescent outcomes; cleanup errors were empty. The first receipt
is under the system temporary directory `context-router-installed-6idhLc/receipt.json`
(55.330 s through its final phase). A subsequent expanded run also passed actual
browser unlock, single-use rejection, re-unlock, browser-close persistence and bundled
PDF parsing, with receipt `context-router-installed-SCy2Rk/receipt.json`.

Both runs enforced OS denial of repository/toolchain reads, empty PATH, only bundled
executables and loopback-only outbound networking. They used private synthetic state,
not a personal installation. Candidate 01 precedes the latest menu corrections;
a final candidate must be rebuilt and qualified after source freeze. No new live
model series, real model download, signing, release publication or human acceptance
is claimed by these results.

### First full review and gate corrections

Fresh read-only final reviewers independently verified all 144 changed/new files at
aggregate `454abfbffb26efad7ee0daccbc2034398123297abb73e890be4491bc01e89572`.
Architecture, persistence and compatibility each requested affected corrections;
none issued final approval. Unaffected coverage is explicitly carried forward.
The full native suite at this freeze passed all 102 tests in 90.438 s. The scanner,
CI and gate contract suites passed 155 tests in 4.968 s; Markdown checked 183 files.

The first final-gate attempt passed contract baseline and documentation, then failed
the unchanged storage-dependency test: authentication reached SQLite-located generic
filesystem helpers through managed admission. Of 942 backend unit tests, 941 passed.
The failed receipt remains `/private/tmp/step09-final-gate-20261007/local-migration-gate-summary.json`;
caller integrity was true, cleanup errors empty, elapsed 120.795 s. This is a failed
qualification attempt, not a waived prerequisite. Provider-neutral filesystem
helpers were mechanically moved out of SQLite; SQLite re-exports preserve behavior.
All 78 unchanged dependency-contract tests subsequently passed in 1.500 s.

Private shell model status now distinguishes healthy loading from terminal failure
while public AI status remains unchanged. Both added regressions failed first;
the complete eight-test readiness suite then passed in 1.721 s. Controlled setup
tests reproduced an absent-identity recovery dead end and a drained seed failure
misclassified as uncertain. Explicit recovered initialization now permits an absent
identity only following successful same-store bootstrap recovery, checks empty
principals before creating identity and retains the existing database target.
Finite offline prepare sends a failure acknowledgment after native-owner drain;
the guardian matches it to actual nonzero exit. Missing/control-lost completion
remains uncertain. All five new real native-CLI/SQLite tests passed in 12.522 s,
including interrupted bootstrap staging, occupied-database non-mutation and later
explicit resume preserving identity. These are component fixtures, not full AppKit.

Candidate 02 packaging passed in 194.318 s with caller integrity. Its manifest is
`0be25044f96f7de6169d0b2e1c2b08ae8feb9669b5c45e2d0b76383696890ec4`;
archive `da654af59be297aac77b1c69281712540098c888a8e24c2e4da85147229600e8`.
The expanded copied-artifact smoke passed in 118.274 s at
`context-router-installed-0fl2Wd/receipt.json`, four native owners exited zero and
cleanup errors were empty. It added interrupted/complete replacement and app-only
uninstall/reinstall preservation. Its restore proof did not yet cover authority
changed since backup. The corrected harness adds actual post-backup revocation,
rotation and grant-controlled MCP reads before/after acknowledged cutover.
Candidate 03 built successfully but predates the latest review fixes. A rebuilt
candidate and new full gate are required; no predecessor is relabeled final.

### Second review, gate and unmanaged-worker correction

All three fresh final reviewers independently verified the 147-file R2 snapshot,
aggregate `ce85a1f10326f9e4c734060c5a3da9e3c85ed1dd8931821115553d9bae12f96a`.
Architecture and persistence approved their affected corrections. Compatibility
approved the corrected installed/live harnesses, including authenticated `me`
continuity after AI invalidation and actual post-backup authority behavior. The
installed MCP harness subsequently accepted the established successful-read shape
where `isError` is omitted; this one-line correction received affected review.
No source approval claims that an unexecuted acceptance check passed.

The complete native suite passed 107 tests in 110.223 s. Candidate 04 packaged in
209.633 s with caller integrity, manifest
`5fba8ded7e86622d3a28486d08c2faf1a2bd041dedb448208fe55a603d1b081c`, archive
`345b8df89fed730b24750a73ee63f769c98f1661205cb741fb8f22ae65137155`, and copied
source inputs `902a324cd63e25b6c4314ac0582c33f37351bf144fa271cfe1bb2dab90536daa`.
It predates the unmanaged-worker correction below and is not the final candidate.

The second full gate passed baseline, documentation and backend unit tests, then
failed two source-model tests (132/134 passed). Receipt:
`/private/tmp/step09-final-gate-20261007-r2/local-migration-gate-summary.json`.
The unchanged source-model isolation policy requires workerData containing exactly
`paths`. Managed integration had added an own `managedAdmission` key even when its
value was undefined in unmanaged mode. The first admin operation consequently
failed; the fault-injection test could not reach its intended later checkpoint.

A new real-worker regression failed first (1.787 s). Conditional inclusion of the
admission field restores the unmanaged contract without changing the fixture policy
or managed authority propagation. Backend build passed; all 33 coordination tests
passed in 5.287 s, all 134 local-model tests passed in 40.657 s (including both
previous failures), and seven actual managed-worker admission/revocation/backup
checks passed in 2.653 s. The contract baseline also passed unchanged. Independent
compatibility review approved this narrow fix and carried forward unaffected
complete-diff coverage. A new package and full gate are required for this payload.


### Final Local Candidate 05

Candidate 05 packaged successfully in 206.144 s. Its 39,541 payload entries total
816,892,790 bytes; the archive is 281,991,587 bytes. Manifest SHA-256:
`a3f624fb6dacf12e73b0a36a6dfdd0ce41713cf0d58076a5aac221a573f9d6eb`.
Archive SHA-256:
`de0b4ed031ec03a18903a08ae38753b6d4a96df8b8214ac1b405ff1c0444e643`.
The app is `/private/tmp/context-router-step09-candidate-20261007-05/Context Router.app`.
Its local build receipt records caller integrity and copied-input SHA-256
`79db0aaf7648d58394f748e9789d55f16ac839e8d9ead116f1a04d9d8e918153`.

The expanded installed smoke passed in 152.924 s under repository/toolchain read
denial, empty PATH, bundled executable allowlisting and loopback-only outbound
networking. It proved browser unlock/re-unlock and browser-close persistence,
bundled PDF dependency closure, installed administration/MCP and stable-endpoint
restart, actual revocation/rotation/grant denial after backup, acknowledged restore
with pending revocation, interrupted and complete replacement, and app-only
uninstall/reinstall preserving durable state. Five exact native guardians exited
zero, every final event was stopped/ok, and cleanup was empty. Receipt SHA-256:
`18fd47c308d6f47c737cf3cb580dfaa20850203a6235c9e7c77e7d4c88979f26`.
The actual private receipt remains under `context-router-installed-FvuQyo` in the
host temporary directory. The independent persistence reviewer inspected it and
closed the remaining installed authority-restoration finding.

The third final local gate passed all twelve phases in 1,435.698 s (receipt timing),
with merge-base comparison performed, caller integrity true, owned database
removed, administration cleanup clean and no cleanup errors. It has exactly the
same copied-input hash as Candidate 05. The complete 147-file R3 snapshot was
unchanged throughout review/validation, aggregate
`42a01fcf3707ddb1aee0c47d1606ffc0acba80a97e37c2b6cd05a88c5cbd7d41`.
See the [sanitized final gate receipt](final-local-gate-summary.json) and
[artifact/qualification evidence](qualification.json). Subsequent closeout changes are evidence/status documentation and removal of one
trailing ASCII space on line 3 of native `diagnostics.m`; no code token or line
count changed. Independent review approved carrying functional evidence forward;
affected documentation/contract and complete staged whitespace checks are renewed. GitHub checks must report the final pushed PR head independently.

The reviewed live executable is bound to this app by
`/private/tmp/context-router-step09-candidate-20261007-05/installed-live-proposal.json`,
SHA-256 `19b49efdf891c9eefb487bd54b01d64f0663b82bfdf6cf3da55d03354b90d90a`.
Compatibility independently verified the binding. Its expanded 2,048-token limit
was explicitly requested from the user after binding; approval remains pending,
so no new installed live-model run occurred. The original 128-token authorization
is not treated as approval of this expansion. Real AppKit/clipboard, sleep/wake,
reboot, external-client, signing/notarization and distribution acceptance also
remain pending in the [consolidated checklist](acceptance.md).
