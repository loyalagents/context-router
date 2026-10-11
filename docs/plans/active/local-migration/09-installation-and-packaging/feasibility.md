# Step 09 Feasibility Evidence

- Scope: independently approved P1 probes; not an installed product or release
- Writer/operator: `/root` only
- Host: MacBookPro18,2, Apple M1 Max, 64 GiB, macOS 15.1.1 (24B91), arm64
- Runtime: Node 24.21.0, pnpm 10.25.0, CLT macOS 15.1 SDK
- Source: branch `codex/local-migration-09-installation-and-packaging`, base
  `7328ceea63a784577594d52af18062be8b583855`; uncommitted documentation/probes
- No personal installation, client configuration, model run or large download

## Native Ownership Fixtures

Command: `node --test scripts/local-migration/installation/feasibility.test.mjs`
with the pinned Node on PATH. The first run failed all eight tests because the
guardian implementation did not exist. After implementing the fixture guardian,
all eight passed in 3.800 seconds. Private evidence roots end in
`context-router-install-feasibility-0IgsPo` (red) and
`context-router-install-feasibility-TyIItL` (green).

Observed: direct Node application/model and parser fixtures retain the same
inherited lock inode; duplicate startup creates no children; explicit restart
observes both old direct owners and all fixture lock holders gone before a new
generation; launcher pipe EOF stops the cohort; exact owned model crash stops
the application without automatic restart. Guardian SIGKILL leaves finite-lived
fixtures retaining exclusion; their later natural exit does not clear durable
uncertainty. Inode replacement and partial/corrupt/unrecognized journal text fail
closed. No PID/name/port inference is used for cleanup.

The `cohort-extinct` event proves lock-holder extinction under these fixtures'
descriptor behavior only. It is not evidence for arbitrary native descendants.
The boot-metadata case rejects unrecognized text; it does not implement reboot
recovery. Actual selected-model retention, forced-cleanup failure and native
AppKit interaction remain separate checks.

Independent architecture/security review approved these three exact files as
bounded synthetic probes with no blockers:

| File in `scripts/local-migration/installation/` | SHA-256 |
| --- | --- |
| `guardian-probe.c` | `d3fb7fc5253d6611a3ca8ea744f2dc9de1ad9699457adb8d275526f6a2546f6f` |
| `process-fixture.mjs` | `8b938e8535721839c7f1ac3fd1f9056bc30d9989b6b7f81ee38d2019ccc3222c` |
| `feasibility.test.mjs` | `1c28bbe3f69cceb5cd5e31533facfe2da7646dacafded09f13a9b98e802a6c7d` |

## Actual Production Closure

Command: `node scripts/local-migration/installation/bundle-feasibility.mjs`.
Owned temporary source/dependencies are copied using the existing gate helpers.
The current backend and Next custom server are built, deployed offline, copied
into fresh payload inodes, and joined with the cached pinned Node archive.
The real application, CLI and PDF child run under macOS OS policy denying reads
of the caller/temporary source and package store and denying execution of all
executables except bundled Node. PATH is empty. Negative controls prove source
read and external executable denial. The outer build/browser driver is outside
that application restriction; this is not a claim about the whole test process.

| Run suffix | Result | Evidence and disposition |
| --- | --- | --- |
| `context-router-install-bundle-MmByhW` | Failed before app launch | Seatbelt rejected `127.0.0.1:*` network-rule spelling. Corrected to its supported `localhost:*` syntax. Build/staging completed; caller-integrity-on-failure was not yet implemented, so that result is unverified for this run. |
| `context-router-install-bundle-ISn7OH` | Failed at PDF probe | Isolation controls and CLI initialize/upgrade/provision/list passed. Probe incorrectly treated the intentionally unembedded-font rejection fixture as positive. Existing product correctly returned `PDF_AUXILIARY`; no product/test policy was changed. Caller integrity true; cleanup errors empty. |
| `context-router-install-bundle-6PvsUb` | Passed, 121.716 seconds | Negative font rejection plus embedded Greek extraction; real browser unlock; MCP initialize after page close; dashboard remains available; exact app/browser cleanup; caller integrity true; cleanup errors empty. |

Each run retains private `summary.json` and bounded phase logs below the local
temporary directory. Passing run copied-input SHA-256:
`ba2a5aa7a24025aaa19bfc145885741ef4408df36d929bf580d36968f32efe35`.
The passing payload is 787,905,578 bytes across 37,204 files, uncompressed,
before synthetic probe files. Every staged symlink resolves within the bundle.
Bundled Node is 122,129,232 bytes, binary SHA-256
`e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.
Its retained LICENSE is 157,609 bytes. These sizes do not include a native shell
or installed model assets and are not a compressed download-size claim.

The cached 27,386,080-byte Node Darwin arm64 tar.xz matches the official HTTPS
SHA-256 `6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe`.
[Official release](https://nodejs.org/en/blog/release/v24.21.0).
The original bundle runs did not verify PGP signatures. The later bounded
signature probe below closes that archive-authentication gap; it does not
authenticate our future application distribution. No personal GPG installation
was performed.

## Certificate Fixture

Read-only metadata review selected `@peculiar/x509@2.1.0` for a temporary probe,
with native Node WebCrypto and explicit `reflect-metadata@0.2.2`. Root's
`certificate-acquire.py` materialized 21 exact registry package versions,
2,266,576 unpacked bytes, under private `context-router-cert-p1-p4k57vpo`.
SHA-512 integrity was verified before exclusive regular-file extraction; no
package scripts ran. No product manifest or lock changed.

Independent High compatibility review approved the acquired closure:
73 declared dependency edges resolve within their ranges; 213 CommonJS modules
and 694 literal require edges stay inside the closure. Both required tslib
majors remain present. Actual MIT, BSD-3-Clause, 0BSD and Apache-2.0 license text
is retained. No outbound/process/native loading sink was found in the inspected
graph. Import-time registrations are preserved; no speculative trimming.

Acquisition receipt SHA-256:
`39417cb972524ca985d7f5c6a467e221a7688a82447dfae560eccdd60619aa96`.
Sorted relative package-path/NUL/binary-file-SHA-256 aggregate:
`3bca773a10f3be0e8e9934a86b50456f304ee0907e6f2c542f74ec2f4675b503`.
Registry attestation metadata identifies build commit
`4f708e3f3ef2195e0590d3fb7cb3dc579092b0ed`; release tag resolves to
`557b2a9a45669917615d42e93f96672812b04244`, one version-only commit later.
The release workflow publishes before committing/tagging. Attestation subject
matches package integrity, but provenance signatures have not been verified.
[Official comparison](https://github.com/PeculiarVentures/x509/compare/4f708e3f3ef2195e0590d3fb7cb3dc579092b0ed...557b2a9a45669917615d42e93f96672812b04244).

Tests and the unchanged actual claim validator were copied into the private
closure. Initial invocation stopped at source cwd access denial; corrected
private-cwd invocation failed on the missing generator (expected red). After
implementing the fixture generator, all four tests passed in 0.242 seconds
using the staged bundled Node with string code generation disabled and OS
denial of source reads, external executables and remote networking:

- Fresh ECDSA P-256/SHA-256 keys/certificates and separate API keys; exact
  self-signed CA/IP SAN/subject and one-day validity; exclusive existing claim.
- Existing validator rejects wrong SAN, expired/future date, non-CA and loose
  permissions without creating a claim; mismatched private key rejected by TLS.
- An owned loopback HTTPS fixture serves through an explicitly pinned CA.
- External execution is denied and a reserved remote address fails with EPERM.

Only synthetic fixture credentials were generated. They remain private and
were not printed. Actual llama.cpp TLS/loading compatibility, product adoption
and signed release provenance remain unproved and gated.

## Remaining Checkpoint 1 Work

The expanded native ownership suite now passes all eleven tests in 34.006
seconds, private root `context-router-install-feasibility-YjEn5i`. Added tests
cover application loss, occupied listener and forced cleanup. The first
occupied-port assertion was insufficient: it accepted eventual fixture expiry;
root strengthened it to require an observed EADDRINUSE event before implementing
the listener fixture. It then failed as expected and passed after implementation.
The application SIGKILL case initially expected clean completion, contradicting
the existing fail-closed requirement while an orphan parser retains its lock.
The corrected test requires the observed injected loss, both direct owners
reaped, no new generation and retained uncertainty after the finite parser exits.
The original 10/11 failure is retained in `context-router-install-feasibility-cKz2Qc`.
This establishes a constraint for P2: actual unproved descendant cleanup must
remain blocked; an obtainable lock alone cannot authorize restart.

`node --test scripts/local-migration/installation/appkit.test.mjs` was red with
the native source missing. The first compiled run under restricted execution
stalled before AppKit startup, exceeded its test timeout and was interrupted
through its owned tool session; all three observed test processes then exited.
That failed run is retained as `context-router-appkit-p1-o8pDMn`. Root added a
20-second OS alarm covering pre-event-loop startup and a retained-child test
deadline. With WindowServer access, the native AppKit menu compiled and invoked
its real Restart/Quit selectors, delivering fixed commands through the owned
guardian and observing both fixture generations and guardian exit: one test
passed in 1.163 seconds, root `context-router-appkit-p1-u5YMuA`. This was a
temporary status item, with no application installation, clipboard access or
default-browser change. Browser behavior remains the separate actual bundle
check above; terminal-free real-token interaction is installed acceptance work.

`node --test scripts/local-migration/installation/readiness.test.mjs` was red
before its fixture existed, then passed two tests in 0.103 seconds. It models
loading/ready/failed framing, fragmented input, stale generation, extra fields,
overlong/duplicate messages and lost control. One hundred pre-ready status/call
attempts reach no mock claim/probe; the non-AI fixture remains usable. This is a
protocol/admission model, not integration evidence for the unchanged real
LocalModelService. P2 must test the actual service and both transports.

Read-only `kern.bootsessionuuid` succeeds on this Mac with native access. Its
actual value is not needed in repository evidence. Restricted access returned
EPERM first. No sleep/wake or reboot experiment occurred, so stability/change
across those transitions remains unverified. Staged Node's direct dylib imports
are only system CoreFoundation, Security, libc++ and libSystem; full native
model dylib closure/signing remains pending.

The user approved the bounded native request and scoped Windows/Linux deferral
on 2026-10-06. Windows/Linux remain unsupported and unqualified; signing access
and private release destination remain missing. P2 must resolve measured choices
and its concrete lifecycle/maintenance/update design before product implementation.

## Native Proof: Preflight Failure Before Model Execution

The one approved P1-N.1 command used pinned Node 24.21.0 and reviewed source
hashes. Private evidence root: `context-router-step09-native-6YirQd`; receipt
start `2026-10-07T04:53:12.452Z` (2026-10-06 local), elapsed 5,022.857 ms,
`sessions: []`, `cleanupErrors: []`. Both cached runtime/model hashes passed;
runtime extraction, bounded helper compilation and normal-pressure memory
observation completed. Certificate package import, credential generation and
all native model launches/completions remained unrun.

The certificate aggregate assertion failed because the expected value used
Python `Path` component sorting while the JavaScript runner used full-path
string sorting. Independent read-only verification reproduced both digests
over the same 814 regular files, 2,266,576 bytes, without symlinks. Original
component-order aggregate remains
`3bca773a10f3be0e8e9934a86b50456f304ee0907e6f2c542f74ec2f4675b503`;
full-path string order is
`5ac9d3fb2dc0f22949a02f45331cfa25a6f4283c469e669ce4ca769a7ca90ca7`.
Acquisition receipt and generator hashes are unchanged. The receipt contains
package metadata rather than individual file hashes; reproduction of the
original aggregate binds all current package paths/bytes to prior review.

The [P1-N.2 correction](native-probe.md) standardizes on the runner's existing
full-path string order, updates the expected pin and revision/approval guard,
and changes no lifecycle bounds. A read-only Node check passes the corrected
pin over the real reviewed closure, with zero package imports/model starts.
At this point no second native command was authorized or had run. The failed
result remains failed. Subsequent approval and selected-model evidence follow.

### P1-N.2 Subsequent Approved Result

The user subsequently authorized proceeding with the corrected probe and
implementation. One P1-N.2 command passed on the same M1 Max/64 GiB/macOS
15.1.1 host using Node 24.21.0. Private evidence root:
`context-router-step09-native-OMAptO`; receipt SHA-256
`e712a01190edc7c3fd9e3f0367c8ce9fd727aab66f70f253a81f3ec5ec98adc5`.
Start: `2026-10-07T05:11:16.520Z`; elapsed 33,393.835 ms; cleanup errors: none.

| Observation | Session 1 | Session 2 |
| --- | --- | --- |
| Pinned public TLS ready | 26,850.529 ms | 847.676 ms |
| Public readiness attempts | 133 | 5 |
| Missing/wrong key denied; authenticated properties match | Passed | Passed |
| Native inherited descriptor retained after guardian drops its copy | Passed | Passed |
| Synthetic completions | 1 | 1 |
| Exact native child exit observed and exclusion ended | Passed | Passed |
| Private bounded diagnostics, API key absent | Passed | Passed |

Both sessions verified one slot, context 16,384 and the pinned template digest.
All sampled memory-pressure values were normal. Observed process lifetime peak
physical footprints were 793,514,240 and 787,353,728 bytes; these samples do not
measure total GPU/mapped-model memory or qualify smaller hardware. Model and
runtime hashes, inspected certificate closure and fresh keys were checked.
No downloads, personal installation or existing application data were involved.

This establishes the selected binary's inherited descriptor retention and the
generated TLS/readiness/fresh-session mechanism in these two runs. It does not
qualify the installed app, sleep/wake, crash recovery, new hardware or cancellation
E/H. P1-N.1 remains failed; its corrected successor does not erase that evidence.

## Node Archive Signature Verification

The [P1-V.1 supplement](provenance-probe.md) and actual temporary OpenPGP.js
payload received independent compatibility approval before import. The first
plan review rejected authenticating the target archive with its own staged
runtime. Root corrected the verifier to use the established trusted host
Node 24.21.0, independently part of the existing toolchain. Its binary SHA-256
is `e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.

`openpgp@6.3.2` was fetched into private
`context-router-node-signature-qv3vb0t1`, its pinned SHA-512 checked and 43 regular
files exclusively extracted (17,421,480 bytes). No dependency install or package
script ran. The actual payload and license were inspected independently. The
Node entry's ECDSA paths contain undeclared `eckey-utils` references, but the
specific official key/signature uses Ed25519 Legacy; those paths were neither
required nor imported. No dependency was added to work around them. The LGPL
package remains temporary and outside the product payload.

The verifier test was red before its fixture module existed. Using a retained
owned child through the existing bounded command runner, the verification then
passed all four tests in 0.128 seconds overall (test harness 0.037 seconds), with
remote network, source reads, process creation and external execution denied:

- Parsed key fingerprint exactly matches the official pinned signer
  `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`.
- The clear-signed official checksum document has exactly one verified signature.
  Its sole strict Darwin arm64 tar.xz entry matches the cached archive's SHA-256.
- Tampering with that signed entry rejects; an incorrect fingerprint rejects.
- Attempts to create another Node child, run `/usr/bin/true` and connect to a
  reserved remote address are denied.

Private `verification.json` and bounded `verification.log` retain the receipt.
This authenticates the fixed archive against the stated official key using the
inspected verifier/HTTPS acquisition chain. Application publisher identity,
nested signing, notarization, Gatekeeper and replacement trust remain pending.
