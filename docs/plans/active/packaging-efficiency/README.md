# CI Qualification Turnaround

- Status: authorized PR #179 review corrections in targeted validation,
  2026-10-14; a new frozen candidate requires final qualification. The prior
  `5f686411` candidate passed remote CI, the complete full local gate and
  independent review; those results remain historical for changed inputs.
- Outcome: run complete source and packaging qualification concurrently in
  separate CI workspaces, with one stable final check. Preserve all coverage,
  triggers, safety contracts and the default full local gate.
- Priority: subordinate to the pilot's live acceptance and local resource needs.
  One cohesive draft PR; no automatic merge or installed-app acceptance claim.

## Current Ownership And Scope

Verified starting base is `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c`,
freshly fetched by the coordinator. The clean managed task worktree is
`<ci-qualification-lanes worktree>`, branch `codex/ci-qualification-lanes`.
The sole writer is `/root/writer`, including this plan, all implementation/tests,
dependency preparation, staging and commits. Coordinator `/root`, factual
inventory and independent reviewers are repository-read-only. Requested settings
are GPT-6 Astra / Extra High (`xhigh`) for coordinator, critical writer and
reviewers, Astra / High for inventory. Explicit writer spawn settings were
accepted; this writer has no independent runtime attestation. The historical
configuration observations below apply only to the completed #178 task.

Writer paths: `.github/workflows/local-migration-baseline.yml`;
`scripts/local-migration/migration-gate.mjs`; a small
`scripts/local-migration/ci-qualification.mjs` profile/receipt validator and
`scripts/local-migration/combine-ci-qualification.mjs` entrypoint;
affected existing `gate-phases`, `gate-runner`, `ci-path-filters` and
`toolchain-contract` tests; this brief; the gate section of
`docs/current/LOCAL_MIGRATION_CONTRACT_BASELINE.md`; and a concise finalization
addition to `docs/useful/AGENT_WORKFLOW.md`. Only add another existing reader
path when a concrete affected contract requires it and record that delta.
Shared hotspots are gate scheduling, provenance/finalization and workflow shape;
serialize all writes. Keep phase manifest/schema, approved commands, lockfiles,
standard CI and product source unchanged unless review identifies an essential
narrow scheduling-contract update. No caller-hashing optimization is revived.

The main checkout belongs to the pilot (`codex/pilot-downloaded-acceptance`,
observed `ecb99aea`); preserve its files, demo data, app, model and personal
state. The coordinator observed a resident pilot guardian/model and an unrelated
orphan test Node process; neither is owned here. Startup chat inspection found
pilot retry documentation complete without a live run and consolidation waiting
for its separate model approval/resource window. Recheck ownership before local
heavy work; never cancel/adopt another task's run. No cross-chat message, model
run, asset download, client change or personal-state action is authorized here.

Integration order: independently approve this concrete plan, write failing tests,
implement the bounded profiles/receipts/workflow, resolve affected review and
focused checks, then freeze and push one candidate. Reinspect main before freeze;
evaluate changed inputs rather than silently rebasing or using another task's
outputs. Preserve the default `pnpm migration:gate` and `--smoke-only` behavior.

## Authorized Review Correction Round

The user authorized helpful findings from the external Claude review in the same
[draft PR #179](https://github.com/loyalagents/context-router/pull/179).
Independent plan approval binds SHA-256
`a8b360f7026b07349971d4d0b4fdb5ad01b865042267ac6339691d6c61262efa`
at `5f686411cbc97b928af764532f344b5403465c06` and the unchanged starting base
above. Sole-writer/model-role ownership persists; accepted settings remain distinct
from independently unverified runtime attestation. No browser flag or native
shutdown repair is included in this round.

The approved policy delta permits differing Ubuntu image build releases, Python
3.12 patches and PostgreSQL 15 patches/distributions, while independently validating
each lane's Linux/X64 and Ubuntu identity. Image family and exact pinned Node/pnpm/
Playwright plus Chromium identity still match. Actual observed versions remain in
receipts; the gate still verifies Chromium against locked Playwright metadata.
The combined job independently verifies actual PR checkout HEAD, exactly two merge
parents and second-parent equality with the event PR head. The existing base-as-
ancestor policy remains; an event base need not equal a regenerated merge's first
parent. Ordinary push checkouts have no required merge shape.

CI external summaries stay nonterminal through finalizer return, bounded-stage
postchecks and required receipt publication. A privately staged passed summary
finishes every awaited write/sync/close and ownership check before final guards and
one synchronous atomic rename commit. Signal-handler disposal and return follow
without further verdict work. Failure before that commit cannot leave a durable
passed summary, even if failed-summary persistence also fails. Required receipt
publication remains after both finalizer and bounded-stage success. Default full
and smoke paths retain their behavior and deadlines.

Known combiner failures use a typed finite public category allowlist; unknown,
parse and filesystem errors remain generic without private values. Required
artifact download actions are pinned to official v4.3.0 commit
`d3f86a106a0bac45b974a628896c90dbdf5c8093`. Packaging's summary names its own optional
database diagnostic artifact. Its accurate command-not-run diagnostic is retained;
removing it would add scope. The mock dispatch test is renamed to describe dispatch
and outer verification, with real cold-start independence evidenced separately by CI.

Tests-first red evidence reproduced acceptance of a root/one-parent PR checkout,
rejection of compatible image-release drift, and durable CI passed status before
required publication. New category/download assertions failed, and new orchestration
seams initially failed as absent APIs; those are distinguished from behavioral
reproductions. Focused identity/workflow/category tests then passed 4/4; initial
finalizer/staging tests passed 18/18, followed by expanded tests for both CI profiles,
pre-receipt bounded failures, parent/target/stage replacement and safe CLI output.
Independent complete-diff review of the first correction candidate `ee11ea5`
found a failure-catch ownership gap: an ordinary downgrade could overwrite the
replacement rejected by terminal publication. New production-seam tests reproduced
both parent and target overwrite. Success and failure publication now share the
captured ownership and guarded atomic path; lost ownership/deadline skips the
write. Staging fault tests use real rename except the dedicated rename-failure case
and assert the intended rejection, so one injected failure cannot mask another.
A real existing nonancestor Git base is also rejected. The already-started `ee11ea5`
CI attempt is retained; no local full gate ran on that superseded candidate.

The next candidate `9c2b2ed` exposed a real Linux inode-lifetime gap in those retained
unlink/recreate tests: source CI failed four assertions while packaging and standard
CI passed. Device/inode numbers alone could identify a replacement after the original
inode was freed. A fixed cached Ubuntu24 probe reproduced reuse in 128/128 unpinned
cases and 0/128 with a read-only descriptor held open; no network/install was needed,
and its disposable container was removed. No local full gate launched on `9c2b2ed`.
Independent approval of the lifetime amendment binds SHA-256
`0069e966bb2be9fc0a8905c538571f19b8c366380f9e26408ea59a578779aefd`.

Read-only no-follow/nonblocking parent, target and stage descriptors now remain live
across all awaited publication work. The stage pin is verified while its writer is
open. One synchronous suffix verifies descriptor/path identities, attempts every
checked close once, checks final cancellation/deadline and renames. No descriptor
close is deferred past a successful commit. After original ownership release, failed
close/guard/rename paths leave nonterminal evidence and may retain a private stage;
they cannot asynchronously downgrade or unlink using stale identities. Before that
release, stage cleanup and failure publication require their still-live original
pins. Primary errors survive cleanup failures. The existing external-process
path-check/rename race remains; hostile-process atomicity is not claimed.

The new tests first failed because no descriptors remained live through publication.
The original unlink/recreate assertions remain unchanged; focused production and
staging coverage then passed 40/40, including all-close/first-error handling,
acquisition and downgrade cleanup, stage replacement after writer close, and late
cancellation/deadline/rename failures with no stale-identity mutation. Both correction
CI attempts are preserved: `ee11ea5` used 3060 runner-seconds and `9c2b2ed` used 2158;
six candidate attempts cumulatively used 16457 seconds (274m17s). These are correction
costs, not performance samples. The renewed gate/runner/workflow/Markdown consumer
batch passed 230/230; Markdown links passed across 147 files and the base-bound
contract check passed (41 capabilities, 58 GraphQL types, 58 consumers, 19 catalog
entries). Final source-bound qualification remains pending.

Final focused counts and source-bound results belong in the PR evidence record.

After the related corrections and documentation are ready, coordinate a clean
freeze with the coordinator, then push the same branch promptly. Require new
exact-head CI, one fresh default full local gate and independent complete base-to-
head review concurrently. Reuse the reviewed immutable launcher design with fresh
once marker, short private temp root, exact new head and actual same-environment
nonqualification export write/read/identity-check/removal before heavy work. Keep
absolute canonical RUNNER_TEMP, exact summary basename, existing report setting,
pinned prerequisites, umask022, 30 GiB minimum free and 15 GiB task budget. Refresh
ownership/resources immediately before launch; preserve all other tasks and live apps.
No broad run occurs per small correction and no additional performance sample is
being requested. A correction failure requires diagnosis and affected review.

Preserve prior evidence in the PR record: invalid first workflow; cold Prisma
engine and relocated-config cache CI failures; initial local umask failure; the
historical native browser shutdown failure and bounded diagnostics with unknown
cause; the all-twelve-phases-pass attempt that failed final export because its
launcher omitted RUNNER_TEMP; and the corrected launcher's true finalized full pass.
No failed attempt is relabelled or erased. Prior cumulative hosted usage was
187m19s across four candidate attempts; new qualification adds correctness-renewal
cost, not performance sampling. Formal performance acceptance remains unproven.
No merge or pass-announcement source commit is authorized; publish exact final
bindings, all checks, cleanup and integration guidance in the existing draft PR.

## Checkpoint 1: Command, Coverage And Dependency Map

The canonical manifest still defines twelve sequential phases for the full
local gate. Validate its complete schema, mode/retirement/predecessor rules and
exact approved command matrix before selecting either CI profile. A separate
fixed allowlist defines only `ci-source` and `ci-packaging`; there is no arbitrary
phase list, skip flag, scheduler, build reuse or changed retirement policy.
Manifest predecessor assertions continue to protect full-gate order. Profile
assertions separately prove exact membership/order and a complete union, with
repository-integrity required in both workspaces.

| Existing phase / commands | CI owner and dependencies |
| --- | --- |
| 1 contract-baseline: existing gate/smoke/contract Node tests, then base-bound contract checker | Source; full manifest/command validation and exported verified base precede it |
| 2 documentation: Markdown checker tests and link scan | Source after 1 |
| 3 backend-unit-build: Prisma generation, seed typecheck, backend build, unit/local-model/local-MCP/local-UI tests, desktop tests | Source after 2; fresh generated/build output |
| 4 backend-database: migrations, integration, e2e, local-database tests | Source after 3; owned PostgreSQL database and SQLite fixtures |
| 5 local-orchestrator: tests, lint, build | Source after 4 |
| 6 eval-fixtures: deterministic verify | Source after 5 |
| 7 eval-deterministic-scenarios: both existing template smoke scenarios | Source after 6; source builds and owned database |
| 8 web-production-build: web build and authenticated browser suite | Source after 7; owned Chromium/profiles and loopback ports |
| 9 harbor-static: existing static script | Source after 8; Python 3.12 |
| 10 restart-smoke: existing outer-verified runtime smoke | Source after 9; retain every supported-mode/lifecycle proof |
| 11 packaged-composition-smoke: existing packaging command plus independent outer lifecycle validation | Packaging; no source-lane result dependency; independently generates Prisma and builds backend/web |
| 12 repository-integrity: generated-client repeat generation, SDL and Git whitespace checks | Both lanes, last after their own mutations; caller integrity and outer finalization additionally remain mandatory |

Packaging retains all six modes: hosted-baseline, local-identity-preview,
local-database-preview, local-model-preview, local-mcp and local-ui. Preserve
every sealing, source/caller check, runtime probe, owned-resource assertion and
outer `executeGatePhaseCommand` lifecycle verifier. A raw command exit code or
timing milestone never qualifies packaging. Source's base comparison must report
`performed`; packaging independently validates the same selected ancestor and
exports/hashes its base bundle, while accurately recording that the contract
checker itself belongs to source.

Both CI jobs start independently without `needs` between them on separate
`ubuntu-latest` runners. Each keeps full-history checkout, exact Node 24.21.0 /
pnpm 10.25.0, Python 3.12, frozen install, pinned Chromium, its PostgreSQL 15
service, a private pnpm store/Corepack/cache, and its own outer gate disposable
workspace, synthetic state, allocated ports, diagnostics and journals. No shared
generated output or writable resources; downloaded cache archives may be inputs
but are restored into job-owned directories. The first version keeps ordinary
preflight/database preparation in both lanes rather than introducing a second
resource lifecycle. Retain existing per-phase timeouts and gate T+3/107/110/113
deadlines plus the 118-minute process fail-safe. Budget each lane's workflow
steps explicitly with cleanup/evidence-upload headroom; the aggregator is bounded
and has no database/browser/build prerequisite. No sibling fail-fast or automatic
workflow cancellation is added.

## Checkpoint 2: Tests First And Required Receipts

Add failing tests in the existing phase/workflow suites before implementation,
then use focused suites per correction batch. The new helper has two small
responsibilities: select an exhaustive approved CI profile from an already
validated full manifest, and construct/validate strict versioned receipts.
The stable job/check remains `local-migration-baseline`. It uses
`needs: [source-qualification, packaging-qualification]` and `if: always()`,
checks each dependency result explicitly for `success`, then downloads exactly
the two required attempt-specific receipts. Missing, failed, cancelled, skipped
or unknown dependency results fail even if a downstream job would otherwise skip.
Required uploads have `if-no-files-found: error` and no `continue-on-error`.
Optional timing/database diagnostic export remains separate and optional.

Bind receipts to the workflow repository, event, workflow path/ref, run ID and
attempt, expected checkout SHA (`github.sha`, including PR test-merge SHA),
PR head separately when applicable, actual clean caller HEAD and copied-input
digest, validated base SHA and base-bundle digest, exact phase-manifest bytes
and fixed partition version/digest, lane identity, full expected ordered
phase/command/mode/evidence census, actual phase outcomes and observed toolchain
versions. Both receipts must match each other and independently supplied current
workflow expectations, not merely agree with one another. The aggregator checks
its clean checkout and expected manifest/partition, exact union coverage and the
two separate integrity outcomes. Exact Node/pnpm and supported Python/PostgreSQL/
browser prerequisites are required; record runner OS/architecture/image for
comparison. Never equate a local HEAD with a PR test-merge SHA.

A receipt is created only after `runBoundedGateStages` and
`finalizeGateAttemptEvidence` fully return successfully, including their final
signal/deadline checks, verified caller integrity, terminal outer and smoke
lifecycle checks, exact workspace/database/container removal and diagnostics
finalization. Capture only fixed sanitized verification outcomes and required
identities; no credentials, raw journal paths, test payloads or private log tails.
Receipt publication itself is bounded and fails the lane if unsuccessful.
An internal finalized `summary.status=passed` cannot be promoted into a receipt
before bounded-stage postchecks. Durable CI summaries remain pending through
receipt publication and use the terminal commit described above. Maintain signal
handlers through that commit and reject earlier cancellation; the workflow
dependency result remains independently required after command settlement.

Read downloaded receipts as bounded regular non-symlink JSON with strict fields
and exact filenames; reject extra/missing files, duplicate lanes/coverage,
malformed hashes/versions, unexpected commands or phases, stale/mismatched source,
base, manifest, toolchain or provenance, partial outcomes, integrity drift,
nonterminal lifecycle/finalization and cleanup errors. Receipts from both lanes
must belong to the same workflow attempt. A partial failed-job rerun may need
“Re-run all jobs”; it must never silently reuse a prior attempt's sibling receipt.

Required tests cover exact census and full-mode invariance; clean-start packaging
with no source outputs; lane resource separation; unchanged six-mode smoke and
outer-verifier dispatch; command failure/settlement; failed/skipped/cancelled
dependency results; absent/duplicate/stale/malformed/tampered receipts and
cross-attempt reruns; checkout/head/base/toolchain/manifest mismatch; generated
drift; missing lifecycle records; cleanup failure; cancellation and deadline
expiry during finalization, summary publication and required receipt publication;
and optional diagnostic failure remaining separate from required verdicts.
Exercise actual helper/entrypoint seams with bounded fixtures, not only source
text assertions. Preserve existing gate-runner, packaging, restart,
database-evidence, toolchain and workflow-contract tests.

Focused validation uses the exact pinned runtime and existing Node test files:
gate-phases, gate-runner, packaging-smoke, restart-smoke, local-database-evidence,
ci-path-filters and toolchain-contract, plus affected runtime-resource tests.
Run Markdown tests/links, base-bound contract validation and whitespace checks
for the edited docs; discover readers by paths, basenames and asserted content.
Record targeted results and pending final validation at each checkpoint.

## Checkpoint 3: Fixed Measurement Budget

Use the naturally occurring main baseline run
[38467923278](https://github.com/loyalagents/context-router/actions/runs/38467923278)
at `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c` and its standard CI
[38467923426](https://github.com/loyalagents/context-router/actions/runs/38467923426).
It was already running at task startup: do not launch a duplicate or cancel it.
The earlier [38462982373](https://github.com/loyalagents/context-router/actions/runs/38462982373)
is historical opportunity evidence (about 32m48s aggregate, 15m38s packaging),
not a matched performance promise. The coordinator verified its source tree
equals the current main tree; commits and triggering events differ.

Budget one baseline observation and the first stable candidate's actual two-lane
workflow observation, with no repeated broad run solely for sampling. Necessary
failure corrections renew qualification, retain every attempt, and are reported
separately; they do not expand the performance sample until favorable. Allow
one required full local gate per frozen implementation candidate, not as a timing
sample. At most the two CI execution lanes plus small aggregation, and one local
heavy qualification, are task-owned concurrently; standard CI remains unchanged.
Local prerequisites/temporary outputs have a 15 GiB task budget and require
30 GiB free before a heavy run. Retain journal-driven cleanup and original
deadlines; resource pressure prevents starting another run, not unsafe termination.

Before samples are assessed, the meaningful-benefit criterion is at least 20%
less elapsed candidate push-to-all-required-checks-ready time than the comparable
baseline event-to-all-required-checks-ready interval, with total dedicated-workflow
runner minutes no more than 35% above baseline and all correctness gates passing.
Report every lane's queue/setup/execution/upload/finalization, aggregation,
standard/native check completion, total runner minutes and runner-class billing
limitations. Use bounded push-time observation if exact server push time is
unavailable. Compare unchanged product/dependency inputs, runner class, versions,
image and cache conditions; list harness/doc changes and differing conditions.
One hosted-runner pair cannot establish variance or a controlled causal speedup.
If event timestamps/cache/runner conditions cannot support the comparison,
report the criterion unproven. Do not promise a 17-minute result, enlarge samples,
or claim complexity is worthwhile after a miss without a new reviewed decision.

## Checkpoint 4: Concurrent Frozen-Candidate Finalization

The agreed milestone is the reviewed design implemented, focused checks green,
known corrections resolved, docs prepared and a clean committed candidate frozen.
Push/open the single draft PR promptly at that milestone. Start exact-candidate
remote CI, the required unchanged full local `pnpm migration:gate`, and fresh
independent complete-diff review concurrently against stable inputs and isolated
resources. The coordinator releases the local heavy window after fresh
toolchain/process/chat/disk checks. Do not wait for local qualification and review
before starting CI. Add this concise protocol to the canonical agent workflow.

Final evidence requires the full local gate with actual local source/clean-state/
copied-input binding, the real two-lane GitHub workflow on the PR test-merge
checkout, unchanged standard/native CI, affected negative tests, and complete
base-to-candidate independent review of coverage, concurrency, failure visibility,
provenance, cleanup and scope. Preserve source/merge/head distinctions.
Post-freeze results/run links belong in the PR body or external receipts, avoiding
commits solely to announce passes. Corrections unfreeze, receive affected tests/
review, then renew affected exact-candidate CI and required local qualification;
carry forward only explicitly unaffected evidence.

Handoff records exact base/head, integration instructions, before/after coverage,
review dispositions, all attempts/timings and limitations, runner-cost tradeoff,
passed/failed/pending evidence, partial-rerun behavior and task-owned cleanup.
Rollback is a reviewed revert of this scheduling/receipt change, restoring the
single sequential dedicated job; the full local gate never changes. Pilot
resources and all other worktrees stay untouched. No coverage/trigger exemptions,
standard-CI deduplication, build reuse, integrity cache, database parallelism,
model runs, policy relaxation, paid runner change or unrelated cleanup is included.

## Current Review And Targeted Evidence

Independent plan reviewer `/root/plan_review` approved checkpoint 1 at SHA-256
`a83156fc5df360f344f4a5e751c23f0c68ce648012f9757379ca9987a35f5568`, with no
blocking findings, covering coverage equivalence, concurrency, failure
propagation, provenance, cleanup and scope. The coordinator released tests-first
implementation. Approval covers the new task section only, not a renewal of the
historical experiment or an implementation approval. Eight initial receipt/profile
tests failed on the absent planned API; the concrete workflow test separately
failed because the baseline had only the sequential job.

The first phase/workflow batch passed 77/77 tests. A subsequent real combined-job
subprocess regression, with no installed dependencies, exposed an ESM top-level
await cycle (exit 13) that import-only tests could not see. Separating the small
CLI into `combine-ci-qualification.mjs` corrected it; the subprocess now passes
and rejects skipped/cancelled dependencies, changed attempt/head/base and dirty
source. This narrow additional path is the recorded ownership expansion.
Publication tests preserve preexisting/replaced files and symlinks. Packaging
dispatch tests use the real phase-sequence and outer-verifier seams from clean
fixture state, including command/lifecycle failure.

The complete focused gate/packaging/restart/database-evidence/workflow/toolchain
batch passed 307/307 on Node 24.21.0 (33.509 s). The affected runtime-resource
suite passed its real backend build/schema/dependency-closure check (25.514 s).
Markdown and contract-checker tests passed 75/75, all 147 Markdown files passed
the link scan, and the contract checker passed with `baseComparison=performed`
against exported base `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c` (41 capabilities,
58 GraphQL types, 58 consumers, 19 catalog entries). Whitespace checks passed.
A subsequent progress-label change uses selected execution indices without
changing manifest phase orders or log filenames; the affected phase/workflow
tests are renewed before freeze.

Prerequisites use only task-owned dependency/store/Corepack/browser/cache roots.
Both project and projectless offline pnpm probes select 10.25.0. The acquired
Prisma 7.4.2 schema engine matches SHA-256
`76747c2e94dca0f0f2717dd2718951d7e7ca438b00896fab2fac42bd71243f77`;
Chromium 153.0.8010.12 / Playwright 1.63.0 and Python 3.12.8 are verified.
The cached PostgreSQL 15 image is available without pulling. No other task's
writable outputs, app, model or personal state was modified. The full local gate,
actual two-lane CI, complete-diff review and performance result remain pending.

The naturally occurring baseline completed successfully: event-created to all
required checks ready was 33m31s; the dedicated job took 33m28s and its gate
32m23.011s. Standard CI's eight jobs passed. Total actual runner usage was
57m27s (51m26s Ubuntu, 6m01s macOS), including 33m28s for the dedicated workflow.
Observed baseline inputs: main `2497cc2`, validated base `93d4ad7a`, Ubuntu 24
image `20261004.327.1`, Node 24.21.0, pnpm 10.25.0, Python 3.12.15,
PostgreSQL 15.19 and primary pnpm cache hit. The copied-input digest was not
available in downloaded logs; do not invent it. The predeclared candidate limits
are consequently 26m48.8s readiness and 45m10.8s dedicated runner usage. No new
baseline run was launched. Candidate performance and final qualification remain
pending.

The first frozen candidate `2ced5136f775fdf8c9923035a8cfc63bfaf705a3`
was pushed at 2026-10-13 21:53:00.807–21:53:02.591 UTC and opened as
[draft PR #179](https://github.com/loyalagents/context-router/pull/179).
Dedicated workflow attempt `38473872779` failed before scheduling any job:
GitHub does not provide `runner` context in job-level `env`. A new regression
first reproduced that invalid context. Private cache initialization now runs in
a bounded one-minute step before package setup; every existing step budget
remains unchanged, with 178 total step minutes in a 188-minute lane job.
Independent complete-diff review found this single blocker and no additional
coverage, receipt, lifecycle or scope findings; correction review is pending.
The corrected workflow/phase/toolchain/contract/Markdown batch passed 164/164
checks (15.799 s); all 147 Markdown links and whitespace checks passed.

The first full local attempt on that candidate failed phase 1 (393/396 tests)
because the task launcher used umask 077: three existing copied-mode/ownership
tests require ordinary 0644 file creation. Narrow reproduction failed all three
under 077 and passed all three under 022. No test or production behavior changed;
the renewed full gate uses umask 022 inside the existing private task root.
Failed evidence remains retained. Its source digest is
`c04b9e440946d15b0d90278299c5a744b1dad9ca9d0fa928044a313532717015`,
base `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c`, and caller integrity passed.
The owned database/container cleanup completed, the disposable workspace was
removed, and cleanup errors were empty. This is failed evidence, not a pass or
performance sample. Final qualification and corrected workflow measurement are
still pending; these correctness retries count in the task's attempt history.

The second frozen candidate `e2d1ad1319327d5aa54d1dcd17579050f78553a4`
started both lanes in [run 38474603981](https://github.com/loyalagents/context-router/actions/runs/38474603981).
Its packaging job failed final integrity after all runtime modes: a cold frozen
install skips Prisma postinstall, so the first generator invocation hydrated the
native engine after dependency snapshots and created an executable cache file
inside the strict private tool home. The prior sequential source phases had
implicitly prepared that prerequisite. Strict private-tree and caller-integrity
checks correctly rejected the mutation; neither assertion is relaxed.

The bounded repair adds only a two-minute packaging-lane prerequisite,
`pnpm --filter backend exec prisma --version`, after frozen install and before
the gate captures dependencies. The lockfile resolves Prisma 7.4.2. The command
prepares the native engine without generating source or reusing any build;
packaging still executes its original generator, backend/web builds, all six
modes, outer lifecycle verification and final integrity. The source lane's
178/188-minute step/job budget stays unchanged; packaging becomes 180/190.
A new test first failed the missing prerequisite, then checks its ordering,
lock-resolved version, unconditional execution and fail-closed two-minute bound.
Independent review approved this narrow prerequisite repair and selective
coverage renewal. The affected batch passed 165/165 tests (20.157 s), base
comparison was performed successfully, and all 147 Markdown links plus whitespace
checks passed. An isolated native CLI probe started without its engine, reproduced
0711 hydration under umask 077, then verified the approved engine digest and
unchanged dependency trees from a fresh private tool home. That prepared probe
created only empty 0700 cache directories, no executable private cache file.
Actual cold-run CI and final implementation review remain pending.

Only workflow, its direct test consumers and these affected docs change in this
repair. Gate/packaging/runtime code, manifests/schemas, product source and locked
dependencies remain byte-identical to `e2d1ad1`. The ongoing full local gate stays
bound to its actual `e2d1ad1` source and copied-input digest, never to a later
commit. Renew affected phase/workflow/toolchain/contract/docs checks and all real
CI on the next frozen head; carry forward only the explicitly unchanged local
phase/runtime coverage and unaffected independent review. Preserve the failed
remote attempt and its runner cost. No additional performance sample is launched
to improve a measured result; this is a correctness retry.

The third candidate `478adb5264251507783aee9800f5fcd48b0cb96f` corrected the
native-engine prerequisite but [run 38477166948](https://github.com/loyalagents/context-router/actions/runs/38477166948)
still failed packaging's final caller integrity for `apps/backend/node_modules`.
Source passed and the aggregate correctly failed. Engine/private-tree and root
dependency errors were gone; all six runtime modes completed. A controlled
copied-workspace probe isolated the remaining write to one Jiti-generated
`backend-prisma.config.<path-hash>.mjs`: Prisma's configuration cache is keyed by
absolute source path, so warming the checkout does not warm its disposable copy.
Preparing the copied path before capture preserves subsequent generator integrity.

Independent plan amendment review approved one fixed `ci-packaging` preflight
command in the actual owned workspace: `pnpm --filter backend exec prisma
--version`, using its isolated environment, owned diagnostic log, 120-second
subprocess bound and existing shared preflight signal/deadline, after toolchain
preflight and before database acquisition, preflight completion and phase dispatch.
Unknown profiles reject; full/source/smoke-only do not run this extra preparation.
The existing workflow prerequisite stays to acquire the native engine before the
bounded gate. No cache exclusions, permission changes, manifest changes, build
reuse or integrity relaxation are introduced. Tests first reproduced missing
preparation and wiring, plus the real Prisma config-loader cache drift in a small
owned fixture. Failure, cancellation and deadline propagation remain fail-closed.
The affected seven-file batch passed 321/321 checks (18.032 s), with all 147
Markdown links, whitespace and required base comparison passing. A separate
actual-command probe used the real gate preflight helper/environment followed by
the strict packaging tool environment, different private homes and umask 077;
Prisma generation preserved the copied backend dependency tree after preparation.

This repair changes gate code, so the next frozen head requires a renewed full
local gate, actual CI and independent complete-diff review concurrently; prior
local pass `e2d1ad1` remains historical evidence rather than final-head validation.
All failed attempts and their runner costs remain recorded in PR #179. No new
baseline or favorable-result sampling is authorized.

## Completed PR #178: Historical Packaging Measurement

The following record is preserved from the previous task. Its ownership, model
observations, experiments and qualification apply to the named historical
revisions only; they are not evidence for this new CI partition.

### Packaging Critical Path

- Status: measurement-only implementation qualified at
  `ee7ab64766ee66805cd50b07ccfec8f6f9c73004`; the tested optimization missed the
  predeclared benefit criterion and was reverted. Follow-up evidence is bound
  separately in [PR #178](https://github.com/loyalagents/context-router/pull/178).
- Outcome: measure the remaining packaging critical path, then implement one
  justified optimization without changing the properties validation proves.
- Priority: bounded efficiency work, subordinate to the assisted pilot's live
  acceptance and machine-resource needs. One cohesive PR; no automatic merge.

## Ownership And Starting Inputs

The isolated worktree is
`<task worktree>`, branch
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
| Complete-diff reviewer `/root/plan_review` | GPT-6 Astra / Extra High (`xhigh`) | Same verified independent read-only reviewer; separate fresh implementation review after freeze |

The coordinator verified model/effort from each matching session's configuration
metadata. This is an observed client configuration, not deeper provider attestation.
Attempts to allocate a separate final reviewer hit the runtime agent-thread limit.
The plan reviewer confirmed it had not inspected the changed implementation or
tests before assignment of the fresh complete-diff review. That review must cover
all final changes against integrated main; plan approval is not carried forward
as code approval. Do not describe this as a newly spawned reviewer.

The writer reserves `scripts/local-migration/packaging-progress.mjs`,
`packaging-smoke.mjs`, `packaging-smoke.test.mjs`, narrowly affected gate-reader
tests, and this record. Gate-runner integrity helpers and their consumers are
shared hotspots: implementation there requires a separately reviewed concrete
checkpoint-2 plan after measurement. No ownership is claimed over pilot or
attribution files, workflows, phase definitions, package manifests or lockfiles.
Checkpoint 2 temporarily owned both gate-runner files; the rejected implementation
and its tests were then restored byte-for-byte to integrated main. Final changes
are confined to the original instrumentation, affected reader tests and this record.

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
and final qualification were still pending at that checkpoint.

Instrumentation currently uses seventeen fixed labels. `native-inventory`
combines sequential package-manifest discovery and native-resolution evidence;
`payload-copy` combines each existing copy call. Repeated verification counters
include every existing callback/assertion without moving it. These operation
scopes do not nest each other; all sit within the existing milestone intervals.
Milestone durations include other work and must not be summed with their detail.

The isolated frozen install used the task-owned pnpm store/Corepack/cache under
`<owned evidence root>`; no shared cache was
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
At that checkpoint, targeted checks had passed and final validation was pending.

The measured candidate was committed as
`e717c6f95b959fdf8d2675b5dff0f576aac938e3`. Baseline module SHA-256 is
`f24b6ac467db9d3041eae0995a7c4f7bd2f3edff661daada05e3bbe4ea345b90`;
candidate module SHA-256 is
`9afdb548cafc5d134979d747663055c3ed07b345558bb9fa528cba0f960dd3fa`.
All candidate-only tests and the helper were subsequently reverted, as required
by the result below. These results document the experiment; they do not describe
an optimization present in the final diff.

### Operation Results And Rejection

After the pilot's build and all 11 installed synthetic smoke phases completed
and its guardian/browser processes settled, the coordinator released the window.
The fixed series ran from 2026-10-13 07:42:15 UTC using Node 24.21.0, on the same
Mac and task-owned prerequisites as the attribution. It finished normally before
the original 08:27:01 UTC experiment deadline. No further sample or optimization
was attempted. There was no competing gate/build/live-model run; ordinary app,
WindowServer and UTM activity remained. This is a warm-cache operation comparison,
not a quiet-machine or end-to-end benchmark.

| Sample / fixed order | Variant | Elapsed seconds | Maximum RSS KiB |
| --- | --- | ---: | ---: |
| Warmup (excluded) | A baseline | 25.677385 | 592384 |
| Pair 1 first | A baseline | 24.295245 | 587776 |
| Pair 1 second | B candidate | 22.725818 | 612720 |
| Pair 2 first | B candidate | 22.560613 | 582896 |
| Pair 2 second | A baseline | 24.984205 | 557904 |
| Pair 3 first | A baseline | 24.646826 | 593216 |
| Pair 3 second | B candidate | 22.603134 | 586064 |

Baseline median was 24.646826 s (range 24.295245–24.984205); candidate median was
22.603134 s (22.560613–22.725818). All three pairs improved, by 6.460%, 9.700%
and 8.292%, but the 8.292% median reduction missed the predeclared 10% criterion.
Maximum RSS increased 19504 KiB (593216 to 612720), within the 64 MiB bound.
No integrity mismatch occurred. The optimization is rejected, with no retained
performance claim. Both gate-runner files were restored to exact
`93d4ad7a227675b963a0c336306a32b7fe9d9ad0` bytes.

The fixed corpus comprised 68052 regular files / 898569668 logical bytes in
`node_modules`, with 4354 literal symlinks and 12859 directories, plus 55180
regular files / 862922308 logical bytes in the private pnpm store (516 directories).
Every sample returned exactly the same full snapshot. Directory digests were
`fe62d1a6f77d771d9abeb0dc235bacb8e43ba3d2dc67aee778fba06c0353ca53`
for dependencies and
`5ddeddb9976ca1613597bf3dafc9efe557b503c22fb3324cbb7aabb6796d3c99`
for the store. The serialized complete snapshot, including absolute input paths,
hashed to `26adbb3a4f7c91235e4518dbf066dc21442e28b6fcf36dcdf9b81aeae1549d4c`.

Sample-boundary load averages ranged 5.947–7.307 / 7.024–7.562 / 7.571–7.840
(1/5/15 minutes). Disk was sampled only before/after: owned allocated disk
2662500/2662528 KiB and free disk 69290868/69439840 KiB. Per-process maximum RSS
comes from `process.resourceUsage().maxRSS`; there were no recursive disk scans
inside timed operations. No stage was retained or recreated.

To reproduce the method on an equivalent frozen corpus, export the two module
versions using `git show 85f4a137:scripts/local-migration/gate-runner.mjs` and
`git show e717c6f:scripts/local-migration/gate-runner.mjs` to separate `.mjs` files
outside the source tree. In a fresh Node 24.21.0 process for each sample, import
that module, record `performance.now()`, await
`captureCallerIntegrity([absoluteNodeModules, absolutePrivateStore])`, then record
elapsed time, `process.resourceUsage().maxRSS`, and the entire returned map.
Record `os.loadavg()` before/after. Use the fixed warmup-A, AB, BA, AB sequence,
no overlapping processes, identical inputs, and compare the complete serialized
maps. Module import and output serialization are outside the timer. Do not use
the full migration gate as a sample. Exact corpus reconstruction may differ on
another machine; report its own identity instead of claiming matched inputs.

Raw sample records, input inventory, module copies and the bounded supervisor
remain under the owned temporary root described above, alongside attribution
receipts. They are local investigation evidence, not required runtime assets.
Only task-owned retained files may be removed after handoff; preserve raw results
until the user no longer needs them. Rollback of the final change is removal of
the diagnostic reporter/reader integration; no installed app or personal state
was changed.

## Checkpoint 3: Final Qualification

The user permits an honest measurement-only outcome when no worthwhile safe
optimization qualifies. Here the finalization milestone is resolved experiment
disposition, exact helper/test reversion, focused/negative tests and resolved
plan reviews. No required validation is relaxed by that outcome. Freeze this
measurement-only candidate once that point is reached. Complete affected
packaging/gate/reporting/docs consumers,
applicable integration/negative checks, a fresh independent complete-diff review,
the required full local migration gate, and exact-head CI. The final local gate
is qualification, not a benchmark sample. Installed-artifact qualification is
required only if changed behavior affects it, respecting pilot ownership.

Final commands use Node 24.21.0 and pnpm 10.25.0. Re-run the affected four
packaging/gate/runtime-resource test files listed above after reversion, plus
`node --test scripts/check-markdown-links.test.mjs`,
`node scripts/check-markdown-links.mjs`, and `git diff --check`. Freeze and commit
those inputs before the complete-diff review and the single full
`pnpm migration:gate` (equivalently its exact entrypoint
`node scripts/local-migration/migration-gate.mjs`). Use the owned Corepack,
Playwright, npm and XDG cache roots; the short owned `TMPDIR`; explicit
`MIGRATION_GATE_BASE_SHA=93d4ad7a227675b963a0c336306a32b7fe9d9ad0`; and
`MIGRATION_GATE_PYTHON_BIN=<Python 3.12.8 executable>`
(verified Python 3.12.8). Reverify pinned Prisma, browser and cached PostgreSQL
prerequisites immediately before the run. Preserve the existing gate deadlines,
all 12 phases, owned database allocation and cleanup. Record a sanitized terminal
summary outside the source via an owned `RUNNER_TEMP` and its exact
`local-migration-gate-summary.json` path. Do not edit tracked numerical evidence
after freezing; post-freeze review/local-gate/exact-head-CI results belong in the
single PR body and final handoff. The PR remains unmerged.

After helper/test reversion, the final affected four-file test run passed 209/209
on Node 24.21.0 (39.546 s), markdown checker tests passed 20/20, and the link
checker passed all 147 Markdown files. `git diff --check` passed; both rejected
helper files have zero diff against integrated main. Remote main was reverified
at `93d4ad7a227675b963a0c336306a32b7fe9d9ad0` before the final commit. These
targeted results allowed that freeze; final local gate, complete-diff review and
exact-head CI were still pending at that point.

The first frozen candidate was `ef909b8ccfe7246d2404f54b7ef7d5a3d337eff6`.
Its independent complete-diff review found one P2 record-classification issue:
an explicitly malformed milestone containing operation text was skipped by the
new classifier, incorrectly leaving legacy evidence complete. Two regressions
(newline-terminated and unfinished) first failed. Classification now excludes
only operation-prefixed records, preserving the milestone's original invalid
or truncated result while retaining `operation=milestone` independence. The
focused reporter/reader tests passed 17/17. This correction requires a new
freeze, reviewer delta check, full gate and exact-head CI; unaffected full-diff
review coverage is explicitly carried forward by the independent reviewer.

The first local gate stopped in phase 1 at an offline prerequisite, with 379/380
contract-suite tests passing: a projectless nested pnpm invocation selected the
Corepack binary's built-in 11.24.0 default because the owned cache had no
`lastKnownGood.json`. It correctly refused network access. The pinned project
preflight had reported 10.25.0. Offline
`COREPACK_HOME=<owned-cache> COREPACK_ENABLE_NETWORK=0 corepack install --global pnpm@10.25.0`
activated the already-cached version in the task-owned default metadata only.
A projectless version probe then reported 10.25.0. No shared cache or source
was changed by this prerequisite repair, and it does not change the completed
node_modules/store comparison inputs. Failed receipts were retained; caller
integrity passed, the owned workspace and exact container were independently
absent, and the cleanup journal recorded database/container removal without
cleanup errors. The retry uses fresh summary/log paths.

With that owned prerequisite fixed and the parser correction applied, all four
affected suites passed 211/211 (39.930 s), including the previously failing real
runtime-resources build/schema fixture. Full qualification was still pending
at that point; its completed scope follows.

### Completed Qualification At The Reviewed Implementation

The implementation at `ee7ab64766ee66805cd50b07ccfec8f6f9c73004`, against base
`93d4ad7a227675b963a0c336306a32b7fe9d9ad0`, completed independent full-diff review
and the corrected-delta recheck with no remaining findings. Its full local gate
passed all 12 phases, with merge-base comparison performed, caller integrity
verified and no cleanup errors. The copied-source digest was
`56ddeaf704dfe32d62c068400e039381dde2a7417672e241b5219aa41dbc708b`.
All six packaged modes passed and both milestone and operation projections
were complete. All 71 packaged resources reached terminal cleanup states;
the owned disposable roots, exact containers and gate/packaging processes were
independently verified absent.

That exact head also passed [standard CI](https://github.com/loyalagents/context-router/actions/runs/38366358937)
and the [full migration gate in CI](https://github.com/loyalagents/context-router/actions/runs/38366358857).
The sanitized gate JSON is included in the Actions job summary. The original
local terminal summary remains at
`<owned evidence root>/final-gate-retry-ci/local-migration-gate-summary.json`;
independent cleanup evidence remains at
`<owned evidence root>/final-cleanup-and-qualification.json`. These receipts,
the failed prerequisite-attempt receipt and raw measurement evidence remain
unchanged. The final resource sampler missed one cleanup-time sample, so its
resource peaks remain sampled estimates, independent of complete gate/timing
evidence. These results attest the named implementation head, not a later head.

### Test And Documentation Review Follow-Up

The user authorized two non-blocking review improvements: add a regression for
calling the operation timer's `finish()` while measured work remains pending,
and replace machine-specific locations in shared prose with portable labels.
The new test checks a bounded complete row census with partial/collection-failed
status, original return identity and one invocation, immutable emitted output
after settlement, and idempotent repeated finishing. The existing production
guard already implements that behavior. No production code, dependencies,
configuration, fixtures, CI policy or runtime boundary changes are included.

The independent reviewer approved the validation impact assessment for this
test/documentation-only follow-up: renew the affected packaging/reporting tests,
Markdown checker tests and link scan, contract-baseline checks that read
`docs/plans`, and whitespace checks, then review the exact delta. Both standard
and full migration CI must pass at the new exact head. The unchanged local
runtime/build/gate evidence is selectively carried forward from the explicitly
named `ee7ab647` implementation above; no new-head local full-gate pass is claimed.
No new benchmark, installed build, live-model run or local broad gate is needed
for this bounded delta. Any production/input change requires reassessment.

Renewed checks on Node 24.21.0 passed: operation-timer cases 4/4, complete
packaging-smoke and gate-phase suites 129/129, and the Markdown/contract checker
test suites 75/75. The contract checker passed against an immutable export of
base `93d4ad7a227675b963a0c336306a32b7fe9d9ad0`, with base comparison performed
(41 capabilities, 58 GraphQL types, 58 consumers and 19 catalog entries).
A mutation check copied the new regression and reporter into the owned scratch
directory and removed only the active-operation guard from that copy: the test
failed because the mutant emitted complete evidence instead of partial evidence.
The repository reporter was never modified. The link scan and whitespace check
also passed. Delta review and new-head CI results are recorded separately in
[PR #178](https://github.com/loyalagents/context-router/pull/178).

For each expensive run, state purpose, changed inputs and why it is needed then;
preflight toolchain/resources. Corrections renew affected tests/reviews and
required final qualification; carry forward only explicitly unaffected evidence.
Checkpoint reports include targeted results and pending final validation.
Handoff records exact base/head/worktree, changes and preserved properties,
review dispositions, comparable evidence and limits, commands/results, retained
resources/cleanup, integration instructions, pilot impact and rollback.
