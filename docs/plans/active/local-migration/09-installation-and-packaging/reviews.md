# Step 09 Independent Review Ledger

- Current plan revision: P2.3; all named dimensions approved for implementation
- Product implementation: starting with failing managed-admission tests
- Sole writer: `/root`; all other agents read-only
- Last updated: 2026-10-06

## Inventory And Settings

The user requested coordinator GPT-6 Astra Extra High. The current serving
model/effort is not independently exposed, so that setting is recorded as
requested, not verified. Each child dispatch below explicitly requested its
model/effort with a fresh context; dispatch acceptance does not verify serving
internals. No model fallback has been silently assumed.

| Agent | Requested | Mandate | Observable limitation |
| --- | --- | --- | --- |
| `/root` | `gpt-6-astra`, `xhigh` | Coordinator and sole writer of all repository files, tests, generated output, Git and PR | Serving settings unobservable |
| `/root/packaging_inventory` | `gpt-6-astra`, `high` | Production closure/platform inventory; separate acceptance/compatibility inventory; provenance and certificate metadata | Explicit dispatch accepted; serving internals unobservable |
| `/root/lifecycle_inventory` | `gpt-6-astra`, `xhigh` | Browser authority, model admission and exact process-ownership inventory | Explicit dispatch accepted; serving internals unobservable |
| `/root/recovery_inventory` | `gpt-6-astra`, `xhigh` | Persistent roots, matching-pair backup/restore, interrupted updates and recovery inventory | Explicit dispatch accepted; serving internals unobservable |

All investigators made no edits, builds, tests, native executable experiments,
downloads, Git changes or personal configuration changes. The available agent
capacity initially rejected a fourth investigator, so the High investigator
received the separate acceptance mandate after completing packaging inventory.
Inventory observations are inputs, not technical-plan or release approvals.

## Plan Reviews

| Revision | Reviewer and named dimensions | Findings/disposition | Verdict |
| --- | --- | --- | --- |
| P1, SHA-256 `af7a18bf75989db450d0a6fd068b246e5f8e9994fa6785d15cce58ad336ca973` | Fresh `/root/plan_architecture_security`, requested Astra `xhigh`; dispatch accepted, serving internals unobservable | No blockers; preserves shared owner, separate credentials, admission, irreversible claims and fail-closed uncertainty. Native selected-model and concrete P2 mechanisms remain gates. | Approved for bounded checkpoint 1 only |
| Same P1 | Fresh `/root/plan_persistence_recovery`, requested Astra `xhigh`; dispatch accepted, serving internals unobservable | No blockers; matching-pair, post-identity initialization failure, explicit restore authority and code/data separation preserved. P2 obligations below. | Approved for bounded checkpoint 1 only |
| Same P1 | Fresh `/root/plan_compatibility_platform`, requested Astra `high`; dispatch accepted, serving internals unobservable | No blockers. Preserves six modes/twelve phases and consumer contracts; source isolation requires more than PATH, exact CI discovery and native scoped deferral remain P2 gates. | Approved for bounded checkpoint 1 only |

P1's review boundary is the full plan with a bounded executable checkpoint 1.
The recorded hash binds its reviewed technical text before root updated the
approval/status metadata. Only those editorial status lines changed afterward;
the technical scope and checkpoint bounds are unchanged.
Passing that review permits only its enumerated probes. Broad implementation
requires measured selection evidence and an approved P2 revision. Material
changes renew affected review; unrelated approvals can carry only with an
explicit impact assessment. Final implementation review must be fresh,
independent and cover the entire frozen base-to-candidate diff.

## Obligations Carried Into Measured Selection And P2

The persistence reviewer explicitly requires these before implementation approval:

1. Enumerate durable generation states/crash points. Uncertain state precedes
   child admission; clean completion follows observed exits. Partial, missing
   or corrupt metadata and crashes during cleanup remain fail-closed; lock
   availability is not proof of old-operation quiescence.
2. Define every actor in maintenance exclusion, including installed CLI and
   preserved source/manual commands. SQLite locking alone does not prove all
   original administrators stopped/reaped.
3. Define restore destination selection and explicit cutover with listeners
   stopped. Exercise restored revoked/rotated MCP authority and grants, not
   merely byte/principal matching.
4. Establish update authenticity, compatibility/security-floor authority and
   enforcement order before accepting distribution. Checks precede every
   version-specific persistent mutation, including initialize/seed/upgrade.

The architecture reviewer also found stale Step 08 status in LOCAL_UI and the
acceptance introduction; root reconciled those descriptions without changing
acceptance results or P1 technical content. Plan links and diff checks passed.

The compatibility reviewer requires exact child source/toolchain isolation,
actual custom-server UI/MCP/SQLite/PDF/CLI evidence, named test commands plus CI
discovery (current native tests cannot be assumed to run on Ubuntu), explicit
native Windows/Linux results or scoped deferral, and fresh installed evidence
rather than reusing Step 08's accepted unverified observations. These remain P2
and installed-product evidence gates. All three reviewers independently verified
P1's SHA-256 and made no writes or executable experiments.

## Checkpoint 1 Probe Reviews

See [measured evidence](feasibility.md) for exact file/payload bindings, red/green
results and limitations. Architecture/security reviewer approved the initial
three-file native fixture implementation as synthetic probe evidence only.
Compatibility reviewer approved the exact acquired certificate closure for
isolated generation/TLS/claim tests. Both reviewers remained read-only. Neither
approval authorizes product adoption or substitutes for actual native model,
installed recovery, platform or signing evidence.

## Proposed Native Proof P1-N.1

The first security/process review requested changes: cancellation during setup
could still launch inference, memory failure could write after control EOF, and
cleanup was outside the advertised time bound. Root wrote failing deterministic
tests and added a shared stop controller with a monotonic budget and cleanup
reserve. Re-review required monotonic per-stage timing and rejection of a health
response received after its readiness deadline; root corrected both.

Architecture/security reviewer explicitly approved P1-N.1 for presentation to
the user for separate execution approval, with all blockers resolved:

| Input | SHA-256 |
| --- | --- |
| `native-probe.md` proposal | `bea1d9f653262be22dd4714f80869cff38a18e2e6c3199cb6de3b58f5e7949a1` |
| `native-measurement.mjs` | `1aba588abde72477a3633af94f3b5a42924b7a4e571d4e4e17e17d7edac23d18` |
| `native-control.mjs` | `e6b801f471ebe265c9a31913fd8d902de3afdea44c732a7092a00b7995eda0a2` |
| `native-control.test.mjs` | `509aab104f4ee00bd25d493f6e9b374822b9b807f6d62d937f70bd696f4f2e09` |
| `native-owner-probe.c` | `bf15bf86da0f77f281e0c265fffb0fed4acaad3c06ea1a1aa77038a73db089ba` |
| `native-owner.test.mjs` | `d00a1097ad3f1c5a2851ebdd537555a1b7ff18f4345e2da772dee4b67b83cf5b` |
| `certificate-generator.mjs` | `5927a60206b130b477bd26efb843cd2602e0e5f9538ef8ff7b2dfcbe72a31c2b` |

Root requested explicit user approval for the exact two-session/two-completion,
six-minute cached-asset experiment and scoped native Windows/Linux qualification
deferral. On 2026-10-06 the user replied **“approve both”** to those two requests.
This authorizes one P1-N.1 command within the fixed reviewed limits and defers
native Windows/Linux product qualification for the Apple Silicon pilot. Neither
platform may be represented as supported. It does not extend native execution
limits or authorize a release, personal installation or public distribution.
The frozen proposal above retains its pre-approval wording for hash binding;
this ledger records the subsequent approval. No live execution had occurred
when this approval was recorded. Signing identity and private release destination
remain missing inputs and distribution limitations.

## Native Proof Preflight Failure And P1-N.2 Review

P1-N.1 stopped before certificate closure import or any native model launch:
`sessions: []`, `cleanupErrors: []`, 5.023 seconds. Its failed receipt is retained
under private root `context-router-step09-native-6YirQd`; see the
[evidence](feasibility.md#native-proof-preflight-failure-before-model-execution).

The compatibility reviewer independently established a sorting-only discrepancy:
the exact same 814 files / 2,266,576 bytes reproduce the original reviewed hash
under Python Path component ordering and the runner's actual hash under full-path
string ordering. Receipt and generator remain unchanged. Root corrected the
expected pin, documented its ordering, and changed only the revision and approval
guard. A read-only Node closure check passed without package imports or model
starts. Syntax, 177-file Markdown links and diff checks passed.

Architecture/security reviewer independently approved P1-N.2 for presentation
to the user for renewed execution approval, with no blocking findings:

| Input | SHA-256 |
| --- | --- |
| `native-probe.md` P1-N.2 | `21c61e12204afe176dc9301784c372bd654a84e0b586a536ebc61d5d093c4a6c` |
| `native-measurement.mjs` P1-N.2 | `10a879107166633b51ab4279a94963dfdff9d8e4eb7afee03a9ae55f7eaab144` |

Reversing exactly those changes reconstructs the prior approved runner hash
`1aba588abde72477a3633af94f3b5a42924b7a4e571d4e4e17e17d7edac23d18`.
Control, control tests, native owner, owner tests and generator retain their
approved hashes; affected review explicitly carries their approval forward.
All lifecycle, resource, time and privacy bounds are unchanged. The frozen
proposal retains its pre-review status line; this ledger records the verdict.
The reviewer performed reads/hashing only. Requested Astra/xhigh remains
unobservable beyond accepted dispatch.

The user subsequently instructed **“could you approve all of those items and
implement it?”** This supplies renewed execution approval for the concrete
reviewed P1-N.2 proposal and authorizes continuing implementation and bounded
installed-app qualification. Root will define and independently review those
later bounds before execution; this does not authorize unbounded experimentation.
The P1-N.1 failure remains preserved. The Windows/Linux deferral remains in force.
Actual signing credentials/access and private release destination cannot be
supplied by an approval statement; their evidence remains missing. Root cannot
perform the user's human acceptance or assert it passed. The requested outcome
remains one draft PR, with no automatic merge or public release.

## Node Signature Probe P1-V.1

The compatibility reviewer rejected the initial plan's circular use of staged
target Node as its own verifier. Root changed it to the established trusted host
Node and renewed review. P1-V.1 was explicitly approved, followed by actual
43-file payload inspection before any import. No other package/dependency was
installed, and no GPG/personal configuration changed.

| Approved input | SHA-256 |
| --- | --- |
| P1-V.1 plan | `fda0d25dcdca3607a2a69e20f04d2acd4f63c2277b89ab23d52794cae75ae964` |
| Private acquisition receipt | `5b7349dde7016c7a2f58bcfc9fa89f3f071a3f91e6a359abcfe6fcd312a630bd` |
| Package file aggregate | `790d7fcc974b20537c36db113d4ae415d51b466254818237f55b6d9e66019da5` |
| Node ESM entry | `9274be7afb7fe902c39acb686066c379874e8a444b7d10fea3f5eab60596f95e` |
| Acquisition script | `33c518957310404193b6f462063c8e10277904de2ea4eeb55e14f87162fc8374` |

Aggregate construction hashes sorted `package/`-relative-to-temp-root paths,
NUL and binary file SHA-256, with no additional separator. The actual signature,
tamper, fingerprint and process/network-denial tests subsequently passed; see
[evidence](feasibility.md#node-archive-signature-verification). This closes the
Node archive proof only, not application signing/distribution acceptance.

## P2 Measured Selection And Implementation Approval

P1-N.2 passed after renewed user approval: two fresh sessions/completions in
33.394 seconds, selected native FD retention and exact cleanup, no errors.
Receipt SHA-256 `e712a01190edc7c3fd9e3f0367c8ce9fd727aab66f70f253a81f3ec5ec98adc5`.
The P1-N.1 failure is retained. Broad implementation waited for the following
independent plan reviews; no product files were changed before these approvals.

| Revision | Finding/disposition | Independent approval |
| --- | --- | --- |
| P2 `05879eb1374fb2ba8d1c15245f2840c0da9f0f2dfdb31f5f58478e8b141aa7f0` | Measured native/AppKit/production closure selection; finite prepare, one application/model owner, role capability, exact shutdown and uncertainty | Architecture/security approved; persistence requested retained SQLite intrinsic-recovery exception |
| P2.1 `f0bab47a96cb7711000c74e7254ce99176163bd98b7a0e81bb68da6fce36dec1` | Package/management/floor before state access, filesystem before native open, exact schema/target before application mutation with intrinsic hot-journal exception; valid v1 setup resume explicitly upgrades | Persistence approved; architecture/security approval carried forward |
| P2.2 `4e2226af53bf5aafd5fef422e11e34a50d14abbd41dbd5c38a29b7ef46f4eca3` | Concrete desktop commands, existing gate phase/allowlist/matrix, Darwin arm64 job/filter prerequisites and fixture/local-artifact evidence split | Architecture and persistence approvals carried forward; compatibility requested native registry discovery coverage |
| P2.3 `44927f62ffc256f634eda99200fc9b349eaf49ba843764452ea440de0d2e5b54` | Explicit desktop package/reference/outbound roots, native extensions/sink tripwires and negative discovery tests | All named dimensions approved; no remaining blockers |

Final P2.3 mandates: `/root/plan_architecture_security` approves architecture,
scope, measured selection, process ownership, security, credentials and privacy;
`/root/p2_persistence_review` approves initialization, persistence, backup/restore,
updates and recovery; `/root/recovery_inventory` approves critical compatibility,
testing, platform and scope evidence. All requested Astra `xhigh`, with accepted
dispatch but serving internals unobservable. Three attempts to dispatch a separate
Astra `high` compatibility reviewer were rejected by agent-thread capacity; root
reused the existing Extra High reviewer for the cross-cutting process/storage test
mandate. This is not a claim that a separate High review ran. Earlier P1 ordinary
High inventory remains factual input only.

Each reviewer independently verified hashes and carried forward only explicitly
unaffected coverage. All remained read-only. Root subsequently changed only P2.3's
status line to approved; its reviewed technical text remains unchanged. The planned
[consumer map](consumers.md) was captured before product edits; actual paths and
fingerprints must land with code. These approvals do not substitute for final
full-diff review, actual installed qualification, exact-head CI or human acceptance.

## Checkpoint 2 Incremental Implementation Reviews

The read-only persistence reviewer `/root/p2_persistence_review` approved managed
storage admission after purpose-guard, observable rollback/worker-exit and uncertain
fixture-cleanup findings were corrected. Reviewed 14-file aggregate SHA-256:
`440e3987b1d02e4dbc2fb5a3796bcc7e28b9d3e4c0be5401bd4bfc093be01f55`
(sorted relative path + NUL + binary file digest). Admission-file binding at that
storage review: `e42fa11908c14fe6495c72d26ad290548381bdd5f738588d181a369fa1ac592d`.
Root reported 26 native and 183 targeted backend tests green; reviewer did not execute.
Approval assumes the trusted guardian path and excludes guardian/control/menu.

The read-only architecture/security reviewer `/root/plan_architecture_security`
approved the next readiness/model-revocation/PDF increment after three corrections:
all main-thread authority failures abort model work, every worker-establishment
failure notifies the supplied validated shared flag, and the parser's drain promise
does not retain completed document results. Missing/malformed-journal active-model
fixtures failed before the fix and passed after it. Current approval bindings:

| Source | SHA-256 |
| --- | --- |
| `managed-admission.ts` | `1f511e8f63eaa132ef45e2f86e26cef9aee0afd09d6ecc522067c8d1e6de8512` |
| `managed-readiness.mjs` | `7e3bf18468e7faaadc1c7d9fae92c131db6a7ddd720af3af9fc7bdd2b33b263b` |
| `manual-session.mjs` | `20d4444546aa6cb67249e70771c8270c372b1a4238c0a461f7a9b550671fb68a` |
| `local-model.service.ts` | `d6ef3e56c8b3599636192e2a6cc9a7a8964ec543a30335f7cf83b3fc0ed5b14b` |
| `pdf-process.mjs` | `07dfee7e06b83e6f313a7e9155328a051036078b40d562c2b76663321ca8faa8` |

Root subsequently completed the full ten-test PDF rerun successfully. Both roles
requested Astra `xhigh`; serving settings remain unobservable. These are incremental
reviews; neither substitutes for fresh independent final full-diff review.

### Native integration, installed CLI and download follow-up

Read-only architecture/security approved runtime control, native guardian and
later menu/download corrections. Persistence approved the named recovery delta
at eight-file aggregate `433513a8b048ab20527eaf4c2aa02a059680f0378c807ae11bf2f170c5649c8f`;
native guardian's earlier seven-file binding was
`11242512944cf28e8198833800bf8e8294842888e797059ffbc8aaff737118cc`.
The affected maintenance/download/diagnostics approval from
`/root/p2_persistence_review` binds its fourteen files to
`5810addf498b2c96a1e0f10b3f34700a422a12783eba00846731556b5ec0b55e`
(sorted relative path + NUL + binary file SHA-256). EOF acknowledgment failure,
reaped downloader descriptor release, required offline-prepare entrypoint and
pre-Node FD4 isolation were corrected and tested. The reviewer inspected the
passing actual installed receipt and empty cleanup list; it did not execute tests.

`/root/plan_architecture_security` approved menu sleep-notification ordering,
post-launch exit observation, duplicate cancel coalescing and download transport
cleanup. Binding before subsequent status/port changes: menu
`ab6373b94c0e6f4c1b4bf97cc3c688832785d21cb707561c73baf1f854ed19c0`,
process `97b5bf62a97ea7a2249d4db46a36b4986e55258076febddc53da397c77900e6e`,
download engine `9520eccd38c8084565ca5e1ce4a4eb49c282c5291e3bda9a1b5a1c82c0edccdc`,
download entry `91648fa8140f2a8bff903cda5be563d75d71723c9984c750d451b3d56bb95a28`,
lifetime `8e3d106fbe378e470479345c1dddfb145c1a5f62d64d79008ed66f5fdcd4e411`.

Affected architecture/security rechecks approved accepting the backend's legitimate
`busy` status, exact model/runtime metadata pins and mandatory `prepare-store.mjs`.
Manifest JS binding `65fe09bab4c6a29d0a12d423e6512fa6aa6e20d36910dccdfd4d18b15984a516`;
native package `ab550f1ead0cd70fea3c6f7aa24af004bf0d4c4eb5225642170d63c3d8e14b3c`.
The busy regression reproduced erroneous shutdown before correction, then passed.

The same reviewer approved the narrow fixed-MCP-port clarification before its
implementation and the resulting code afterward: menu
`36f6f4a10d8cd06c2f062b85a838ef3554897679854ff2e31ab4faba1f30ba26`,
supervisor `8ca826d2d5d0018972ebc414f59e3c4b62a4603a0c32c9c201898cdb919185c5`.
Requested nonzero ports are probed with SO_REUSEADDR before envelope admission;
the probe closes and does not reserve the port. A later race still fails closed.
The test now asserts absence of the whole fresh envelope, unchanged existing
metadata and a still-usable occupying listener. Final installed restart after real
MCP traffic must renew TIME_WAIT evidence against that code.

### Proposed installed live bound

`/root/recovery_inventory` approved the corrected opt-in executable read-only:
`live-installed.mjs` SHA-256
`dd323fa303a33b95371296e88c93f377fb49f88405c956a4e1453a65e02d95e2`;
proposal SHA-256
`9097eecbd74f10e19f1763b91e5711ec8466b0ecf4c0673d281b67c7e33bbf99`.
It accepts legitimate loading status, rejects late protocol failure, binds final
journal generation, memoizes cleanup observation and terminates the harness at
the absolute deadline while preserving uncertainty. The actual public route
enforces 2,048 output tokens, so the original 128-token execution authorization
cannot cover it. No new live execution occurred. The final candidate binding and
explicit expanded-limit user approval remain required by the
[proposal](installed-live-proposal.md). Code review is not execution approval.

These reviewers requested Astra Extra High; serving settings remain unobservable.
All incremental approvals carry forward only unaffected dimensions and do not
substitute for the fresh final complete base-to-candidate review.


## Fresh Final Reviews And Affected Rechecks

Fresh role reviewers `/root/final_architecture`, `/root/final_persistence` and
`/root/final_compatibility` verified the complete 144-file initial snapshot,
aggregate `454abfbffb26efad7ee0daccbc2034398123297abb73e890be4491bc01e89572`.
Their blocking findings were corrected: provider coupling through filesystem
helpers, healthy model-loading presentation, absent-identity bootstrap recovery,
controlled prepare failure versus uncertain exit, installed post-backup authority
coverage, and authenticated non-AI continuity after model invalidation. The
[implementation evidence](implementation.md) preserves tests and failed gates.

Each verified the 147-file R2 snapshot at aggregate
`ce85a1f10326f9e4c734060c5a3da9e3c85ed1dd8931821115553d9bae12f96a` and approved
its affected source dimensions, carrying unaffected complete-diff coverage forward.
Compatibility additionally approved the installed MCP success-shape correction:
`installed-smoke.mjs` SHA-256
`89920048a85203fbe9a7e7e2be53d6387c337ec73344f95a800479a12e069bf8`.
Its updated live-harness binding is
`1cfc136c528207b53eb0da6e328343c52d6fc7e59266ef53bab2d443c05e39c3`, with proposal
`080140af73edf0e7c4857b8f8ecb74b08099231c2f1d7f57c5b805a61a880f0b`.
These supersede the earlier harness bindings only; execution remains separately
bounded and requires the explicit proposed token-limit approval.

The second gate exposed an unmanaged workerData compatibility regression. The
unchanged strict fixture policy remained intact. `/root/final_compatibility`
approved the conditional admission field and new real-worker regression, binding
`sqlite-local-identity-coordination.ts` to
`641a6e4e4c098c872f53cbe4cb7b341a72a5ca773c5cdf20088ad637021aaea1` and
`coordination.spec.ts` to
`b0b77adfadfdefd26fbc4e5518dc6e27dd866a972cb8427d0c0d0e3ac43aae0c`.
Managed authority/revocation and native lifecycle are unchanged. Corresponding
source-model, coordination and real managed-worker tests passed after review.

All fresh reviewers requested Astra Extra High, with actual serving settings
unobservable. Root remains sole writer. Source approval is complete for these
bindings; final artifact qualification, full gate and exact-head CI remain required.


### Candidate 05 Artifact Evidence

`/root/final_persistence` inspected Candidate 05's actual installed smoke and closed
the post-backup authority-restoration finding. Binding: package manifest
`a3f624fb6dacf12e73b0a36a6dfdd0ce41713cf0d58076a5aac221a573f9d6eb`, harness
`89920048a85203fbe9a7e7e2be53d6387c337ec73344f95a800479a12e069bf8`, receipt
`18fd47c308d6f47c737cf3cb580dfaa20850203a6235c9e7c77e7d4c88979f26`.
All five exact guardians exited zero; final journal was matching/quiescent/ok and
cleanup empty. Persistence/recovery approval covers this candidate. Unaffected
architecture and compatibility coverage carries forward.

`/root/final_compatibility` verified the unchanged reviewed live executable and
concrete candidate-binding JSON at
`19b49efdf891c9eefb487bd54b01d64f0663b82bfdf6cf3da55d03354b90d90a` and found it
ready for an explicit user approval request. This is not execution approval.
The final local gate passed on the same copied source inputs as Candidate 05;
exact-head CI and pending acceptance classes remain separate.


Compatibility independently checked all 149 closeout files at aggregate
`158df68d45856997d78a0b746b96ddc25d6222d303d2be9c8fe9302c9d77673d`, including
actual build, installed-smoke and final-gate receipts. It found no evidence or
compatibility blocker. The only non-document delta after R3 is removal of one
trailing ASCII space on `diagnostics.m` line 3: old SHA-256
`8de913e8b4dff4b53208f84709643d460d9aace0de78b285184c980090e212a6`, new
`5aaeaecb3ee91982fc4c2f5e686688172cd9df1cef3a971bf9cc8e2443564f70`.
The reviewer reconstructed the exact prior bytes and approved carry-forward
without repeating the full build/gate for this nonsemantic byte and nine
status/evidence documents. This paragraph and the corresponding explicit
implementation-evidence exception record that verdict; PR-link updates are
bookkeeping. No functional input changed. At this review, live/CI/human checks were unrun;
final pushed-head CI evidence is tracked on PR #168.


### External Review Corrections (2026-10-07)

The user supplied an independent Claude Code review of `1211a20` and authorized
root to implement the agreed corrections. The prior approvals missed lifecycle
cases; they do not override these findings. Root reproduced F1, F2 and a stronger
F4 late-unlock/drain lockout before editing. One cohesive PR remains in use.

- F1: fixed shell output failure dropping child drain evidence. Append/flush
  failure now discards the shell sink permanently while child records continue.
  Diagnostic failure is distinct from malformed application evidence.
- F2: fixed orderly CLI cancellation incorrectly becoming uncertain. Explicit
  quit is distinct from EOF/failure; acknowledgment follows native drain and must
  match actual normal exit without force. SIGHUP is handled. Independent review
  found an additional quit-write/completion race; a deterministic failing fixture
  preceded the narrow lone-quit EPIPE correction. Capability/start failures remain
  fatal, and abnormal/forced exits remain uncertain.
- F3: added executable model-child fixtures for FD3-only inheritance, early exit,
  non-AI control continuity, drain-before-TERM, real bounded KILL escalation and
  the actual application invalidation handler. These do not qualify real llama
  inference or the packaged dynamic-library closure.
- F4: fixed validated stale cancellation and late responses; Quit wins over
  Restart. A late unlock could previously discard a batched drain and block
  relaunch, so root assessed this as P2 rather than the review's P3.
- F5: fixed transient independent lock contention with a 250 ms monotonic bound
  on fresh-descriptor reacquisition. Persistent holders and changed metadata or
  lock identity still refuse and poison the owner.
- F6: added explicit native-only offline download cleanup, strict complete
  preflight, exact two-link publication recovery, revalidation and directory
  synchronization. It cannot clear an active/uncertain journal or overwrite the
  recovery acknowledgment of a non-ready/pending installation.

Read-only review mandates: `/root/review_shutdown_revision` approved F1/F3/F4;
`/root/review_persistence_revision` approved F2/F5;
`/root/final_compatibility` approved F6, documentation and installed-smoke changes.
All requested Astra `xhigh`; serving settings remain unobservable. Root is sole
writer and owns all test execution. These are affected-delta rechecks; unchanged
complete base-to-candidate coverage above carries forward. No blocker remains in
those source mandates. Aggregate of the 28-file correction snapshot before this
ledger/status bookkeeping:
`7c430fbbd7a497a8f9bcd0cfea0ed2447fe2572eee136530ff6700fad971bd91`.

Targeted red/green runs covered the reported failures. A first saturation fixture
exceeded the private protocol's frame bound; pacing corrected the fixture without
weakening that limit. Its claim is output saturation; the existing native queue
fixture separately proves the two-second deadline. The first real rotation fixture
used the wrong operation basename; it was corrected to `identity.operation.json`,
then actual cancellation and named recovery passed. Existing behavioral assertions
were unchanged. The first complete native run passed 148/149 tests in 206.236 s;
the menu fixture failed to link the newly required cleanup compilation unit. Its
compiler source list was updated, with no assertion changes, and the targeted menu
check passed in 1.624 s. A complete-suite rerun will be recorded with final PR evidence.
All 44 portable tests, documentation links and the contract baseline also passed.

Candidate 05 and its gates remain historical evidence. A clean-commit rebuild,
renewed installed smoke (including cleanup), full local gate and exact-head CI are
required for these substantive corrections. Their final receipts and commit/artifact
bindings must be recorded on [PR #168](https://github.com/loyalagents/context-router/pull/168).
Expanded live execution remains separately unapproved; human/signing acceptance
is not satisfied by deterministic fixtures or CI.

### External Re-review Lifecycle Corrections (2026-10-07)

The user authorized fixing the confirmed N1/N2 findings and N3 operator clarity
after root reproduced them against Candidate 06. Before product edits,
`/root/review_shutdown_revision` approved the N1 plan including the menu delivery
race at plan SHA-256
`1cb8ef0a64699a5dbee4fa6795aa5afcfd0fea632764bdb872632bc21f1eaeb1`.
`/root/review_persistence_revision` and `/root/final_compatibility` approved their
N2/N3 mandates at the preceding plan SHA-256
`a6b8e64ee97f88fdadc0635a31e224a82115788ff8e5831d8a9122c3d31b79cd`;
the subsequent refinement concerned menu delivery only. All requested Astra
`xhigh`; serving settings remain unobservable. Root remains sole writer.

N1 separates strict wire validation from ephemeral token availability in the
guardian and menu. Missing leaves are harmless only under a valid pinned export
parent; unsafe existing files still fail. Stop-time records remain validated but
do not read/display tokens. N2 records explicit signal cancellation separately
from quit, EOF and failure; completion still requires native drain and matching
normal exit, with the native maintenance proof unchanged. N3 retains strict
inventories and documents only exact offline owned regular Finder-file removal.

Candidate 06 at `9b9c5ab` completed its rebuilt installed smoke, all twelve local
gate phases and both exact-head CI workflows. The re-review's N4 missing-evidence
claim is therefore stale. Those receipts remain historical evidence after these
new lifecycle changes; renewed revision-bound receipts belong on PR #168.

Affected implementation approvals: `/root/review_shutdown_revision` approved N1,
`/root/review_persistence_revision` approved N2/N3, and `/root/final_compatibility`
approved the shared helper, documentation and compatibility delta. The complete
21-file delta before this evidence bookkeeping had sorted `path NUL sha256 LF`
aggregate `8d5604548a39522d4355053e87cc0cfe6865d5d7826d9372e30fe5a8bffbd4e3`.
Unchanged earlier complete-diff coverage carries forward; no source blocker remains.

Tests preceded product edits and reproduced N1/N2. The first menu fixture needed
the missing `sys/stat.h` include. The first post-fix run exposed test markers
inside the sealed bundle, causing correct package-refusal on relaunch; moving
those fixture markers outside the bundle preserved the package invariant. A
guardian availability check initially landed in the ready branch instead of the
unlock branch; the initial-ready regression caught it and it was corrected.
Then 35/35 targeted checks passed. Independent reviewers identified a scheduling
assumption in the new double-unlock assertion; the corrected test accepts either
valid delivery ordering and checks the final token. Additional actual-application
restart coverage proves later CLI admission. All 50 portable tests, all 179 native
tests (zero skips, 265.195 s), Markdown links and the standalone contract baseline
passed. Clean-commit package/installed smoke, full local gate and exact-head CI receipts
are recorded on PR #168. Earlier failed runs are retained, not replaced by passes.

### CI Saturation Fixture Follow-up (2026-10-07)

At `9e2abbd`, Candidate 07 packaging and its eleven-phase installed non-AI smoke
passed and received independent evidence approval. Standard CI passed seven jobs
but failed the existing saturation test (178/179 native tests): after resuming
stdout at 2.6 seconds, the guardian did not exit by the fixture deadline. A
host-dependent buffer-fill/timer interleaving is the inferred cause, not a measured
buffer size. Root changed only test synchronization: observe exact process `exit`
while output stays paused, fail at fifteen seconds, then resume in `finally` so
`close` can finish. Exact normal exit 1, failed quiescence and relaunch assertions
remain, as do the independent queue/deadline test and all product limits.

`/root/review_shutdown_revision` independently approved the plan and implementation
at test SHA-256 `f83297fed4c312a46f167bcb54a82c4f3d0c42a9a0e61d063ab4b3105e2705f8`.
All eight targeted tests passed (17.159 s), followed by all 179 native tests with
zero skips (261.049 s). Earlier source approvals carry forward.
Root gracefully cancelled the superseded local gate during phase eleven before
tracked edits. Its retained summary records cancellation, caller integrity true
and a SIGINT cleanup/evidence error; the external summary destination had not been
precreated. The canonical retained resource journals show every owned resource
closed/exited/removed, with no recovery required; the exact Docker ID was confirmed
absent. This cancelled run is not a passing gate. Candidate 07 receipts and the CI
failure remain historical. Final native, rebuilt candidate, installed smoke, full
local gate and final-head CI receipts are tracked on PR #168.

### Human Restart Navigation Correction (2026-10-09)

Candidate 08 human testing exposed a stale dashboard tab after Restart: the UI
port is ephemeral, while the menu opened the browser only at initial readiness.
Root remains sole writer. `/root/review_restart_dashboard`, requested Astra
`xhigh` with actual serving settings unobservable, independently approved the
bounded plan and implementation over `15306f15e5823bbb144175f757ab7b0743461813`.
The menu rearms browser opening only on explicit Restart and consumes it at
validated readiness, suppressed during stopping/quitting/broken control. The
confirmation, unlock screen and installed runbook explain fresh login and the
current dashboard address; terminal instructions and 429 retry guidance remain.

The new native regression failed before the production change, then all three
targeted menu tests passed (5.301 s). It captures actual selected origins across
three generations, exact opening counts, failed replacement startup and stopping,
quitting/broken-control negatives without opening the user's browser. A preliminary
fixture compilation failure from a superclass property-name collision was fixed
before recording the expected behavioral failure. The reviewer bound approval to
menu SHA-256 `d4c0cf868949fcbf34ddc9612fe59ddc1a2c5a2bea0fe2bf573f4ffa1bd04094`
and fixture SHA-256 `b4851ba2a831028a9a91c7fb4171e2c77441fa52f6b21a89c851303ad557cae7`.
The web production build passed. Three affected real-browser checks passed
(8.089 s), retaining consumed-token rejection and capacity retry. Their first
sandboxed attempt failed before readiness; the isolated loopback/browser run
outside the sandbox passed without product or assertion changes. Markdown links
and diff whitespace checks passed.

Carry forward unaffected complete-diff coverage for supervisor draining/reaping,
storage/recovery, session authorization, transport contracts, packaging integrity
and model lifecycle. No backend behavior or HTTP contract changed. Rebuilt
candidate, installed smoke, final full gate and exact-head CI evidence belong on
PR #168; Candidate 08 remains historical and the user's running copy is untouched.
Human retest, live-model and signing/platform acceptance remain separate.

### Disconnected Dashboard Correction (2026-10-10)

The user requested a usable current dashboard or an explicitly retired obsolete
tab. Process inspection also confirmed the retest had launched the older `$app`
after staging Candidate 09 separately. Root remains sole writer; the existing
affected reviewer `/root/review_restart_dashboard` (requested Astra `xhigh`, actual
serving settings unobservable) approved the bounded browser-only plan. Connection
failures must be distinguished from HTTP rejection, malformed responses and
storage errors; late failures must respect session epochs. No timeout, discovery,
credential transfer, write retry or programmatic browser close is introduced.

Two new browser regressions failed for the missing disconnected screen before
implementation. An earlier fixture check incorrectly expected exit 0 after
SIGTERM; it was corrected to the source launcher's explicit exit 143 before the
behavioral red run. A fresh production web build and ten focused browser checks
then passed (21.101 s), covering stopped-runtime authenticated/locked tabs,
restoration failure, real session revocation/fresh unlock, delayed failure after
Lock and new login, both 429 cases, normal profile editing, absolute expiry and
late history/grant/revoke responses. The reviewer approved the affected
implementation without blockers, bound to `LocalSession.tsx` SHA-256
`bdb1e01d0ae41b211ed7a043b54b1f533d6893701dab5866936165e496a8a9bf`
and `browser.test.mjs` SHA-256
`457d29d3935263a0822ad3bb820a625510548eb7a4d79f939f5a841dfc7ba151`.
Targeted rebuilt-artifact evidence is recorded with the retest candidate.

Carry forward unaffected native menu/guardian, backend authorization, transport,
storage/recovery, model lifecycle and packaging implementation reviews. The new
browser presentation and epoch changes require renewed affected review. Per the
user's incremental-validation instruction, this is an acceptance-round correction:
full local migration gate, complete installed qualification, final review and
exact-head CI remain pending for the eventual frozen final candidate. Candidate
09's broader passes remain historical for the changed browser inputs.
