# Assisted colleague pilot: interruption and delivery

- Status: activated 2026-10-11; isolated replacement and actual-Claude lost-reply checks passed; unsigned download found a bundle-signing defect
- Scope: close the accepted Claude interruption follow-up, then rehearse the smallest supported installation/replacement route
- Base: verified local/remote main `7d2df8516115661d97287d34647f17e4a2e48701`; branch `codex/pilot-interruption-delivery`
- Owner: seal-repair checkpoint sole main-checkout writer/integrator `/root/delivery_review`; coordinator `/root` and other agents are read-only

## Current milestone and evidence reconciliation

This section supersedes pending-status statements in the historical connection
checkpoints below. It does not reopen the numbered migration or activate CI
optimization, stale-display implementation, or other backlog work. The main
checkout was clean and the earlier pilot chats were idle when ownership changed.
Other worktrees and the running app are preserved. One cohesive PR is intended
if implementation is needed; no automatic merge, binary publication or invitation.

| Role | Requested setting | Observable setting and ownership |
| --- | --- | --- |
| Coordinator `/root` | GPT-6 Astra, Ultra | User request; runtime model/effort not independently attested; read-only repository coordination and live acceptance during seal repair |
| `/root/evidence_inventory` | GPT-6 Astra, High | Explicit spawn accepted; runtime not independently attested; read-only facts/receipts |
| `/root/interruption_review` | GPT-6 Astra, Extra High (`xhigh`) | Explicit spawn accepted; runtime not independently attested; read-only client/security/test review |
| `/root/delivery_review` | GPT-6 Astra, Extra High (`xhigh`) | Explicit spawn accepted; runtime not independently attested; sole repository writer/integrator for the seal-repair checkpoint |
| `/root/candidate_review` | GPT-6 Astra, Extra High (`xhigh`) | Explicit spawn accepted; runtime not independently attested; fresh read-only complete-diff review and affected correction review |

The starting main revision has the same tree as the combined source already
qualified locally: `b6ef6aac44822ba22cb96ebb75f60877308d1f48`. The initial preparation added
documentation and opt-in test tooling without production changes. The subsequent
download failure activated the bounded native/packager seal repair below; its
changed inputs require new targeted and artifact evidence. Dependency/model pins
and store formats remain unchanged. The sealed C build below is bound to clean
`56cba238`; later test/compiler and evidence corrections do not relabel its source. The earlier gate supports unchanged inputs; the new
tooling and its readers require their own validation. The retained 12-phase receipt names
clean source `ed8673af`; its tree equals main exactly. PR #172's validated
`e9246e1` and squash `3920457` also have identical trees
(`a9868f63d0ead03bf31e3a5f93fb95126822e4a2`). A squash or another review is not a
reason to rebuild or repeat identical tests.

| Classification | Evidence / actual remaining work |
| --- | --- |
| Completed, carry forward | #172 final source validation, independent complete-diff review and exact-head CI passed. Later receipts in chat `01a129d8-b20c-75e2-8295-8022b0958c93` record final dashboard verification, actual **35 min 5 sec** inactivity on the final pair, visible expiry followed by a separate explicit successful read, two-credential independence/rotation/revocation, and all 11 installed smoke phases. |
| Completed, carry forward | Full combined-tree local gate: **12/12 passed** at `context-router-ci-assessment/integration-final/local-gate/local-migration-gate-summary.json` in retained private temporary evidence. [Standard main CI](https://github.com/loyalagents/context-router/actions/runs/38183133729) completed successfully. Earlier EPIPE and browser-exit failures remain recorded with the later passing diagnostics/runs; their causes are not retrospectively proven. |
| Completed, carry forward | [Main Linux aggregate](https://github.com/loyalagents/context-router/actions/runs/38183133767) completed successfully on `7d2df8516115661d97287d34647f17e4a2e48701`, verified 2026-10-11 23:47 UTC. No duplicate run was started or existing run cancelled. |
| Changed inputs, affected verification | #170 changes the web grant-rejection UI. Source/browser evidence belongs to that change and combined-tree validation; the older installed app cannot demonstrate the new UI. #171 changes gate timing evidence, not app behavior. Reconcile actual artifact inputs before carrying installed evidence to a new build. |
| Completed, bounded carry forward | Actual Claude observed controlled post-commit reply loss, reported uncertainty, made no mutation replay and recovered on one explicit read. The earlier 39 ms Stop attempt remains inconclusive; the separately approved follow-up below closes the missing observation. |
| Completed, bounded carry forward | The prior personal Candidate 14-to-corrected-app transition retained the same root and real compatible weights without reset/redownload. Composite receipts, unchanged model admission/runtime inputs and current process/file metadata support asset reuse, with the limits below. |
| Completed, bounded carry forward | The controlled synthetic A-to-B rehearsal below passed: preserved state, credential/target-policy continuity, backup, one committed lost-reply mutation, explicit recovery read and durable restart. |
| Genuinely outstanding | Trusted colleague acquisition and actual quarantined download-to-launch, complete colleague disk budget, supported recovery acceptance limits, and invitation-blocking PDF/attribution/stale-display disposition. Same-artifact replacement and a model marker are not real A-to-B/model evidence. |
| Scope decision | User keeps qualification on the measured M1 Max / 64 GiB / macOS 15.1.1 Mac; the colleague's unspecified MacBook Pro is a later compatibility trial. User selected the unsigned route; the actual quarantined launch failed with a bundle-signing defect, described below. No reset release is designated or needed for the state-preserving rehearsal. |

Carry-forward is bounded by source/dependencies/configuration/platform/client/
fixtures/artifact identity. Source tree equality supports the prior local gate;
it does not establish a new installed artifact, changed client account, another
Mac, or an unperformed live acceptance check. The standalone bridge remains
separate from the app bundle.

Read-only inventory identifies the running app as the retained confidence-corrected
artifact: source `3dd4f7e`, production inputs reviewed at `828ef86`, manifest
`5399bf71478ecac4e9d89aa46867a8391b1b66b97585d0629c43ac8bccefa0e9` and trial receipt
`5155955c467b5454ca9bdb3aaefa7501852905427635fd3dabf4f99946aff33d`. The durable private
bridge snapshot names `e9246e1`; its three modules match main exactly. Receipt
SHA-256 is `64133c18d6e0d677a84286e14a11eca47f78eb9d9a9137b199a7436ff9b2c695`;
module hashes remain those recorded in the connection history below. Node is
24.21.0, SHA-256 `e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.
Directories are private user-owned 0700, modules 0400, with trusted canonical
ancestry. Current Claude bundle metadata remains 2.31226.1; Pro/ordinary chat is
confirmed again in the actual-Claude acceptance below.

Final #172 validation receipt SHA-256 is
`19e8506ed416e24ae5a9adf71839096d96e22a1c9f56c901afc7e4fffee0d439`; combined local gate
receipt SHA-256 is `0c8a26a3be5ea80c4d010f06e116bfe877cc93774cc53db39ab19656e478d23b`.
The latter binds Node 24.21.0, pnpm 10.25.0, Python 3.12.8, PostgreSQL 15.19,
Chromium 153.0.8010.12 and Playwright 1.63.0, real-base comparison performed,
caller integrity true and empty cleanup errors. Temporary receipt paths are local
evidence locations, not durable colleague installation paths. Synthetic A/B
credentials remain revoked at generations 2/3; retained exports are private 0600
single-link files. Credential bytes were not displayed or committed.

Prior protected inventory verifies the real model's 5,680,522,464 bytes and pinned
digest (`03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`);
inventory receipt SHA-256 is
`08593e158b60df020fa615a790f7ace133e019665a9bd86fdc43eed31324396f`.
Cleanup preservation receipt `a518e60454ea1d67e33b535be20312ab016819b28740b0a164fef80ee4a8686c`
reports the managed root unchanged; its historical independent-review field remains
pending. Replacement observation receipt
`1efe885ce6813d2f2b8613610d764d855721037463edffc7c4d0658500e1eca2` records Candidate 14
quiescent/ok exit, B launch at 2026-10-11 12:00:44 UTC, same retained root and no
reset/download. On 2026-10-11 23:56 UTC, read-only process observation still binds
B's native menu 61848 to guardian 63077 and model runtime 63314. The model metadata
matches the prior device/inode, owner, mode, size and modification timestamp;
current metadata receipt SHA-256 is
`cbbd8ea7bb89543d3ecc5caeb8b779a91b58e4e1e9dc6796aa4acab53206729c`.
Both apps have identical native/model-admission/runtime/configuration bytes; their
startup path verifies the full pinned asset before enabling the model. Independent
delivery review accepts this composite real-asset reuse evidence. It is not a
dedicated instrumented before/after experiment, new inference-quality test, proof
of completed model loading from process existence alone, or peak-disk qualification.

The separately user-activated packaging-efficiency chat owns only
`scripts/local-migration/packaging-smoke.mjs` and its tests in its own worktree.
The user authorized coordination. Pilot runtime rehearsals are serialized around
its announced heavy-run windows; this branch does not absorb that implementation.
Pilot evidence initially binds unchanged main packaging. A later efficiency
integration needs its own frozen review/evidence and explicit integration boundary.

## Interruption preparation and approval boundary

The earlier trusted approval was for one named synthetic write followed by Stop,
a second temporary connector and its rotation/revocation/cleanup. That attempt
was consumed. Both temporary credentials were revoked and both connector entries
removed; the final configuration checksum matched its pre-test checksum. It does
not authorize another write, fresh personal-client configuration or fault proxy.

The proposed follow-up uses the unchanged production bridge/CLI and one new
synthetic credential with a single allowed target. After approval and normal Quit
of the identified personal CR app, a test-only proxy can own literal loopback
port 8787 and forward only to an isolated installed artifact on an ephemeral
loopback port with a new private explicit `--root`. The proxy must not inspect
personal state, inherit provider credentials, forward to other hosts, or run a
model. It will accept one exact approved mutation once, receive its completed
successful backend reply, then close only that reply socket before delivering
response bytes. The real bridge must generate its own fixed **Outcome unknown**
result. Neither the app nor an unidentified process is killed.

Before arming, record a synthetic value/audit baseline. Observe the actual Claude
tool card and its subsequent tool calls; distinguish bridge no-replay from model
initiated retry. Inspect the persisted value and domain audit before any
deliberate retry. A one-shot guard rejects additional mutation attempts and
records their count; it must not disguise a client retry as a passing no-replay
observation. Recovery is an explicit read and supported reconnect, then credential
revocation, removal of only the temporary connector, normal shutdown/reaping of
owned test processes and restoration of the previously running app when approved.

Pre-dispatch cancellation and dispatched response loss remain distinct claims.
Existing deterministic bridge/SDK tests cover cancellation during held renewal
before dispatch and loss after one real SQLite mutation/audit commit. The new live
observation targets the missing post-commit reply loss; it is an instrumented
transport observation, not a natural-fault frequency or cancellation-roll-back
claim. Independent review must approve the concrete injector and authority bounds
before consequential implementation; preparation/test code is reviewed and checked
before requesting bounded live approval.

Independent interruption review approved this preparation with authentication
before upstream forwarding, a pinned owned upstream port, exact one-shot mutation,
separate attempted/forwarded counts, bounded messages/timeouts and no raw credential
or payload diagnostics. The new test-only proxy was written tests first (initial
missing-module failure). Review found malformed-credential assertion disclosure
and incomplete injected-loss accounting on early downstream close. Sanitized setup
errors and conservative incomplete-injection accounting resolve those findings;
text-block validation and disconnect/in-flight shutdown/oversize/header regressions
were added. That corrected suite passed **18/18**, no skips, with ephemeral loopback
sockets. Default sandbox denial of socket creation was an environment limitation;
the authorized isolated run passed after enabling those local sockets.

The optional [rehearsal runner](../../../../scripts/local-migration/installation/pilot-rehearsal.mjs)
uses explicit manifest-pinned A/B artifacts and, for each v2 app, an externally
retained `sealed-payload.json` with its independently supplied SHA-256, plus a new private root beneath
`/private/tmp`. It verifies copied payloads before execution, never chooses the
default personal root or port 8787, and denies inference execution. App-owned
GraphQL inspection checks actual value and one audit event before the explicit
bridge recovery read; closed-state inspection follows normal owner exit. It
records actual handshake counts, bundled Node/SDK/bridge/harness inputs and sampled
disk allocation. The registry adds only this opt-in outbound classification and
its discovered sink row; protected prior records and checker behavior are unchanged.
Independent client and delivery reviewers approved the corrected bounded runner
before execution. Its SDK/test-launcher evidence does not substitute for actual
Claude UI, production-CLI/fixed-port, model, Gatekeeper or colleague acceptance.

Fresh complete-diff review found one P2 in the runner: a guardian spawn error could
reject an unobserved exit promise before the failure receipt was saved. The small
process observer now handles that error immediately, readiness detects it, and
cleanup records a no-PID failed spawn without raw diagnostics. Two focused tests
cover asynchronous real spawn failure, sanitized error evidence and normal/nonzero/
signal exits. Affected re-review resolved the finding; other source review coverage
carries forward. Preparation checks also passed strict Markdown links (145 files),
75 contract/Markdown checker tests, eight runtime-composition documentation-reader
tests, syntax and whitespace. Contract comparison against exact main performed
successfully using base-bundle manifest
`61b274364a9c63b253b178102bd6403075da4d93873ffc22331263e73b10fc3a`.
These are targeted preparation checks, not final qualification.

### Isolated rehearsal result

The reviewed runner passed on the measured Mac, finishing at approximately
2026-10-12 00:02 UTC (October 11 locally). Its retained receipt is
`/private/tmp/context-router-pilot-rehearsal-20261011-01/receipt.json`, SHA-256
`f6ede8c2b7660567416ad90f474fbbb020f712f8e9d935d74869b91fc063bca6`.
The receipt binds both manifests above, runner
`9bb32766beccae174a5f26396752518403655bae41a4deb72024a40be3ebfd83`, helper
`361f904ad6821a9f143ae220afe26ddfd54a5da6aea791d645c8decec05bdf3f`, proxy
`bcf69dda17d32b721d92615dc48df8992bf1bb61393a6470d54078ddc80382fb`, the unchanged
three production bridge modules, pinned bundled Node and SDK 1.27.1.

A was seeded, normally stopped and backed up. B replaced the whole app at the
same test path; selected database, installation and identity bytes were unchanged
before B first opened state. B read the preserved value, retained the exact allowed
target and rejected a denied target and revoked credential. A later allowed write
produced one additional audit event.

Using B's bundled Node and the real bridge with the test-only port launcher, the
proxy forwarded exactly one synthetic mutation, received its successful reply and
dropped that reply. The bridge produced its own **Outcome unknown** result. Before
the explicit recovery read, app-owned GraphQL showed the expected persisted value
and exactly one new audit event. The separate read renewed initialization and
returned that value. A further normal restart retained it without another audit
event. Proxy evidence is one mutation attempt, one forward, one lost reply, zero
refusals/injection failure, and two initialize/initialized exchanges. Both temporary
credentials ended revoked. All five guardians exited normally; a subsequent process
check found none present and the final journal was quiescent/ok.

This is installed-artifact/SDK evidence with synthetic state and model execution
disabled. It does not close the actual-Claude observation or demonstrate the newer
#170 UI, Gatekeeper, another Mac, or durable installed delivery of the bridge. The
heavy execution slot was coordinated with the separate packaging chat and released
after cleanup. **Targeted checks passed; final validation pending.**

Final live preparation exposed a narrower guard problem: a refused first armed
mutation could leave the latch available for a corrected second attempt. A tests-first
regression reproduced it. The reviewed correction now consumes the first armed
mutation attempt before validating its shape/ID, so any refusal exhausts the attempt.
Each invalid shape has a fresh-proxy regression; successful one-shot and concurrent
retry coverage remain. The renewed proxy/process suite passes **26/26**, no skips.
Current proxy SHA-256 is
`f1f394f13ebf7566f744c71d703f78924b9b8d28c353587964b8102c03c47885`.
The installed receipt retains its original proxy hash: its first, well-formed,
single-mutation path and subsequent read/shutdown are unaffected by this change.
Only that coverage carries forward; the new refused-first-attempt behavior is
established by the renewed focused tests and affected review, not by relabeling
the earlier installed receipt.

## Actual-Claude acceptance and cleanup

The user explicitly approved the prepared test and selected the unsigned route.
The approved host used the qualified durable standalone bridge and separate Node
24.21.0, one temporary connector and fresh private root
`/private/tmp/context-router-pilot-claude-loss-20261011-01`. Independent review
approved host SHA-256
`1978973dafc4b55615c6d261ef918db3341ada902119f0c9ce9be476af8045fd`
and configuration controller
`1120bb06e429f77db6b9c5298944d78aefc2b0e09c61ab40468721a5693ad1f4`.
The controller uses a private exact backup, fixed error diagnostics and targeted
restoration while Claude is quit. A review finding about raw assertion/JSON errors
exposing configuration content was fixed before any configuration write.

On 2026-10-12 UTC (October 11 Pacific), Claude Desktop 2.31226.1, Pro ordinary chat,
Opus 5.5 High used **Allow once** for the exact synthetic SET, with confidence
omitted. The proxy admitted one mutation of `pilot_claude_loss_20261011.allowed`
from `synthetic-before-loss` to `synthetic-after-loss`, received the successful
reply, then closed that reply socket. The tool card displayed: **Outcome unknown.
The request may have completed. Inspect state before retrying a write; no request
was replayed.** Claude reported uncertainty and stopped.

GraphQL inspection at **01:46:07 UTC**, before the separate recovery read,
observed the new value and exactly one added `PREFERENCE_SET` audit event. The
ledger showed one mutation attempt, one forward, one reply loss and no injection
failure. A separately requested **Allow once** read at **01:46:43 UTC** succeeded
and returned the new value. Initialize/initialized counts increased from two to
three; the mutation/audit counts stayed one. The two initial handshakes were
Claude startup behavior, not mutation retries. The dedicated connector log also
contained exactly those two tool calls. Local ToolSearch schema lookups were not
connector calls. Claude's read-response speculation about a later update based on
chat-minute timestamps is unsupported by the audit/ledger and excluded from the
acceptance claim. No second mutation or extra explanatory cloud request was made.

The final host receipt is retained at the named root's `receipt.json`; UI
observations, configuration restoration and original-app restoration receipts are
in `/private/tmp/context-router-pilot-live-preparation-20261011`. The temporary
credential was revoked. All three guardians (92032, 93368, 93758) exited normally
with code zero and quiescent/ok evidence; those PIDs and host 91599 were subsequently
absent. Claude's original configuration was restored byte-for-byte, SHA-256
`21ecf7813fde0f4acca07fa7fc0d010185413b706d31bddb76ead00834c7d52b`, and Claude reopened.
The previously observed original app had already exited quiescent/ok during a
long UI-tool delay, before any test action. It was restored on its original root:
menu 31029, guardian 32030, existing model runtime 32327 and backend 32328 owning
8787. This verifies restoration/process ownership, not a new inference-quality run.
The loopback download server also stopped. No private documents, model download,
reset, journal deletion, binary publication or colleague contact occurred.

Canonical SHA-256 receipts for that completed acceptance are:

- Host: `07c5c0183252b026567ef965baf3a95b33890d8a235be01d981a44467340d75a`.
- UI observation: `cb08552fd52caed86aa4b4f28fe393b12e7f38c97c179de02aa6ec7867eab283`.
- Configuration restoration: `fbb7ce00bccaf9e7e67b4048aa24a514e91a7a703cc9dd65c11748d9ba957dae`.
- Original-app restoration: `28d690764862b43854f1cde0794c750453c3ae0ef2b126136724dd23df649fbe`.
- Dedicated protocol log, `/Users/lucasnovak/Library/Logs/Claude/mcp-server-context-router-pilot-loss-20261011.log`:
  `5a8ce26b957e8bcdb32131864a28bff914671cb453d407f1ad6b001f90d3b70c`.

The log content and credentials are not committed. Independent review confirmed
actual configuration restoration and the original app's roots, PIDs and port.

Independent interruption review accepts the controlled actual-client result.
This is instrumented post-commit reply-loss evidence, not cancellation rollback
or a measurement of natural failure frequency. Existing app/bridge input identities
remain explicit; it does not qualify a future changed artifact automatically.

The preparation source at `0562455519e70fff99bd1046322581ca164f2ace` passed
[standard CI](https://github.com/loyalagents/context-router/actions/runs/38187031857)
and the [Linux aggregate gate](https://github.com/loyalagents/context-router/actions/runs/38187031862).
Those results do not cover a later production packaging repair.
**Targeted checks passed; final validation pending.**

## Delivery options and invitation dependencies

The user wants simple sharing with GitHub-capable colleagues, favoring quick work
or work reusable for later distribution. The user selected an identifiable unsigned app with a durable standalone bridge.
A separately installed pinned Node remains the qualified actual-Claude recipe;
using the app's pinned bundled Node is an option requiring its own durable-path
qualification. A bundled-Node recipe would remove a separate Node installation without adding
an installer or extension. The route is selected, but launch acceptance failed
on the existing artifact. A checksum is byte-integrity evidence,
not publisher authentication.

Apple's [launch-testing guidance](https://help.apple.com/xcode/mac/current/en.lproj/dev1cc22a95c.html)
permits a local-server Safari download to obtain browser-created quarantine. This
can test local Gatekeeper behavior without publishing a binary, but the development
Mac may have a cached product decision. A missing prompt/block would be inconclusive
for first-launch acceptance. The approved Safari download from the pinned loopback-only server was automatically
extracted by Safari/Archive Utility. Its app inventory matched the pinned B
manifest before execution and retained browser-created quarantine. A verified
owned listener protected port 8787 throughout the attempted launch. macOS refused
it as **damaged and cannot be opened** before any downloaded native process or
default app-support parent appeared. No quarantine or security setting was changed.

| Option | Immediate cost and benefit | Reusable work / remaining qualification |
| --- | --- | --- |
| Pinned-source build | Existing packager; colleagues need exact Node/pnpm, clang, dependencies, cached acquisition inputs and build space/time | Useful contributor fallback; clean-machine setup/launch still unmeasured |
| Trusted unsigned app | Smallest download/install path; needs trusted acquisition and per-app approval | Artifact receipts, whole-app replacement and state/disk checks carry forward to signing; actual quarantined B launch failed; repair/retest and managed-Mac policy remain outstanding |
| Signed/notarized app | Developer ID and signing/notarization work, easier publisher verification/launch | Long-term foundation; current manifest inventories executable/signature files, so signing order/layout needs deliberate work rather than an added final command |

Apple documents [per-app Open Anyway](https://support.apple.com/en-us/102445) for
trusted unsigned/unnotarized software. Managed Macs may prohibit it. Do not disable
Gatekeeper globally or strip quarantine; testing the actual downloaded artifact
is still required. Extension packaging or an updater is optional later work.

### Download failure and bounded repair checkpoints

The retained B executable has a linker-created ad-hoc signature, with unbound
`Info.plist` and no sealed resources. `codesign --verify --deep --strict` reports
**code has no resources but signature indicates they must be present** on both
retained and downloaded B. This is a packaging defect consistent with the observed
Gatekeeper refusal, not evidence that Safari changed payload bytes. Preserve the
rejected app and receipt; do not advise stripping quarantine or disabling Gatekeeper.

Independent delivery and architecture reviews agree that appending a signing
command is insufficient: the current manifest hashes the main executable and
signature files, while a proper bundle seal also covers that manifest. Signing
then rewriting the manifest invalidates the seal. Apple's
[code-signing guidance](https://developer.apple.com/library/archive/technotes/tn2206/)
requires the sealed bundle to remain unchanged.

A disposable offline copy at
`/private/tmp/context-router-pilot-signing-probe-20261011-01` accepted outer-bundle
ad-hoc signing and passed strict/deep verification without nested code being
re-signed or any downloaded executable being run. The old manifest then failed
verification as expected. This is feasibility evidence only, not a runnable app.

The bounded repair plan is:

Before implementation, ownership transferred from `/root` to
`/root/delivery_review` for this checkpoint. The coordinator stopped repository
writes; existing documentation and test-tooling changes are preserved. The
separate PR #175 retains ownership of `scripts/local-migration/packaging-smoke.mjs`
and its test file. No commit, push, broad gate or new package build belongs to this
checkpoint until the coordinator requests it. Independent plan review approved
the v2 boundary; independent diff review and targeted evidence remain required.

1. Add tests for a mandatory signing-aware manifest v2. Preserve complete exact
   hashes for ordinary payloads. Only the fixed main-executable and
   `Contents/_CodeSignature/CodeResources` entries receive platform-signature
   coverage, with existing regular-file, single-link, mode, bounds, canonical-path
   and stability checks. Extra signature files remain errors.
2. Require native Security.framework strict resource/executable validation,
   all architectures, nested-code checks and no network access before Node or
   managed-state access. Bind the expected executable and bundle identifier.
   No unsigned/v1 fallback in the new native app; retained old artifacts keep
   their own verifier. Security epoch, model pins and state formats stay intact.
3. Finalize existing nested payload bytes, inventory/write the manifest, seal the
   outer app last, verify both contracts, record final byte hashes externally,
   and archive without later bundle mutations. Do not use deep force-signing,
   resource exclusions or a custom Mach-O signature normalization parser.
4. Update shared native fixtures to valid sealed bundles. Check tampering of the
   executable, seal, manifest and payload, omissions/extras and unsafe links/modes;
   prove failures occur before managed-state access. Run affected native/installed
   acceptance before another quarantined Safari trial on the new named artifact.

This remains an unsigned-publisher route: an ad-hoc integrity seal supplies neither
Developer ID authentication nor notarization. The user agreed to finalization
after this repair, renewed download/launch and replacement acceptance, complete
independent review and applicable gates in the same draft PR. Publishing and
invitations remain separate. Production repair passed independent complete-diff and affected review. Sealed
artifact C is recorded below; renewed Gatekeeper acceptance remains pending.

The repair checkpoint passed 18 portable manifest tests and 24 real Mac native
package tests after a targeted native compile. The affected native consumer run
passed 76/76 serial tests, including package verification, supervisor/revision
fixtures, recovery, shutdown, envelope, process and lock drivers. The tests distinguish
post-seal mutations from malformed manifests/payloads re-sealed with a valid
platform signature. Native v2 is mandatory; the JavaScript legacy verifier is
restricted to the explicit retained-artifact rehearsal and rechecks the caller's
independent raw-manifest SHA-256 before its complete v1 inventory. Pinned Node and
all 20 runtime/license files (148,570,750 bytes) in the disposable signing probe
matched retained B; no model weights were read or run. Targeted checks passed;
final validation pending. The first expanded sandbox attempt could not read the
boot session or bind test sockets (29/152 passed); its runner and temporary
guardians exited, and no failed fixture root named in its diagnostics remained.
The permitted focused rerun passed without changing assertions. Contract comparison
against the pinned base, 75 contract/Markdown tests, 145-file strict Markdown link
check, eight runtime-composition readers, JavaScript syntax and whitespace also
passed. Independent complete-diff review, full frozen-candidate validation and a
new packaged artifact remain required.

### Independent seal review and artifact-pin correction

Fresh complete-diff review of snapshot
`642605f6b52fa92131217212a4f525d98fdae4f286197af3419c36fefe9f04a3`
found one blocking P1: a v2 manifest digest no longer transitively pins the final
native executable or `CodeResources`. A changed executable can be ad-hoc re-sealed
while the manifest bytes stay unchanged. Platform integrity alone does not identify
the artifact independently approved for execution. The fixed two-file signature
boundary, native validation, seal-last packager and explicit legacy isolation had
no other blocking findings.

The correction requires `--from-sealed-payload` and
`--from-sealed-payload-sha256` for a v2 A, with corresponding `--to-...` arguments
for a v2 B. Supply the external receipt path and SHA-256 from the independently
trusted build handoff. The runner checks the raw receipt digest, recomputes every
final file hash including the manifest/executable/resource seal, and compares the
full inventory before executing the source or copied app. V1 retains its explicit
independent manifest pin. Do not infer an expected receipt digest from the same
untrusted app being admitted.

The local-build installed smoke captures its explicitly trusted source bundle's
complete final-byte inventory once, records it outside the app, and compares each
initial/replacement/reinstall copy before bundled Node or native execution. The
existing `step09-installed-live-v1` approval schema refuses v2 before creating a
root or reading model assets; this checkpoint does not introduce a new live-model
approval schema or exercise model inference.

The correction was written tests first (three missing-preflight failures) and
passed all 45 portable/native package tests. The substitution test changes the
main executable and produces a valid new ad-hoc seal with identical manifest
bytes: ordinary v2 verification succeeds, while the old independently pinned
receipt blocks the actual rehearsal CLI before its output root exists. Copy
checks cover initial install, replacement and reinstall; the legacy live CLI
refuses v2 before temporary-state creation. Strict links (145 files), pinned-base
contract comparison, 75 contract/Markdown tests, eight runtime-composition readers,
syntax and whitespace passed at the correction checkpoint. Explicit legacy
preflight/captured-copy regression coverage also passed (18 portable tests). Native/runtime behavior is unchanged from the prior
76-test passing consumer checkpoint. Independent affected re-review is pending.

The historical real-GGUF A-to-B reuse claim remains specific to its recorded
transition. The future seal-repair C needs exact model/runtime/configuration input
comparison and renewed affected native/installed lifecycle checks; it is not
claimed to have directly demonstrated model-enabled startup or AI quality.

### Sealed C build and native driver linkage correction

The isolated packager completed from clean
`56cba23865900bd74817578c936200df9a504be9`, tree
`39e9680df72fa54e78897b17d2ad4b0757f8cb37`, with copied-input digest
`2288206694eb328f4e739abfe14bf7f685049476158e489f42907cc669fc6c4b`.
Artifact C remains bound to that source even after test-only corrections. The
build at `/private/tmp/context-router-pilot-sealed-C-20261011-01` passed JS/native
strict verification and caller-integrity checks. Its SHA-256 receipts are:

- Build receipt: `8edb0f5208eab0bc0ad266129ceea4f0c52217d197ad4a626b5def7be3a68a6c`.
- Manifest: `4d7b8fd22c3912d5c3dbade2ccd8f896159f6068359b51590561e6e1485d03ab`.
- External sealed-payload receipt: `7b93ea55c3b8e4f9df4595d05019bd2d0cfcde9d97e111734b08333f325445d5`.
- ZIP, 284,638,215 bytes: `a89323668635cd96014648ae6ec328d163e50fdf5e5bb64d60abdc34d63f7cd2`.

CI run `38196887962` and the retained isolated full native run each executed 198
cases: 186 passed and 12 failed because six test compiler commands linked
`package.m` without `Security.framework`. These are real failed validations, not
passing full-suite evidence. The red CI log at the artifact root,
`ci-native-56cba238.log`, has SHA-256
`40e6d5bb58b017b175c1a5178faade337ffe706cee9996ba7c0d42e95ddd7323`.

The complete compiler inventory found ten consumers of `package.m`: production
build plus nine native test files. Production, envelope, process and lock-contender
commands already linked Security. The correction adds only that framework to
`diagnostics`, `menu-restart-dashboard`, `menu-unlock`, `menu`,
`model-cleanup-race` and `sleep-clock` test compilers. Assertions, native/runtime
source, build output, CI requirements and artifact C are unchanged. Independent
review approved the exact six-line delta without findings.

After the existing full run exited, all 12 corrected cases passed serially in
29.4 seconds using isolated temporary fixtures. The focused log at
`/private/tmp/context-router-seal-linkage-focused.log` has SHA-256
`7cc1e8f0d9e13e27e93e98074971240cbc8f84cb390d1b751f899fd8868d40bc`. Full native qualification must be renewed using the corrected test
commands; installed/replacement/Gatekeeper acceptance, final local gate and new
head CI remain pending. No production/package rebuild is justified by this
compiler-flag-only change. Targeted checks passed; final validation pending.

The first installed smoke on C passed ten phases, including complete compatible
replacement at 217,373 ms, but failed its 240,000 ms aggregate allowance. Final
reinstall copying and full-byte verification reached 261,813 ms before the next
CLI command refused the expired signal. The failed receipt at
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/context-router-installed-y55MAu/receipt.json`
is retained with SHA-256
`63a30099007921ea1cfc60dd3b0104aa40c443d2add918b0621c23133d3cddf4`.
Cleanup reported no errors; all four guardians exited zero with quiescent, valid
journals, and the owned browser process/group were absent on independent review.

The reviewed harness-only correction raises the aggregate allowance to 360,000 ms
for the added copy verification work. All eleven phases, assertions and individual
operation/startup/cleanup deadlines remain unchanged. The separate A-to-B pilot
rehearsal keeps its 240,000 ms allowance: its historical receipt does not establish
an elapsed-time need for a change. Artifact C and production/runtime source remain
unchanged; no package rebuild is needed. A complete fresh installed smoke is still
required, so the partial run does not qualify installed/replacement acceptance.

The isolated rehearsal's A is retained Candidate 14 (manifest
`944c5be0eb2e44e5c215fdacac3f8ad12546dd190cdddd8afa45c78285d8ff38`); B is the
confidence-corrected artifact above. This is a real backend change: the two search
descriptor modules differ. Native executable, Node, model runtime/configuration,
security epoch and storage formats match. Build-specific dependency paths and
web-generated files also differ; do not claim the complete payload has only two
changed files. This pair deliberately excludes #170's newer web behavior.

| Dated disk observation | Bytes / scope |
| --- | --- |
| A archive / B archive | 281,996,863 / 281,995,737; retained original archives, outside the synthetic rehearsal root |
| Rehearsal largest sampled allocation | 2,056,536,064 (about 2.06 GB), while both complete apps were staged with synthetic state/backup |
| Rehearsal final retained | 1,655,718,464 logical / 2,011,271,168 allocated bytes, including both complete apps and synthetic state/backup |
| Compatible weights | 5,680,522,464 bytes; retained real asset, outside the synthetic rehearsal root |

Adding the final sampled allocation, nominal model bytes and both archive sizes
gives about 8.26 GB as a planning subtotal, not a measured combined disk footprint
or required free-space guarantee. Model allocation, APFS sharing, existing personal
state/backups, exports, incomplete downloads, source-build inputs and transient
extraction/verification space need separate accounting for an actual delivery.
Samples do not establish an instantaneous peak, and allocated blocks may share
extents. No model file was copied or downloaded by this rehearsal.

| Dependency before invitations | Owner and missing evidence |
| --- | --- |
| Rejected PDF | Pilot coordinator for triage; owner/user supplies a consented file or minimal synthetic equivalent and rejection details. Determine supported-subset rejection versus parser defect; no private document use is inferred. |
| Possible wrong-person attribution | Pilot coordinator for triage; minimal two-person synthetic reproduction and exact observed/proposed attribution are missing. Treat as an unresolved correctness/privacy blocker, not accepted omission E. |
| Stale applied-value display | Separate UI outcome in the [UI brief](../../backlog/ui-usability/README.md); pilot coordinator owns dependency disposition. Reproduction/fix/acceptance or explicit safe bounded scope is missing. No implementation is absorbed here. |
| #170 installed feedback | Pilot integrator; a main-derived installed artifact and affected display acceptance are needed before claiming its new UI is installed. |
| Recovery | Pilot coordinator/product owner; ordinary Restart/Quit and named recoveries remain supported within their evidence. Uncertain owner/forced-loss/reboot states require stop-and-preserve escalation; reinstall is not a repair and there is no reset command. |

No reset release has been designated. Keep source documents, matching-pair
backups/pending stores, credential exports and compatible verified weights. A
later reset designation requires its own reviewed authority/retention policy and
bounded destructive approval. ChatGPT Desktop remains nonblocking future work.

## Checkpoints for this milestone

1. Reconcile the above evidence, verify actual app/bridge/Node/client identities,
   correct canonical status and independently review the concrete test/delivery plan.
2. Prepare and test the isolated fault harness without personal-client changes.
   Obtain any missing bounded live approval; run the synthetic interruption and
   inspect persistence/audit before deciding any retry. A defect gets the smallest
   independently reviewed tests-first correction and affected checks.
3. Compare source build, assisted unsigned acquisition and signed/notarized
   delivery. Rehearse actual compatible A-to-B replacement in synthetic state,
   measure retained/peak disk and compatible assets, and record recovery limits.
   A durable bridge with separately pinned Node is the current recipe; using the
   app's pinned bundled Node is optional future persistent-client work, not a
   blocker for this milestone. The installed test harness already exercised its
   bytes, but no new Claude configuration is required for this delivery recipe.
4. Complete the agreed seal-repair, renewed quarantined launch and compatible
   replacement milestone. Freeze named source/artifact inputs, obtain fresh
   complete-diff review and all applicable final gates/manual acceptance/exact-head
   CI. Carry unaffected evidence with an explicit impact assessment. The selected
   unsigned delivery route permits its bounded rehearsal; private-state resets,
   model downloads, client changes and provider requests still require their own
   applicable named scope. Publication and invitation are not authorized.

During preparation, use pinned tools and focused harness/integration checks,
strict Markdown links/whitespace and actual documentation readers (including
contract-reference discovery). Do not repeat the full gate for documentation or
unchanged runtime bytes. Test-only tooling must preserve existing gate coverage,
triggers and production endpoint/security contracts.

## Historical Claude connection slice (#172)

The following implementation history remains as evidence with its original
checkpoint scope. Its old pending statements are superseded by the reconciliation
above, not by an assumption that undocumented checks passed. Historical base was
`855e8734b919871eac82415465b456add38a3084`, branch `codex/colleague-pilot`, with
`/root/writer` as sole writer; that ownership ended before this milestone.

## Outcome and boundaries

An assisted colleague can launch a small stdio bridge from ordinary Claude Desktop
chat and connect to the existing installed app's authenticated
`http://127.0.0.1:8787/mcp`. Discovery, reads, permitted/denied writes and safe
explicit reconnect retain the existing credential/grant authority. The installed
app continues to own backend/model startup and shutdown. Existing Claude Code and
Codex CLI direct HTTP clients remain supported.

The first delivery is a **source-bound standalone bridge**, requiring an absolute
Node 24.21.0 executable and reviewed checkout entrypoint or retained source
snapshot with the same three module bytes. It is not yet included in the
installed bundle. No extension, native launcher, new backend, database, registry,
OAuth, public/LAN listener, tunnel or personal-client automation is part of the
source implementation. Subsequent bounded approval authorized the coordinator's
Candidate 14 trial with a dedicated synthetic credential, one preserved Claude
configuration entry, restarts and synthetic requests to Anthropic. The user later
explicitly approved the combined confidence-correction app (`3dd4f7e`) and bridge
snapshot (`c29efc5`) retest and manually unlocked the dashboard. The coordinator
owns those bounded live actions; approval is not a general state-mutation mandate.
No writer live actions, local model runs/downloads, private-document submissions,
resets, binary publication or merging are authorized. The user has now explicitly
authorized source-branch publication and a draft PR for review. Broader distribution/signing,
real replacement/disk qualification and native owner-loss work remain with the
pilot coordinator. Reset designation stays undecided and is not needed for a
bridge that never administers state.

Anthropic's [remote connector guidance](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
describes cloud-origin connections, which cannot reach this loopback service.
The MCP [local-server guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers)
documents Desktop command/arguments subprocess setup; an extension is optional.
The coordinator observed Claude Desktop 2.31226.1, Pro, in ordinary chat during
the original and corrected-pair trials. The local entry initialized and discovered tools;
this establishes that instance's connection, not a general organization-policy
claim. [Enterprise settings](https://support.claude.com/en/articles/12622667-enterprise-configuration-for-claude-desktop)
can disable local development MCP. The original trial exposed two corrected
compatibility issues; the nullable-confidence correction now passes in that actual
client. Visible operational-error recovery, rotation and revocation were also
observed; the evidence limits and remaining qualification are recorded below.

## Ownership and review

| Role | Requested setting | Observable evidence / responsibility |
| --- | --- | --- |
| Coordinator `/root` | Astra Ultra | Requested by user; runtime model/effort not independently observable; repository read-only |
| Sole writer `/root/writer` | Astra Extra High (`xhigh`) | Explicit spawn settings accepted; no independent runtime attestation; all branch/files/staging/commits |
| Inventory `/root/inventory` | Astra High | Explicit spawn request; read-only code/consumer evidence |
| Plan reviewer `/root/plan_review` | Astra Extra High (`xhigh`) | Explicit spawn settings accepted; no independent runtime attestation; security, lifecycle, compatibility, scope and test coverage |
| Complete-diff reviewer `/root/diff_review` | Astra Extra High (`xhigh`) | Explicit spawn request; no independent runtime attestation; complete checkpoint diff and affected correction recheck approved for bounded source trial |

Only the writer edits this checkout. Coordinator/reviewers remain read-only.
Existing foreign edits in `docs/plans/README.md` and
`docs/plans/backlog/agent-assisted-onboarding/README.md` are preserved and excluded
from this slice's staging/commits. Their initial SHA-256 values are respectively
`9cc87614fd852f9324f4cd2caac8a899a0f679160bcd7b530afe078a3b89e963` and
`ce2d603dc57a40a9c842eb87ba3261c1cbeef599a3235ce19ed6818636a34e83`.
No other active writer was found; existing unrelated worktrees are untouched.

Owned implementation paths are `apps/backend/scripts/mcp-bridge/` and new
`apps/backend/test/local-mcp/bridge*.test.mjs`. These stay under existing backend
CI filters and the existing local MCP test command; no new package/dependency or
CI trigger change is needed. Owned guidance is this plan,
`docs/useful/MCP_LOCAL_SETUP.md`, narrowly affected current/installed guidance, and
status/link correction in `docs/plans/backlog/mcp-onboarding/README.md`.
Add the exact bridge directory to reference/outbound discovery in
`scripts/local-migration/check-contract-baseline.mjs`, with focused discovery
regression coverage in its test. Update only accurate bridge classification and
derived census in
`docs/current/local-migration-contract-baseline.json`, with checker evidence;
protected historical ownership and contract dispositions remain unchanged.

Backend HTTP/auth/domain code, web, desktop/native/packaging and managed state
are outside the planned implementation. Any needed change there is a reviewed
plan amendment, with backend tests written first. New bridge behavior also uses
tests first. No shared build output is overwritten: production integration uses
an isolated source/build copy and temporary synthetic roots/ephemeral ports.

## Transport contract and failure model

The executable accepts only `--credential-file /absolute/canonical/private/file`
(and fixed help/version). Client config contains absolute executable/script/file
paths, never token bytes. Production destination is compiled/fixed literal
127.0.0.1:8787 and `/mcp`; no URL/port/env override. An imported test harness may
inject an ephemeral loopback port without making that a CLI capability.
Use Node core `http` directly: no proxy/environment routing, DNS, redirects,
OAuth fallback, automatic request retries or resumable streams.

The CLI refuses nonempty inherited `NODE_DEBUG`, `NODE_DEBUG_NATIVE` or
`NODE_OPTIONS` before credential access or HTTP. The manual config clears all three;
deleting debug flags after Node startup would not disable cached core logging.

Credential is read once at startup. Require canonical absolute path (at most
4096 characters, no controls), non-symlink safe ancestors, same-user 0700 parent,
and same-user regular 0600 single-link file. Use no-follow/nonblocking open,
fstat and path/parent pins before/after a bounded read; reject changed identity,
mode/size/content metadata or path ancestry. Read at most 75 bytes (one overflow sentinel beyond the exact token
export bound of 74 bytes including LF), require the existing
`cr_mcp_<22 base64url>.<43 base64url>` syntax with optional final LF, and close the
file descriptor. Never watch, rewrite, rotate or delete credentials. Rotation
requires a new private export path and an explicit Claude reconnect/restart;
revocation is independently enforced by the backend on every request.

Stdio uses one UTF-8 JSON-RPC message per LF. Bound a line including unterminated
input to 128 KiB, validate JSON-RPC 2.0/request shape/method/typed ID (safe integer
or at most 128 UTF-8 bytes), reject batches and invalid UTF-8 without echoing
content. Advertise only the existing CR tools/resources surface; no invented
server-initiated sampling/elicitation capability, GET stream or generic proxy
claim. Preserve tool/resource results without recording them in diagnostics.

Maintain a bounded state machine: awaiting initialize, initialized, ready,
needs-session, stopping. Forward the initial handshake with validated negotiated
protocol (2025-06-18 or 2025-11-25) and session header, and require successful
`notifications/initialized` before dispatching ordinary requests. Use generated
upstream request IDs and exact typed downstream-to-upstream mappings. Internal
handshakes cannot collide with client IDs. Retain at most 4096 downstream IDs;
reject reuse and require explicit bridge restart at exhaustion. At most eight
ordinary requests can be active, with no unbounded queue. Separately bound control
requests so cancellation/shutdown remain usable under saturation.

Each admitted request captures an immutable session generation. Cancellation
routes only to its exact active request in that captured generation; it never
reinitializes or targets a later request/session. Concurrent session replacement
uses one initialization promise; old responses cannot replace new session state.
Retain original initialization parameters and accepted protocol/capabilities;
renewal must preserve that stdio-negotiated contract or return reconnect-required.
Successful terminal responses retain their original client IDs. A response must
have a matching ID and exactly one result/error, valid JSON/UTF-8, expected status
and content type. Require JSON-RPC 2.0 and integer-code/string-message errors. Bound headers to
16 KiB, each response to 8 MiB, aggregate incoming response buffers to 16 MiB and
queued stdout to 8 MiB (plus bounded parsed objects/serialization). Test representative
descriptors/schema; overflow is unknown outcome if dispatched. JSON is normal; only empty 200 event-stream is understood
as cancellation/no terminal result. Unsupported/nonempty SSE fails conservatively.

| Observation | Behavior |
| --- | --- |
| HTTP 404 for an ordinary request in the current session | Existing edge rejects that request before dispatch. Cancellation/DELETE/handshake 404 never settles earlier work. Retire only that generation, return fixed error stating this request was not dispatched and an explicit retry is needed. Never replay it. Next client request single-flight initializes and sends initialized before its own dispatch. |
| Socket loss, timeout, 5xx, malformed/oversized/mismatched response after dispatch | Return fixed `outcome unknown` error for a tool call; it may have committed. No automatic replay. Next deliberate request may reconnect; inspect shared state/history before retrying a write. |
| Cancellation or empty SSE | Attempt bounded cancellation of original generation, report outcome unknown for dispatched work; cancellation does not prove rollback or settlement. No automatic replay. |
| HTTP 401/403 | Fixed authority error, no fallback/retry/credential reload. Explicit reprovision/rotation and bridge restart as appropriate. |
| Capacity/refusal before bridge dispatch | Fixed bounded not-dispatched error; no queued background work or retry loop. |
| App unavailable at initialize/reconnect | Fixed connection unavailable; no backend/model launch. Later explicit reconnect/request may retry initialization. |
| EOF, SIGINT, SIGTERM, SIGHUP or output error | Stop accepting input, bounded best-effort authenticated DELETE of owned session(s), destroy own HTTP sockets, exit within five seconds. Shared backend/model remain running. |

Use a short connection/handshake deadline (10 seconds), operation deadline
exceeding the backend's 180-second workflow bound (190 seconds), and bounded
control/shutdown deadline (at most five seconds). Stalled stdout cannot grow memory
without limit or prevent bounded exit: pause/refuse input and stop on exceeded
output bound or drain deadline. Do not hold a keepalive/heartbeat that prevents
real inactivity expiry. Protocol-only stdout; stderr contains fixed categories
only, no token, file path, headers, request IDs, payloads, raw errors or stacks.
No diagnostic files or telemetry.

## Checkpoints and evidence

1. **Plan and review.** Complete source/client investigation; draft this plan and
   independently review before implementation. Resolve every blocking finding
   with its trigger, consequence, disposition and revised-plan hash. Source base,
   branch, foreign changes and pinned toolchain are verified. Only docs checks
   run now; no migration gate for orientation.
2. **Bounded bridge, tests first.** Write failing credential, protocol, transport,
   concurrency and lifecycle tests, then implement in small increments. Test path
   aliases/symlinks/hardlinks/FIFO/permissions/oversize/races; fragmented UTF-8,
   malformed IDs/batches/no LF; fixed endpoint/no redirect; typed ID mapping;
   single-flight initialization; stale 404 next-request recovery; old-generation
   cancellation; response loss after accepted mutation; timeout/cancellation;
   stdout backpressure; EOF/signals and redacted failures. Run the new focused
   tests after each behavior change; keep tests unless requirements change.
3. **Production integration and manual guidance.** Run bridge with the existing
   real local MCP composition, auth guard and isolated SQLite fixture on port 0.
   Prove descriptors/resources, allowed reads/writes, denied writes, durable state,
   independent second-client revoke/rotate, stale sessions/restart and mutation
   commit with lost/cancelled response exactly once. Use the real SDK StdioClientTransport with the bridge and SQLite backend, and
   existing HTTP SDK tests for direct-client compatibility. No live model is required. Update manual
   setup/reconnect/privacy guidance; remove unsupported URL-only Desktop guidance
   without weakening hosted HTTP/OAuth support. Record source/input hashes and
   prepare bounded real-client checklist referencing the canonical brief.
4. **Review and trial handoff.** Fresh independent complete-diff review covers
   security/privacy, lifecycle/recovery, contract compatibility, tests and scope.
   Resolve blockers and rerun affected tests/review. Prepare a source-bound trial
   record naming exact source revision/dirty input hashes, Node, entrypoint and
   unchanged installed app identity (actual path/artifact must be resolved before
   the human trial; standard Applications locations were absent). State: **Targeted checks passed; final
   validation pending.** Client configuration and cloud-backed test requests need
   bounded user approval; do not execute them while awaiting it.
5. **Finalization boundary.** The proposed end-of-round milestone is reviewed
   implementation plus targeted synthetic evidence and an approved real-client
   trial plan. Agree with the user when exploratory client feedback ends before
   freezing a final candidate; this plan does not infer that agreement. At that
   point complete all applicable full gates, installed-artifact acceptance and
   exact-head CI. No trial, source integration result or historical artifact
   receipt substitutes for final pilot readiness.

Concrete targeted commands (Node 24.21.0/pnpm 10.25.0, isolated build where needed):

- `pnpm check:toolchain` before validation.
- `node --test --test-concurrency=1 test/local-mcp/bridge*.test.mjs` from the
  backend directory; focused names during iteration.
- `pnpm --filter backend test:local-mcp` against the isolated fresh backend build;
  includes real HTTP/SQLite and direct SDK consumers.
- Existing affected local UI management/http tests if shared-state/authority
  evidence needs them; no browser claim from storage assertions alone. Actual
  dashboard visibility is part of the approved real-client checklist.
- `node scripts/check-markdown-links.mjs`, `git diff --check`, and affected
  doc-reader/checker tests discovered by path, filename and asserted content.
- `node --test scripts/local-migration/check-contract-baseline.test.mjs` and
  `node scripts/local-migration/check-contract-baseline.mjs`; record
  `baseComparison=skipped` when base artifacts are absent. Refresh derived
  fixtures only when new references/sinks require it; test/classify actual sinks.

The full `pnpm migration:gate`, applicable installed qualification and exact-head
CI remain required for final qualification, with pinned toolchain/resource
preflight and a stated purpose before expensive runs. Do not alter CI triggers,
retire modes, weaken tests or repeat the full gate after each correction. Changed
inputs invalidate affected evidence; explicitly carry forward only unaffected
coverage. Source-only trials cannot claim bridge-in-bundle installed qualification.

## Real-client acceptance and open decisions

The [canonical Claude checklist](README.md#claude-desktop-acceptance) remains the
acceptance authority: exact app/Node/bridge source/client/account/mode; discovery,
reads, permitted and denied writes; dashboard visibility; independent revocation,
rotation and explicit reconnect; **real inactivity exceeding 35 minutes**; app and
client restart; stale sessions and uncertain mutation response with no replay.
Synthetic clock manipulation is automated coverage, not the 35-minute observation.
Use only approved synthetic test data/grants for this slice; disclose that Claude
may send tool results to its provider. No actual personal config change or cloud
request is authorized by writing an example or completing local tests.

Local test evidence cannot approve client changes/provider requests. The
coordinator obtained explicit bounded approval for both the original Candidate 14
trial and the subsequent exact corrected app/bridge pair. The user performed the
requested dashboard unlock, normal app quits and runtime restart. After the
rotation/revocation checks, the user explicitly requested removal of the temporary
Claude entry; the coordinator removed only that entry. Any further live actions
remain coordinator-owned and bounded by the user's approval. Distribution/reset/
cohort decisions stay with the overall pilot.

## Change-to-evidence record

| Input / checkpoint | Evidence | Result / limits |
| --- | --- | --- |
| Initial source | HEAD and local/remote main `855e8734b919871eac82415465b456add38a3084`; branch created without reset | Known foreign docs preserved; no implementation |
| Toolchain | `LC_ALL=C PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" pnpm check:toolchain` | Passed; shell locale must use `C` for local Perl utilities |
| Plan review | `/root/plan_review` approved plan hash `0db9880efd4f5d9043b1e79c7c90622b35d2b0e23428305e3060ce8b36ee34f1` | No blockers. Nonblocking 404/error-validation/aggregate-buffer precision incorporated; coordinator authorized implementation. |
| Checkpoint 2 | Tests-first missing-module red, then 26 focused credential/transport/CLI tests | Passed on Node 24.21.0; synthetic ephemeral sockets only. Pipelined initialization and failed-renewal cleanup regressions failed before correction, then passed. Final validation pending. |

### Synthetic implementation checkpoint (2026-10-11)

The standalone bridge, four bridge test files and test-only stdio child are
implemented. A fresh isolated Nest build copied backend source/generated client,
scripts and tests beneath a private temporary validation root; dependency links
were read-only inputs. The checkout's `dist`, installed app and personal state
were not changed. Node 24.21.0/pnpm 10.25.0 preflight passed.

- Full affected `pnpm test:local-mcp`: **88 passed** against that isolated build,
  including existing direct SDK HTTP, auth, persistence, lifecycle and synthetic
  model-peer tests. No live model or provider was used.
- Subsequent same-inode credential race tightening: failing regression first,
  then **32 bridge tests passed**, including all four real SDK stdio/SQLite tests.
  Existing backend behavior and fixtures were unchanged; the unrelated coverage
  from the 88-test pass carries forward. The new race test raises the combined
  distinct local MCP case count by one.
- Contract-checker and Markdown-checker tests: **75 passed**. Strict Markdown
  links (145 documents), `git diff --check` and direct contract check passed;
  the direct check reports **`baseComparison=skipped`**, not a full migration gate.
- Registry delta is limited to the added bridge outbound classification and
  derived reference/sink census. Every existing outbound row is byte-equivalent
  as parsed data; protected historical ownership/dispositions were not changed.
- Initial integration failures were harness assumptions, not product failures:
  read-only clients intentionally discover five tools versus six for a writer;
  the lost-response fixture needed to parse the nested tool result before dropping
  its response. Corrected assertions still check authority and exactly one commit.
  The first full-suite attempt lacked its copied synthetic TLS fixture and raced
  signal delivery against subprocess startup. The repeat included that fixture
  and waited for a bounded protocol readiness observation; all 88 tests passed.

The coordinator read-only verified retained Candidate 14 at the temporary
`context-router-step09-candidate-20261010-14/Context Router.app` location.
Native package verification passed; manifest SHA-256 is
`944c5be0eb2e44e5c215fdacac3f8ad12546dd190cdddd8afa45c78285d8ff38`, source digest
`c5542b2b07032b89feeacbdfccadbd4a8864d052557388c74022874ef2bc7d70`, security epoch 1.
This identifies an available unchanged artifact, not the user's currently running
app. Its backend production sources/dependency manifests match this slice's base;
that relationship does not replace installed/client acceptance.

**Targeted checks passed; final validation pending.** The complete-diff review
of local trial checkpoint `96809067cc1f1548b7a6b13becab2051291eb536` found two blockers;
corrections and their approved recheck are recorded below.
Real Claude Desktop account/
policy/configuration, >35-minute inactivity, dashboard visibility, app/client
restart and the complete canonical acceptance checklist remain unverified.
The full migration gate, final installed qualification, exact-head CI and agreed
finalization milestone remain pending. No branch was pushed or artifact published.

### Independent review correction checkpoint (2026-10-11)

The complete review by `/root/diff_review` requested changes for two blocking
findings. The coordinator authorized this correction batch without changing the
approved product or validation scope.

- **P1, inherited debug credential disclosure:** Node 24.21.0 core network logging
  under `NODE_DEBUG=net` could write bearer bytes to stderr. The CLI now refuses
  nonempty Node debug/native-debug/options settings before credential access or
  requests; the manual config explicitly clears them. Subprocess regressions use
  only a synthetic token and test-only access/request observers, assert no
  credential access or HTTP attempt, and never print token bytes.
- **P2, SDK-invalid response forwarding:** null/primitive/array results, invalid
  result metadata, unsafe error codes and extra response-envelope keys could pass
  the adapter but fail the pinned SDK parser. The bridge now validates the generic
  result/error envelope and projects known response fields. Invalid dispatched
  responses produce SDK-valid fixed outcome-unknown errors without replay.
  Uncorrelatable invalid input omits its ID instead of emitting SDK-invalid null.
  Initialization also validates optional instructions and projects the supported
  server identity fields, preventing malformed optional metadata from escaping.
- The review regressions failed before correction. After the corrections, **49
  bridge tests passed** in the unchanged isolated backend build, including all
  four real SDK stdio/SQLite integration cases. Added focused checks also cover
  fragmented multibyte UTF-8, malformed typed IDs, lifetime ID exhaustion with
  explicit restart, and bounded shutdown with active/hung HTTP.
- **75 contract/Markdown checker tests passed**. Strict Markdown links (145
  documents), direct contract check (`baseComparison=skipped`) and whitespace
  checks passed after the guidance updates; no census refresh was needed.
  Backend production sources,
  dependency inputs, auth/persistence/lifecycle implementation and native/package
  inputs are unchanged; their unrelated coverage from the earlier 88-test local
  MCP pass carries forward. No full gate or package qualification was repeated.
- The MCP onboarding backlog now links to this implemented source trial; its
  broader C/C+ ergonomics remain backlog. Foreign agent-assisted onboarding edits
  remain untouched and excluded from commits.

The reviewer rechecked the exact correction commit's privacy/protocol changes,
new regressions and affected guidance, with the disposition below. Retain the
three reviewed modules under a private
`/private/tmp/context-router-claude-bridge-trial-<commit>/` directory with a JSON
receipt of exact commit, module hashes, Node identity and source-only limits.
The local trial still requires the real-client approval/acceptance and finalization
gates above. The retained Candidate 14 integrity evidence does not identify a
currently running app; choose the exact app before any stop/admin/restart.


### Review disposition and trial handoff (2026-10-11)

`/root/diff_review` approved correction commit
`38d6f052d347c14bb7d25d003563c2d58971529b` for the bounded source trial, with no
remaining blockers. Both P1 and P2 are resolved. The reviewer independently ran
**17 selected correction regressions: 17 passed, 0 failed** on Node 24.21.0 with
isolated temporary resources and ephemeral sockets. The eight-file correction
diff, including initialization projection, observation fixture and guidance, was
reviewed. Unchanged complete-diff coverage from
`96809067cc1f1548b7a6b13becab2051291eb536` explicitly carries forward for credential
handling, lifecycle/recovery, authority, no replay, checker/census coverage,
integration scope and delivery boundaries.

The subsequent disposition commit changes only this plan. All three bridge
modules remain byte-identical to reviewed `38d6f05` and the 49-test isolated
inputs; their hashes, final source revision, pinned Node identity, retained
Candidate 14 integrity evidence and outstanding limits belong in the external
snapshot receipt. Applicable Markdown/contract checks are rerun for this record;
unchanged code tests and the independent code review carry forward.

**Targeted checks passed; final validation pending.** This approves only a named
source-bound trial artifact, not client configuration, cloud-backed requests,
installed qualification, publication, merge or final pilot readiness. No app or
client was launched or modified by this slice. The next human decision is bounded
approval of the exact app, one preserved client configuration entry/restart,
dedicated synthetic-only credential/grants and synthetic provider-bound requests.
The canonical client checklist and agreed end-of-round finalization remain open.

### Plan amendment: nullable search confidence (2026-10-11, approved)

The user approved the bounded Candidate 14/Claude trial described above. The
coordinator observed ordinary Claude Desktop 2.31226.1 Pro discover six tools;
creating a synthetic definition and setting a value with omitted confidence
succeeded, then a preference read failed schema validation. A narrow same-client
SDK discovery/read probe reproduced `-32602`: active preference confidence must
be a number. Independent diagnosis reproduced discovery-cached validation and
confirmed that both search descriptors declare number while existing result
mapping returns stored nullable confidence. Earlier automated read clients had
not listed tools on those same clients, so the SDK had no cached output schema.
This is a failed read compatibility check, not evidence that the writes failed.
No private paths, client identifiers, credentials or value payloads are recorded.

This amendment authorizes implementation only after independent plan approval.
The current source is `acdce558bde0f004fccba7066e6f917ab6788777`; the bridge remains
at reviewed `38d6f05` bytes. The sole writer/coordinator/reviewer ownership and
requested-versus-observed model settings above continue unchanged.

**Smallest correction and owned paths.** Change only the four confidence schema
properties in `apps/backend/src/mcp/tools/preference-search.tool.ts` and
`apps/backend/src/mcp/tools/smart-search.tool.ts`: active and suggested confidence
become `anyOf: [{ type: 'number' }, { type: 'null' }]`. Keep stored/result values,
mutation requirements, domain/storage behavior, result mapping, authority,
transport, native code and dependencies unchanged. Tests may change/add only in
these tools' existing `.spec.ts` files, `apps/backend/test/local-mcp/tools-output-schema.test.mjs`,
`apps/backend/test/local-mcp/bridge-integration.test.mjs`, and the affected MCP
contract tests/fixture under `apps/backend/test/contracts/`. Guidance/evidence
ownership adds this amendment, `docs/useful/MCP_LOCAL_SETUP.md`, the MCP section of
`docs/current/LOCAL_MIGRATION_CONTRACT_BASELINE.md`, and a new explicit record plus
necessary derived census in `docs/current/local-migration-contract-baseline.json`.
No production bridge or checker/CI/gate implementation changes are planned.

**Contract evolution.** The checker deliberately treats output-domain widening
as breaking even though this corrects metadata for already-returned values.
Preserve that enforcement. After tests expose the defect, collect the exact new
MCP fixture and add one reviewed transition using the existing `migrationRecords`
mechanism: exact prior/new fingerprints, exact breaking diff, compatibility
window, migration/rollback guidance, evidence path, and the union of affected
consumer identities from both sides. Preserve all historical records and protected
ownership/dispositions. Known consumers retain numeric results and accept null
without coercing it to zero or inventing certainty; clients must refresh discovery
on explicit reconnect/restart. Unknown external clients receive the same nullable
confidence guidance without claiming deployed-client verification. Reverting code
requires no data rollback, but restores the known schema mismatch for null rows;
it must not silently rewrite stored confidence to satisfy the old descriptor.

Checkpoints:

1. **Reviewed amendment.** Independent reviewer checks the four-field scope,
   tests-first matrix, shared hosted/local contract transition and artifact/trial
   boundaries. Record the approval hash before product edits.
2. **Reproduce before correcting.** Add same-client `listTools()` then
   `callTool()` regressions for direct HTTP and the actual SDK stdio bridge.
   Exercise permitted mutation with omitted confidence, then discovery-cached
   read on that same client against the real isolated SQLite/backend fixture.
   Cover null and numeric confidence in active and suggested arrays for both
   search tools. Use synthetic persisted fixtures for nullable suggestion rows
   where normal suggestion mutation requires confidence; do not loosen that
   requirement. Smart-search coverage uses a deterministic workflow fixture and
   the real tool/result path, with no provider or live model. Assert unchanged
   structured content and its JSON text counterpart; retain authority checks.
   Run these tests red against the current isolated build, then implement the
   four metadata changes and run them green. Refresh only the reviewed MCP
   fixture/transition, never tests merely to match an accidental implementation.
3. **Affected validation and code review.** Freshly build the amended backend in
   an isolated source copy; never overwrite the running app or checkout `dist`.
   Run the two search tool unit suites, MCP contract/runtime-composition suites,
   all local MCP tests (including direct HTTP and stdio discovery-first reads),
   contract/Markdown checker tests, strict links and whitespace. Validate the
   exact transition against the real base artifacts using the existing checker
   mechanism; a `baseComparison=skipped` run alone is insufficient evidence for
   this amendment. Independently review the complete amendment diff, including
   transition/consumer evidence. Carry unchanged bridge/native/authority coverage
   explicitly, while qualifying the earlier read assertions' discovery gap.
4. **Source/artifact-bound retest.** Freeze a reviewed local trial commit after
   targeted checks. If a new installed candidate is needed, use the unchanged
   packager in an absent, separately named private output directory and record
   exact source, copied inputs, app manifest/archive hashes and package integrity.
   Explain the build's purpose and recheck pinned tools, input hashes, disk and
   isolated resources before starting. Packaging success is not full installed
   qualification. Preserve Candidate 14 and all existing app/state/model assets.
   Current user approval names Candidate 14 only: obtain separate bounded approval
   before replacing/relaunching another candidate or restarting the client for
   its trial. Retest the known ordinary-chat discovery/write/read sequence on
   synthetic data after approval, without automatic replay of prior writes.

Read-only packaging inventory: Node 24.21.0/pnpm 10.25.0 preflight and Apple clang
16.0.0 are available. The cached Node archive matches packager SHA-256
`6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe`; retained
`/private/tmp/step09-restart-llama-b11146-bin-macos-arm64.tar.gz` matches
`1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711`; Candidate 14's
bundled model license matches
`bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a`.
The former Step 06 asset paths no longer contain those inputs. Available disk was
approximately 15 GiB at inventory; Candidate 14's bundle/archive were about
817/282 MB, which excludes temporary build/dependency overhead. Check sufficient
headroom before packaging; do not delete retained inputs, personal state or
unrelated temporary roots to make space. No build or cleanup has started.

The agreed boundary remains targeted source/artifact retesting. The full migration
gate, complete installed qualification, exact-head CI, actual >35-minute idle
observation and remaining canonical client acceptance are pending the finalization
milestone. Do not treat the metadata fix or a successful retest as final pilot
readiness, and do not alter gate requirements to shorten this correction.

Independent amendment review: `/root/diff_review` approved full plan hash
`8be09c3dd7a55d16b1e48919671418fb4af2ae31410fed2ab07e0397d6c06144` with no blockers;
the coordinator authorized tests-first implementation. Code review remains pending.

### Nullable-confidence implementation checkpoint (2026-10-11)

The five new discovery-first regressions failed before production edits with the
same `-32602` confidence schema error: one actual SDK stdio integration and four
HTTP cases covering both result branches of both tools. Only the four descriptor
fields were changed. The new direct tests persist null/numeric values in isolated
SQLite; suggestion-null coverage seeds an existing nullable row without changing
normal mutation validation. The smart workflow fixture reads those same stored
rows; the real tool still filters authority and constructs the result. Existing
stdio integration now discovers tools on each exact writer/reader/direct client
before reading. Assertions preserve null/numeric confidence and equal structured
and JSON-text content.

After an isolated Nest rebuild, all five regressions passed. One test-only
assumption was corrected to the existing successful-read contract: `isError` is
optional and omitted by the helper, so the assertion rejects true and separately
requires `success: true` plus exact content/value preservation. The initial
schema failures were observed before that assertion was reached. No product
result-envelope change was made.

- Full affected isolated `pnpm test:local-mcp`: **110 passed, 0 failed**.
- The two search tool unit suites and MCP contract/runtime-composition suites:
  **13 passed across four suites**, run in the checkout against current TypeScript
  source and the newly collected fixture. This did not build checkout production
  output. The isolated tree supplied the 110-test compiled local MCP run; its
  unused copied contract fixture was not an input to the 13-test contract run.
- Contract/Markdown checker unit tests: **75 passed**.
- MCP collector delta: exactly the four confidence schema fields. Transition
  `pilot-nullable-search-confidence` pins prior fingerprint
  `sha256:51437088a1c3bdf2bdb07e04f0fb020ed561f457c49e5241cd4ab56093cb4018`
  and new fingerprint
  `sha256:abeddf85b98ad62f30a5e70caec6ca76c347fe88d6d6835377a7cd2fbc173b08`,
  the exact breaking diff and **64 consumer identities from both sides**.
- Required real-base contract comparison passed with **`baseComparison=performed`**
  against Git base `855e8734b919871eac82415465b456add38a3084`. The extracted artifact
  manifest SHA-256 is
  `3857a3efc2b110fdb4cebca4a2690a1873545569742491eda31567a0a5ececc8`.
  This focused comparison is not the complete migration gate.

The registry preserves prior migration records, protected ownership/dispositions,
authority, consumers and outbound inventory; only the new transition and four
new documentation reference rows are added. Consumer outcomes classify actually
updated compatibility guidance as migrated; unchanged schema readers and
reference/auth/transport/resource surfaces are verified-unaffected. Unknown
external-client evidence remains published
migration guidance, not observed deployed behavior.

The bridge modules, storage/domain/auth/native code and dependencies remain
unchanged. Their independent review coverage carries forward; the old client
read tests' missing discovery step is now explicitly corrected. Candidate 14 and
its ongoing idle observation were not contacted or modified by this work. Fresh
amendment code review, a separately named candidate and bounded replacement/retest
approval remain pending. **Targeted checks passed; final validation pending.**


### Nullable-confidence review disposition (2026-10-11)

`/root/diff_review` approved `828ef86c7c12119eca873fe823b98b816955ef07` for the
bounded source/artifact trial with no blocking findings. The reviewer independently
passed all **five discovery-first regressions**, the real-base contract checker
(`baseComparison=performed`), and verification that the manifest and seven base
artifact bytes match Git base `855e8734b919871eac82415465b456add38a3084`.
Prior bridge security/lifecycle/authority/no-replay review coverage carries forward
unchanged; the discovery-gap regression coverage is now corrected.

One nonblocking evidence-label correction marks the three web history/search
reference consumers as `verified-unaffected`: they contain display/GraphQL
references and do not consume the changed MCP confidence schema. The three labels
and the suite-provenance clarification above form an evidence-only batch, with no
production, test or fixture-byte changes. Applicable documentation/checker checks
and the reviewer's evidence-only recheck bind that batch before packaging.

A separately named output is proposed at
`/private/tmp/context-router-colleague-pilot-confidence-828ef86`. The unchanged
packager will record its actual final source SHA and copied-input digest. The
working tree retains two foreign documentation edits, so `dirty: true` must be
reported alongside their exact paths/hashes and proof that production inputs equal
the reviewed commit; do not label the build a clean-commit artifact. Packaging
awaits coordinator go-ahead after this evidence recheck. Launch/replacement/retest
still requires the user's separately bounded approval for the exact new candidate.

### Plan amendment: visible bridge tool failures (2026-10-11, reviewed)

The approved live Candidate 14 trial recorded no protocol traffic between
08:29:47.721 and 09:06:12.260 UTC, more than 36 minutes. A catalog tool request
then received JSON-RPC `-32000` at 09:06:12.271; Claude presented a generic connector
error and could not distinguish stale-session, unknown-outcome or schema failure.
The sanitized logs/UI do not retain the exact error body or HTTP status, so stale
session is an inference, not a proven 404 diagnosis. A separate explicit catalog
request at 09:07:41.079 succeeded at 09:07:41.111 and returned one synthetic
definition. No automatic retry was observed. This establishes elapsed inactivity,
an error and later explicit recovery; it does not complete the canonical idle
acceptance or prove the hidden error text reached the model.

The coordinator also observed an intentional Claude transport shutdown at
09:08:47.354 UTC, fresh initialization and discovery at 09:08:55.657, and a
successful first explicit post-restart catalog read returning one synthetic
definition. Candidate 14 and the credential were unchanged. This is restart
recovery evidence for the previous bridge, not acceptance of the presentation
change or the confidence-correction app, which was unlaunched at that checkpoint.

The confidence-correction app has since been packaged and verified at source
`3dd4f7e635936524afa04e96261df4d6c803c89d`, with production inputs matching reviewed
`828ef86`. Its external `trial-receipt.json` under
`/private/tmp/context-router-colleague-pilot-confidence-828ef86` records exact
source/foreign-doc hashes, copied inputs, compiled-byte equality, manifest/archive
integrity and limitations. It was unchanged and unlaunched at this amendment's
implementation checkpoint; the later explicitly approved launch is recorded in
the current evidence below. The new bridge work did not rebuild or replace that
app, and no approval was inferred from the earlier Candidate 14 approval.

**Scope and ownership.** After independent approval of this amendment, the sole
writer changes only `apps/backend/scripts/mcp-bridge/bridge.mjs`, affected/new
`apps/backend/test/local-mcp/bridge*.test.mjs` and the test-only
`apps/backend/test/local-mcp/fixtures/bridge-child.mjs` if needed for bounded
fixture controls. Documentation ownership is this plan and
`docs/useful/MCP_LOCAL_SETUP.md`; update derived reference/sink census in
`docs/current/local-migration-contract-baseline.json` only if these edits actually
change discovery. No backend output descriptor/contract-fixture, domain/storage,
auth, lifecycle, native/package, dependency or gate/CI change is intended. The
coordinator remains repository-read-only and owns all app/client actions. Writer
and independent reviewer requested Astra `xhigh`; coordinator requested Astra
Ultra. These are requested/accepted settings, not independently verified runtime
model/effort claims. Existing foreign files remain untouched and uncommitted.

**Smallest presentation change.** For an already initialized, well-formed ordinary
`tools/call` request, bridge-origin operational failures become a JSON-RPC success
envelope containing a `CallToolResult` with `isError: true` and exactly one text
content block selected from the bridge's fixed allowlisted messages. Include no
`structuredContent`, custom result payload, upstream text, arguments, credential,
path or exception. The pinned SDK permits error results without structured
content after discovery; it still validates structured content when supplied.
This intentionally changes `Client.callTool()` from a rejected Promise to a
resolved error result. Callers must inspect `isError`; a resolved Promise does
not mean the tool succeeded. Actual Claude rendering/model visibility remains a
human retest question, not a promise from SDK compatibility.

The eligibility guard uses plain-object checks without an SDK runtime dependency.
It requires a ready stdio lifecycle, the existing valid JSON-RPC request/typed ID,
only `jsonrpc`, `id`, `method` and `params` envelope keys,
`method === 'tools/call'`, object params, a string tool name, and arguments absent
or an object (not null or an array). Any own `params.task` key is ineligible.
Optional `_meta` must be an object; its optional `progressToken` must be a string
or safe integer. Any own `_meta['io.modelcontextprotocol/related-task']` key is
ineligible, whether its value is valid or malformed: task correlation requires
metadata that this minimal fixed result deliberately does not emit. Other params
and metadata remain opaque. This is only an error-presentation decision; retain
existing dispatch/validation behavior and do not validate domain arguments in the
bridge. Initialization/readiness failures before the stdio lifecycle is ready,
malformed requests/IDs, duplicate IDs, lifetime ID exhaustion, notifications and
non-tool methods keep protocol-error behavior. Errors for valid ready tool calls
cover actual-request stale 404, pre-dispatch unavailability/renewal incompatibility,
authority refusal, active-request capacity, pre-dispatch cancellation, and
post-dispatch cancellation/timeout/socket loss/malformed upstream response.
Keep the existing sanitized backend JSON-RPC error projection and backend success
or `isError` results unchanged; do not begin forwarding raw upstream errors.

The stale text may say the actual rejected request was not dispatched only when
that request received the existing verified stale response. Unknown-outcome text
must retain that a mutation may already have completed, that the bridge replayed
nothing, and that state must be inspected before retrying a write. Cancellation,
DELETE and reinitialization responses cannot settle an earlier mutation's outcome.
No automatic replay, renewal trigger, retry count, generation ownership, session
cleanup or credential behavior changes. Visible text offers the model guidance;
it cannot enforce Claude's decisions about later explicit tool calls.

Checkpoints:

1. **Plan review first.** Independent review approves exact guard, semantic-change,
   fixed-message and evidence boundaries before product edits. Record its hash.
2. **Tests first, then one rendering change.** Write regressions that fail under
   the current protocol-error behavior. Through the actual pinned SDK stdio
   client, call `listTools()` and then a tool on that same client; verify the
   new fixed `isError` result resolves, contains no structured content, and survives
   cached read-tool schemas. Exercise stale rejection followed only by a new
   explicit request/reinitialization; lost mutation reply after exactly one
   committed mutation/audit, unknown text, no bridge replay, then an explicit read.
   Cover authority, pre/post-dispatch cancellation, timeout, capacity and failed
   renewal. Sentinel inputs/upstream errors must not appear in result or stderr.
   Strict negative cases preserve protocol errors for lifecycle/non-tool/malformed/
   duplicate/exhausted-ID requests, unknown envelope keys, malformed optional
   `_meta`/`progressToken`, any own task key, and valid or malformed related-task
   metadata presence; preserve sanitized backend errors/results.
   Existing assertions change only for this approved presentation requirement;
   retain dispatch/commit counts, generation/cancellation and no-replay checks.
3. **Focused validation and diff review.** Run all `bridge*.test.mjs` plus affected
   `http.test.mjs`, `lifecycle.test.mjs` and `tools-output-schema.test.mjs` against
   the existing isolated confidence-corrected backend build after proving its
   production inputs still match reviewed `828ef86`. No unchanged backend rebuild
   or app qualification is needed. Run applicable Markdown/checker tests, links,
   whitespace and real-base contract comparison to detect unintended contract
   drift. Independently review the complete amendment diff; carry only unchanged
   prior bridge/backend/package coverage, explicitly excluding superseded error
   presentation assertions. Resolve blockers before freezing a new bridge commit.
4. **New bridge snapshot and bounded retest.** Retain all three bridge modules in
   a new private source-bound snapshot with exact commit/module/Node hashes and
   review/check receipts; do not overwrite the currently configured snapshot.
   Keep the confidence-correction app artifact unchanged. Present exact new
   bridge path, client configuration delta/restart and chosen app for separate
   bounded approval before any personal-client change or new-app launch. Retest
   visible failure text and deliberate recovery using approved synthetic data.
   Do not claim actual Claude acceptance from local SDK tests alone.

No live app/client/endpoint, credential or provider actions belong to the writer.
The full migration gate, final installed qualification, exact-head CI and remaining
canonical acceptance still wait for the agreed finalization milestone. This
amendment prepares a named trial and does not declare final pilot readiness.

#### Visible-failure implementation checkpoint

Independent review approved the clarified plan at full-file SHA-256
`f69de2b4dbfbe8226d1d820627ef861f14bfa9ba7db8a5cffb6b50f827fa80b1`,
superseding the provisional earlier hash; the coordinator then authorized
implementation. There were no remaining plan blockers. Product edits are confined
to the bridge's eligibility predicate and operational-error renderer. The exact
fixed messages, HTTP/session/cancellation behavior and existing sanitized backend
error projection are unchanged. No descriptor, contract fixture, registry,
dependency, native or packaged-app input changed.

Tests were updated first. Under the unchanged production bridge, the transport
run reported 14 passed and 25 failed out of 39, with expected protocol-error versus
tool-result shape failures. All four updated real SDK/SQLite integration scenarios
then failed for the same old error semantics before the product edit. After the
minimal renderer change, transport 39/39 and integration 4/4 passed. The final
focused run after stronger mutation-dispatch assertions and formatting passed:

- `node --test test/local-mcp/bridge*.test.mjs test/local-mcp/http.test.mjs test/local-mcp/lifecycle.test.mjs test/local-mcp/tools-output-schema.test.mjs`:
  **73 passed, 0 failed**, including all 51 bridge tests. The command ran from the
  previously isolated backend workspace with updated bridge/test bytes, private
  synthetic SQLite roots and ephemeral loopback ports.
- Real SDK cases discover on the same client before authority/stale/lost-response
  calls, so cached output schemas consume the new error result. The lost successful
  mutation dispatches exactly once, adds exactly one audit event, reports unknown
  completion with no replay, and a later explicit read returns the committed
  value. Cancellation still permits admitted work to commit; no rollback is claimed.
- Guard/projection cases preserve protocol errors for malformed envelopes, metadata,
  typed IDs, task/related-task presence, lifecycle, duplicate/exhausted IDs and
  non-tool methods. They cover capacity, pre/post-dispatch cancellation, timeout,
  changed renewal, malformed/lost replies and sentinel redaction. Backend success,
  tool-error results and sanitized backend protocol errors retain prior projection.
- `node --test scripts/local-migration/check-contract-baseline.test.mjs scripts/check-markdown-links.test.mjs`:
  **75 passed, 0 failed**. Derived fixture refresh produced no registry delta.
- Markdown links passed across 145 files; whitespace passed. The required
  real-base checker passed with `baseComparison=performed` against the previously
  verified seven-artifact `855e8734` bundle and its recorded manifest hash.

Build provenance is deliberately narrower than whole-tree equality: all **344**
tracked backend `src` files and build configuration/package inputs present in the
isolated build were compared byte-for-byte to reviewed `828ef86` and the checkout,
with zero mismatches. The actual source trees, including copied generated client
files, also match across all 358 files; the build asset plugin matches reviewed
`828ef86`. Root package/lock/workspace manifests match that commit, and both
workspaces resolve dependency symlinks to the same targets. The isolated harness
omits the hosted Prisma schema/migration and seed tree; those are not inputs to
this SQLite test build, and equality of those absent files is not claimed. The
previously built confidence-corrected `dist` remains unchanged. No backend or app
rebuild was performed for this bridge-only change.

Independent complete amendment review approved
`a3a41d9e2f170dbfd07528fd29e2fae4da57de97` against `3dd4f7e` with no blockers or
nits. The reviewer independently passed all **43** tests in the two changed
transport/integration files, the real-base checker (`performed`) and whitespace;
verified all 358 source-proof hashes against both trees; and matched changed
bridge/test bytes to the frozen commit. Unchanged credential/CLI, authority,
backend, native/package and nullable-confidence review coverage carries forward.
Prior assertions of protocol-error presentation are superseded by the approved
new tool-error semantics. The final evidence-only commit changes no executable
or test bytes; the new snapshot receipt must bind its three module bytes to this
reviewed/tested source commit.

#### Current trial evidence and remaining acceptance

Evidence update: 2026-10-11, coordinator observations through 12:29:07 UTC. The
writer read only the approved acceptance record, without token files or personal
configuration backups. Private state paths, client/request/process identifiers
and synthetic value payloads are omitted here. Requested writer setting remains
Astra `xhigh`, accepted at spawn but not independently runtime-verified.

The user explicitly approved the combined corrected-pair retest. Artifact identity
is unchanged from the reviewed handoff:

- App source `3dd4f7e635936524afa04e96261df4d6c803c89d`, production inputs matching
  reviewed `828ef86`, with the previously disclosed foreign documentation. Manifest
  SHA-256 `5399bf71478ecac4e9d89aa46867a8391b1b66b97585d0629c43ac8bccefa0e9`;
  app trial-receipt SHA-256
  `5155955c467b5454ca9bdb3aaefa7501852905427635fd3dabf4f99946aff33d`.
- Bridge snapshot source `c29efc5b0d733087eb24eab1fecb0c9095ae3def`, whose three
  module bytes match reviewed/tested `a3a41d9`. Snapshot receipt SHA-256
  `3b380150857e0c87bb0895613992b5c800fc84ea0d1f6f11b75f0486eb65ce74`;
  bridge module SHA-256
  `cf9c46f929f1edfe69d81c3a97fcb38830c6f7f8843ab60895d9ce0337a62f86`.
  Node remains 24.21.0, SHA-256
  `e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.

The user normally quit Candidate 14. The coordinator observed its owner lifecycle
quiescent, outcome `ok`, and all old owned processes exited. The corrected app then
launched against the same retained state, without a reset or model download.
Only the pilot entry's bridge-script argument changed while Claude was exited;
other MCP configuration fields/entries were preserved. Claude restarted on the
approved bridge, with fresh initialization at 12:00:59.801 UTC followed by
successful tools/resources discovery. The user subsequently restarted the local
runtime while Claude's bridge remained alive. The coordinator verified the new
listener belonged to the approved bundle, with no intervening client initialization
or request before the deliberate stale-session test.

| Corrected-pair check | Observed result | Limit |
| --- | --- | --- |
| Read original synthetic preference after discovery | Succeeded with original value and null confidence preserved | Corrected schema accepted by the actual discovery-cached client |
| New allowed write and explicit read-back | Write succeeded with `changed: true`; read-back returned the new value with null confidence | Synthetic scope only; no private value payload is recorded |
| Denied write | Claude displayed `MCP_PERMISSION_DENIED`, `success: false`, `changed: false` | Synthetic policy denial; separate rotation/revocation observations follow |
| Runtime restart with Claude left running | First explicit read displayed the fixed session-expired/not-dispatched/new-request message as a failed tool; a separate explicit read succeeded with null confidence and unchanged value/timestamp | Raw HTTP status and `isError` flag were not captured; matching stale path is supported by reviewed source |
| Credential rotation | Native operation succeeded after clean quit; old credential was visibly denied; after changing only its file argument and restarting Claude, fresh discovery/read succeeded | Dedicated synthetic client only; no two-live-client independence claim |
| Credential revocation | After another clean quit, native inspect/revoke/inspect showed generation 2→3 and revoked state with policy/grants unchanged; running bridge was denied, then fresh Claude initialization failed with fixed access-denied text | Native operations exited successfully; no preference data returned on denial |
| Dashboard | Prior pair's synthetic record and MCP attribution were observed after manual unlock | Final corrected-pair dashboard session still awaits unlock/verification |

The protocol summary records exactly one request/response pair for each original
read, new write, read-back and denied write. No extra call is inferred from Claude's
prose. Restart recovery likewise records one stale response followed by a separate
explicit request; no automatic client retry was observed. No internal replay claim
is inferred from those client logs alone: reviewed source and deterministic
integration tests provide the internal no-replay evidence.

The original Candidate 14/previous-bridge trial also observed a real idle interval
of at least **2,136.801 seconds**, exceeding 35 minutes. Its first subsequent
catalog request, after more than 36 minutes without protocol traffic, received a
generic connector error; a separate explicit request succeeded with no automatic
retry observed. Stale session remains an inference because sanitized evidence did
not retain HTTP status or the exact error body. An intentional prior Claude
restart also produced fresh discovery and a successful first explicit catalog
read. Those observations remain attributed to that original pair.

The independent reviewer accepted a composite of that actual idle interval and
the corrected pair's visible stale failure/separate explicit recovery. The stated
condition is now met by the runtime-restart observation together with reviewed
source and deterministic no-replay evidence. The unchanged-input assessment covers
backend idle pruning/session/auth and bridge request/reconnect behavior; the
intervening changes are nullable search output metadata and ordinary tool error
presentation. This is composite evidence, **not a directly observed 35-minute idle
pass on the corrected pair**. Neither the original hidden error nor the current
uncaptured HTTP status/`isError` flag is represented as a raw wire observation.

Rotation produced a private 0600 export without printing token bytes. The old
credential was denied; the replacement retained the original record and timestamp
after explicit Claude restart. Revocation preserved capabilities, target policy,
sensitivity restriction and grants. Fresh client initialization was then rejected
with `-32000`, and Claude displayed the connection failure. The user subsequently
requested removal of the temporary entry. With a private backup, the coordinator
removed only that entry and verified the original MCP entries matched exactly.
An incidental sidebar preference changed through the earlier client UI remains
recorded externally; the whole personal configuration is not claimed byte-for-byte
restored. Claude reopened without the temporary connector. The approved app remains
running against preserved data/model/state; no reset or cleanup was performed.

Final corrected-pair dashboard verification is pending the user's unlock. A live
two-credential independence exercise and live lost-mutation-reply exercise remain
unverified; deterministic isolated tests cover those behaviors separately. The
remaining canonical checklist, agreed finalization milestone, full migration gate,
final installed qualification and exact-head CI remain pending. Cheap read-only
preflight found the pinned Node/pnpm, explicit Python, browser and clang available;
the local Docker daemon and cached PostgreSQL image were available without a pull,
with approximately 17 GiB disk headroom. That preflight is not a gate pass.
The user has requested source-branch publication and a draft PR for review at this
checkpoint. This does not establish a final-candidate freeze or authorize broad
qualification, binary publication or merge; dashboard verification and the agreed
finalization milestone remain pending.
No writer app/client/live-port, credential or provider action was taken for this
evidence update, and no executable/test bytes changed. The evidence-only batch
passed 75 checker/Markdown tests, links across 145 Markdown files, whitespace and
the required real-base comparison (`performed`). Unchanged behavioral-test and
independent source-review coverage carries forward.
**Targeted checks passed; final validation pending.**

### Draft review correction checkpoint (2026-10-11)

The user authorized three focused review corrections on PR #172 at `d5aab13`.
Independent plan review approved the bounded delta before edits: persistent
executable-location guidance, explicit credential-ancestor regressions, and eight
unchanged consumer-evidence labels. Writer/reviewers retain requested Astra
`xhigh` settings without independent runtime attestation. No production defect or
reader change is assumed by adding tests.

Owned changes are limited to `MCP_LOCAL_SETUP.md`, `bridge-credentials.test.mjs`,
the eight outcomes in `pilot-nullable-search-confidence`, and this plan. The runbook
now requires a durable private user-owned snapshot and verified code/receipt/Node
ancestry outside managed state; temporary snapshots remain historical trial
evidence. It pins all three modules and the receipt to reviewed source rather
than treating a colocated receipt or read-only file mode as an independent trust
anchor. No live files, client configuration or credentials are moved or changed.

Credential regressions cover higher group/world-writable and symlink ancestors,
root-owned sticky acceptance and its non-root-owner/root-owned-child rejection
boundaries, and mid-read higher-ancestor replacement while preserving credential
inode/content, private-parent inode and outer-directory link count. Synthetic
metadata seams avoid privileged ownership changes and are restored in `finally`;
serial tests retain real file I/O. Production reader bytes remain unchanged.

The eight unchanged consumer labels are corrected to `verified-unaffected`:
the eval tool wildcard; authorization search/smart-search references; preference
schema and workflow smart-search references; Harbor mode search, sensitive-policy
check and overhead-report search references. All 64 consumer identities, contract
fingerprints, exact transition changes and prior history remain intact. The
older wording above now distinguishes actually migrated guidance from unchanged
readers/references. No checker implementation or fixture change is intended.

Link evidence has two scopes: the earlier workspace pass covered 145 Markdown
files including the preserved untracked onboarding document; the draft's exact
tracked head contains 144. Do not describe the workspace count as an exact-head
pass. The accepted historical composite idle evidence above remains valid within
its stated limits. The user has additionally required **one actual uninterrupted
interval exceeding 35 minutes on the final trial pair in this PR, only after all
other corrections/reviews settle**. That direct observation is pending and has
not started; this timing agreement does not authorize live setup now.

Focused validation is the credential test file, required real-base contract
comparison, strict Markdown links, whitespace and an exact eight-outcome JSON
delta assertion. The registry's web-runtime reader consumes unchanged outbound
and reference sections; no web suite, unchanged checker unit suite, build or full
gate is needed for this delta. Both affected security/runbook/test and
evidence-label reviews approved the frozen batch without findings; no independent
behavioral rerun was claimed. Prior unaffected code and trial evidence carry
forward; final validation remains pending.

Focused results: pinned toolchain preflight passed; the credential-only suite
passed **9 tests, 0 failures, 0 skips**, without production reader changes. Required
real-base comparison passed with `baseComparison=performed`; strict workspace
links passed across 145 Markdown files and whitespace passed. The exact-delta
assertion confirmed only eight outcome values changed in the registry, with all
64 consumer identities and every other parsed field preserved. Tracked HEAD
contains 144 Markdown files; no exact-head 145-file claim is made. No broad suite,
build, app/client/credential action or timed idle interval was run.
