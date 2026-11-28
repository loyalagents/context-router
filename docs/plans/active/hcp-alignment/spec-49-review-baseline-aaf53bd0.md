# HCP PR 49: small write-completion and retry contract

**Status: revised plan for engineer and product review, 2026-11-27. No new protocol
behavior or adoption target is approved by this document.**

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
| The currently promised eligible retry result, with role-correct identifiers and unchanged original copy limits. | Store a serialized response or retain enough information to reproduce the same eligible original result. No mandatory full-response cache layout. |
| A distinguishable temporary unresolved outcome with safe same-key retry instructions. | Wait for a bounded period or return the specified temporary response; either way, do not execute twice. |
| Clear authorization and disclosure boundaries when permissions change. | How to enforce the selected ordering. No mandatory callback after serialization, socket-drain wait or proof of remote receipt. |

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

This entitlement belongs only to the original response path after known successful
commit and required durable audit. It does not authorize a later request. A failed
operation, uncertain commit, dry run or audit append alone cannot qualify. Import
completion means processing completed; it does not mean every candidate imported.

The following are **semantic meanings**, not new Core error codes or an added
response envelope. Use existing success/error contracts wherever possible.

| Caller receives or observes | What it establishes | Safe caller action |
| --- | --- | --- |
| Ordinary authorized success | The operation succeeded and the returned representation/identifier is authorized under its stated limits. | Keep the role-correct reference/version when present; use them only under applicable authority. |
| Exact completion-only success | The operation succeeded; no representation or reference accompanies this reply. It does not assert the entry is still active or unchanged. | The write is done. With known idempotency support for that operation and within the protected window, the client MAY repeat the exact keyed request under the same original authority to recover an eligible result. It may receive that result, completion again or denial; none repeats the write or undoes known success. Never use a new key. |
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
For example, an unchanged grant may still receive opaque denial at minute 90
because the original copy expired, while its consumed key remains protected. That
denial does not establish revocation, failure of the original write or permission
to execute it anew. Completion after copy expiry remains a separate #34 policy
decision, not part of this clarification.

## Storage flexibility does not silently weaken result recovery

Base §9.6 literally requires the original response, including its identifier and
version, within its retention window without spelling out a copy-expiry exception.
The selected #49 direction qualifies that return promise with current authority and
original-result eligibility; the new copy-expiry denial is a caller-visible limit,
not merely a change to storage wording. #49 must express identifiers according to
the caller's role: a Context Client receives its grant-scoped ref, not a management
identifier. The eligible result guarantee covers create **and revise**.

For this smaller batch, **preserve that observable eligible-result guarantee**
while replacing the requirement to retain a particular response representation
with enough durable information to reproduce it. A provider need not retain the
serialized response bytes or a separate full-body copy if it can satisfy the same
result from retained, authorized original information. It may not substitute current
entry data, manufacture a fresh disclosure, refresh a deadline or reconstruct a
candidate that the applicable rules require to remain invalid or erased.

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

For this revision, simplify enforcement wording into observable ordering without
silently changing the candidate's or CR's selected privacy behavior. Original
ordinary results and revealing retry results must be ordered against effective
authority changes at the release decision. A revealing
retry result, including completion, conflict or pending metadata, needs applicable
current authority over the attempted/historical context; effective revocation that
wins before release yields opaque denial. Do not rerun consumed execution
preconditions or assume #38's proposed purpose field already exists.

The earlier proposed changes to token-expiry cutoff, permanent invalidation after
narrowing/restoration, completion after copy expiry and completion after restored
scope are **not selected by the user's openness to implementation flexibility**.
Keep the existing stricter selected behavior in this batch unless Lucas expressly
supersedes it after review. A policy epoch, lock or other mechanism is a provider
choice; whether a reply remains authorized is a protocol rule.

Concretely, an affected candidate stays invalid after narrowing then restoration,
and an expired content copy is not replayable: those retries receive opaque denial,
with no completion fallback, new mutation or renewed deadline. A fresh token alone
does not invalidate an unchanged grant's otherwise-eligible candidate. The original
known-commit completion entitlement remains separate from these later denials.

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
| Alternative minimal/reference recovery, write-only handles and broader #34 policy relaxations | C8 protocol/adoption owner; before removing the existing eligible-result guarantee, granting new identifier authority or changing selected retry-denial policies. A write-only creator still has no guaranteed new-entry reference in this batch. |
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
   invalidation/copy deadlines; HTTP 200 minimal output and MCP example consistency.
   Include bounded result recovery after minimal success without losing known
   success: an eligible create/revise candidate recovers its original 201 after
   minimal 200, with the same parsed JSON values including a historical time-varying
   member. Also cover copy expiry before duplicate protection ends; typed temporary 503
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
preserves the complete plan subsequently reviewed by both latest Claude agents,
SHA-256 `e8259bb0127fd9c5dcef7f28deb4a84d8730069ecbd99d41c60453785ce9ce5b`.
Lucas authorized this pass to clarify result recovery after completion, duplicate
versus copy windows, historical result equality, one concrete temporary HTTP
response and client/provenance guidance. Reference-only outputs, new write-only
handles, broader invalidation/expiry relaxations and erasure-marker rules remain
separate decisions. Fresh review receipts for this pass belong in the
[C8 brief](c8-resolution-brief.md); prior approvals do not carry over changed wording.

Before this correction pass, Markdown link validation passed across 170 files; tracked/untracked whitespace and
the archived guide's exact hash passed. Consumer searches found the portfolio link
and no executable reader requiring additional tests. No runtime checks or new CI
qualification were run for this planning-only edit; publication and implementation
use the applicable exact-candidate checks above. Preserve the installed app,
personal/demo state, separately owned encryption work and historical C6/C7b/C7c
evidence.
