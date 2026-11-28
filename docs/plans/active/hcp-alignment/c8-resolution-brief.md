# C8 Protocol Resolution And Context Router Adoption

- Status: dependent CR adaptation to updated spec #49 in progress; spec merge and explicit adoption pending
- Owner: C8 step chat is sole writer in each isolated checkout; the original
  orchestrator `01a1b827-ae7c-7b23-9160-d7b69d0ee2b0` retains sequencing
- Source base: CR `98fe60ffb21c678b0d955a042ccd034db49299dd` (merged C7c #218)
- Verified upstream spec base: `b790561830702c067cd7810c96ee78dd3d84741c`
- Current CR targets: normative Draft 3 `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`;
  adoption materials `b764a058eac15a4cd843892e60473089b2e835bb`
- Parent: [alignment plan](README.md), [questions](spec-questions.md),
  [requirement/evidence matrix](gap-analysis.md), [integration reference](../../../useful/HCP_INTEGRATION.md)

## External Review Follow-up

Lucas authorized three bounded corrections to CR #221 after the independent Claude
review of `01632b4a7c22ff0b66098bd68afdde487d10f6a3`. The C8 coordinator remains sole
writer in the same managed tree. Spec #49 and all adopted pins are unchanged.

- An earlier receipt encoding without the current recovery proof is opaque-denied
  before exact recovery or mismatch disclosure. The key remains consumed; other
  operations and restart remain usable. No old response is reconstructed and no
  store migration/reset is added. Authentication and request-purpose validation
  still precede key lookup.
- Generic HTTP operational failures use `about:blank` 503 with an outcome-neutral
  explanation and no retry instruction. `subject-unavailable` remains reserved for
  its Core encrypted-trust-domain condition. Authorized `idempotency-unresolved`
  retains its own proof, final release checks and `Retry-After`; MCP is unchanged.
- Relationship/proposal references use current read eligibility for the peer,
  including purpose, target narrowing, lifecycle and standing rules across **all**
  its categories. They do not require permission to reveal every stored category.
  A rule change affecting a known peer's read eligibility permanently invalidates
  retained responses for that affected grant, even if the rule is later removed.
  Unrelated grants retain their responses. The stricter predicate for the written
  result is unchanged.

The bounded plan reviewer `c8_three_fix_plan` approved this direction (requested
Astra/xhigh; actual settings unobservable). Three meaningful new regressions cover
an obsolete receipt through restart, unkeyed uncertainty/closed admission, and a
query/get-issued partial-category reference through create/retry/restart followed
by a denial on its withheld category. They failed before source fixes and pass
afterward; existing uncertain-outcome assertions now require the generic type.
Only disposable test fixtures manufacture the earlier receipt encoding, restoring
its exact production immutability trigger before admission.

Fresh read-only reviewers `c8_three_fix_authority` (Astra/xhigh requested) and
`c8_three_fix_adoption` (Astra/high requested; actual settings unobservable for
both) approved the first two corrections and independently found that the partial
peer fix also needed permanent invalidation after a rule was removed. The extended
HTTP regression reproduced the stale 201 after removal/restart. Policy changes now
compare previous/current read eligibility of known grant references, including
purpose and narrowing, and use the existing affected-grant invalidation mechanism.
The regression now denies exact and changed-body recovery of the consumed key,
permits a fresh authorized key, preserves an unrelated grant's cached response,
and verifies no duplicate mutation audit. The broader consumed-precondition
self-supersession question is not changed. Correction rechecks are part of the
final review below; the PR records final commit-bound receipts.

Finalization is one follow-up commit in #221 after focused write and HTTP consumer
checks, fresh independent authority and adoption/testability review, and renewed
exact-candidate Product CI. Prior browser/source evidence is carried forward only
for unchanged presentation, launch and normal-flow behavior; CI renews applicable
coverage. No full local migration gate or installed artifact is selected. Broader
self-supersession recovery, #38 authority, erasure/directive decisions and C9 remain
separate, with their existing owners and data gates.

## Updated #49 Application Plan (2026-11-27)

Lucas authorized continuation of CR #221 before upstream merge. The managed C8
checkout was reattached; existing uncommitted plans and review snapshots are
preserved. CR source starts at `e737a4cfc899c7ecae547a98259b5372d16d271e`.
The implementation candidate is spec #49 at
`be930499c50bea7c8d551f391cb159c01ed1785d`, still open/unmerged when checked;
its exact-head spec CI run `46093275359` passed. The previously recorded CR CI
covers the earlier contract and does not qualify this revision.

The current normative/material pins above remain adopted baselines. Candidate
compatibility, upstream merge and explicit adoption are separate milestones.
The following checkpoints supersede the older implementation directions below,
without rewriting the dated observations and review records.

1. **Named execution purpose.** Require and validate request `purpose` on create,
   revise and soft withdrawal; authorize action/category/target/purpose together.
   Strip that request metadata from stored entries and record it in the existing
   operation audit. Update explicit person review/approval, its purpose selector
   and controlled staged producers. Keep bounded single-purpose read/write grant
   issuance as a declared C9 residual. Preserve provisional revision/withdrawal
   target-purpose and person-correction policies pending #38.
2. **Completion and recovery.** Establish an ordinary or fixed minimal candidate
   at commit under the caller's role and named purpose; record copy disclosure
   only when a content candidate exists. An otherwise authorized create with
   empty future purposes may commit. Context Client completion is exact HTTP 200;
   authorized management representations retain independent management authority.
   Original known completion and later current-authority recovery stay distinct.
   Exact copy-only expiry yields completion; other ineligibility and expired
   mismatches deny. Preserve current affected-grant invalidation, unrelated-grant
   isolation and permanent invalidation through restoration/restart. A withdrawal's
   own deleted transition is consumed, not a reason to reject its exact retry.
3. **Bindings and uncertainty.** Move soft withdrawal to POST
   `/v2/entries/{entryId}/withdrawal`, updating actual callers. Hard deletion stays
   separately unsupported. Use the existing single-owner synchronous SQLite
   transaction/recovery boundary to distinguish confirmed no effect from unresolved
   keyed outcomes. Typed HTTP 503 `idempotency-unresolved` plus `Retry-After` requires
   applicable authority; it cannot leak a key when authority cannot be established.
   No speculative pending-operation journal, new retention service or retry SDK.
4. **Evidence and adoption.** Backend regressions first, focused consumer/browser
   and crash/restart checks at each checkpoint, candidate schema checks on actual
   outputs, then fresh complete-diff authority/privacy/durability and
   architecture/adoption/testability reviews. Keep read MCP descriptors and
   provisional read/error behavior unchanged. After actual upstream merge, verify
   merged content and intervening changes, explicitly update old/new pins and
   consumed schemas, renew affected checks and exact-candidate Product CI. Keep
   #221 draft until adoption and required validation are complete; no automatic merge.

The coordinator is sole writer. Fresh read-only plan reviewers
`c8_updated_authority_plan` and `c8_updated_adoption_plan` were requested as
`gpt-6.2-astra` at `xhigh` and `high`, respectively; the tool accepted those
settings, with actual runtime settings unobservable. Review dispositions and
checkpoint evidence will be recorded here. Full write-only/multi-purpose issuance,
MCP writes/Provider Interop and qualification remain C9. Remaining #38, #2,
#23/#39/D3 and CR-Q9 questions keep their existing owners and data gates.

**Implementation-plan review:** Both new reviewers approved the four checkpoints
before runtime edits, subject to the concrete regressions now in progress. Their
findings added commit-time role-correct candidate selection and copy audit,
historical relationship authority on changed-key conflicts, precise permission
tracking for original replies versus conservative retained-grant invalidation,
semantic no-op policy comparison, and standing rules on management context-write
grants. Newly conflicted Context Client results receive completion; the older
own-quarantine content exception is being removed under the candidate's lifecycle
rule. A person editor may show a simple saved message, while the authorized
Management Client wire result retains its own disclosure authority. The spec does
not settle #38's remaining correction/revision/withdrawal questions.

**Checkpoint evidence:** Three new purpose regressions failed before the source
fix and then passed; the complete 78-test write suite passed at the named-purpose
checkpoint. The actual HTTP person editor exercised required selection, the second
supported purpose, exact approval and audit with no stored purpose extension.
The new POST withdrawal regression failed on the old DELETE behavior and passed
after adaptation, including an exact retry with one withdrawal event. Four new
completion/copy-expiry regressions and six authority/invalidation regressions were
observed failing and then passed after their fixes. The native-commit uncertainty
HTTP regression failed on the old generic mapping and passed with both live and
expired release authority; reopening recovered one mutation/event. These are
iteration receipts, not final complete-diff review or exact-candidate CI evidence.

**Fresh implementation review and corrections:** `c8_new_authority_review`
(Astra/xhigh requested) and `c8_new_adoption_review` (Astra/high requested) reviewed
the full base-to-working candidate read-only; actual model/effort settings were not
exposed. Both verified all 33 files in the first frozen manifest. The adoption
review independently compared all 13 test-only schemas with exact spec `be930499`.
They requested fixes for relationship authority at the last commit/uncertain-result
boundary, file identity on an uncertain native commit, withdrawal extensions,
historical classification on held replies, and overly broad invalidation from
irrelevant directive selectors or old references outside current grant reach.
The new regressions reproduced these failures before source changes. Corrections
preserve credential versus disclosure deadline errors, use a recovery-authority
proof valid in either possible native commit outcome, share the ordinary data-file
identity check, and compare actual candidate/grant scope. A write that itself
supersedes a required peer cannot emit a key-revealing uncertain outcome.

Before those corrections, 91 write tests and 150 HTTP/persistence/consumer tests
passed. Eight new focused repository regressions now pass; the HTTP fault cases
exercise peer expiry, self-supersession and replaced/missing temporary data files.
The latter restore only their own synthetic fixture file before cleanup. All
source work is confined to the managed C8 tree; no retained trial, personal state,
installed app or OS trust changes are involved. Final correction review, browser
checks and exact-candidate Product CI remain pending at this checkpoint.

**Correction recheck:** The next independent pass found an interaction between
historical and current classification: a destination-category directive must also
invalidate a held result. Both scopes are now compared; full-scope equivalent
directives remain equivalent across otherwise harmless recategorization. Two
failing destination-directive regressions and unchanged/no-directive controls cover
this. Three failing HTTP regressions also required known token/peer expiry during
an indeterminate native commit to retain 401/403, and prevented the known-commit
copy-expiry exception from authorizing a typed uncertain outcome. Final uncertainty
release uses one clock sample. A stale browser conflicted-write expectation was
updated from content-bearing 201 to the contract's exact minimal 200; a separate
first-start SIGTERM browser test is being rerun after a failed open. The preceding
local pass had 151 repository and 154 transport tests green; affected evidence is
renewed after these final corrections. Unchanged consumer and historical coverage
is retained, with no broad local migration gate selected.

**Current direction (2026-11-27):** Lucas asked to revise #49 around a small
contract for authorized requests, truthful outcomes and idempotent writes. The
[small-contract plan](spec-49-focused-revision-plan.md) separates HCP's observable
guarantees from provider storage/coordination choices and gives one caller-action
table. It retains the existing eligible result-candidate recovery promise for this
batch, with the two expressly selected exceptions below; changing delivered bodies
or references to optional otherwise is a distinct #34 contract decision.
HTTP 200 minimal completion remains selected. The
authorized correction pass specifies a single HTTP-only 503
`idempotency-unresolved` problem with `Retry-After`, authorized result recovery
after completion-only success, historical JSON-result equality, and the distinction
between at least 24 hours of duplicate protection and shorter copy eligibility.
Lucas subsequently approved completion-only recovery when original copy expiry is
the sole eligibility obstacle, and optional conservative invalidation of retained
results within an affected grant. Current authority, other eligibility checks,
sticky invalidation, release ordering and unrelated grants' recovery remain.
Reference-only outputs, new write-only handles, further policy relaxations and
erasure-marker rules remain deferred. The prior
[nineteen-card guide](spec-49-decision-guide-2026-11-26.md) is historical review
evidence, preserved unchanged. Neither plan is implemented or adopted by the
existing PR heads. On November 27 GitHub reconfirmed spec #49 open/unmerged at
`38d0c73…` and CR #221 draft/open/unmerged at `e737a4c…`.

**Selected-policy plan review (2026-11-27):** Fresh read-only reviewers
`selected_policy_authority` and `selected_policy_adoption` requested
`gpt-6.2-astra` / `xhigh` and `high`, respectively. The tool accepted those
settings; actual runtime settings remain unobservable. Both approved plan SHA-256
`86557953f195fbadb6b2317dce594006b8b976934cd13705380f9deaa9ae57ef`
and the associated brief/question annotations before this receipt was added.
Corrections made the expiry waiver exact-request-only, preserved opaque denial
before conflict on expired mismatches, scoped the revocation-denial wording to
retries and aligned the active adoption checkpoint. All material findings are
closed within their planning remits; implementation and adoption are not verified.

Selected-policy documentation checks passed: Markdown links across 172 files,
tracked/untracked whitespace and all three preserved review-snapshot hashes.
Consumer searches found no affected executable reader. No runtime checks or new
CI qualification were run; the implementation/adoption gates below remain.

**Latest rereview disposition (2026-11-27):** Claude review A (`d2865033…`) and
review B (`91ccef7f…`) both reviewed the preserved
[aaf53bd0 baseline](spec-49-review-baseline-aaf53bd0.md) and recommended approval
with small corrections. B's supplied text ends after its main findings and
placement recommendations. Neither verdict approves every proposed policy change.

The preceding clarification pass accepted bounded key-reuse guidance after confirmed
no-effect attempts, discarding replay-only content at copy expiry, explicit
presented/historical authority checks, the HTTP-only problem-schema distinction,
and comparison caveats. It preserved required invalidation, duplicate protection,
the selected `Retry-After` requirement and the D3 gate.

| Review proposal | Disposition / owner |
| --- | --- |
| A2 / B1: completion after copy expiry | Selected by Lucas on November 27 for the #49 revision: exact currently authorized retry receives fixed HTTP 200 when original copy expiry is the sole obstacle. This supersedes the earlier selected denial in that case. Completion after restoration or other ineligibility remains unselected. C8 protocol/CR owners implement and adopt it. |
| A1 / B2: broader invalidation freedom | Lucas selected the bounded affected-grant option on November 27: a genuine grant or applicable governing-policy change may invalidate all retained candidates for that grant. Mandatory affected-result invalidation, unrelated grants, sticky denial and release ordering remain. Person-wide unrelated invalidation and revival are unselected. C8 protocol/CR owners implement and document the chosen application policy. |
| A3 / B3: reference-only recovery | Keep full eligible results in this batch; #34 owns any replacement guarantee, schema and write-only identifier authority. A favors changing now; B favors deferral. |
| A5: withdrawal keys become MUST | No change to SHOULD; C8 binding owner revisits before claiming universally recoverable withdrawal. Known support can justify retry; unknown support cannot. This is a new provider obligation, not wording. |
| A4: a Core error on create, revise or withdraw establishes no effect for that attempt | Not adopted as a blanket claim for those operations; C8 Core/binding owner must resolve uncertain-outcome handling across bindings before any such guarantee. The narrow confirmed-no-effect key-reuse case is clarified. |
| B4: remove the post-erasure retry-suppression promise | Not adopted as wording; #23/#39 retain the no-resurrection objective, retention decision and combined-capability gate. No marker permission or fingerprint-retention exception is introduced. |
| B5: authorize only the presented request before non-content replies | Not adopted: it changes the historical-information boundary on mismatches. The existing two authority requirements are made explicit without prescribing internal stages. |

Read-only `rereview_scope_check` and fresh complete-diff reviewer
`rereview_small_diff` requested `gpt-6.2-astra` / `xhigh` and `high`, respectively;
the tool accepted these settings, with actual runtime settings unobservable. Both
approved plan SHA-256
`db38f60fd6862802eb820a6dfae14c392615df129d2d6c6d25ebb8239def28bd`
and the associated brief and exact review snapshot. The adoption review's sole
attribution correction limits A4 to create, revise and withdraw, as supplied;
that correction and this receipt were added after review. No behavior change or
implementation, CI or adoption approval is claimed.

For this rereview clarification pass, Markdown links passed across 172 files;
tracked/untracked whitespace and all three preserved review-snapshot hashes
passed. Consumer searches found no affected executable reader. No runtime tests
or new CI were run; publication and implementation retain their applicable gates.

**First correction-pass review (2026-11-27):** Fresh read-only reviewers
`doc_pass_authority` and `doc_pass_adoption` requested `gpt-6.2-astra` / `xhigh`
and `high`, respectively. The tool accepted the settings; actual runtime settings
remain unobservable. Both approved the corrected plan at SHA-256
`aaf53bd0b441450f379b51041453c0d5941e5318db804ce43bbd7432becbcaa7`.
The caller table now requires known idempotency support after minimal success;
the acceptance checkpoint checks original status and historical JSON values;
and the proposed random/non-content-derived key requirement is explicitly deferred
to #23/#39. Both reviewers also checked the associated question annotation,
baseline snapshot and brief before this receipt was added. All findings are closed
within their planning remits; this is not implementation, CI or adoption approval.

For this documentation pass, Markdown links passed across 171 files; tracked and
untracked whitespace and both preserved review-snapshot hashes passed. Consumer
searches found documentation links and no executable reader requiring additional
tests. Runtime checks and new CI qualification were not run; implementation and
publication retain their applicable exact-candidate validation requirements.

The earlier read-only `small_contract_authority` and `small_contract_adoption`
reviewers requested Astra/xhigh and Astra/high, respectively. The tool accepted
these settings; actual runtime settings are unobservable. They closed material
findings on their earlier planning candidate. Links (170 files), whitespace and
historical-guide integrity passed before this correction pass. Those receipts do
not approve the subsequent corrections. No runtime change, new target adoption or
renewed implementation CI is claimed. The review records below distinguish the
proposal versions and candidates.
Read-only research `independent_protocol_examples` requested Astra/high. Fresh
plan reviewers `focused_plan_authority_review` and `focused_plan_adoption_review`
requested Astra/xhigh and Astra/high respectively; explicit `gpt-6.2-astra`
settings were accepted by the tool, with actual runtime settings unobservable.
Their initial findings refined first-response versus retry behavior, final authority
checks for every revealing retry response, inactive-entry exceptions, erasure
boundaries, client retry instructions and scoped acceptance. Review of the corrected
planning candidate is separate from later implementation approval.

For the November 26 decision guide, fresh read-only advice `revision_options_advice`
requested Astra/xhigh and attribution/scope review `revised_guide_review` requested
Astra/high. The tool accepted those settings; actual runtime settings remain
unobservable. The initial Claude attachment pair (`abad20f2…` and `4da5e435…`)
reviewed the preserved earlier proposal `ba125cd0…`. The first small-contract pair (`1de08229…`
and `d5c8d650…`) both verified the [small-contract baseline](spec-49-small-contract-review-baseline.md)
`e8259bb0…`. They also report reviewing the intervening nineteen-card guide
`e812ee7b…`; those intervening Claude reviews were not separately supplied here.
The guide labels agreement, disagreement and the
remaining decisions without treating review recommendations as user approval.
The fresh attribution/scope reviewer closed all material findings after corrections
to recovery authority, key namespace/binding, crash-uncertainty mapping and review
attributions. It found no remaining material contradictions in the guide or its
assigned checks; this is not runtime, spec-implementation or adoption approval.

## Ownership And Boundaries

The app could not attach the completed C7c checkout because another chat still
owned its registration. After Lucas confirmed C7c was merged, C8 created a fresh
managed CR checkout at `/Users/lucasnovak/.codex/worktrees/hcp-c8-adoption/context-router`,
branch `codex/hcp-c8-adoption`. The separately managed spec checkout is
`/Users/lucasnovak/.codex/worktrees/hcp-c8-contracts/hcp-spec`, branch
`codex/hcp-c8-completion-replay`. Both began clean at the verified upstream bases.
The original CR checkout, completed C7c branch, separately owned encryption branch,
retained C6/C7b roots, installed app, models, personal data and client settings are
outside this work. No live host/model run, reset, release or automatic merge.

This is sensitive cross-repository authority and durability work. Requested
coordinator/writer: Astra/xhigh. Read-only investigators/plan reviewers
`c8_authority_plan` and `c8_adoption_plan` requested `gpt-6.2-astra`/`xhigh`;
the tool accepted those settings, but actual runtime model/effort is not independently
observable. Fresh agents review completed implementation. One writer owns each
worktree; reviewers do not mutate files or shared test resources.

C8 delivers protocol resolution and explicit application adoption. C9 retains
remaining mandatory capabilities and complete binding/profile qualification,
including §18.3 Provider Interop for independent hosts. Withholding a conformance
claim or using a local bridge does not satisfy that requirement. D3 erasure must
be resolved **and implemented before any personal-data extension**; CR-Q9 must be
resolved and adopted before sensitive real data. No historical experiment result
is rewritten as if these later resolutions were available at first adoption.

## Upstream Reconciliation (2026-11-25)

GitHub issue fetches verified all 41 current non-PR issues open, including every
published local question. Searches found only PRs #1, #18, #20, #27, #30, #31 and
#32; none implements the priority normative fixes. `main` remains `b790561…`.
The relevant normative section sources and schemas are unchanged from the CR pin;
intervening changes concern reviewer materials, introduction, guide/roadmap notes,
and checks. Search results omitted state; individual issue fetches supplied it.
Submitted, merged and adopted remain separate statuses.

| Batch / question | Current concrete behavior and disposition | Owner / revisit |
| --- | --- | --- |
| A: #36 / #34 | Known committed writes use a minimal original-channel acknowledgement; later requests require current authority, with permanently invalidated response candidates and retained duplicate protection. Propose one coordinated spec fix and explicit CR adoption. | C8 sole writer now; first implementation batch after plan review. |
| B: CR-Q8 | Omission expands the grant's purpose-approved categories; any later standing-rule denial rejects the whole query. Explicit allowed-only queries can succeed; `[]` is empty success; an entry with any denied category stays withheld. Lucas selected retaining this behavior on November 25. Clarify the ordering, omission versus empty, and safe error distinction. | C8; owning Core text/examples then HTTP/MCP consumer evidence. |
| B: CR-Q7 | Existing query/get use role-restricted schemas and identical structured/JSON text values. Complete public six-tool descriptors and checked success/empty/error examples are absent. Resolve JSON error text and MCP `{}` no-result mapping, preserving Core extension/profile points. | C8; freeze write descriptors after #36/#38. CR continues to advertise only implemented tools; full binding runtime remains C9. |
| C: #38 / CR-Q11 | Exact person corrections bypass the old asserter's purpose veto under separately reviewed authority; principal restrictions and response disclosure remain. Lucas selected a required explicit current purpose for every write and an otherwise-authorized person's ability to save a new assertion with no permitted future purpose, receiving completion only. | C8; choices selected November 25, then independent plan review, owning Core/bindings/schemas and tests-first CR adaptation. Not implemented or adopted by A. |
| CR-Q1 / #2 | Admission, durable audit, irreversible provider handoff and remote receipt remain distinct. No new read algorithm is needed merely to clarify wording. | C8 authority owner before final release/conformance claims; coordinate with A without solving slow physical COMMIT. |
| D3 / #23 / #39 / CR-Q12 | Actual copied payloads/fingerprints, required independently authored reasons, shared audit events and physical erasure require a distinct contract. No purge/key framework is activated by A. | C8 protocol owner; C9 capability owner, accelerated before any personal data. Mandatory hard deletion remains incomplete. |
| CR-Q9 | Applicable directive text and selectors can reveal an otherwise withheld category/association. Dropping a selector or directive alone is not a resolution. | C8 privacy owner before sensitive data: choose informed policy disclosure or withhold the underlying disclosure when required policy cannot safely accompany it. |
| #3 / CR-Q3 | Effective expiry continues while offline; event append and reconciliation cannot occur while stopped. Existing conservative catch-up does not resolve conflicting 24h text. | C8 lifecycle owner before local-provider/C9 durability claims; N3's independent final grant-expiry evidence remains C9. |
| #9 / CR-Q5 / #37 / CR-Q10 | Management inactive reads, immutable content versus current lifecycle, conflict candidates/reactivation and cross-provider ordering need scoped clarification. | C8 lifecycle owner before expanded import/reactivation or C9 Memory Manager claims. |
| #41 / CR-Q13 | Same-token notification retry, strict receiver age, terminal 400 and dormancy remain unresolved. | C8 notification owner before independent receivers or HTTP/OAuth qualification. |
| #42 / CR-Q14 | Dead grants cannot authorize reports or reads; historical report attribution needs a separate authenticated path. | C8 reporting owner before post-revocation reports, real sharing, or full binding claims. |
| #43 / CR-Q15 | Audit attempts are not receipt; empty retrievals have no copy deadline; notice affects only relevant grants. | C8 summary owner before complete summary/Core claims. A must preserve truthful write-attempt evidence. |
| #40 / CR-Q4 | Code+PKCE and rotating refresh do not settle minimum/conditional OAuth flow support. | C8 OAuth owner before C9 profile qualification; no automatic extra-flow implementation. |
| #19/#21/#24/#26 portability | Current synthetic subset preserves restrictions on foreign identity/history, collisions and imported policy/audit. | C8 portability owner before broader import; mandatory selected capabilities carried to C9. |
| #35 pagination | Existing Activity uses authorized snapshot cursors, not offset-based history or credentials encoded in cursors. Upstream consistency/authorization wording remains unresolved. | C8 history owner before full audit/binding claims; C9 retains actual snapshot/cursor coverage. |
| #33 Health | Issuer-attested health records through a provider surface have an unresolved credential requirement. | C8 profile owner before clinical/Health expansion or claim; no clinical producer activated. |
| #4–#8/#10–#17/#25/#28/#29 | Example/schema/checking and role/provenance findings remain open. Select those affected by actual edits, without presenting all as runtime defects or silently relaxing the spec. | C8 adoption owner with each relevant artifact; remaining selected requirements reviewed at C9. #22/#18 encryption remains separately owned. |
| C7b / C7c guidance | A host success requires exact query-ref → get and semantic result checks; historical rule-selector relevance is not effective access, a client action or an exact grant link. | C8 adoption owner: concise examples only if useful beside selected fixes; no new authority fields, skill or generic framework. |
| N4 parser | Duplicate keys, media and UTF-8 handling are explicit tested application choices. | CR owner preserves them; no new protocol parser policy without concrete need. |
| New #44–#48 | Commerce recipients/limits/sensitivity, conversational confirmation and inference-source navigation concern unselected flows. | Orchestrator assigns the feature owner at activation; reevaluate before enabling those flows or an affected profile claim. |

These role owners are responsibilities retained by this C8 step until explicitly
handed off, not unassigned upstream issue lists. Separately owned PR #27 adoption
guidance and #18 encryption investigation are not absorbed.

## Batch A Reviewed-Plan Candidate

**Historical candidate:** this section records the earlier implementation plan.
The November 27 small-contract proposal above guides review of the next revision; this
record and its evidence are retained without retroactively changing their claims.

**Concrete case:** a create commits once, including its required audit, then its
grant is revoked before the original reply. The provider must neither return now
unauthorized content nor imply that the committed operation failed. A later retry
must not gain the original channel's completion entitlement or execute it again.
The selected direction preserves Lucas's C4/C5 choices; it does not reopen them.

1. Define an exact closed Core completion-only object
   `{"outcome":"committed","representation":"not-included"}` for a successfully
   committed create, revision, withdrawal and non-dry-run import whose ordinary
   result cannot be released. Preserve their successful HTTP status (201/201/200/200)
   and MCP success meaning. It contains no resource identifier, version, time,
   standing, policy diagnostics, or resource-specific Location/ETag header. A known
   successful outcome and its required audit must be durable; an audit of a denied
   sharing report, a dry-run, failed transaction or uncertain commit never qualifies.
   Import completion does not assert that every candidate was imported.
2. Bound this entitlement to the original response path. Authorize additional
   representation/headers under current disclosure authority for the original
   grant/purpose for context writes, or the original principal/delegate and scoped
   management authority for import, separately from permission to execute the write
   again. No substitute grant, principal or login continues that entitlement. A write-only
   grant can receive minimal completion; this does not claim CR's current paired
   read/write implementation supports every such grant. Lost replies remain uncertain
   to the caller. No status endpoint, substitute grant, copy renewal or receipt claim.
3. Separate durable duplicate suppression from eligibility to return a response.
   §9.6 keys remain mandatory to accept for HTTP create/revise and recommended for
   DELETE; this batch selects soft withdrawal, not a new hard-delete resolution.
   Import and MCP acquire no new key or automatic-retry mechanism. §9.6 keeps at
   least 24h duplicate protection from successful commit; uncommitted failures do
   not consume a key. It cannot require retaining or
   releasing forbidden response data. Scope keys to the subject/provider, authenticated
   client and capacity; bind the original grant, operation, exact target and raw UTF-8
   body octets (without requiring storage of raw bodies). Another grant cannot make
   the same principal/key fresh. Current attempted-operation authority and historical
   candidate eligibility precede revealing a match or conflict; only then is a changed
   operation/target/body a 409. Invalid evidence is 401; insufficient authority,
   a different grant or an ineligible/discarded candidate is opaque 403. Providers may
   retain longer; clients cannot assume suppression after the retention interval.
4. Preserve affected-context sticky invalidation after effective permission changes,
   including narrowing then restoration, across restart and prepared handoff. A new
   token for unchanged authority is not a permission change. Unaffected grants keep
   their candidates. A presently authorized retry with a discarded/ineligible payload
   gets an opaque 403, never a regenerated result, new mutation or second operation
   audit. Current lifecycle/version/purpose validity and original copy deadlines apply
   to content-bearing Context Client copies. Authorized withdrawal metadata can replay
   after withdrawal; management results do not acquire a Context Client copy clock.
   C5's denial after `useUntil` remains, superseding historical C4 expired-copy replay.
5. Define the retained replay candidate as the role-correct result prepared at
   commit: the eligible representation, or the fixed completion object where the
   original operation has no representation authority (including write-only grants).
   Keep it separate from whether the original channel ultimately returned it,
   minimal completion or nothing. A fresh token under the unchanged original grant
   MUST obtain it while still eligible within the retention interval; arbitrary early
   eviction cannot turn all ordinary authorized retries into denials. Never reconstruct
   it or extend deadlines. Recheck eligibility after serialization at irreversible
   provider handoff, without waiting for drain or remote acknowledgement.
   This makes the existing C4 choice explicit instead of promising original wire bytes.
   A retained completion-only candidate needs fresh current authority over its original
   operation/target/purpose, not read reach; this is historical-result authority, not
   the original-channel entitlement. Do not reexecute one-shot/expectedVersion checks.
   Never downgrade an invalidated content candidate to completion, or upgrade a retained
   minimal candidate after widening. Write-only retry is a proposed interoperable
   consequence; CR's existing paired-grant limitation remains explicit for C9.
6. Keep hard-delete/audit-erasure resolution (#23/#39), slow physical COMMIT and
   mutation-purpose selection (#38) explicit dependencies. This batch must not
   establish a new audit redaction exception, universal infinite key retention, or
   an admission grandfathering rule. Reads retain their own final-release boundary.
   Other governance acknowledgement paths remain separately recorded application
   contracts, outside this batch's normative resolution.

The adoption review identified an affected CR correction: the consumed-import review
path currently loses whether the result is original or replayed. Both JSON and browser
handoffs can consequently use original-channel completion after a retry's authorization
expires while rendering. Carry private original-versus-consumed state to both handoffs;
only original committed import gets the fallback. Preserve authorized recovery of the
existing result, one import event, and the exact review binding. This does not add
idempotency keys to imports or authorize using an expired management credential.

Owning spec changes: §§5/6/7/8/9/10 and Appendix A only where this contract affects
them, `tools/make_schemas.py`, focused positive/negative example checks and generated
pages/schemas. Do not change the shared query/get entry union to admit completion.
Keep Draft 2 output unchanged. Separate the ordinary write result from completion
so the withheld-response path accepts only the exact closed object, regardless of
what an ordinary result's open schema admits.
Hard-delete and dry-run outcomes must be distinguished despite shared schemas.
Tests include ordinary `hardDeleted:true` and dry-run results, valid ordinary results
with matching marker fields rejected **as completion-only** (still allowed as ordinary
authorized entry extensions), and request-bound zero/all-skipped non-dry-run
imports. Exact minimal-schema validity alone does not establish an authorized commit.
No comprehensive conformance framework or unrelated schema repair.

Independent plan reviews approved A after these refinements. The adoption reviewer
approved blob `7a1373abe23d6769a4462d2ba6fdddc0e7c1a165`; the authority reviewer required
the explicit write-only retained-result distinction and exact-object completion check
now incorporated above. Both retain fresh implementation review and qualification.

## Checkpoints, Validation And Adoption

1. **Reconcile and review:** independent authority and adoption reviewers evaluate
   this plan, current clauses and CR behavior. Record decisions/findings; close blockers
   before dependent implementation. Each independently useful repo change uses one PR.
2. **Spec fix:** smallest coordinated source/schema/example/check change. Run Python
   prerequisites, focused negative fixtures, `make check`, `make pages`, local links
   and whitespace; verify historical Draft 2 and generated outputs. Fresh independent
   complete-diff review and exact-candidate spec CI; human upstream merge.
3. **CR adoption:** a dependent patch may be prepared, but no new target is adopted
   until upstream merges and its commit is verified. Record old/new normative and
   materials pins, affected matrix rows and which current behaviors already match.
   Backend behavior changes are tests first. Renew relevant write/replay/authority,
   HTTP/SQLite/recovery and management-result consumer checks; test schemas consumed
   by actual CR outputs. Include refreshed same-grant/unexpired-candidate replay after
   original minimal completion as a positive control. Apply the selected
   [small-contract plan](spec-49-focused-revision-plan.md): exact copy-only expiry
   returns closed HTTP 200; other ineligibility or mismatch with an expired
   historical result still denies. Cover both permitted invalidation strategies
   and unrelated-grant isolation, no deadline renewal, and first-versus-consumed
   import expiry at both actual handoffs.
   Do not silently bundle unmerged descriptors or broaden tools.
4. **Final handoff:** known findings closed, agreed bounded behavior and contributor
   documentation ready, then freeze source and run fresh complete-diff reviews plus
   applicable exact-candidate Product CI. Distinguish spec submitted/merged from CR
   adoption submitted/merged; give concrete next ownership and remaining C9 obligations.

Validation follows the [repository matrix](../../../useful/AGENT_WORKFLOW.md#default-and-exceptions).
Documentation changes need affected readers/checkers. Source protocol/schema work
does not itself select a full local migration gate or installed artifact. Identify
any additional Mac filesystem/recovery gap from the actual patch before selecting
more checks. No installed/native artifact or new human host trial is part of A.
Changed inputs invalidate affected evidence; only expressly unaffected coverage
carries forward. Publication follows a stable reviewed candidate; no automatic merge.

## Batch A Implementation Checkpoint (2026-11-25)

The spec proposal defines the exact completion object and separate response-release
authority, updates HTTP/MCP mappings and §9.6 replay/invalidation, and generates a
separate completion schema without changing read unions or historical Draft 2.
Its source examples and positive/negative checks distinguish an ordinary extensible
entry from the fixed minimal result. This is not upstream merge or CR adoption.

CR records import release context in a private, one-use map only after successful
durable return. Both HTML and JSON handlers consume it at final handoff, after
serialization. The original committed import retains minimal completion if its
final disclosure check cannot succeed. A consumed-review replay still needs the
original live management credential and unexpired exact review. Review expiry
alone does not forbid the authorized original result. Saved ordinary results,
one import event and restart recovery remain intact. No storage schema, retention
or installed-app change is needed.

- Red evidence: all three new consumed-import final-handoff cases returned 200
  instead of required 401 before runtime edits (API serialization, HTML result
  serialization and HTML page rendering).
- Green evidence: all 24 tests in `portability.test.cjs` pass, including existing
  original-response, uncertain outcome, audit failure and crash/reopen cases.
- The focused `writes.spec.ts` and `portability.spec.ts` suites pass 84 tests.
  The new independent token/copy deadline case proves an unchanged grant's refreshed
  token can replay the still-live candidate after original minimal completion, keeps
  its original deadline, and later denies without another mutation/event.
- Toolchain: Node 24.21.0, pnpm 10.25.0; frozen dependency install, Prisma generation
  and backend build passed. Test resources are isolated synthetic SQLite/HTTPS roots.
- Spec `make check` and `make pages` pass using Python 3.11.13/jsonschema 4.26.0.
  Regenerating Draft 2 into a temporary directory matches tracked schemas exactly.
  These are artifact consistency checks, not provider conformance tests.

Fresh independent implementation reviewers `c8_authority_implementation` and
`c8_adoption_implementation` requested Astra/xhigh (accepted by the tool; runtime
unobservable) found the following additional consequences of the selected contract.
These are adoption fixes, not new mutation-purpose or person-correction decisions.

| Finding | Correction and evidence |
| --- | --- |
| Two browser expiry checks could disagree after a known original commit | Shared one-use import release checks both paths; adjacent clock reads now preserve minimal completion. |
| Consumed import review could expire during serialization with its session still live | Final release checks the exact review deadline for recovery; three API/HTML cases were red at 200 instead of 403. Original results remain authorized after review-only expiry. |
| Unavailable final storage admission lost original completion | Known original import retains minimal completion; replay and reused/foreign result objects fail closed. Includes empty committed import, with one durable event. |
| Assertion purpose narrowing then restoration revived old responses | Invalidate affected grant response candidates transactionally before binding the new result. Prepared original/retry, restart, and an unaffected purpose are covered. Equivalent classification sets preserve candidates and existing audit behavior. |
| Final copy deadline was reported as credential expiry | Separate authority and disclosure deadlines; a valid credential with expired result gets opaque 403, while expired credentials get 401. |
| Historical key conflict escaped after authorization expired during response serialization | Bind the conflict privately to its historical authorization and recheck at final handoff. Both deadline cases were red at 409 and now deny without revealing the key. |
| A changed retry could disclose a conflict when its attempted revision/relationship target was rejected or withdrawn | Reuse read-only attempted-operation authorization before selecting the conflict and at final handoff. Eight admission/handoff cases were red, then green; no optimistic-version reexecution or mutation is introduced. |
| Exact retries skipped current relationship-target authority; rebuilding proposals then overchecked historical confidence | Exact replay resolves original relationship/proposal references under current authority at admission and handoff, including their deadlines. It preserves the original proposal and skips new-assertion, confidence-comparison, optimistic-version and one-use execution checks. Rejected/withdrawn and self-superseded targets deny; management recovery after assertion expiry and readable changed-asserter targets remain eligible. |
| Core did not explicitly bind original prepared results to sticky invalidation across bindings | Core now covers unkeyed HTTP/MCP too; the ordering table includes candidate eligibility. HTTP `ref`/`version` wording is limited to content-bearing create/revise. |

The correction tests reproduced each reported runtime boundary before its source
fix. One new audit assertion initially counted fixture-bootstrap events; it now
selects the exact grant and requires one create, preserving the intended assertion.
After this correction batch, the full focused write/portability Jest suites pass
91 tests and the HTTP/browser-handler/crash/restart suites pass all 55 tests.
The reviewer recheck follows this corrected candidate.
The last attempted-target correction adds eight focused cases. The renewed write
suites pass 68 Jest and 23 HTTP/recovery tests; the unaffected 31 portability Jest,
32 portability transport and schema checks carry forward (154 focused tests total). The
401 evidence concerns an admitted session expiring at final handoff. The existing
import admission route's 403 for a non-current management bearer remains a separate
C9 binding-qualification item; this batch does not claim uniform error mapping.
Six observed synthetic HTTP results pass eight validations (ordinary create/revise/withdraw/import,
minimal create/import and their dedicated completion-schema checks)
against the proposed schemas using JSON Schema 2020-12 plus format checking.
The schema check is provisional compatibility evidence, not an adopted pin.

Spec [PR #49](https://github.com/loyalagents/hcp-spec/pull/49) is submitted and ready
for human review, with independent approval and green
[CI run 45734368400](https://github.com/loyalagents/hcp-spec/actions/runs/45734368400).
Its source head is `38d0c73c9b04541b1df0901600f0bc161ae82bc6`, verified base
`b790561830702c067cd7810c96ee78dd3d84741c`, and actual CI checkout/test merge
`34ca607b6aed6904976f342a2d51289dbbbe5ff4`. Schema generation, checks and reading-page
consistency passed on that merge. It is not merged or adopted.

Both fresh independent reviewers approved the complete corrected CR candidate
after the exact-replay resolver correction. The final write Jest run passes 75
tests and the final affected transport run passes 23 tests against the rebuilt
source. Unaffected portability coverage remains 31 Jest and 32 transport tests:
161 focused tests in total. The local
nonruntime contract comparison against `98fe60f…`, links and whitespace pass.
No full local migration gate, installed artifact or new host trial is selected:
the patch changes authorization decisions without changing filesystem, locking,
packaging or installed composition, and isolated Mac persistence/crash/HTTPS
coverage plus applicable Product CI supplies the selected evidence.

CR final exact-candidate CI remains pending; CI will use the committed candidate. Both adopted
pins remain the old values above. A later pin change must identify the verified
human-merged spec commit and any extra delta before renewing affected evidence.
