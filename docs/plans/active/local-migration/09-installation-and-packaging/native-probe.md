# Step 09 P1-N Native Proof Request

- Revision: P1-N.2, checksum-order correction; affected independent re-review and renewed user approval pending
- Parent scope: checkpoint 1 feasibility only; no product implementation approval
- Sole writer/operator: `/root`
- Purpose: resolve selected native model descriptor retention, generated TLS,
  readiness order and fresh sessions after observed shutdown

This extends P1's synthetic-only execution permission. The user's Step 09 request
explicitly requires separately bounded approval for new native model experiments.
No Step 06 permission is reused. The proposed runner is
`scripts/local-migration/installation/native-measurement.mjs`. P1-N.1 was approved
by the user on 2026-10-06 and stopped at preflight before any native session or
completion. P1-N.2 is not yet authorized to execute.

## Checksum Correction And Execution Disposition

The one approved P1-N.1 command stopped after 5.023 seconds, with both cached
assets verified, normal memory pressure, zero sessions and no cleanup errors.
Its certificate closure check used a Python `Path` component-sorted aggregate
as the expected value while the JavaScript runner sorted full-path strings.
All 814 files (2,266,576 bytes) still reproduce the original reviewed aggregate
`3bca773a10f3be0e8e9934a86b50456f304ee0907e6f2c542f74ec2f4675b503`
under component order. The exact same files in full-path string order produce
`5ac9d3fb2dc0f22949a02f45331cfa25a6f4283c469e669ce4ca769a7ca90ca7`.
The first ordering difference is `types/bit_string.js` versus `types.js` in
`@peculiar/asn1-schema/build/cjs`. No dependency change or new download occurred.

P1-N.2 changes only that expected aggregate, the receipt revision and the
accidental-execution guard below. All runtime/session/resource/cleanup limits
remain as reviewed. Renewed approval is requested because P1-N.1 explicitly
allowed one command and required stopping on any failed check; the failed
preflight does not silently authorize a second command. No model session or
completion was consumed, but no rerun will occur without the new answer.

## Fixed Bounds And Inputs

One command on this M1 Max/64 GiB/macOS 15.1.1 host, at most six minutes total,
two sequential native sessions, one short synthetic completion per session
(two total), 64 output tokens and 30 seconds per completion. Each session has
a 60-second public-health readiness deadline and an independent native owner
150-second lifetime, followed by at most five seconds graceful and five seconds
forced exact-child cleanup. Stop on any failed/uncertain check; no inference,
startup or generation retry. HTTP readiness polling is bounded and unauthenticated.

Use one monotonic six-minute deadline with the last 20 seconds reserved for
cleanup. The active-work cutoff is 340 seconds; a generation cannot start unless
at least 170 seconds remain for its independent native lifetime and cleanup.
The common stop signal gates launch after asynchronous setup and each claim,
qualification, template/preparation, control write and completion. Memory failure
aborts that same signal. Control errors are handled, and no write follows EOF.
Tests inject stop during setup, resource failure during qualification and the
active deadline, including exhaustion of the reserved cleanup budget.

Use only the existing cached b11146 Darwin arm64 archive (11,189,714 bytes,
SHA-256 `1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711`)
and existing Qwen3.5-9B-Q4_K_M weights (5,680,522,464 bytes,
SHA-256 `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`)
under the retained Step 06 asset root. Rehash both; extract runtime into a new
owned private temporary root. No downloads, model changes, personal application
installation, existing data, external clients, reboot or sleep-setting change.

Use the exact inspected P1 certificate closure and generator, the current
unchanged claim validator and completion client, and existing pinned runtime
flags/template hash. Two new private session directories, API keys and one-day
certificates are generated sequentially; the second is created only after the
first exact native owner has exited and lock exclusion has ended.
Recheck the inspected package-file aggregate and generator SHA-256 immediately
before import; an unchanged acquisition receipt alone is insufficient.

## Owned Process And Observation Protocol

A small native experiment owner forks/execs exactly one inference child,
retaining its direct parent/waitpid authority. Both initially inherit a private
flock descriptor. No process is found or signalled by name, port or inferred PID.
The model runs under an OS profile denying network except its owned loopback
port. Model diagnostics drain through a private bounded one-MiB file; the
parent exports fixed events only. Exact child PID is used solely for read-only
memory sampling. Abort if memory pressure is not normal or lifetime peak exceeds
18 GiB. This is an experiment bound, not a universal hardware-support claim.

Only public pinned-TLS health is polled while loading. After health 200, the
actual validator claims the fresh session, negative missing/wrong-key probes
must receive 401, and authenticated properties must match one slot, 16,384
context and the selected template hash. Public health does not replace those
checks. The existing client makes the single synthetic completion without retry.

To test FD retention safely, command the still-running native owner to close
only its own copy of the lock descriptor. Another lock attempt must remain
blocked by the actual model after exec/TLS readiness. The native owner retains
its exact child handle and later terminates/reaps it. **Do not kill the owner**
to test this; that could leave an unbounded native orphan. After observed
waitpid exit, exclusion must end before any next session. This proves the
selected binary's retention in these runs, not arbitrary descendants or general
crash recovery. The existing finite fixture tests cover intentional owner loss.

The coordinator's EOF, SIGINT/SIGTERM or whole-command deadline closes control;
the native owner independently stops/reaps its child on EOF or lifetime expiry.
If exit cannot be observed, retain private evidence, block further sessions and
report uncertainty. Do not infer cleanup or attempt arbitrary recovery. The
model owner's death itself is not deliberately injected by this experiment.

## Existing Deterministic Evidence And Remaining Limits

`node --test scripts/local-migration/installation/native-owner.test.mjs` was
written first: two failures with the C owner missing. Initial implementation
passed compilation but the probe ended before its Node fixture printed ready;
the test was corrected to wait for post-exec descriptor readiness before the
release check. Current two tests pass in 0.374 seconds, using only a finite
15-second Node fixture and the owner's 20-second fixture mode. Those tests
verify lock retention after exec and EOF exact reaping. They are not native
model evidence. Private red/intermediate/green roots are retained.

The first independent P1-N review requested changes for launch-after-cancellation
and cleanup exceeding the total budget. P1-N.1 adds a shared stop/admission
controller, monotonic cleanup reserve and four deterministic tests. Those tests
failed before the controller existed and now pass (0.053 seconds). Renewed
review must approve the revised runner/bounds before the user execution request.

This experiment does not qualify installed UI/MCP AI, cancellation E/H, sleep,
reboot, resource-starved hardware, credential expiry recovery, broad platform
support or distribution signing. Preserve all original Step 06 failed/limited
evidence. Any further live installed-application test requires a separately
bounded approval unless explicitly included in a later approved request.

## Proposed Invocation

After independent review and an explicit user answer only, use Node 24.21.0:

```sh
STEP09_NATIVE_APPROVAL=P1-N.2-two-sessions-two-synthetic-completions \
  node scripts/local-migration/installation/native-measurement.mjs \
  <exact-reviewed-private-certificate-closure-root>
```

The environment value is an accidental-execution guard; it is not authorization.
Retain code hashes, approval evidence, exact toolchain/host, artifact hashes,
bounded timings/memory, results, exact owner exit, and private diagnostic audit.
