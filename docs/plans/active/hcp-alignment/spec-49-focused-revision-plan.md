# HCP PR 49: small write-completion and retry contract

**Status: plan updated with Lucas's selected retry policies, 2026-11-27.
Spec implementation, upstream merge and Context Router adoption remain pending.**

Lucas asked for a smaller contract centered on authorized requests, truthful
outcomes and idempotent writes, with a clear boundary between HCP guarantees and
context-store implementation choices. This plan replaces the nineteen-card guide
as the current proposal. The [November 26 decision guide](spec-49-decision-guide-2026-11-26.md)
is preserved unchanged as review history; its recommendations are not approvals.

## The proposed contract

An app should be able to change context stores and still know how to handle a
successful write, a denied request and a lost reply. HCP should specify those
observable outcomes and the rules for safely retrying. Providers choose how to
deliver them.

1. **Authorize every new request.** A retry is a new request. Missing permission
   prevents new effects and any protected disclosure about an earlier operation.
2. **Report only what is established.** A known successful write can be acknowledged;
   an uncertain outcome cannot be called success or rollback. A denied retry says
   nothing about whether its first attempt succeeded.
3. **Apply each protected keyed write at most once.** Lost replies, overlap and
   restart must not cause another mutation or another mutation audit event.
4. **Keep response meanings portable.** The caller must understand what it received
   and what it may safely do next. An implementation preference cannot silently
   remove an existing recovery guarantee or bypass changed permissions.
5. **Leave the mechanism open.** Database layout, journals, coordination and response
   storage are provider choices, subject to the same observable guarantees.

This is one cohesive #49 change covering original completion and the safeguards
needed for the existing HTTP idempotency contract. Broader recovery features remain
owned under #34; they are not prerequisites merely because the earlier guide
discussed them. Any inseparable unresolved guarantee must be settled before landing
the affected change, rather than hidden by a PR split.

## What HCP guarantees, and what providers choose

| HCP must define and guarantee | Context-store implementer can choose |
| --- | --- |
| Authentication and authorization on every request, including retries; no key-dependent disclosure to an unauthorized caller. | Internal authorization services, indexing and coordination. No mandated two-pipeline architecture. |
| Known successful original completion with required durable audit: ordinary role-correct output when eligible, otherwise the exact completion-only result below. | How the operation and required history become durable. No required database engine or transaction spanning every store. |
| No repeated mutation or mutation event for the same protected key, including concurrent attempts and restart. | Unique constraints, locks, journals or another correct recovery design. Normal request/access logging is not a second mutation event. |
| A shared key identity, request-matching rule, minimum protection window and original-authority binding. | Storage representation and retention beyond the minimum. Raw bodies need not be stored merely to compare request identity. |
| The eligible original retry result, or the exact completion-only result when original copy expiry is its sole obstacle. Role-correct identifiers and original copy limits remain. | Store a serialized response or retain enough information to reproduce the eligible result or establish completion-only eligibility. No mandatory full-response cache layout. |
| A distinguishable temporary unresolved outcome with safe same-key retry instructions. | Wait for a bounded period or return the specified temporary response; either way, do not execute twice. |
| Current authorization, permanent invalidation of affected results and preservation of unrelated grants' eligible results. | Precise invalidation or conservative invalidation within an affected grant; enforcement mechanics. No mandatory callback after serialization, socket-drain wait or proof of remote receipt. |

**Provider freedom does not mean each provider invents a different response
contract.** Window floors, request identity, error meanings and the permitted
disclosure of historical results are shared rules. Optional behavior is safe when
one client can handle all permitted outcomes without provider-specific guesses.

## Original completion and caller actions

For a known successful create, revision, soft withdrawal or non-dry-run import,
the original usable response path returns the ordinary eligible result, or exactly:

```json
{"outcome":"committed","representation":"not-included"}
```

The minimal result uses **HTTP 200**, already selected by Lucas. It carries no
identifier, version, timestamp, policy explanation, entry content or resource-specific
`Location`/`ETag` header. Ordinary create/revise keep their ordinary success status.
The corresponding MCP success example must have a complete envelope and matching
structured/JSON-text values; this introduces no MCP retry key or new CR tool.

The original completion entitlement belongs only to the original response path
after known successful commit and required durable audit. It does not authorize a
later request. The separately authorized copy-expiry retry below reuses the same
closed result, without carrying that original entitlement forward. A failed
operation, uncertain commit, dry run or audit append alone cannot qualify. Import
completion means processing completed; it does not mean every candidate imported.

The following are **semantic meanings**, not new Core error codes or an added
response envelope. Use existing success/error contracts wherever possible.

| Caller receives or observes | What it establishes | Safe caller action |
| --- | --- | --- |
| Ordinary authorized success | The operation succeeded and the returned representation/identifier is authorized under its stated limits. | Keep the role-correct reference/version when present; use them only under applicable authority. |
| Exact completion-only success | The operation succeeded; no representation or reference accompanies this reply. It does not assert the entry is still active or unchanged, or explain why the result was omitted. | The write is done and the client can stop. With known idempotency support for that operation and within the protected window, the client MAY repeat the exact keyed request under the same original authority to recover an eligible result. It may receive that result, completion again or denial; none repeats the write or undoes known success. Never use a new key. |
| Confirmed pre-execution rejection or verified no-effect rollback | This attempt made no mutation. It does not answer the outcome of a different earlier attempt. | Correct the request/authority if appropriate; distinguish this from a lost earlier reply. |
| Authentication/authorization denial on a retry | This new request cannot execute or recover protected information. An originally unknown outcome remains unknown; an already-confirmed success stays known. A generic scope denial does not establish that the grant was revoked. | Stop this denied recovery path. Do not substitute a grant or fresh key to recover the old operation. |
| Authorized key/request mismatch | The presented method, target or bytes do not match that key's original binding. No second mutation occurs. | Recover the exact original request; changing the key is not recovery. |
| Typed temporary unresolved outcome | After authorization checks, execution is known to be outstanding or its outcome is temporarily indeterminate during recovery. Neither success nor rollback is asserted. Known ineligibility is denial, not this temporary condition. | The client MAY make bounded, authorized same-request/key retries within the protected window, respecting Retry-After when present and otherwise backing off. Use no fresh key; clients need not keep retrying until expiry. |
| Timeout, dropped connection or other 5xx | This attempt supplies no new confirmed outcome. A proxy failure does not establish provider-side pending execution, and any earlier confirmed success stays known. | The client MAY use bounded same-key recovery only with known support, sufficient authority and time remaining. No blind automatic resend for unkeyed, unsupported or out-of-window requests. |

```mermaid
sequenceDiagram
    participant App as LLM app
    participant Store as Context store
    App->>Store: Authorized write with key K
    Store->>Store: Commit once with required audit
    Store--xApp: Reply lost
    Note over Store: Original grant is revoked
    App->>Store: Retry K with revoked authority
    Store-->>App: 401 invalid-token; no key or outcome detail
    Note over App,Store: No second mutation; the original commit is not undone
```

An endpoint can be idempotent even when its later response is different. The
guarantee concerns repeated effects; it does not grant permanent access to the old
response. Clear communication includes honestly leaving an outcome unknown when
the channel or authorization prevents recovery.

Do not infer rollback merely from an HCP problem body or an HTTP error status.
Only a defined, established no-effect rejection or verified rollback supports that
claim for the current attempt. Neither a temporary error nor a denial of later
recovery answers an unknown earlier outcome.
An unconsumed key may be reused with corrected input only when no attempt under
that key committed or remains unresolved. A rejection after a lost earlier reply
does not establish that condition.

## Bounded HTTP idempotency

Keep the existing scope: create and revise **MUST accept** `Idempotency-Key`, and
clients SHOULD supply it. Soft withdrawal retains its existing SHOULD support;
clients do not automatically retry it when support is unknown. Support may be known
through the integration contract; no new discovery mechanism is required. No new idempotency
mechanism is added to import, MCP or unkeyed calls. Hard deletion retains its own
contract and the dependency below.

The common rules are:

- Protect a successfully committed key for **at least 24 hours from commit**,
  through overlap, lost responses and restart. This is a floor, not an instruction
  to delete at exactly 24 hours or retain every API call indefinitely.
- Scope key identity to the provider's subject instance, authenticated client and
  context/management capacity. Separately bind the original grant or management
  authority, operation, exact target and identical UTF-8 body bytes. A replacement
  grant cannot make the same consumed key fresh or reveal a match/conflict/outcome.
  Re-registration that changes the authenticated client identity is also not
  recovery in the old namespace; it is distinct from refreshing a token.
- Apply current authorization before revealing key-dependent information. For an
  authorized duplicate, do not rerun consumed version/one-use execution conditions,
  the mutation or its mutation audit. Same-grant refreshed evidence is distinct
  from a replacement grant. A historical withdrawal acknowledgement may remain
  authorized after withdrawal; this does not make inactive entry content readable.
  Management results keep their own scope rather than acquiring a Context Client
  copy deadline.
- A confirmed no-effect first attempt does not consume a fresh key. A later denial
  must not clear a key already consumed by an earlier commit. While recovery is
  uncertain, do not execute a possibly committed operation again.
- Required audit must be durable before success acknowledgement. Recovery must
  preserve the operation, its required history and duplicate protection. A provider
  may use multiple stores if its recovery design satisfies these outcomes.
- Clients preserve the method, target, key and exact bytes before first send.
  Retrying with reserialized JSON can be a mismatch. Stop comfortably inside the
  minimum window measured conservatively from first dispatch, allowing delivery
  time; a new key, replacement grant, different authenticated client identity or
  expired window is not safe automatic recovery of the old operation.

For overlap or temporary inability to establish an execution outcome during recovery,
the corrected plan uses one **HTTP-only 503 problem type**,
`https://hcp.example/problems/idempotency-unresolved`, with `Retry-After`, after
optional bounded waiting and the required authority checks. Add its binding-only
row to §9.7, the allowed value to the HTTP problem schema, and one checked example
carrying `type`, `title`, `status` and `detail`. Keep `idempotency-conflict` for proven
mismatch and `subject-unavailable` for its existing Core meaning. This adds no
Core/MCP error, new task service or status endpoint.
Update the §9.7 introduction and HTTP schema description to distinguish a
binding-only problem from a mapped Core error; the shared Core/MCP code list
remains unchanged. The selected HCP temporary response requires `Retry-After`.
Client backoff when the header is absent handles intermediaries or nonconforming
responses; it does not make the header optional for that HCP response.

This is the concrete engineering mapping for the proposed #49 revision, replacing
the earlier 409 preference; it is not implemented or adopted yet. HCP currently
requires typed problem details. Generic RFC 9457 also permits `about:blank`, so a
new named type is an HCP binding choice, not an HTTP requirement. A proxy 5xx or lost
reply can justify the same conditional recovery action without the same knowledge
about execution. An unrecoverable committed-key state is a failed recovery
guarantee, not permission to start fresh.

**Two different windows apply.** The 24-hour minimum protects against duplicate
effects; it does not promise 24 hours of readable results. Under §7.6's default
fresh-version heuristic, a create/revise content copy commonly lasts about one
hour; without a notification endpoint the ceiling is one hour, and explicit limits
can make it shorter. Providers with a notification channel can set other permitted limits.
Lucas selected **completion after copy expiry alone** for #49. An exact keyed
retry within the protected interval MUST receive the fixed HTTP 200 completion
result if the operation is known committed with its required audit, current
authentication and the original authority still permit recovery, and the original
copy's `useUntil` is the sole failed eligibility condition. All other historical
authorization, lifecycle, selected-version and validity checks still apply; only
the copy deadline is waived for this content-free reply. No content, identifier,
resource-specific header, fresh copy or second mutation is returned or created.

For example, a reply lost at 09:00 can be recovered as “saved” at 10:30 when the
copy expired at 10:00 and every other condition still holds. Revocation, permission
invalidation (including the conservative option below), inactive lifecycle or
other ineligibility still yields opaque denial. Missing proof of a known commit
cannot become success. The completion object does not identify which path produced
it, so a client cannot infer that an eligible reference can never be recovered.

## Storage flexibility does not silently weaken result recovery

Base §9.6 literally requires the original response, including its identifier and
version, within its retention window without spelling out a copy-expiry exception.
The selected #49 direction qualifies that return promise with current authority,
original-result eligibility and the bounded invalidation option below. Copy expiry
alone now returns completion instead of the original representation; these are
caller-visible contract changes, not merely storage wording. #49 must express identifiers according to
the caller's role: a Context Client receives its grant-scoped ref, not a management
identifier. The eligible result guarantee covers create **and revise**.

For this smaller batch, **preserve that observable eligible-result guarantee**
while replacing the requirement to retain a particular response representation
with enough durable information to reproduce it. A provider need not retain the
serialized response bytes or a separate full-body copy if it can satisfy the same
result from retained, authorized original information. It may not substitute current
entry data, manufacture a fresh disclosure, refresh a deadline or reconstruct a
candidate that the applicable rules require to remain invalid or erased.
Replay-only content for a Context Client may be discarded at its original
`useUntil`; effective invalidation still requires discarding cached response
payloads. Keep enough permitted historical context to establish the copy-expiry
fallback's remaining checks even after discarding replay content; this need not be
a serialized response. The ability to establish those checks must survive restart
throughout the protected interval; losing that context is not permitted early
eviction or a reason to treat a committed key as fresh. Neither removes duplicate protection, permits early loss
outside the selected invalidation rules, nor deletes authoritative entry/history records. Management results
do not acquire a Context Client copy deadline. Erasure remains separately governed
by the dependency below.

Here “same result” means the eligible candidate's associated success status and
JSON member values recorded at commit, including the then-selected time-varying
fields. It does not require identical serialization bytes or transport headers;
resource-specific headers still require current release authority. This differs
from request matching, which deliberately uses exact request-body bytes.
Reconstruction is not assumed cheap or always possible: an old entry version alone
may not reproduce historical projections or derived credential evidence. A stable
grant-scoped reference may be stored or derived; stability does not require
derivability. Providers choose what sufficient original information to retain,
subject to erasure and eligibility rules.

The retained **original result candidate** is distinct from the reply that actually
reached the wire. If an authorized content candidate existed at commit but only the
token expired before release, the known original write receives minimal HTTP 200;
a new request using expired evidence fails with 401, while refreshed evidence for
the same unchanged grant can recover that still-eligible candidate and its original
copy deadline. Conversely, a write-only original candidate stays completion-only:
later widening cannot turn it into a content/reference result.

Making the **delivered body** optional is a different contract change. The earlier
proposal favored doing so; this revision defers that change until #34 explicitly
settles the replacement recovery guarantee. The coordinator still favors exploring
a small authorized reference result rather than a full historical body. Its schema,
role/purpose/lifecycle limits and any loss of original-version recovery need explicit
review. The smaller #49 must not accidentally replace dependable entry recovery
with best-effort search or provider-specific behavior.

## Permission changes: preserve the boundary, simplify the mechanism

Unauthorized-on-arrival requests are settled: they fail. Known original commit
followed by lost disclosure authority is the central completion case. Neither rule
settles all in-flight races.

For this revision, express enforcement as observable ordering, with the two
explicit policy changes Lucas selected on November 27. Original
ordinary results and revealing retry results must be ordered against effective
authority changes at the release decision. Before disclosing a key match, conflict,
pending state or historical completion, check current authority for both the
presented operation and the historical operation/result under its original
authority. In particular, authority for a different target does not authorize
probing a key associated with an inaccessible target. Content-bearing results
also require the applicable lifecycle, selected-version and copy eligibility;
the selected completion fallback waives only the original copy deadline.
A different operation, target or body cannot use this waiver: an ineligible
historical result, including an expired content copy, still requires opaque
denial before disclosing a conflict. Otherwise the ordinary authority-gated
mismatch rule applies. Effective revocation that wins before release on a retry
yields opaque denial. These are
observable checks, not mandated internal stages. Do not rerun consumed execution
preconditions or assume #38's proposed purpose field already exists.

Lucas also selected **conservative invalidation within an affected grant**. For
retained HTTP retry candidates, a provider MAY treat a genuine permission change
to a grant, or an effective governing policy change that applies to that grant,
as invalidating all prior candidates under that grant. It need not determine
which individual results the change affects. Precise invalidation remains valid;
actually affected candidates MUST still be invalidated under either approach.

This option permits loss of some otherwise eligible results and their references.
It does not permit arbitrary eviction or invalidation of unrelated grants,
clients or independent management authority. A shared policy can affect multiple
grants; each must fall within that policy's scope. Token refresh under unchanged
authority and semantically unchanged policy saves are not permission changes.
Original-request completion and prepared-result rules otherwise remain unchanged.

Every candidate invalidated under either approach stays invalid after restoration
and restart. Invalidation wins over the copy-expiry fallback, and a previously
prepared retry reply cannot escape after its invalidation becomes effective.
The committed operation and its duplicate protection remain intact. No database
layout, per-result write or specific counter is required to enforce these rules.
Relaxing token-expiry checks, allowing revival after restoration, person-wide
invalidation unrelated to the grant, or completion for other ineligible results
is not selected. The original known-commit completion entitlement remains separate.

The case where revocation occurs before an in-flight mutation's commit is known
remains owned under #2. #49 concerns established successful commits; it does not
authorize committing a now-unauthorized operation, demand impossible cancellation
of an irreversible physical commit, or claim to solve that race. This dependency
must be resolved before a broader in-flight authorization guarantee is claimed.

## Erasure and remaining ownership

Within the promised retry interval, a consumed key must not become a fresh create
merely because the person erased the original entry. Equally, key records,
fingerprints and result associations are
not automatically exempt from erasure. #23/#39 must establish permissible retained
information or another safe refusal mechanism. Until that is implemented and
verified, do not claim combined hard-delete/retry safety or qualify the affected
capability. Merely saying “deny” without a way to recognize/refuse the retry is
insufficient. D3 resolution **and implementation precede any personal-data extension**.

| Remaining work | Owner and trigger |
| --- | --- |
| Alternative minimal/reference recovery, write-only handles and further #34 policy relaxations | C8 protocol/adoption owner; before replacing the original-result guarantee beyond the selected copy-expiry fallback and affected-grant invalidation option, granting new identifier authority or changing other retry-denial policies. A write-only creator still has no guaranteed new-entry reference in this batch. |
| Temporary HTTP response mapping | C8 binding owner in #49; implement the proposed HTTP-only 503 type, schema value and checked example, then verify consumer handling before spec candidate freeze. |
| In-flight execution/revocation and slow physical commit (#2) | C8 authority owner; before broader timing/authorization claims. |
| Erasure, retained operation metadata and proposed mandatory random/non-content-derived keys (#23/#39, D3) | C8 protocol owner with C9 capability owner; decide and implement permissible retention and any client key-generation rule before combined erasure/retry qualification or any personal-data extension. No marker permission or new key-generation MUST is adopted here. |
| Copy accounting/summary semantics (#43) | C8 audit owner; before complete summaries. Operation/disclosure events do not prove remote receipt or use. |
| Mutation purpose/person correction (#38), complete MCP descriptors (CR-Q7), omitted categories (CR-Q8) | C8 next contract/binding batches. Preserve Lucas's selected explicit purpose, authorized empty future-purpose save and whole-query denial. |
| Sensitive directive disclosure (CR-Q9) | C8 privacy owner; resolve and adopt before sensitive real data. |
| Remaining mandatory capabilities and full bindings/profile evidence, including §18.3 Provider Interop | C9 owner assigned by the orchestrator; no obligation removed by this smaller plan. |

These are responsibilities retained by the C8 step owner until handed off. No
encryption redesign, generic conformance framework, new MCP write tools, discovery
framework or live host trial is activated. Independently implemented protocols
remain the relevant comparisons; their bounded lessons and limitations are retained
in the [earlier guide](spec-49-decision-guide-2026-11-26.md#what-the-protocol-comparisons-establish).
For clarity, [Solid WAC's privacy advice](https://solid.github.io/web-access-control-spec/#consider-append-read-diff)
does not prohibit returning a resource URI, and
[Repeatable Requests](https://docs.oasis-open.org/odata/repeatable-requests/v1.0/cs01/repeatable-requests-v1.0-cs01.html)
uses a server-maintained repeatability window rather than prescribing HCP's
24-hour duration. These comparisons establish neither HCP's result-retention
policy nor its historical-authorization rule.

## Execution checkpoints

1. **Review the small contract.** Independent authority/privacy/durability and
   architecture/adoption reviewers check the shared guarantees, permitted variance
   and caller actions. Check the corrected result-preservation scope and concrete
   temporary HTTP mapping; make any changed product policy explicit. No reviewer recommendation
   is user approval for a previously selected policy reversal.
2. **Revise spec #49.** In the isolated spec worktree, change only affected Core,
   HTTP/MCP mappings, schemas, examples and owning generators. Keep the completion
   result closed, ordinary role schemas correct, query/get unchanged and Draft 2
   output unchanged. Run `make check`, `make pages`, generated-artifact consistency,
   affected examples/negative cases and links. Obtain fresh complete-diff reviews,
   exact-candidate spec CI and human upstream review/merge. No automatic merge.
3. **Adapt CR #221 tests first.** Cover unauthorized first attempts; known commit
   then revocation; lost original reply; same-grant refreshed evidence; replacement
   grants; exact and mismatched requests; simultaneous first uses; CR's selected
   waiting/temporary-response path plus portable-client handling of either permitted
   path; confirmed rollback versus unknown commit; crashes/restart;
   one mutation/event; eligible role-correct ref/version recovery; preserved
   sticky invalidation and content-copy deadlines; HTTP 200 minimal output and MCP example consistency.
   Include bounded result recovery after minimal success without losing known
   success: an eligible create/revise candidate recovers its original 201 after
   minimal 200, with the same parsed JSON values including a historical time-varying
   member. Cover copy-only expiry at the boundary and later in the protected
   interval, including after replay-body discard and restart: exact HTTP 200 with
   no content/ref/resource headers and no second mutation/event. If assertion or
   credential validity also expires, lifecycle becomes inactive, or invalidation
   wins before release, deny; narrowing then restoration cannot revive completion.
   Changed operation, target or bytes after copy expiry must yield opaque denial,
   not 409 or 200; an otherwise-authorized mismatch while the historical result is
   still eligible remains the 409 control. Neither case repeats the write.
   Cover precise and conservative provider choices: after a relevant change,
   actually affected candidates always deny; otherwise-unaffected candidates in
   that grant may remain eligible or be permanently invalidated. Unrelated grants,
   clients and independent management authority retain eligible results; token
   refresh and no-op policy saves cannot justify broader invalidation. Record CR's
   implementation choice without imposing it on portable consumers.
   Also cover typed temporary 503
   versus proxy failures/timeouts; changed client identity; and no automatic
   withdrawal retry when support is unknown, including after known minimal success.
   Test observable effects and caller actions rather than a required cache layout.
   Add combined erasure tests only with its resolved real implementation; preserve
   the gate meanwhile. No storage rewrite just to demonstrate provider freedom.
4. **Adopt and hand off explicitly.** After human spec merge, verify the actual
   merged delta, update old/new normative and material pins plus affected matrix
   rows, and renew affected consumer/persistence checks. Freeze for independent
   complete-diff reviews and applicable exact-candidate Product CI under the
   [validation policy](../../../useful/AGENT_WORKFLOW.md#validation-and-context-discipline).
   Report spec PR/merge, CR PR/adoption, tests/reviews and owned remaining work.
   Submitted, merged, adopted and application-merged are separate milestones.

## Provenance and validation boundary

On November 27, GitHub confirmed [spec #49](https://github.com/loyalagents/hcp-spec/pull/49)
open/unmerged at `38d0c73c9b04541b1df0901600f0bc161ae82bc6`, base
`b790561830702c067cd7810c96ee78dd3d84741c`, and
[CR #221](https://github.com/loyalagents/context-router/pull/221) draft/open/unmerged
at `e737a4cfc899c7ecae547a98259b5372d16d271e`. Their old implementation reviews and
green CI do not validate this new plan.

Current CR targets stay normative Draft 3
`2e2939c9bebcefb3bed7bb3522231c0e4d65a315` and adoption materials
`b764a058eac15a4cd843892e60473089b2e835bb`. The previous guide is preserved byte-for-byte
with SHA-256 `e812ee7b9ee08dd5e6d732cb0edd041ceb815f7c179ee65ead6a6faf2484c44e`.

This is a sensitive contract-planning change with a sole writer. Read-only reviewers
`small_contract_authority` and `small_contract_adoption` were requested as
`gpt-6.2-astra` / `xhigh` and `high`, respectively. The tool accepted the requested
settings; actual runtime model/effort is not independently observable. Final review
closed all material findings in both remits on content SHA-256
`568c13425738bb546e88875fe164a1389ea81e3a447aaa4da909ec4a7360ee57`;
that intermediate content was not separately preserved. Those reviews concern
their earlier candidate, not this correction pass or a completed implementation.

The [small-contract review baseline](spec-49-small-contract-review-baseline.md)
preserves the complete plan reviewed by the first small-contract Claude pair,
SHA-256 `e8259bb0127fd9c5dcef7f28deb4a84d8730069ecbd99d41c60453785ce9ce5b`.
Lucas authorized the earlier correction pass to clarify result recovery after completion, duplicate
versus copy windows, historical result equality, one concrete temporary HTTP
response and client/provenance guidance. Reference-only outputs, new write-only
handles and erasure-marker rules remained separate decisions at that point.
Lucas subsequently selected the copy-expiry-only completion fallback and
conservative invalidation within an affected grant, as specified above. Further
relaxations remain separate decisions. Fresh review receipts belong in the
[C8 brief](c8-resolution-brief.md); prior approvals do not carry over changed wording.

The [subsequent review baseline](spec-49-review-baseline-aaf53bd0.md) preserves
SHA-256 `aaf53bd0b441450f379b51041453c0d5941e5318db804ce43bbd7432becbcaa7`,
reviewed by the latest pair (`d2865033…` and `91ccef7f…`). Their small clarifications
and policy proposals are separately dispositioned in the C8 brief. The two
subsequently selected policies are approved directions for the #49 revision, not
claims of implemented or adopted behavior.

Before this correction pass, Markdown link validation passed across 170 files; tracked/untracked whitespace and
the archived guide's exact hash passed. Consumer searches found the portfolio link
and no executable reader requiring additional tests. No runtime checks or new CI
qualification were run for this planning-only edit; publication and implementation
use the applicable exact-candidate checks above. Preserve the installed app,
personal/demo state, separately owned encryption work and historical C6/C7b/C7c
evidence.
