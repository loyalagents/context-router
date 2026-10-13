# Packaging Critical Path

- Status: checkpoint 2; approved bounded candidate passes focused validation,
  awaiting the coordinated operation experiment
- Outcome: measure the remaining packaging critical path, then implement one
  justified optimization without changing the properties validation proves.
- Priority: bounded efficiency work, subordinate to the assisted pilot's live
  acceptance and machine-resource needs. One cohesive PR; no automatic merge.

## Ownership And Starting Inputs

The isolated worktree is
`/Users/lucasnovak/.codex/worktrees/aad6/context-router`, branch
`codex/packaging-critical-path`. Fresh `git fetch origin main` confirmed both
the initial clean HEAD and `origin/main` at
`583277a7b08f11084ea63cb879225543c348ea85`. The coordinator independently
verified the remote ref. The starting checkout had no implementation changes.

| Role | Requested model / effort | Observed configuration / ownership |
| --- | --- | --- |
| Coordinator `/root` | GPT-6 Astra / Extra High (`xhigh`) | Session configuration observed: `gpt-6-astra`, `xhigh`; repository read-only |
| Inventory | GPT-6 Astra / High | Session configuration observed: `gpt-6-astra`, `high`; read-only |
| Sole writer `/root/writer` | GPT-6 Astra / Extra High (`xhigh`) | Session configuration observed: `gpt-6-astra`, `xhigh`; all edits, staging and commits in this worktree |
| Plan reviewer `/root/plan_review` | GPT-6 Astra / Extra High (`xhigh`) | Session configuration observed: `gpt-6-astra`, `xhigh`; read-only |

The coordinator verified model/effort from each matching session's configuration
metadata. This is an observed client configuration, not deeper provider attestation.
Record the fresh final reviewer separately when assigned.

The writer reserves `scripts/local-migration/packaging-progress.mjs`,
`packaging-smoke.mjs`, `packaging-smoke.test.mjs`, narrowly affected gate-reader
tests, and this record. Gate-runner integrity helpers and their consumers are
shared hotspots: implementation there requires a separately reviewed concrete
checkpoint-2 plan after measurement. No ownership is claimed over pilot or
attribution files, workflows, phase definitions, package manifests or lockfiles.

The pilot owns the main checkout, its installed app and acceptance state.
[Attribution PR #177](https://github.com/loyalagents/context-router/pull/177)
has its own writer and worktree; observed head was
`899eb1b7a4fc49a0bfc03f197669b51a52362ac9` and its local gate was active during
startup. Existing packaging work from #171 and #175 and failure evidence from
#176 are merged in the base. Historical worktrees are not active ownership
claims. Do not modify, reset, clean, or reuse another task's resources.

Integration order: finish bounded investigation here, inspect main and #177
before final qualification, and assess any changed inputs explicitly. Do not
rebase or repeat valid benchmarks solely because main advances. No cross-chat
message is authorized by this record. The coordinator owns resource-window
coordination; heavy execution waits until the pilot/attribution window is clear.

Resources: this worktree's dependency/build outputs and uniquely named private
temporary roots, fixture databases and allocated loopback ports only. The
existing smoke/gate ownership journals and cleanup rules remain authoritative.
No installed-app launch, live model, personal document, client configuration or
asset download is part of this task.

Required startup readings, current application/contract/storage documentation,
contributor, interface-evolution and installed-app runbooks, and active pilot
ownership were inspected. Use the [validation policy](../../../useful/AGENT_WORKFLOW.md#validation-and-context-discipline)
and [contract baseline](../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md).

## Checkpoint 1: Cost And Coverage

The completed combined-main
[gate run](https://github.com/loyalagents/context-router/actions/runs/38352044031)
reported packaging 896.883 s, backend database 311.091 s and web build/browser
247.318 s. These locate investigation priorities; they are not controlled
benchmarks or evidence that a check is redundant. Earlier #175 Mac measurements
are historical and do not establish current or Linux performance.

| Operation / property | Inputs and outputs | Current cost evidence / duplication decision |
| --- | --- | --- |
| Context preparation: private source, dependencies, store and caller integrity | Caller source/dependencies/Corepack/store; owned workspace and hash snapshot | Included in `context-prepared`; separate hashing versus copying cost missing |
| Prisma, backend and web builds: fresh generated and compiled output | Pinned toolchain, source, dependency closure, allocated proxy configuration; generated client/backend/Next output | Combined in `build-complete`; local-database prerequisite deliberately builds without a database URL; equivalence to other builds is not established |
| Post-build source snapshot: source/dependency/Corepack immutability baseline | Fresh build workspace and private cache; integrity snapshot | Also included in `build-complete`; not equivalent to pre-build caller snapshot |
| Deploy, copy and closure inventory: production resolution and no shared writable files | Offline dependency store, compiled output and source; backend, local UI and Next standalone payloads | Combined in `stage-sealed`; closures serve different entrypoints and cannot be merged without proof |
| Seal and initial verification: exact readonly artifact inventory | Payload metadata, bytes and links; manifest and tree digest | Combined in `stage-sealed`; #175 already bounds metadata prefetch while content reading remains serial |
| Hosted and five local-mode runtime checks: behavior in relocated sealed output | Sealed payload, hostile environment, independent synthetic credentials/state; lifecycle and runtime evidence | Existing milestones isolate mode totals; source tests do not replace artifact tests |
| Repeated sealed-stage verification: integrity at each required boundary | Same expected inventory, potentially changed filesystem | Count and cumulative time missing; repeated scans are not equivalent across intervening runtime work |
| Source and caller re-verification: integrity before and after cleanup | Prior snapshots, current source/cache/store/caller trees | Different placements cover different mutation windows; no omission or relocation is proposed |
| Cancellation, cleanup and finalization: settlement and owned-resource removal | Exact journals, identities, descendants and bounded signals; terminal evidence | Existing cleanup/finalization milestones; diagnostic failure must not alter this proof |

### Bounded Instrumentation Plan

Preserve schema-1 milestone labels, order, values, availability semantics and the
existing safe reader. Old logs must produce the same projection. New fixed
operation records add an optional, independently validated `operationTimings`
projection; its completeness describes collection only, never smoke success.
Malformed operation records affect only that projection, not valid legacy
milestone completeness. Operation durations are nested in milestone intervals;
they must not be blindly added to milestone durations or each other. Document
any nested operation scopes explicitly.
The existing 16,384-byte read cap remains unchanged.

Use a constant allowlist of at most twenty operation names: caller snapshot,
source copy, dependency clone, Corepack clone, Prisma generation, backend build,
web build, source snapshot, backend deploy, local-UI deploy, payload copy,
shared-file exclusion, native inventory, seal, stage verification, source
verification and caller verification. Timers accumulate only a settled-call
count (including failed/cancelled settled attempts, not a success count) and safe
nonnegative integer elapsed milliseconds per name. Emit exactly one row per
fixed name in allowlist order, using zero only for genuinely unexecuted work,
plus a fixed collection-complete or collection-partial marker after finalization.
A missing row never means zero. No path, identifier, environment value, command
output or error text enters these records. Optional operations need not occur
in every execution mode.

Instrumentation surrounds the existing operations at their current boundaries.
Every stage callback and each source/caller integrity assertion stays in place.
An async timing wrapper invokes and awaits its operation once, including
synchronous throws and non-Error rejections; it does not introduce a race,
timer, cancellation listener, child process, scan or second read. Guard initial
and subsequent clock reads, accumulation, and writes. Missing/failed collection
must preserve the operation's exact return value or thrown object, original
verdict, cancellation behavior, original signals/callsite placement, and settlement
before cleanup. Latch any clock,
counter or writer failure for the rest of the collection; invalid/overflowed
measurements cannot be repaired into complete evidence. Final rows follow all
measured work, including post-cleanup integrity checks, and precede the settled
command log consumer.

Tests precede implementation: old-log compatibility; finite labels and values;
duplicate, out-of-order, unknown, negative, fractional, nonfinite and overflowing
records; missing marker, interrupted and truncated logs; chunk tags; private
canary exclusion; throwing initial/subsequent clock or writer with no recovery
to complete; zero rows versus missing rows; malformed detail leaving valid
milestones unchanged; exact operation result/synchronous throw/non-Error
rejection preservation; aborted operation settlement and cleanup. Extend an
existing owned-log reader test for valid and malformed optional detail. Run the
affected packaging and gate tests, documentation consumers/link checks and
whitespace checks. Do not change phase commands, timeouts, workflow triggers,
supported modes, required assertions or #176 reporting behavior.

Independent plan review and disposition are required before instrumentation
implementation. Checkpoint 2 needs a new concrete optimization plan and its
independent review; this plan authorizes no caching, scan omission or reuse.

### Review And Targeted Evidence

The independent reviewer approved checkpoint 1 at plan SHA-256
`adda380c6a855d155a524c2fbf8648f09a5cab61f6ae3dca1d8a53e41c335f9b`.
The required correction was a complete fixed-row census: omitted rows cannot
mean zero, and zero count with positive duration is invalid. That correction,
synchronous/non-Error failure identity and independent malformed-detail handling
were accepted before implementation. No optimization or final-diff approval is
implied. The coordinator's additional `operation=milestone` parser collision was
fixed with complete and unfinished malformed-record regression cases.

Five new operation-timing tests failed against the absent baseline API before
implementation. The focused legacy/operation/materializer-policy checks then
passed 11/11 on Node 24.21.0. The complete affected packaging-smoke, gate-phases
and gate-runner suites passed 208/208 serial tests in 14.3 s. Markdown checker
tests passed 20/20 and the link checker passed 146 files. The current-tree
contract checker passed (41 capabilities, 58 consumers; merge-base comparison
was intentionally skipped by this standalone invocation). Integration measurement
and final qualification remain pending; these are targeted results.

Instrumentation currently uses seventeen fixed labels. `native-inventory`
combines sequential package-manifest discovery and native-resolution evidence;
`payload-copy` combines each existing copy call. Repeated verification counters
include every existing callback/assertion without moving it. These operation
scopes do not nest each other; all sit within the existing milestone intervals.
Milestone durations include other work and must not be summed with their detail.

The isolated frozen install used the task-owned pnpm store/Corepack/cache under
`/private/tmp/context-router-packaging-efficiency-YO3Gap`; no shared cache was
written. Before browser preparation, observed allocation was 1,047,664 KiB for
worktree dependencies and 1,018,968 KiB for that resource root. The install's
default blocked dependency scripts were preserved. The existing validated Prisma
prerequisite was copied read-only from another isolated worktree into this
worktree's ignored dependency output: package 7.4.2, exact schema-engine SHA-256
`76747c2e94dca0f0f2717dd2718951d7e7ca438b00896fab2fac42bd71243f77`,
24,151,904 bytes, engine revision `94a226be1cf2967af2541cca5529f0f7ba866919`,
separate inode and executable mode. Its source was not modified. The private
`prerequisite-provenance.json` records package/binary digest checks.

## Measurement Budget And Checkpoint 2

After prerequisite and resource-window checks, allow one instrumented packaging
attribution run to identify the largest eligible cost. Do not run the full gate
to gather samples. For the selected operation, allow one warmup and three
baseline plus three candidate targeted samples, sequentially, against identical
payload/input identities. Maximum experimental wall time is 90 minutes and
experimental temporary data is 15 GiB, including dependencies, workspace clones,
package fixtures and retained outputs. Sample active disk use to bound observed
peak, while preserving journal-driven cancellation/cleanup. Before each expensive run,
require at least 30 GiB free disk; stop starting experiments if the budget or
resource window no longer holds. These are ceilings, not targets. Any extension
requires an explicit recorded coordinator decision within user scope.

Record exact source revisions, payload hashes, OS/architecture/hardware, exact
Node 24.21.0 and pnpm 10.25.0, cache/warmup conditions, competing load, individual
times, sample count, median/range, process peak memory and sampled temporary
disk usage (identify sampled versus exact peaks). Keep baseline and candidate
on the same machine and workload. Include timing overhead where material.
Do not infer end-to-end speedup from isolated-operation measurements or compare
uncontrolled GitHub runners as matched samples.

The concrete optimization plan must preserve deterministic primary errors,
bounded work/memory, all verification placements and settlement before cleanup.
No required check reuse or omission, parallel lifecycle execution, cross-run
cache, web-build reuse, shared database fixture, coverage retirement, CI routing
or nightly relocation is in scope. If no useful safe change is supported,
report that result and propose an honest measurement-only outcome.

### Attribution Result And Selected Candidate

The single direct packaging attribution run passed on clean instrumentation
head `85f4a1375268497ed775a55545edcc23157e74ef`. Its finalization milestone was
676.515 s; the outer supervisor, including its final resource sample, took
677.392 s. Both legacy milestones and optional operation collection were complete.
All six runtime modes passed, all journal resources reached terminal cleanup,
the private packaging root was absent, both exact owned container IDs were
independently absent, and the final observed process tree was empty. Synthetic
diagnostics and task-owned prerequisites remain; only compiler caches remain
under the separately owned short temporary root.

| Measured operation family | Settled calls | Total seconds |
| --- | ---: | ---: |
| Sealed-stage verification | 38 | 396.793 |
| Caller/source snapshots and re-verification | 5 | 88.423 |
| Stage sealing | 1 | 35.294 |
| Prisma/backend/web builds | 3 | 35.268 |
| Dependency cloning | 1 | 24.231 |
| Payload copying | 4 | 14.879 |
| Backend/local-UI deployment | 2 | 11.845 |

This was macOS 15.1.1, arm64, MacBookPro18,2/M1 Max/64 GiB, Node 24.21.0 and
pnpm 10.25.0, with a fresh private dependency install, copied pinned browser/
Corepack prerequisites and ordinary background activity. Prior load was
8.39/8.69/8.51; it was not a quiet-machine benchmark. Process-tree RSS was
sampled every five seconds and recursive allocated disk every thirty seconds:
observed peaks were 1,938,192 KiB RSS and 6,401,200 KiB disk. These are sampled
maxima, not exact peaks or exclusive APFS allocation. One cleanup-time sample
failed collection; that resource observation is incomplete independently of
complete operation timing and successful cleanup. Disk sampling itself can add
I/O overhead. The raw bounded receipts live under the task-owned resource root;
`attribution-timings.json`, `attribution-result.json` and the cleanup receipts
retain the individual data and limitations. The manifest was
`30983b68dcaefad4a2707eb2ef64dd4f2a562647648ec1de57b36147708a66be`
and staged-tree digest
`c5d7db05bc46f0dd8f314177a9bbd7d93ffb4fa305543d92313f361452bf43db`;
the stage was removed normally.

Stage verification is the largest measured family (58.7%). Its walker already
uses #175's single metadata prefetch. Skipping checks or reusing a prior result
would violate this scope; additional file-content concurrency would change its
reviewed memory/work bounds. No further small, justified stage optimization is
established here. Select the largest remaining measured serial integrity family
with an analogous bounded opportunity: caller/source hashing, 88.423 s (13.1%).
This selection is a testable hypothesis, not a promised speedup.

After that run and verified cleanup, merged attribution PR #177 advanced main
to `93d4ad7a227675b963a0c336306a32b7fe9d9ad0`. It was integrated into this branch
without conflicts. Its backend extraction/tests and stabilization docs do not
change packaging, gate-runner or dependency inputs. The attribution observation
remains bound to its original head; it does not qualify the new backend bytes.
Unchanged helper/dependency inputs may support the operation comparison below.
Final full-gate and exact-head CI evidence must qualify the combined source.

### Concrete Checkpoint-2 Plan: One Metadata Prefetch For Caller Hashing

Independent review is required before implementing this plan. Expand writer
ownership only to `scripts/local-migration/gate-runner.mjs` and its existing
test file, plus this record. Keep all public capture/assert APIs and every caller
placement unchanged.

The independent plan reviewer approved these concrete bounds at plan SHA-256
`abdb993fa7ff86193f56aab5a67b618a13b215a0cee37a15f97bf4f22c718fcc`.
This is approval to implement and measure, not performance acceptance or final
correctness review.

Change only directory traversal inside `hashPath`: an async iterator supplies
entries in the exact existing sorted depth-first order. The consumer may request
one next entry's metadata while it reads/hashes the current regular file.
Append both file and symlink digest rows in the consumer's original order;
the producer must not append a later symlink ahead of the current file. Preserve
root missing/file/symlink/special results, child special-file behavior, literal
symlink targets, path separators, ignored empty directories and exact JSON/digest
format. No cached metadata, digest, open handle or previous verification is reused
across calls. Mutable paths remain subject to the existing non-atomic snapshot
limitation; no stronger atomicity claim is introduced.

There is at most one pending iterator advance and one regular-file content read.
Keep whole-file reads/hashes serial and the existing row storage; do not add a
pool or materialize file contents ahead. Capture a future metadata rejection
without letting it overtake an earlier current-file error. Preserve the original
thrown object, including non-Error values. On error or cancellation, stop further
traversal and await the pending advance plus iterator settlement before returning
or throwing, so cleanup cannot race outstanding filesystem work. Retain original
abort checks/signals and add checks around new prefetch boundaries as needed.

Tests first: exact digest equivalence on mixed nested file/link/empty-directory
trees, including a symlink ordered after a file; root absent/file/link/special
semantics; same-size content mutation detection; at most one content read and
one metadata advance in flight; current-file error versus later metadata error
precedence; synchronous/non-Error failure identity; cancellation during pending
metadata/content work; no further traversal after failure and full settlement
before caller cleanup. Explicitly test abort when a later metadata result/error
is already buffered, preserving the original loop/hash-file cancellation
precedence; iterator-return failure with and without a primary error; falsy
thrown/rejected values; and absence of unhandled rejections. Use bounded synthetic
fixtures and restore any filesystem
test hooks in `finally`. Do not weaken existing integrity assertions.

Affected consumers are aggregate gate preparation/final integrity, generated
output checks, packaging smoke, desktop package caller hygiene, installation
bundle feasibility, and runtime-resource fixtures. Run gate-runner, gate-phases,
packaging-smoke and runtime-resources suites. Explicit shared-helper tests cover
both APIs, multiple consumer-shaped roots and success/failure paths; the final
real aggregate gate exercises generated-output integrity around regeneration.
Desktop package manifest/native and installation feasibility tests exercise
separate verifier/lifecycle behavior and are indirect compatibility evidence
only: a pass cannot claim direct desktop-packager integration of this helper.
This helper runs in build/test tooling, is not bundled in the installed runtime,
and leaves its verifier unchanged; independent review agrees a fresh installed
runtime qualification is unnecessary for this change. The full final local gate
remains required.

### Matched Operation Experiment And Acceptance Criterion

Keep the existing experiment budget. Use the identical task-owned root dependency
tree and private pnpm store as a fixed representative corpus; neither is changed
during the comparison. These are real pinned packaging prerequisites and cover
the dependency/store scans implicated by the attribution. Hash input identities
through each returned snapshot and require identical complete results for every
sample. Bind baseline module bytes to instrumentation head `85f4a137` and candidate
module bytes to their recorded SHA-256/revision. Do not retain or recreate the
completed stage, and do not run another full packaging smoke for sampling.

Run one baseline warmup followed by three sequential pairs in fixed order
AB, BA, AB, where A is baseline and B candidate. Each sample uses a fresh Node
process with the same exact toolchain, corpus and timing wrapper. Record operation
wall time, process maximum RSS, individual output digests, OS/cache conditions and
background load. Sample allocated disk before/after the series; only tiny result
files are written during it. Avoid recursive disk sampling during timed scans.
No concurrent experiment or build uses these inputs.

Before seeing results, accept only if all three paired candidate times improve,
candidate median is at least 10% below baseline median, results/digests and all
negative tests agree, and candidate maximum RSS is no more than 64 MiB above
baseline maximum RSS. Report all individual timings, medians and ranges; material
background-load changes or unexplained variability invalidate the comparison.
Do not expand the sample count after seeing an unfavorable result. If the
criterion fails, revert the optimization and report the measurement-only result.
Any savings projected onto the 88.423 s observed family are estimates, not a
demonstrated end-to-end improvement. The final gate is qualification, not a
matched baseline/candidate measurement.

### Checkpoint-2 Targeted Validation

The tests-first baseline run had one passing digest/consumer-semantics fixture
and 15 expected failures: serial traversal cannot advance metadata while the
current content read waits, and has no iterator-close behavior. After the bounded
directory change, the focused caller-integrity cases passed; an additional
nested-prefetch/read-rejection-versus-abort case also passed in the affected
suite run. `node --test --test-concurrency=1` for `gate-runner.test.mjs`,
`gate-phases.test.mjs`, `packaging-smoke.test.mjs` and `runtime-resources.test.mjs`
passed 226/226 on Node 24.21.0 (40.853 s). The tests exercise the public capture and
assert APIs and restore process-local filesystem hooks before removing fixtures.
Extending the nested-prefetch case to also reject later metadata while aborting
kept the original falsy read rejection; the final focused integrity run passed
19/19 (130.569 ms). This added case does not change implementation inputs.
Targeted checks passed; final validation pending.

The comparison harness is prepared in the task-owned root; no timed sample has
started. Baseline module SHA-256 is
`f24b6ac467db9d3041eae0995a7c4f7bd2f3edff661daada05e3bbe4ea345b90`;
candidate module SHA-256 is
`9afdb548cafc5d134979d747663055c3ed07b345558bb9fa528cba0f960dd3fa`.
Each fresh process records a complete snapshot, operation duration, maximum RSS
and load before/after. The supervisor persists every individual result and
stops on digest mismatch, timeout or the original experiment deadline. No
sampling expansion is permitted. The pilot's imminent package build takes
priority; the coordinator must release the comparison window first.

## Checkpoint 3: Final Qualification

The user-defined finalization milestone is after useful measured optimization,
focused/negative tests, and resolved plan reviews. Freeze the candidate once
that point is reached. Complete affected packaging/gate/reporting/docs consumers,
applicable integration/negative checks, a fresh independent complete-diff review,
the required full local migration gate, and exact-head CI. The final local gate
is qualification, not a benchmark sample. Installed-artifact qualification is
required only if changed behavior affects it, respecting pilot ownership.

For each expensive run, state purpose, changed inputs and why it is needed then;
preflight toolchain/resources. Corrections renew affected tests/reviews and
required final qualification; carry forward only explicitly unaffected evidence.
Checkpoint reports include targeted results and pending final validation.
Handoff records exact base/head/worktree, changes and preserved properties,
review dispositions, comparable evidence and limits, commands/results, retained
resources/cleanup, integration instructions, pilot impact and rollback.
