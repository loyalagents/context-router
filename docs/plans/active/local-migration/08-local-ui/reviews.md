# Step 08 Review Ledger

- Status: P2 independently approved in all four required mandates; checkpoint implementation authorized
- Sole writer: `/root`; all reviewers read-only
- Last updated: 2026-10-04

## Plan P1

Plan SHA-256: `b3aad4b9a1f519478143b74af0029a4217752a6108c0cd8a5557bdcfa0499e02`. Markdown links (164 files) and diff whitespace passed. Plan content is frozen for review.
Required mandates: architecture/scope, security/privacy and auth-contract evolution,
persistence/recovery, compatibility/tests/usability. No approvals yet.

| Reviewer | Mandate | Requested / observed | Status |
| --- | --- | --- | --- |
| `/root/plan_architecture` | Architecture, trust-boundary composition, scope/packaging | Astra xhigh / explicit dispatch accepted; serving internals unobservable | P1 changes required |
| `/root/plan_security` | Browser/session, credentials, privacy, auth-contract evolution | Astra xhigh / explicit dispatch accepted; serving internals unobservable | P1 changes required |
| `/root/plan_persistence` | History, transactions, upgrade/recovery | Astra xhigh / explicit dispatch accepted; serving internals unobservable | P1 changes required |
| `/root/plan_compatibility` | Compatibility, tests, usability/accessibility | Astra High / explicit dispatch accepted; serving internals unobservable | P1 changes required |

## P1 Findings And P2 Disposition

All four P1 verdicts were changes required. Unaffected review dimensions may carry
forward only through explicit affected P2 approvals.

| ID | Reviewer | Finding | Disposition in P2 |
| --- | --- | --- | --- |
| A1 | plan_architecture | Next installs a raw upgrade handler outside Nest routing; unmatched sockets can remain open | Require independent upgrade/CONNECT rejection before forwarding and raw-socket cleanup tests after Next initialization |
| S1 | plan_security | Unlimited grants make list/revision unbounded; truncation can omit DENY | Pages of 32 client summaries, bounded complete per-instance inspection, explicit overflow denial with no partial revision/effective claim, CLI and generation-only revoke preserved |
| PERSIST-01 | plan_persistence | CREATE can overwrite intervening memory; default PostgreSQL read/write is not CAS | Exact reviewed state/identity presence or absence, in-transaction definition validation, one serializable compare/write/audit attempt, controlled writer tests; no timestamp-version or ABA promise |
| PERSIST-02 | plan_persistence | Separate READ COMMITTED deletes lack a common history-clear snapshot | One serializable clear attempt, concurrent ordered-insert/rollback tests and explicit known rollback versus uncertain acknowledgement |
| C1 | plan_compatibility | Preserve-existing default silently changes absent/v1 REST clients | Add fieldPolicies v2 at existing route, local UI always v2, preserve absent/v1 semantics, all supported field-type old/new tests and migration guidance |

P2 also enumerates the selected Markdown/JSON/YAML/text/PDF MIME set and explicitly
preserves later-approved Steps 04/07 definition-edit semantics, documenting the
older Step 01 aspiration as an existing limitation. It reserves bounded logout
control capacity and actively aborts expired-session AI work. These are security,
compatibility and concurrency changes requiring affected review, not editorial.

## Plan P2

Frozen SHA-256: `fa7c1838c5ca637363de2ca928ecf04bb2391b7417d05fc0432fd95a9650ee70`.
Markdown links and whitespace checks pass. All four affected reviewers explicitly
approved this exact P2 hash before any product edit:

| Reviewer | Verdict | Scope and carry-forward |
| --- | --- | --- |
| `/root/plan_architecture` | APPROVE | A1 resolved; architecture/composition/trust boundaries, packaging/lifecycle and scope approved; unaffected P1 single-owner/strategy/E/H coverage carried forward |
| `/root/plan_security` | APPROVE | S1 resolved; browser/session, credentials/privacy and auth-contract evolution approved; other P2 deltas accepted and unaffected P1 security carried forward |
| `/root/plan_persistence` | APPROVE | PERSIST-01/02 resolved; history, upgrade/recovery and concurrent proposal/grant writes approved; unchanged storage/privacy/recovery coverage carried forward |
| `/root/plan_compatibility` | APPROVE | C1 resolved; MIME and definition clarification accepted; compatibility/consumers/test adequacy/usability/accessibility approved; unaffected P1 coverage carried forward |

These are plan approvals, not implementation approvals. Root remains sole writer.
The plan file retains the exact reviewed bytes; its draft/pending administrative
labels describe its review submission. This ledger records the subsequent approval.
Fresh complete implementation review remains required.

## Implementation

Checkpoint 1 starts after all P2 approvals. Fresh complete base-to-candidate reviews remain required.

### Early Browser Security Corrections

`/root/plan_security` (prior Astra xhigh dispatch; serving internals unobservable)
returned APPROVE for the affected checkpoint 1 corrections after five findings
were resolved: post-Multer admission, separate logout capacity, immediate local
locking, active idle expiry and parser byte preservation. Bindings at review:

- HTTP boundary: `db2465df7c56ee22e4e6b0b926dbdc583c893c1cd595bc703c04c36a3625357e`
- Browser transport: `b96c9b785e70cd2d01397950f081d3f54f0bb2ce38d1ada5f38f02b10ac8b9d1`
- LocalSession: `91ea66e726a389347d44b1e31b834d672dab418e86f54a6aee67f496ac4005fe`

The reviewer inspected source; targeted execution evidence was coordinator-provided.
Subsequent management boundary changes are undergoing their own affected review.
This approval does not substitute for fresh complete implementation review.

The later external F1 finding showed that this early parser-byte review did not
establish chunked-body enforcement after Express's prototype replacement. Its
byte-preservation result remains historical evidence; the R12 correction and
renewed affected security review supersede the body-limit claim.

### Reviewed Apply V2 Persistence

`/root/plan_persistence` returned APPROVE for this affected checkpoint, with no
blockers. Prior requested Astra xhigh dispatch retained; serving internals remain
unobservable. Service SHA-256:
`e7303458b6255ab9c04b6ec84a9bb80f3e3abe48965c7f4f81f82c394ca474d2`.
The reviewer recorded a sorted 20-file aggregate
`fb97c81cd46831e043c6eb425dd51058c7bf30bc93d5d30eadcbab611bdec5e1`
using SHA-256 of `path + NUL + file SHA256 + LF` records. Exact path manifest is
being added to this ledger. The review covers definition/row/location identity,
canonical persisted state, current domain validation, serializable write/audit,
known conflicts versus uncertain acknowledgement, no retry, and unchanged legacy
apply. SQLite and PostgreSQL execution evidence above is coordinator-provided;
the reviewer ran no tests. A nonblocking request for positive owned-location and
namespace-isolation coverage was accepted and remains to be added. Full final
Step 08 independent review remains pending.

The reviewed-apply aggregate above covers this exact historical 20-path manifest
(sorted lexically before hashing). Later AI forwarding/category edits to the
analysis service and its tests are outside that checkpoint approval:

```text
apps/backend/src/domains/shared/storage/storage-unit-of-work.ts
apps/backend/src/infrastructure/storage/postgres/postgres-preference.repository.ts
apps/backend/src/infrastructure/storage/postgres/postgres-unit-of-work.ts
apps/backend/src/infrastructure/storage/sqlite/sqlite-preference.repository.ts
apps/backend/src/infrastructure/storage/sqlite/sqlite-unit-of-work.ts
apps/backend/src/modules/preferences/audit/event-sensitivity.ts
apps/backend/src/modules/preferences/document-analysis/document-analysis.module.ts
apps/backend/src/modules/preferences/document-analysis/document-analysis.resolver.ts
apps/backend/src/modules/preferences/document-analysis/document-analysis.service.spec.ts
apps/backend/src/modules/preferences/document-analysis/document-analysis.service.ts
apps/backend/src/modules/preferences/document-analysis/dto/apply-suggestion-v2-result.dto.ts
apps/backend/src/modules/preferences/document-analysis/dto/apply-suggestion-v2.input.ts
apps/backend/src/modules/preferences/document-analysis/dto/preference-suggestion.dto.ts
apps/backend/src/modules/preferences/document-analysis/reviewed-suggestion.service.ts
apps/backend/src/modules/preferences/preference/preference-revision.ts
apps/backend/src/modules/preferences/preference/preference.repository.ts
apps/backend/test/integration/reviewed-apply.spec.ts
apps/backend/test/integration/storage-contracts/postgres-unit-of-work.spec.ts
apps/backend/test/local-database/reviewed-apply.spec.ts
apps/backend/test/local-database/unit-of-work.spec.ts
```

### MCP Management Corrections

`/root/plan_security` returned APPROVE for the affected management corrections
only (requested Astra xhigh retained; serving internals unobservable). Three
blocking findings were reproduced with new tests and resolved:

1. SQL projections now bound variable values by bytes including embedded NUL,
   validate numeric storage types/ranges, and bound revoke's returned projection.
2. The final serialized authority response is checked after effective results
   are included; overflow returns the fixed unavailable shape without grants.
3. ALLOW requests wholly outside credential maxima are rejected atomically with
   an explicit `OUTSIDE_MAXIMUM` result. Wildcard authority remains conditional
   on actual targets and sensitivity, using the existing authorization chain.

Reviewed SHA-256 bindings:

- SQLite credential adapter: `83c139d9086f71ffcb0830347bc8b9d67c943ada23afb8a32bcfafda5a9f6a33`
- Management service: `3387d75868152281666c83715dc0c0c0a14e665a9dd09daa614b670fb0b042c8`
- MCP client UI: `6706885c5e4ea7212420e7da29b8e55c6cb807e62cad8a02584eff572273c70a`
- Management tests: `452b87e11ec9c7e61ad566a2c7a6463dc52a6d1c503aa1ca22332dd7aa7c27e0`

Coordinator evidence: management 7/7 and authenticated management Chromium 1/1.
The reviewer inspected source and did not execute tests. New HTTP/bootstrap AI
changes are excluded and undergoing a separate affected review. This is not a
complete implementation approval.

### AI Upload Cancellation Corrections

The affected AI/browser review initially returned CHANGES REQUIRED for two P2
findings: an old cancelled batch could clean up a new batch's shared file map,
and a composite deadline could still publish proposals from an earlier file.
Root reproduced the first with a held File read, then introduced per-batch owned
maps and an explicit composite-signal publication check. The combined browser test
also covers a successful first file followed by a second exceeding the deadline.

`/root/plan_security` returned APPROVE for the affected corrections only:

- LocalDocumentUpload: `86181157e5552edc26a795ac602276f6a322fb234a35e2d9e7218934979d3bc4`
- AiControls: `147c9f3f2d8bf12cf9c553d6187f8495b505689ca0c51e3e053ba05e83a69c10`
- AI browser test: `f749be7e27183839b9df408191025d785338cc8090c25443b08c84afcdc26740`

Requested Astra xhigh retained, serving internals unobservable; read-only review,
root-provided test evidence. Scoped server control, capability, safe failure,
v2 preservation and session-epoch conclusions carry forward. Full-step independent
review remains required.

## Fresh Final Review R1 And R2 Corrections

R1 is bound by [candidate-r1.json](candidate-r1.json): 169 changed/untracked
paths, exact base `5e2a67dd785500ba053b2e836c47166e8adeada8`, aggregate
`8dbc97d819566d95158957dba5b778b76c94e6be42f9c5adef2d602945ca730e`.
Each reviewer independently verified the complete inventory/content/modes. Root
remained the sole writer. No reviewer ran builds or suites; security additionally
ran a bounded, in-memory compressed-PDF probe without repository writes.

| Fresh reviewer | Requested setting | R1 verdict |
| --- | --- | --- |
| `/root/final_architecture` | Astra xhigh | CHANGES REQUIRED: retained query controls and deployed source hardlinks |
| `/root/final_security` | Astra xhigh | CHANGES REQUIRED: retained query controls, new shared-process PDF decompression, missing hostile-browser/RSC proof |
| `/root/final_persistence` | Astra xhigh | APPROVE within persistence/concurrency/recovery mandate; other blockers remain |
| `/root/final_compatibility` | Astra High | CHANGES REQUIRED: delayed MCP change publishes to closed BroadcastChannel |

Dispatches succeeded. Serving model/effort internals are unobservable. In
particular, compatibility was dispatched with a full-history fork, so High is a
request, not a verified override; inheritance may apply. Sensitive reviewers
were requested at the coordinator's xhigh tier. No claim of a verified tier is
made from prompt text alone.

The compatibility reviewer independently approved the exact HTTP transition
`0decd923adc249b1ce70beb38646fff0bce56452d0880f3098ef87cf03a669fb` →
`35d2d14ec3dfbaf79173759aabdcf0d3320e0775c980c50bec0a91922a841ec2`,
including all five declared response-domain additions and the exact union of
113 old/new consumer IDs/paths. Security also approved its auth-contract scope.
Root therefore changed this specific migration record to `reviewed`; neither
approval substitutes for final implementation approval.

R2 corrections and evidence:

- Retained `askVertexAI` now forwards the browser signal/deadline without changing
  its schema or hosted one-argument delegation. A new unit test failed before
  the fix. Real GraphQL/TLS-model fixtures cover successful completion, logout,
  shortened deadlines, concurrent native MCP busy/manual availability and
  settlement without fallback. A model deadline may return a sanitized GraphQL
  error before the outer HTTP timer; neither path publishes generated text.
- Removed the newly introduced shared-process `PDFDocument.load`. Only cheap
  PDF envelope checks remain there; structural document analysis stays behind
  the existing owned parser. A unit regression failed before removal. The real
  child handles the reviewer's 4,406-byte/4 MiB compressed-object fixture with a
  fixed empty/invalid outcome, responsive parent and reaped child. Existing
  deterministic cancellation/deadline/reaping tests remain. Security confirmed
  that unchanged in-process AcroForms are an accepted preexisting boundary,
  not a required broader parser migration; the runbook now states this limit.
- Added actual production Chromium second-origin hostile-page requests, ambient
  browser/MCP cookie replay, blocked preflight/CSRF attempts and unauthorized
  RSC/prefetch canaries for every private route. Targeted test passed.
- Delayed grant and revoke followed by lock both reproduced a closed-channel
  unhandled rejection. Cleanup now nulls the channel, and publication requires
  the current non-aborted request epoch. Both browser regressions passed.
- Real sealed packaging correctly rejected injected workspace files hardlinked
  to source. Deployment now materializes beneath the already owned private root,
  then copies into fresh stage inodes before sealing. The new regression also
  caught an omitted local-ui payload in the sealing routine; it now seals that
  directory as well, verifies read-only copies and unchanged source modes/content.
  The no-shared-inode and complete closure/integrity guards remain enforced.
- Updated the exact packaging subprocess census from eight to nine for the
  already reviewed explicit offline web deployment; no wildcard command allowance.
- Published the plain-HTTP exact-origin replacement-listener/service-worker
  residual. Prior HTTP/GraphQL compatibility, state, authority and E/H limitations
  remain unchanged.

R2 affected reapproval, final aggregate gate and final-head CI remain pending.
Human acceptance remains explicitly pending and is consolidated in
[acceptance.md](acceptance.md).


### R2 Verdicts And R3 Cleanup Correction

R2 [candidate-r2.json](candidate-r2.json) binds 173 paths, aggregate
`77913396ac0bbfb376cadeffc09a5ef01ff08b35c6af8ecc4388fec690ea119f`.
Architecture, security and compatibility independently verified that binding.
Compatibility returned APPROVE for its mandate; security closed all three original
findings and architecture closed both original findings. Their unaffected R1
coverage carries forward.

Architecture found one further P2 cleanup issue and security concurred: the
intermediate deployment's source hardlinks were chmodded by generic recursive
cleanup. Root reproduced this with the actual cleanup function: an external
0644 source became 0600. R3 changes permissions on directories only, preserving
regular-file inodes when unlinking on the supported POSIX hosts. The new actual
cleanup test verifies removal plus unchanged external source bytes and mode;
the complete packaging harness passes 45/45. Aggregate-mode source integrity is
also checked after private-root cleanup, in addition to the existing observation
before cleanup and external caller/store checks afterward. Direct-mode copied
source is removed with its root; original caller inputs remain checked afterward.

R3 affected architecture/security/recovery review is required before the final
gate. Compatibility's R2 product/consumer coverage is unaffected by this cleanup
and status-copy-only delta. Human acceptance remains pending.

### R3 Recovery Finding And R4 Wrapper Corrections

R3 [candidate-r3.json](candidate-r3.json) binds 174 paths, aggregate
`0407805701a73c52abff3f68a3ccd092672e509962f36deb3e2845232eaf8685`.
Persistence independently verified it and approved the inode corrections,
carrying forward R1's unchanged database/CAS/history/grant coverage.

Persistence then found that the outer restart/packaging cleanup could delete
an ancestor of state deliberately retained by the inner UI helper after an
unconfirmed browser reap. Architecture additionally identified that retained
aggregate packaging state was under diagnostics, whose sanitization/private-mode
walk could mutate credentials, binary recovery files or external hardlinks.
These findings kept R3 at CHANGES REQUIRED.

R4 tests the actual enclosing cleanup functions for both wrappers. Missing,
pending or failed local UI owner cleanup (including a retained private-state
record) prevents ancestor removal; successful recorded cleanup allows removal.
The regression failed before the guards. Packaging execution roots now use owned
private temporary allocations outside the diagnostic tree in both modes, with
diagnostics explicitly protected against child placement. A second regression
verifies that diagnostic sanitization cannot rewrite retained recovery content.
No cleanup retries or unowned process signalling were added. Journal failures
remain errors with retained recovery paths. The three affected harness suites
pass 77/77 (2,000 ms), including 46 packaging tests.

The earlier standalone sealed packaging attempt completed both actual
Chromium/relocated generations and all runtime proofs, then correctly failed its
caller-integrity observation because root edited inputs during the run. Receipt:
`context-router-packaging-diagnostics-p3CQVn/summary.json`, status **failed**, not
final proof. All owned resources in that run finished cleanup. The final full
gate will use a frozen candidate, so neither this run nor the earlier unsealed
payload runs are substituted for final sealed evidence.

R4 affected architecture/security/persistence reapproval remains required;
compatibility product/consumer approval from R2 is unchanged. Full final gate,
final-head CI and human acceptance remain pending.

### R4 Final Approvals And R5 Schema Test Pins

All four fresh review mandates are APPROVED for R4, aggregate
`2fa27af053b6f654985a12b62ef7b5e2daad03ed902dd3c0fc81be70073c16c7`
in [candidate-r4.json](candidate-r4.json). Architecture, security and persistence
approved affected recovery corrections and explicitly carried forward unchanged
complete-diff coverage. Compatibility independently verified all 175 paths and
carried its R2 approval through the cleanup-only delta. Each reviewer remained
read-only and distinguished coordinator test execution from independent source
inspection. No blocker remains from these reviews; gate/CI/manual acceptance are
separate requirements.

The first final aggregate attempt failed phase 3 solely on two retained exact
schema-size assertions (14,088 bytes). Their byte-for-byte canonical SDL checks
already passed; the independently reviewed Step 08 schema is 15,714 bytes. R5
updates only those two numeric pins to the changed public schema requirements;
no production/schema bytes or behavioral assertions are changed. The two affected
suites pass 13/13 (4,882 ms). Compatibility affected reapproval is required.

That failed full attempt is retained at
`/private/tmp/step08-final-gate-2w2yh5t0/local-migration-gate-summary.json`:
status failed, elapsed 93,811 ms, base comparison performed against the exact
Step 07 SHA, caller integrity true, owned database removed and administration
cleaned. Contract phase and documentation passed; later phases were not claimed.
A fresh full gate is required on R5. Other R4 approvals remain unaffected by this
schema-test-only and review-evidence delta.

### Final R5 Approval And Gate Result

Compatibility independently verified every R5 path/mode and aggregate
`2a48f8c76f70d75d1e5b247a37858af5ffc2ff9f773a7363fe7188268792f81b`
and returned APPROVE: both numeric pins match the canonical 15,714-byte schema,
byte-for-byte assertions remain, and no product/schema behavior changed.
All four fresh complete-diff mandates are therefore approved through their
explicit affected-review chain. No actionable review finding remains.

The full final R5 gate passed all twelve phases, exact-base comparison, caller
integrity and owned cleanup; see [final evidence](implementation.md#final-local-validation-and-draft-handoff)
and the [sanitized receipt](final-gate-summary.json). Subsequent changes are only
closeout documentation/status and this receipt, without production/test/gate
changes. Final pushed-head CI is a separate PR requirement. Manual acceptance
remains pending and this does not authorize ready-for-review or merge.

### R6 Linux CI Correction

R5 standard CI passed, but dedicated Linux CI failed sealed Chromium startup.
The pinned-binary Linux reproduction and correction are recorded in
[implementation evidence](implementation.md#linux-ci-startup-correction).
R6 affects packaging temporary-path selection and browser startup diagnostics,
readiness and cleanup tests. Architecture, security/recovery and compatibility
require affected reapproval. Persisted application state, history/CAS/grants,
product APIs and their R4/R5 independent coverage are unchanged. The same sole
writer and reviewer allocations remain in effect. The P2 plan is unchanged.


### R6 Affected Approvals And Renewed Gate

All affected reviewers independently verified the 179-path manifest and aggregate
`bad1e63bdafeacda4540a7f299db70c5fa71bf78f308f925fc6502d6804abc71`
in [candidate-r6.json](candidate-r6.json), with no drift and unchanged P2.

| Reviewer | Verdict | Scope and carry-forward |
| --- | --- | --- |
| `/root/final_architecture` | APPROVE | Owned temporary path, packaging closure/sealing, bounded startup, journal/reap and parent-retention invariants; unchanged R4 complete architecture coverage and R5 schema pins |
| `/root/final_security` | APPROVE | Fixed diagnostic categories, bounded transient stderr, no raw forwarding, readiness and owned cleanup/recovery; earlier security findings, auth-contract approval and unchanged full coverage |
| `/root/final_compatibility` | APPROVE | Pinned Linux reproduction, startup diagnostics and five failure/reaping cases, unchanged product interfaces; R4/R5 compatibility/test coverage |

Each reviewer remained read-only, inspected the reproduction and regression source,
and distinguished the coordinator's 102/102 execution evidence from their own
independent source/hash inspection. Requested/observable model settings remain as
recorded above; no serving-tier claim is added. The persistence mandate's R4
application-state/history/CAS/grant approval is unaffected; the harness recovery
delta is covered by the architecture and security/recovery reapprovals.

The renewed full local gate passed all twelve phases with exact-base comparison,
caller integrity and complete owned cleanup; see
[R6 validation](implementation.md#r6-final-local-validation). Post-run manifest
verification found no drift. Only documentation/receipt closeout follows that run.
Final replacement-head CI and actual human acceptance remain distinct requirements;
the PR stays draft and is not authorized for merge.

### R7 MCP CLI Parsing Correction

The R6 dedicated workflow exposed an existing valid-ID parsing defect, reproduced
deterministically before the fix; see
[implementation evidence](implementation.md#issued-mcp-client-id-parsing-correction).
R7 changes only the CLI's normalization of the already-supported ID domain and
adds compiled-process regressions. Security/credential-input and compatibility/test
coverage require affected reapproval. Storage, identity generation, authorization,
browser/harness behavior, architecture and recovery contracts remain unchanged;
their prior complete-review coverage carries forward. No HTTP/schema compatibility
transition or P2 plan change is needed. Root remains the sole repository writer.


### R7 Affected Approvals And Renewed Gate

Both affected reviewers independently verified all 182 paths, modes and hashes
in [candidate-r7.json](candidate-r7.json), aggregate
`7ce78944372cfe56fd8d3c4a475d2285ff6ea060e37edffaf1b4cfe7c4151eb4`.
They confirmed unchanged base/P2, no drift and passing whitespace checks.

- `/root/final_security`: **APPROVE** for credential-input normalization, strict
  parsing/allowlists, downstream validation and unchanged authorization/randomness;
  all previous full-review, finding-closure, recovery and HTTP approvals carry forward.
- `/root/final_compatibility`: **APPROVE** for the existing ID-domain correction,
  compiled regression coverage and preserved interfaces; unchanged complete
  compatibility/test coverage carries forward.

Both reviews were read-only. Build/57-test execution and workflow results are
coordinator evidence, not reviewer reruns. Requested/observable settings remain as
recorded above. Architecture and application persistence/recovery are unchanged
by this parser-only fix and retain their independent approvals.

The R7 full local gate passed 12/12, with performed exact-base comparison,
caller integrity true and no cleanup errors; see
[R7 validation](implementation.md#r7-final-local-validation). Post-gate binding
verification found no drift. Only evidence/receipt closeout follows that run.
Final-head CI and actual human acceptance remain distinct requirements; the PR
stays draft with no authorization to merge.

### R8 Linux Browser State Ownership

R7 standard CI passed; its dedicated workflow exposed browser-created cache mode
violations after the sealed smoke. Non-root pinned Linux reproduction additionally
found a residual Unix socket after group exit. See the
[R8 evidence](implementation.md#linux-browser-state-ownership-correction).
Architecture and security/recovery independently approved the bounded design:
profile HOME, fresh short per-generation TMP children, existing journal record,
strict acquisition/reap/removal ordering and failure retention. Final approval
must bind the implementation candidate; design approval alone is insufficient.

R8 affects harness environment ownership, cleanup evidence and associated tests.
Architecture, security/recovery and compatibility/test reviews require renewal.
The application's persistence/history/CAS/grant semantics, browser authentication,
product interfaces and unchanged complete-diff coverage carry forward explicitly.
P2 and requested/observable role settings remain unchanged; root is the sole writer.

### R8 Affected Approvals And Renewed Gate

All three affected reviewers independently verified the 183-path manifest, modes
and aggregate `ddfb88945f7cbfe1c46332d1766242fa05a7352de03063131902294d62345937`
in [candidate-r8.json](candidate-r8.json), with unchanged P2 and no drift.

| Reviewer | Verdict | Affected scope and carry-forward |
| --- | --- | --- |
| `/root/final_architecture` | APPROVE | HOME/TMP ownership, exclusive acquisition, gated launch, ordered reap/removal, strict lifecycle evidence and inner/outer recovery retention; unchanged complete architecture coverage through R4/R6 and unaffected R7 parser delta |
| `/root/final_security` | APPROVE | Browser-state confinement, refusal to adopt existing paths, journal failure handling and recovery; prior full security/privacy/auth-contract approvals, findings closure and R7 credential-input approval |
| `/root/final_compatibility` | APPROVE | Actual-wrapper HOME regression, real Unix-socket cleanup/failure tests, Linux reproduction and unchanged product assertions/interfaces; prior complete compatibility/test coverage |

Reviews were read-only. The 104-test run and pinned Linux execution are coordinator
evidence; reviewers independently inspected their source/receipts rather than
rerunning builds. Requested/observable role settings remain recorded above.
Application persistence/history/CAS/grant contracts are unchanged; that independent
mandate carries forward, with the harness recovery delta covered by the renewed
architecture and security reviews. No actionable finding remains.

The full R8 local gate passed 12/12 with exact-base comparison, caller integrity
and complete owned cleanup; see [R8 validation](implementation.md#r8-final-local-validation).
Post-gate binding verification found no drift. Only closeout evidence/receipt
updates follow the frozen run. Final-head CI and human acceptance remain separate
requirements; PR #167 stays draft with no authorization to merge.

### P3 Validation Budget Approval Before R9

R8 standard CI passed, but dedicated run `37199274659` passed phases 1–10 and
timed out packaging at its exact 899999 ms effective allowance (exit 124).
No final Linux success is claimed. The previous log's late private-tree failure
and R8 local timing support bounded headroom for the expanded Step 08 workload;
they do not locate the unfinished substage or prove a new budget will pass.

The [P3 plan](plan.md#p3-validation-budget-addendum) is frozen at SHA-256
`365a276bd93b980d3516777bfe6526f698f2df79399bcffb28f48d86390bca0f`.
Before implementation, `/root/final_architecture`, `/root/final_security`, and
`/root/final_compatibility` each independently verified that only the header and
P3 addendum changed from approved P2 and returned **APPROVE** in their affected
dimensions. They approved exact bounded budget arithmetic, unchanged cleanup,
grace and operation limits, finite safe diagnostics, tests-first checkpoints and
renewed full validation. Their reviews were read-only; requested/observable model
settings remain unchanged. P2 application/persistence/auth-contract scope and
unaffected complete-diff review coverage explicitly carry forward. R9 implementation
approval is separate; manual acceptance and final-head CI remain pending.

### R9 Reporting Finding And R10 Correction

Architecture and security independently verified all 185 R9 paths and aggregate
`313a3377e612c1b3e52dbc290752a53269482e0e3ceb1eb7bdcb450226409863`, then returned
**CHANGES REQUIRED** for asynchronous stdout EPIPE bypassing the synchronous catch
and potentially terminating owned cleanup. Compatibility approved the budget/test
delta, but that approval does not waive the reporting blocker. All three otherwise
approved the P3 budget arithmetic, unchanged lifecycle bounds and finite diagnostic
scope. Full R9 validation was deliberately cancelled before source edits; see the
[correction evidence](implementation.md#closed-pipe-reporting-correction).

R10 adds a real default-writer closed-pipe regression before the fix and uses bounded
synchronous descriptor writes under the existing catch. Affected architecture,
security/recovery and compatibility/test review must bind R10. P3 and application
interfaces, persistence/history/CAS/grants and browser authority are unchanged;
their complete-diff independent approvals carry forward. Root remains sole writer.

### R10 Approvals And R11 Deadline Diagnostics

Architecture, security/recovery and compatibility independently verified every R10
path/mode/hash and aggregate
`22388662e6601728cd135308c8f159fbf6900b413c9b567b78abfc4a8f970851`, then each returned
**APPROVE**. The synchronous reporter and real closed-pipe test close the R9 blocker;
P3 budget arithmetic and unchanged complete-diff coverage carry forward. Architecture
also independently reproduced raw/Console failures and synchronous-writer cleanup
success with bounded disposable Node children before the frozen review. Other
behavioral runs were coordinator evidence; reviews were read-only.

R10's subsequent full gate failed a generic source-browser deadline; complete owned
cleanup and caller integrity passed. Architecture independently confirmed that the
retained evidence cannot identify the expired wait and recommended fixed labels
before any shutdown or budget change. R11 makes that diagnostics-only change and
adds the corresponding privacy/deadline regression. The focused source smoke passed
internally, with an independently recorded outer receipt-path configuration error;
the earlier deadline cause remains unconfirmed. See
[R11 evidence](implementation.md#r10-source-deadline-and-r11-diagnostic-follow-up).
Final affected review and full-gate success remain required. P3, all operation
deadlines, product behavior, application persistence and complete unaffected review
coverage are unchanged.

### R11 Affected Approvals And Renewed Full Gate

All three reviewers independently verified the complete 187-path R11 inventory,
modes and aggregate `03102086f9c363c414cb9ce3200ead2b936f123b47201a370d70aacea58763ea`,
with unchanged P3 and no drift, and returned **APPROVE**:

- `/root/final_architecture`: diagnostics-only change preserves waits, assertions
  and cleanup; R10 and unchanged complete architecture/application coverage carry forward.
- `/root/final_security`: closed stage allowlist prevents private input entering
  deadline text; R10 and complete security/auth-contract/state/recovery coverage carry forward.
- `/root/final_compatibility`: regression covers every stage, fallback and original
  error identity; R10 and unchanged complete compatibility/test coverage carry forward.

Reviews were read-only and inspected coordinator test evidence. They independently
checked the focused source pass and outer receipt-path failure without presenting
either as full acceptance or a root-cause fix. Requested/observable model settings
remain as recorded. Application persistence/history/CAS/grants remain unchanged;
their independent complete-review approval carries forward.

The subsequent frozen R11 full gate passed all 12 phases with exact-base comparison,
caller integrity and complete owned cleanup; see
[final validation](implementation.md#r11-final-local-validation). Post-gate binding
verification found no drift. Only evidence/receipt closeout follows. All four
implementation mandates are approved through the recorded affected-review chain;
final-head CI and actual human acceptance remain separate requirements. PR #167
stays draft; Steps 09–11 remain inactive, with no authorization to merge.

### External Review And R12 Correction Design

External review of `84cad4a` found F1 (chunked body-limit bypass), F2 (legacy
rich-text extraction regression), and F3 (lost grant/revoke outcome). All three
are accepted and corrected, along with misleading unlock-capacity feedback.
See [correction evidence](implementation.md#post-review-corrections-r12).

Root remains sole writer. The sensitive boundary changes retain requested Astra
xhigh for root, architecture and security; compatibility retains its prior High
request. Actual serving model/effort settings remain unobservable, not newly
verified. The existing read-only specialists reviewed the focused design:

- `/root/final_security`: **APPROVE**, requiring the own-property parser hook,
  local-only multipart bounds, unknown-value/group preservation and mutation
  ownership tests. Independently inspected pinned Busboy's parts sentinel.
- `/root/final_compatibility`: **APPROVE**, requiring full-pipeline rich-text
  fixtures and both explicit/save-time appearance safeguards, unchanged legacy
  behavior, private-state prompt exclusion and actual browser regressions.
- `/root/final_architecture`: **APPROVE**, including the clarified existing
  manual re-inspection flow, separate read-error/outcome state and exchange-only
  429 guidance. No new framework or public response contract is needed.

These are design approvals, not frozen implementation approval. Renew affected
browser/security, PDF compatibility and application ownership review against R12;
carry forward only unchanged history/persistence/CAS, MCP maximum authority and
lifecycle/gate coverage from the complete-review chain. The full local gate and
both workflows must pass on the corrected candidate/head. Human acceptance and
merge remain human-owned.

### R12 Findings And R13 Submission

R12 ([candidate-r12.json](candidate-r12.json)) binds 192 listed paths to aggregate
`e15131e7503a245e4246f59b4970f179edcfdbf9b79b88bb808ac9a072c5ebfe`. All three
reviewers verified their contents/modes and independently supplemented the
binding with deleted `apps/web/next.config.ts`: 193 rename-independent paths,
complete aggregate
`702f8e75b145d50a8da9916ea9204b4d662d0852b44e76cd27b1742805ba04e5`.
The old file is absent; its base SHA256 is
`351c336afa605a0227c7aa78b142a108788320daf2f4107b840cce17a1861aa9`.
Prior assertions that the default rename-sensitive manifest alone was complete
are corrected by this explicit deletion witness. Historical manifests remain
immutable; the replacement generator enumerates with `--no-renames`.

Architecture and compatibility returned **APPROVE**. Security returned
**CHANGES REQUIRED** solely for the invalid-JSON oversized field test, with no
remaining source blocker. Root cancelled the gate with verified caller integrity
and owned cleanup, then strengthened the input and proved it fails when only the
field-size cap is removed in an isolated process. See
[R13 evidence](implementation.md#r12-review-gap-and-r13-test-correction).
R13 renews the test/inventory review; all unchanged R12 source review and complete
unaffected mandates carry forward. Required full-gate and final-head CI success
are not inferred from the cancelled attempt.

### R13 Approvals And Renewed Full Gate

All three specialists returned **APPROVE** and independently verified the complete
194-path rename-independent inventory, modes, hashes and explicit deletion in
[candidate-r13.json](candidate-r13.json), aggregate
`7dc6c85dec20940243364a7bbdf41965ddb5ba49b5a6530364fbb60f1aac8c55`. Exact base and
P3 hash remain unchanged.

- `/root/final_security`: the valid oversized JSON/control pair plus isolated
  field-size override closes the validation finding. F1–F3 and unlock-feedback
  source approval carry forward from the R12 source review.
- `/root/final_compatibility`: new test isolates the parser bound and directly
  includes the deletion; legacy/v2 PDF behavior, local-only HTTP limits and
  mutation outcome coverage remain approved.
- `/root/final_architecture`: no production change after approved R12; the test
  and inventory correction resolves the remaining proof/bookkeeping issues.

Reviews were read-only and inspected coordinator red/green logs; no reviewer
claimed to have rerun tests/builds. Requested settings and observability limits
remain as recorded. Explicitly carried-forward complete coverage includes shared
application/model ownership, credential separation, GraphQL and legacy HTTP
consumers, storage/history/CAS, MCP maxima, model controls, packaging, lifecycle
cleanup, recovery and P3 budgets. No actionable finding remains.

The subsequent frozen full gate passed all 12 phases, with exact-base comparison,
caller integrity, owned cleanup and zero post-gate binding drift; see
[final validation](implementation.md#r13-final-local-validation). Post-gate edits
are limited to evidence and the receipt. Replacement-head CI and actual human
acceptance are separate requirements. PR #167 remains draft and human-owned.

### Documentation Closeout Review After User Acceptance

The operator authorized acceptance closeout and a small deferred UI follow-up,
including publication on existing draft PR #167 and final-head CI verification.
Root remained sole writer. A fresh read-only reviewer,
`/root/closeout_review`, requested Astra High for this bounded documentation and
evidence review; actual serving model/effort was not independently observable.

The reviewer returned **APPROVE** on the frozen documentation delta over
`40ef8fd84e8880cbc0539a3260ab24a693b6696a`: eight modified Markdown files and the
new `docs/plans/active/ui-usability/README.md`. It independently checked all
194 R13 entries, finding no runtime/test/configuration/dependency/workflow drift;
the historical receipt and documentation updates remain evidence changes.
Acceptance correctly separates observed outcomes, operator confirmations and
accepted unverified observations. Authority, sensitive-history masking, truthful
mutation outcomes, E/H limits, draft status and later-step inactivity are retained.
The follow-up has a bounded scope, owner and trigger; no secrets were found.

Reviewer checks passed: `git diff --check` and all 169 Markdown files' links.
Coordinator documentation-validator tests passed 20/20 on Node 24.21.0.
This review entry and its evidence pointer are the only additions after that
review. R13's complete implementation approvals and 12-phase local gate carry
forward for unchanged runtime inputs; no new local full-gate claim is made.
Both workflows must still be verified on the final pushed documentation head,
with results recorded in the PR checks/description. This does not authorize
ready/merge or activate Step 09.
