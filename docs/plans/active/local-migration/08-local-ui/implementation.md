# Step 08 Implementation Evidence

- Status: implementation and independent reviews complete; full twelve-phase local gate passed; human acceptance pending
- Sole writer: `/root`; P2 approved in all four mandates before product edits
- Base: `5e2a67dd785500ba053b2e836c47166e8adeada8`
- Toolchain: Node 24.21.0, pnpm 10.25.0
- Last updated: 2026-10-04

## Browser Session Store

Wrote six behavioral tests first; the intended missing-module failure was observed.
The implementation adds separate random bootstrap/session authorities, exclusive
private export, one-use exchange/reissue, monotonic expiry, logout/owned-request
abort, capacity bounds, restart invalidation and disjoint nonsymlink roots. The
six tests passed after the backend build. A new seventh test reproduced an early
timer firing that could leave active expiry unarmed; rescheduling against the
same absolute deadline fixes it without extending the session. All seven now pass.
A test-only prefix slicing correction removed a random-suffix comparison risk;
its independent-secret expectation did not change.

Commands: `pnpm --filter backend build` and
`node --test apps/backend/test/local-ui/sessions.test.mjs` with the pinned Node PATH.
The backend now exposes `pnpm --filter backend test:local-ui` for this growing suite.
HTTP composition, actual browser coverage and all later checkpoints remain pending.

## Combined HTTP Composition (Checkpoint 1, Partial)

Three real HTTP tests were written before the new bootstrap and failed because
it did not exist. The new explicit root registers storage/model once, uses a
separate browser strategy, reuses extracted MCP features and Nest's own HTTP
server, and leaves the MCP Origin guard unchanged. Exact routes/Host/Origin,
separate credential realms, bounded body admission and raw upgrade/CONNECT
closure are covered. All ten session/HTTP tests now pass (2,632 ms), following a
clean backend build. A denied keep-alive request initially caused the following
attack probe to see a reset; explicitly closing denied connections fixed cleanup
without changing the test expectation. The first sandboxed HTTP run failed during
startup without retaining the underlying cause; the authorized owned-loopback run
succeeded after the build fix. The sandbox cause is not independently established.

Actual Next/Chromium, saturation, full lifecycle/model ownership and remaining
privacy/concurrency evidence are still pending. Passing these ten tests alone
is not full Checkpoint 1 or browser acceptance.

## Production Browser And Early Security Review

The custom launcher, runtime-selected local page shells, lazy hosted Auth0 construction,
fixed browser transport and reused profile/preferences/schema/history/form clients
now build. The first real Chromium production test passed: nonce CSP hydration,
unlock, synthetic profile save/reload, cookie/localStorage absence, logout, and
no observed unexpected browser/backend egress. No model or personal client was used.
Playwright 1.63.0 / Chromium revision 1243 is pinned; installation is an explicit
test prerequisite. The unused optional `@playwright/test` peer was removed from
the lockfile; a frozen offline install succeeded without version upgrades.

The original security plan reviewer performed an additional read-only early review
(Astra/xhigh dispatch retained; internals unobservable). Five findings were accepted:
post-Multer session admission, separate logout capacity, immediate local locking,
idle browser expiry, and possible multipart byte loss. New tests reproduced 429
logout denial and a 400 same-packet upload during delayed auth. Parser-level counting
preserves backpressure, controllers revalidate after parsing, and authenticated
logout has a separate pool. The full local-UI backend suite passed 15/15 (3,722 ms).
Transport tests passed 4/4; two Chromium tests passed (4,581 ms), including delayed
logout acknowledgement and eight-hour idle expiry through the browser clock.
These are targeted evidence, not final review or full checkpoint completion.

## History Work In Progress

New SQLite tests first failed for missing classification/clear contracts. Three
then passed for archived/event-time and legacy classification, complete non-history
table preservation, and witnessed second-delete rollback without retry. A fourth
test reproduced an intervening definition sensitivity update that the old outside-
transaction snapshot missed; the before snapshot now reads inside the mutation
transaction. The frozen transaction-facet tests are being updated only for the
approved new `getDefinitionById` capability. PostgreSQL ordering, broader privacy
coverage, UI invalidation, reviewed proposal application and full gates remain pending.

## History And Reviewed Apply Checkpoint Progress

SQLite history/UoW/storage contract targets passed 59/59 (6,452 ms). PostgreSQL
history/UoW targets passed 6/6 (3,251 ms), including a real independent append
committed between the two history deletes; both new records survived. Owned
PostgreSQL database/container cleanup completed. Chromium history passed: legacy
payload masking, explicit reveal, cancelled confirmation, both-stream clear and
preserved live memory. This does not yet complete restart/upgrade/stale-response
or full browser acceptance.

Reviewed apply-v2 tests were written first and failed for missing contracts. Seven
SQLite tests now pass: absence-only CREATE, persisted state/provenance comparison,
delete/recreate and definition identity, current domain validation, atomic audit
rollback, uncertain commit acknowledgement without retry, and canonical JSON.
After adding the approved transaction facets and service wiring, the combined
SQLite/UoW/document-service run passed 39/39 (4,290 ms). PostgreSQL compilation
initially rejected the nullable JSON helper for a required JSON value; using
Prisma JsonNull for that value corrected it. Two controlled real PostgreSQL
concurrent CREATE/UPDATE tests plus the UoW suite passed 5/5 (2,649 ms). Each race
produced one APPLIED and one CONFLICT with one committed audit. Both owned runs
cleaned database/container resources; the failed compile diagnostics remain at
`/private/tmp/step08-pg-check-LrySfG` for this session only.

Actual local GraphQL v2/legacy compatibility passed: repeated reviewed CREATE
returns an item conflict, while the retained legacy mutation still upserts. The
browser review component now sends v2 locally and keeps per-item outcomes visible,
removes attempted items from selection, and blocks automatic resubmission of an
uncertain result. Production web build passes; authenticated proposal UI scenarios
remain pending with the deterministic AI fixture.

## MCP Management Checkpoint Progress

Four tests first failed for missing bounded storage methods. They now pass for
real per-instance identity, secret-free projections, maximum/generation/revision
changes, 513-grant overflow with no effective claim, and malformed oversized text.
HTTP management first failed at its absent route; storage + HTTP targets now pass
11/11 (3,912 ms). Effective authority uses the existing MCP evaluator through
narrow read-only snapshot ports. Existing evaluator unit tests pass 30/30.
Production Chromium passed (2,961 ms): narrowing, remove grant, stale CLI edit,
and revoking only one of two same-label instances. Further bounded-storage review
is in progress; this is not final checkpoint acceptance.

Astra High read-only AI inventory (`/root/ai_controls_inventory`) confirmed request
entrypoints dropping options and identified checkbox policy synthesis and prompt
serialization pitfalls. Dispatch accepted the requested setting; serving internals
remain unobservable. No files were edited by that agent.

### AI Controls Checkpoint (In Progress)

Selected structured/text capabilities and upload configuration now determine the
browser's exact operation/MIME/size policy. Controllers validate actual bytes,
UTF-8 text and PDF structure before use-case entry, revalidate the browser after
awaited parsing, and forward immutable request execution controls. The optional
client deadline can shorten the 180-second bound only. No GraphQL consolidation
resolver exists in the retained inventory; existing MCP consolidation already
receives execution controls. This inventory clarification does not add a new API.

Local document uploads require review consent, additional confirmation for
secret-like filenames/content, release raw files after completion/cancellation,
and stop a batch on AI failure. Local form fill always sends v2, preserves existing
nonempty fields, accepts exact named overwrite flags, and keeps reviewable skipped
outcomes. Useful literal and smart search are now in Preferences. The legacy
absent/v1 form-fill and legacy apply interfaces remain compatible.

Tests-first evidence, Node 24.21.0 / pnpm 10.25.0:

- Local AI policy/controller/request tests: 15/15 (2,695 ms).
- Actual PDF v2 preservation/overwrite plus retained extractor/prompt/validator:
  40/40 (2,277 ms), covering text, checkbox, radio, dropdown and option list.
- Safe failure categories and final analysis/form-fill publication checks: 33/33
  (2,430 ms). New cancellation/deadline-after-review cases failed before the fix.
- Deterministic real-adapter UI/MCP shared admission, successful controls,
  concurrent busy, non-AI access, logout cancellation and settlement/latch:
  1/1 (6,366 ms). A test recorder initially captured the subsequent MCP options;
  fixing that recorder established the separate request signals.
- Authenticated production Chromium AI controls: 3/3 (7,884 ms): no-model gating
  with literal search; consent, real inference and mixed applied/conflict proposals;
  real PDF default preservation and exact explicit overwrite. No hosted egress,
  page errors or CSP violations observed in these cases.
- Test harness socket guard: new normalized-argument negative control failed
  before the fix and now passes (1/1). This is harness evidence, not a product
  network sandbox claim.

An affected read-only security review is in progress; complete independent
implementation reviews, final migration gate and CI remain pending. Deterministic
fixtures do not alter the existing Step 06 E omission or H inconclusive native
cancellation evidence. No live model or personal client configuration was used.

### Additional Persistence and Browser Evidence

- Positive owned-location CREATE/UPDATE, same-slug personal/global isolation, and
  expiration of every newly exposed UoW facet: SQLite 29/29 (3,514 ms).
- Cross-principal history isolation, legacy UNKNOWN sensitivity through v1-to-v2
  upgrade/reopen/matching backup restore, and existing backup protections: SQLite
  history plus backup suites 28/28 (18,861 ms). Clear affects the live pair only;
  restoring an older explicit backup retains its old history and authority.
- Actual PostgreSQL serialization rollback after a concurrent update of the second
  history stream, concurrent reviewed writers, and expired facets: 9/9 (3,524 ms).
  Owned database/container cleanup confirmed. No retry or success receipt on the
  rolled-back clear; independent concurrent changes remain.
- Chromium stale history across two windows, including a delayed pre-clear audit
  response and previously loaded hidden access tab: 1/1 (2,966 ms). Both UI streams
  stay empty after confirmed clear while live memory survives.
- Chromium held cancelled File read plus replacement batch and batch deadline:
  passed (8,418 ms), with affected independent security approval recorded.
- Repeated profile save then deletion of an optional newly created value reproduced
  a stale-ID bug; the form now tracks each acknowledged row. Browser regression
  passed (3,343 ms).
- `me`/deprecated self-only `user(id)` local GraphQL compatibility: 1/1 (1,039 ms).
  New deprecation assertion failed first, then passed after the additive change.
- Schema regenerated from the canonical backend producer; GraphQL root validation
  now pins exact field identities, not just a count. Contract-checker tests 52/52.
  Standalone contract inventory currently passes with `baseComparison=skipped`;
  it is not the required final exact-base compatibility gate.

Contract inventory is in [consumers.md](consumers.md). Final gate/CI wiring,
relocated browser packaging, complete independent reviews and human acceptance
remain pending. Step 08 is still in progress.


### Browser, Packaging And CI Checkpoint

The production browser suite now passes 18/18 (31,938 ms), including actual
no-model personal-definition create/edit/export/archive and manual preference
create/update/delete. Missing form control labels were reproduced first and
corrected without redesign. Backend local-UI tests pass 27/27 (13,349 ms). The
latest web build completed without new lint warnings. The unrelated ESLint peer
snapshot churn was removed; frozen offline pnpm installation passes.

The shared source/relocated MCP harness has an explicit optional UI hook, retaining
MCP behavior by default. Source UI two-generation evidence passed at
`/private/tmp/step08-ui-smoke-PETMrc`; relocated production evidence passed at
`/private/tmp/step08-ui-smoke-juzA4c` after strict closure and WebSocket-control
updates. Those session-local journals are not durable acceptance artifacts. Both
runs used Playwright 1.63.0 / Chromium 153.0.8010.12, actual production Next/Nest,
private SQLite state and deterministic TLS inference. No live inference or
personal client files were used.

An independently requested architecture consultation (same prior reviewer, xhigh,
read-only, not final approval) identified browser cleanup propagation and the scope
of browser egress claims. Chromium now stays in a gated Node process group; CDP
close is bounded and followed by explicit reap/group absence. A failed browser
cleanup retains its profile/root through the common runner, with an injected
regression. Browser evidence is precisely page HTTP/WebSocket confinement, not
OS-wide no-egress. The exact app policy retains worker controls and admits two
UI-mode listeners only. Root remains sole writer.

The gate now has six explicit modes and requires browser tests in the web build
phase plus distinct authenticated browser lifecycle receipts in source and sealed
packaging smokes. Production web deploy is an additional exact offline materializer
with an explicit files allowlist; hosted standalone remains covered. Standard CI
selects frontend for backend changes and backend for launcher changes. CI installs
the pinned browser as a prerequisite, never from inside the gate. Dedicated step
budgets grow from 153 to 163 minutes and job bound from 165 to 175, preserving the
existing twelve-minute overhead and unchanged internal/gate-step limits. This
additive prerequisite is subject to final independent review.

Focused gate/environment/lifecycle/CI/runtime-config tests pass 108/108 (4,850 ms).
Packaging harness tests pass 43/43 (793 ms); the initial sandbox-only EPERM was
rerun with owned loopback permission. Existing MCP helper tests pass 7/7.
Canonical inventory now has 57 GraphQL consumers, 136 public references and
58 classified sinks; 15 queries / 17 mutations. Its exact HTTP transition binds
five strict response-domain additions and 113 affected consumer identities, with
independent approval still pending. Final complete-diff reviews, the final exact-
base aggregate gate, draft PR and final pushed-head CI remain pending.

### Fresh Final Review Corrections

See the R1/R2 section in [reviews.md](reviews.md) for independent findings,
reproductions and targeted corrections. The first actual sealed packaging attempt
failed safely before sealing on a source-hardlinked backend file in the new web
production closure; its owned resources were removed and diagnostics retained.
A copy-before-seal correction and explicit local-ui payload sealing preserve
source/store integrity. Final sealed end-to-end and full aggregate evidence will
be recorded after the corrected candidate completes those checks.

The exact HTTP compatibility transition is now independently reviewed, with all
five strict response additions and all 113 old/new consumer bindings verified.
Final code approval, gate, PR/CI and human acceptance are still separate gates.

R2 targeted results before affected reapproval: backend resolver/admission 21/21;
real PDF suites 10/10; real local GraphQL HTTP cases 13/13 across the combined run
and corrected deadline assertion; complete dashboard suite 21/21 (41,835 ms);
phase-one contract/gate harness 300/300 (29,912 ms), including all 44 packaging
harness tests. Production backend and web builds passed. The standalone baseline
checker passed with base comparison skipped; the exact HTTP transition function
returned no errors, but neither substitutes for the forthcoming full gate's
performed base comparison. Markdown links and diff checks are rerun at closeout.

## Final Local Validation And Draft Handoff

Earlier checkpoint entries above are chronological evidence, including failed
attempts and then-pending gates. This section records the current result.

R5 was the first final product/test candidate: [candidate-r5.json](candidate-r5.json),
178 bound paths, aggregate
`2a48f8c76f70d75d1e5b247a37858af5ffc2ff9f773a7363fe7188268792f81b`.
The compatibility reviewer independently approved its two schema-test pin updates;
all unaffected R4 architecture/security/persistence approvals carry forward.
The frozen P2 plan is unchanged.

The full final command was:

```sh
PATH=/Users/lucasnovak/.nvm/versions/node/v24.21.0/bin:$PATH \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python \
MIGRATION_GATE_BASE_SHA=5e2a67dd785500ba053b2e836c47166e8adeada8 \
RUNNER_TEMP=/private/tmp/step08-final-gate-f3f1o5c7 \
MIGRATION_GATE_CI_SUMMARY_PATH=/private/tmp/step08-final-gate-f3f1o5c7/local-migration-gate-summary.json \
pnpm migration:gate
```

Result: **PASS, exit 0, 12/12 phases**. The committed sanitized
[R5 receipt](https://github.com/loyalagents/context-router/blob/ac5de4cef4266e92be94428959b8640c1cad925d/docs/plans/active/local-migration/08-local-ui/final-gate-summary.json) records 1,123,577 ms; the terminal reports
1,123,936 ms including final return work. Base comparison was **performed** against
`5e2a67dd785500ba053b2e836c47166e8adeada8`; caller integrity is true, cleanup errors
are empty, the owned database was removed and owned administration cleaned.
Versions: Node 24.21.0, pnpm 10.25.0, Python 3.12.8, PostgreSQL 15.19,
Chromium 153.0.8010.12 and Playwright 1.63.0. Source was the uncommitted R5 snapshot,
with copied-input digest
`98c6f04b208d21749d738dcfcb9e1676c43614294a7c678c09c947759de1e896`.
Only closeout documentation and this receipt are added after that run; product,
test and gate code are unchanged. Final-head CI validates the pushed commit.

| Phase | Result | Elapsed ms |
| --- | --- | --- |
| Contract baseline | passed | 27341 |
| Documentation | passed | 1328 |
| Backend unit/build | passed | 120947 |
| Backend database | passed | 221001 |
| Local orchestrator | passed | 6376 |
| Eval fixtures | passed | 41325 |
| Deterministic scenarios | passed | 7541 |
| Web production/browser | passed | 73777 |
| Harbor static | passed | 2291 |
| Source restart smoke | passed | 82198 |
| Sealed relocated composition | passed | 506587 |
| Repository integrity | passed | 1822 |

Source and sealed payload runs each verified two authenticated browser
generations, separate authority, shared UI/MCP state/model admission, history
clear, restart invalidation, revocation and bounded owned cleanup. They use
synthetic deterministic inference. This is not live-model qualification, general
OS egress isolation, installer proof or personal-client interoperability proof.

The single PR stays **draft**. Its checks and PR closeout record the exact final
pushed SHA and both standard CI and dedicated migration results. Required
[human acceptance](acceptance.md) stays **PENDING**, including isolated Claude
Code/Codex interoperability and any qualified live-model checks. Steps 09–11 and
future full MCP onboarding remain inactive. Existing E/H, plain-HTTP origin trust,
legacy history/backups and AcroForm parser limits remain as documented.

### Linux CI Startup Correction

Draft [PR #167](https://github.com/loyalagents/context-router/pull/167) initially
pushed `ac5de4cef4266e92be94428959b8640c1cad925d`.
[Standard CI](https://github.com/loyalagents/context-router/actions/runs/37190493733)
passed. The [dedicated gate](https://github.com/loyalagents/context-router/actions/runs/37190493739)
passed its first ten phases, including source Chromium, then failed sealed
composition with `Browser driver failed`. The R5 macOS gate remains valid
historical evidence, but did not establish Linux sealed startup.

An owned disposable Ubuntu 24.04 arm64 container reproduced the failure with the
exact pinned Chrome for Testing 153.0.8010.12. The original sealed TMPDIR was
63 bytes; Chromium's resulting `SingletonSocket` path was 108 bytes and aborted
with `Socket path too long`. The source TMPDIR and corrected sealed TMPDIR were
53 bytes, their actual socket paths 98 bytes, and both reached DevTools readiness.
This matches Chromium's [platform-specific socket bounds](https://chromium.googlesource.com/chromium/src.git/+/refs/tags/146.0.7680.21/chrome/browser/process_singleton_posix.cc).
The exact binary reproduction, rather than the older source tag alone, establishes
the observed behavior. Local evidence: `/private/tmp/step08-linux-chromium-proof/result.log`.
The reproduction container and its browser groups were removed afterward.

The correction shortens only packaging's owned UI temporary child to `runtime/ui`.
No root ownership, journal, parent-retention or product behavior changes. Browser
startup now emits only fixed spawn/socket-path/exit/signal/deadline categories,
with a bounded transient stderr tail and no raw diagnostic forwarding. It notices
signal termination directly and validates the port before accepting readiness.
New fake-browser failure cases check fixed output, high-volume private canaries,
split socket diagnostics, spawn/exit/signal/deadline failures and owned-group reap.
The diagnostic test failed before the fix and passes afterward. The three affected
UI/packaging/gate-phase harness suites pass 102/102 in 10,975 ms; Markdown links
(168 files) and diff whitespace pass. An initial sandboxed suite invocation was
blocked by loopback `EPERM`; the authorized owned-loopback run passed. Affected review,
a renewed full local gate and both workflows on the replacement pushed head are
required; manual acceptance remains pending.


### R6 Final Local Validation

R6 was the second final code/test candidate: [candidate-r6.json](candidate-r6.json),
179 bound paths, aggregate
`bad1e63bdafeacda4540a7f299db70c5fa71bf78f308f925fc6502d6804abc71`.
Architecture, security/recovery and compatibility independently verified this
manifest and approved the affected correction, carrying forward unchanged
complete-diff coverage. Application persistence contracts remain unchanged.
A post-gate comparison found no drift in any bound path, mode or content.

The renewed full command used the same pinned toolchain and exact base above,
with `RUNNER_TEMP=/private/tmp/step08-final-gate-r6-_0354mbu` and
`MIGRATION_GATE_CI_SUMMARY_PATH=/private/tmp/step08-final-gate-r6-_0354mbu/local-migration-gate-summary.json`.
Result: **PASS, exit 0, 12/12 phases**. The
[R6 receipt](https://github.com/loyalagents/context-router/blob/fa1f649fc9adbb7b9ed59836727d50db4e9ef383/docs/plans/active/local-migration/08-local-ui/final-gate-summary.json) records 1,139,223 ms; the terminal
reports 1,139,551 ms including final return. Base comparison was performed;
caller integrity is true; cleanup errors are empty; the owned database was
removed and administration cleaned. Source was the R6 uncommitted snapshot over
`ac5de4cef4266e92be94428959b8640c1cad925d`, with copied-input digest
`d042f1994a4a742ce97a1cc9d1d05c3f902828ab58e94b59e0e48bf6d7d14508`.
All versions match R5. Sealed composition passed in 515,930 ms, including both
actual authenticated browser generations and confirmed group reaping.

Only closeout documentation/review evidence and the sanitized receipt change
following this frozen run. Replacement pushed-head standard and dedicated CI
results are recorded in PR #167; human acceptance remains **PENDING** and the PR
remains draft. The earlier failed Linux run and passing R5 local run are retained
as historical evidence, not substituted for replacement-head validation.

### Issued MCP Client ID Parsing Correction

R6 pushed head `fa1f649fc9adbb7b9ed59836727d50db4e9ef383` passed the new browser
harness phase in [dedicated CI](https://github.com/loyalagents/context-router/actions/runs/37193707041),
then failed phase 3 in the preexisting compiled MCP administration test at
`permissions --id <issued-id>`. The only variable command argument is the
randomly issued ID. Node 24's strict parser rejects a separate string value
beginning with `-`, while issued 16-byte base64url IDs legitimately permit that
prefix. This was a real CLI usability defect, not a reason to retry the random
fixture until it passed. The run did not reach sealed Linux validation.

A new deterministic compiled-process regression supplies test-only randomness
for the 16-byte ID during isolated provisioning, retaining normal 32-byte token
randomness. IDs beginning with `-` and `--` reproduce the same exit 2 and fixed
invalid-command error before the fix. The correction normalizes only exact
`--id` followed by the existing valid 22-character leading-hyphen ID shape into
Node's `--id=value` form. Strict parsing, per-command allowlists, ID generation,
stored state and authority checks are unchanged; existing IDs remain usable.

The regression now passes permissions, grant, rotation and revocation for both
prefixes, existing equals syntax, and rejection of missing/malformed values,
unknown/disallowed options and misplaced terminators. Existing tests and their
requirements are unchanged. Backend build passed; the focused regression passes
in 2,475 ms and the full local MCP suite passes **57/57**, 36,292 ms. Affected
independent security/compatibility reapproval and renewed full local/final-head
CI validation are required. Human acceptance remains pending.


### R7 Final Local Validation

R7 is the final code/test candidate: [candidate-r7.json](candidate-r7.json),
182 bound paths, aggregate
`7ce78944372cfe56fd8d3c4a475d2285ff6ea060e37edffaf1b4cfe7c4151eb4`.
Security and compatibility independently verified and approved the narrow CLI
correction; all unaffected complete-review coverage carries forward. Post-gate
verification found no drift in any bound path, mode or content.

The renewed command used the same pinned toolchain and exact Step 07 base, with
`RUNNER_TEMP=/private/tmp/step08-final-gate-r7-pe00fgz4` and
`MIGRATION_GATE_CI_SUMMARY_PATH=/private/tmp/step08-final-gate-r7-pe00fgz4/local-migration-gate-summary.json`.
Result: **PASS, exit 0, 12/12 phases**, receipt elapsed 1,141,289 ms (terminal
1,141,533 ms including final return). The current
[sanitized receipt](final-gate-summary.json) records performed base comparison,
caller integrity true, no cleanup errors, removed owned database and clean owned
administration. Source was the R7 uncommitted snapshot over
`fa1f649fc9adbb7b9ed59836727d50db4e9ef383`, copied-input digest
`d871903d1a00a1b9c1a9307ce82afe2fdfeb918723355bf21f5e27650cb6805a`.
All pinned local versions match R6. Sealed composition passed in 512,881 ms,
including both authenticated browser generations and confirmed process-group reap.

The preceding [R6 standard CI](https://github.com/loyalagents/context-router/actions/runs/37193706996)
passed all jobs; its dedicated failure remains separately recorded above. R7
replacement-head standard and dedicated results belong in the PR's final CI
closeout and do not inherit that earlier standard result. Only documentation,
review evidence and the sanitized receipt change after this frozen local run.
Required synthetic human acceptance remains **PENDING** and PR #167 stays draft.
