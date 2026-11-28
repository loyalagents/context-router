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

The following are **semantic meanings**, not six new Core error codes or an added
response envelope. Use existing success/error contracts wherever possible.

| Caller receives or observes | What it establishes | Safe caller action |
| --- | --- | --- |
| Ordinary authorized success | The operation succeeded and the returned representation/identifier is authorized under its stated limits. | Keep the role-correct reference/version when present; use them only under applicable authority. |
| Exact completion-only success | The operation succeeded; no representation or reference accompanies this reply. It does not assert the entry is still active or unchanged. | Stop retrying to perform the write. Do not create again to obtain a missing reference. |
| Confirmed pre-execution rejection or verified no-effect rollback | This attempt made no mutation. It does not answer the outcome of a different earlier attempt. | Correct the request/authority if appropriate; distinguish this from a lost earlier reply. |
| Authentication/authorization denial on a retry | This new request cannot execute or recover protected information. The original outcome may remain unknown. | Stop unauthorized recovery. Do not substitute a grant or fresh key to recover the old operation. |
| Authorized key/request mismatch | The presented method, target or bytes do not match that key's original binding. No second mutation occurs. | Recover the exact original request; changing the key is not recovery. |
| Temporary unresolved outcome | After authorization checks, execution is known to be outstanding or its outcome is temporarily indeterminate during recovery. Neither success nor rollback is asserted. Known ineligibility is denial, not this temporary condition. | When authorized, retry the same operation/key/bytes within the protected window, following retry guidance. |
| Lost connection or no reply | The caller has no confirmed outcome. | Use the supported keyed recovery contract if still eligible; no blind automatic resend for unkeyed or out-of-window requests. |

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

## Bounded HTTP idempotency

Keep the existing scope: create and revise **MUST accept** `Idempotency-Key`, and
clients SHOULD supply it. Soft withdrawal retains its existing SHOULD support;
clients need known support before automatically retrying it. No new idempotency
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
  time; neither a new key nor an expired window is safe automatic recovery.

For overlap or temporary inability to establish a recovered outcome, recommend a
single **HTTP-binding temporary response with `Retry-After`**, after optional bounded
waiting. The concrete mapping proposed for review is 503; reserve the existing
`idempotency-conflict` for a proven mismatch. This changes the coordinator's earlier
409 preference. It is not a new Core `subject-unavailable` meaning, task service,
status endpoint or claim that generic HTTP clients may automatically retry any POST.
Settle the binding/schema mapping in review before implementing it. An unrecoverable
committed-key state is a failed recovery guarantee, not permission to start fresh.

## Storage flexibility does not silently weaken result recovery

Base §9.6 currently requires the original response, including its identifier and
version, for an eligible exact retry. #49 must express identifiers according to
the caller's role: a Context Client receives its grant-scoped ref, not a management
identifier. The eligible result guarantee covers create **and revise**.

For this smaller batch, **preserve that observable eligible-result guarantee**
while replacing the requirement to retain a particular response representation
with enough durable information to reproduce it. A provider need not retain the
serialized response bytes or a separate full-body copy if it can satisfy the same
result from retained, authorized original information. It may not substitute current
entry data, manufacture a fresh disclosure, refresh a deadline or reconstruct a
candidate that the applicable rules require to remain invalid or erased.

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
| Alternative minimal/reference recovery and broader #34 policy relaxations | C8 protocol/adoption owner; before removing the existing eligible-result guarantee or changing selected retry-denial policies. |
| Temporary HTTP response mapping | C8 binding owner in #49; settle the one shared mapping before spec candidate freeze. |
| In-flight execution/revocation and slow physical commit (#2) | C8 authority owner; before broader timing/authorization claims. |
| Erasure and retained operation metadata (#23/#39, D3) | C8 protocol owner with C9 capability owner; before combined erasure/retry qualification or any personal-data extension. |
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
   and caller actions. Confirm the result-preservation scope and temporary HTTP
   mapping; make any changed product policy explicit. No reviewer recommendation
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
this paragraph records that result after the review. Corrections made candidate
versus wire-result identity explicit, bounded temporary responses to factual
uncertainty, preserved denial/expiry semantics, and aligned optional-path tests.
The reviews approve the plan, not the unresolved HTTP mapping or an implementation.

Markdown link validation passed across 170 files; tracked/untracked whitespace and
the archived guide's exact hash passed. Consumer searches found the portfolio link
and no executable reader requiring additional tests. No runtime checks or new CI
qualification were run for this planning-only edit; publication and implementation
use the applicable exact-candidate checks above. Preserve the installed app,
personal/demo state, separately owned encryption work and historical C6/C7b/C7c
evidence.
