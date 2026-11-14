# Authorization changes after a committed write

## Research for Context Router’s adoption of HCP

**Research date:** November 11, 2026, America/Los_Angeles. Some source timestamps are November 12 UTC.

**Normative target examined:** HCP `2.0-draft-3`, commit `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`.

**Scope:** Research and proposed specification language only. No application changes, live-account experiments, or issue publication. Existing Context Router decisions are treated as application choices, not evidence of protocol requirements.

## 1. Answer in brief

**There is no single established rule that every committed write must lose its response when authorization changes. There are concrete precedents for returning the operation’s result, for returning success while removing protected content, and for separately authorizing later result retrieval. The precise commit–revocation–response race is undocumented in several prominent APIs.**

- **An ordinary Kubernetes mutation is a concrete example of returning the result under the mutation request’s authorization.** In the pinned v1.34.0 path examined, authorization precedes processing; successful storage is followed by response serialization without a general second authorization or separate `get` check. This is implementation evidence, with resource and extension limitations.[K-auth](#source-k-auth)[K-create](#source-k-create)[K-response](#source-k-response)
- **FHIR/SMART provides a standards precedent for separating write and read authority.** Its minimal-response mechanism can avoid returning a resource. An especially relevant HAPI FHIR development-tree fix preserves success for an applied PATCH while omitting a body the caller cannot read. It corrects earlier behavior that saved the change but reported `403`.[SMART](#source-smart)[FHIR](#source-fhir)[HAPI-fix](#source-hapi-fix)
- **Idempotency is not universally exact response replay.** Stripe v1 stores the original status/body; Stripe v2 and EC2 can return updated results without repeating successful effects. Google’s guidance permits current resource state when historical success cannot be reproduced.[Stripe-v1](#source-stripe-v1)[Stripe-v2](#source-stripe-v2)[EC2-idem](#source-ec2-idem)[G155](#source-g155)
- **Revocation and expiry do not have one universal effect on admitted work.** AWS expressly allows an in-progress upload to succeed after revocation in one documented workflow. Google documents another workflow whose unfinished destination writes can fail after permission loss or expiry. Neither establishes a rule for every completed write.[S3-upload](#source-s3-upload)[G-logging](#source-g-logging)

**Recommendation for HCP:** authorize the mutation, authorize disclosure of its representation, and authorize knowledge of its completion as separate decisions. Once a mutation is durably committed, ordinarily return a tightly limited completion acknowledgement on the original response path. Release a content-bearing result only under the separately defined disclosure contract. Treat a later retry as a new request with current authorization; preserve duplicate suppression even when a response payload is invalidated.

This is a recommended HCP policy, **not a finding that HCP already permits it**. The pinned create/revise results require entries/disclosures; a completion-only fallback and an explicit acknowledgement exception need specification changes.[H5](#source-h5)

## 2. The boundaries that must remain distinct

| Concept | Meaning in this report | What it does not imply |
|---|---|---|
| Mutation permission | Authority to perform this particular state change, with its target, conditions, and limits | General authority to read the resulting resource |
| Representation permission | Authority to receive specified resource fields, relationships, evidence, and metadata | Authority to perform another mutation |
| Completion permission | Authority to learn an operation’s outcome, such as committed | Authority to inspect the resource or query arbitrary operation keys |
| Durable commit | The mutation has reached the promised storage durability boundary | A response was sent, or the client knows the outcome |
| Response handoff | The provider releases bytes beyond the last boundary at which it can reliably prevent their delivery | Socket drain, receipt by the application, or use of the data |
| Client receipt | The client actually receives some or all of the response | Something the server can always establish from a successful write call |
| Later retry | A new request asking to resolve the same logical operation | Continuation of the original request’s authorization entitlement |

Two additional terms are needed to discuss slow commits accurately:

- **Admission:** accepting a request for processing after initial checks. This can precede validation, queuing, and storage work by a substantial interval.
- **Irrevocable mutation decision:** the last enforceable decision to proceed with the specific mutation after which the provider cannot reliably cancel its commit. Call this boundary **M**. It is distinct from a later observation that the write is durable, **C**. It must describe an actual execution boundary, not an arbitrary flag used to grandfather work.

Let **R** be effective revocation, **H** response handoff, and **D** client receipt. The central case is `C < R < H`; changing what happens at H cannot reverse C. For expiry during storage, however, `M < expiry < C` is possible. A permission check immediately before calling a database does not establish authority at every instant during that call. This is concurrency reasoning, not a requirement taken from an external protocol.

For R, distinguish the person initiating revocation, the authorization service recording it, and the provider’s promised enforcement point. OAuth explicitly recognizes propagation and introspection-cache considerations; a stronger HCP contract must define its own boundary.[OAuth-revoke](#source-oauth-revoke)[OAuth-introspect](#source-oauth-introspect)

## 3. Comparison: authorization and original responses

**Evidence labels:** **N** = normative language in the identified specification; **D** = official documented API behavior or guidance; **I** = inspected official implementation; **T** = inspected upstream test assertions, not tests run for this report; **U** = not established by the checked sources. A draft’s normative language binds that draft’s design, not the internet generally.

| System and version examined | Authorization timing actually established | Mutation response versus read permission | Revocation/expiry during the original request | Evidence and limits |
|---|---|---|---|---|
| **Stripe API v1**, current `/v1` documentation | Valid credentials and method/resource permissions required; invalid keys can fail before endpoint execution | Restricted-key **Write includes Read** for that resource. Not a clean write-only analogue | Exact admission/commit/handoff race **U** | **D** for keys, errors, and response caching; no public server-path or race experiment[Stripe-keys](#source-stripe-keys)[Stripe-errors](#source-stripe-errors) |
| **Stripe API v2**, current `/v2` documentation | Same documented key model; exact internal checkpoints **U** | Same restricted-key qualification; endpoint result may include additional data | Exact post-commit response-release policy **U** | **D** for v2 replay behavior; do not import v1 semantics[Stripe-v2](#source-stripe-v2) |
| **AWS EC2**, Query API `2016-11-15`, `RunInstances` | IAM evaluates requests; exact storage/release checkpoints **U** | The action returns instance information. Official launch-policy examples do not require `DescribeInstances`; this supports operation-specific result authority | Whether an admitted request is cancelled or its response withheld after effective IAM change **U** | **D**, with inference limited to the documented action/result contract. EC2 asynchronous workflow completion is not a single database commit[EC2-run](#source-ec2-run)[EC2-policy](#source-ec2-policy) |
| **Google standard methods**, AIP-133/134/211 | Authorization before validation; no general release-time rule | Create/update return a resource. AIP-211 says check the called operation’s permissions; it does not universally define which extra field-level permissions apply | Exact commit/revoke/release behavior **U** | **D**, approved API design guidance, not proof of all Google service internals[G133](#source-g133)[G134](#source-g134)[G211](#source-g211) |
| **Google long-running operations**, AIP-151 plus Route Optimization RPC | Initial method and later operation retrieval are distinct requests. Concrete `GetOperation` requires `routeoptimization.operations.get` | An operation handle/result has its own access contract; it may contain protected metadata | General cancellation-on-revocation rule **U** | **D** for the pattern and concrete retrieval permission; not a universal Google permission name[G151](#source-g151)[G-operation](#source-g-operation) |
| **Kubernetes v1.34.0**, ordinary generic ConfigMap mutation path | Request authentication/authorization, admission/validation, storage, response. No general post-storage reauthorization found in inspected path | Result returned without a separate `get` check | An RBAC change after the earlier allow does not introduce a later check in this path; completion/result can proceed | **I** at pinned commit; not every API, webhook, admission plugin, or custom server[K-auth](#source-k-auth)[K-create](#source-k-create)[K-store](#source-k-store)[K-response](#source-k-response) |
| **FHIR R4 4.0.1 + SMART 2.2.0** | Access-control enforcement is left to the implementation; exact race **U** | Separate create/read/update permissions; successful writes can return minimal content or a representation | No specified post-commit revocation behavior | **N** for the identified REST/scopes provisions; combining them does not prove a late recheck[FHIR](#source-fhir)[SMART](#source-smart) |
| **HAPI FHIR official development snapshot**, commit `3f77c0…` | PATCH write checks plus outgoing-body authorization; rule list cached per request | Disallowed PATCH resource body is removed while success survives; plain create/PUT and matching conditional create differ | Fresh revocation lookup **U**; cached rules mean an outgoing check alone is not such evidence | **I + T**, snapshot identified below; no deployment prevalence or executed-race claim[HAPI-code](#source-hapi-code)[HAPI-tests](#source-hapi-tests) |

### What the strongest implementation evidence actually shows

**Kubernetes.** The specimen is release **v1.34.0**, commit `f28b4c9efbca5c5c0af716d9f2d5702667ee8a45`, not a claim about the latest release. The request filter calls `Authorize` and invokes the handler on allow. The generic create handler calls storage; after success it selects `201` and passes the resulting object through response transformation and serialization. ConfigMap storage uses that generic store.[K-auth](#source-k-auth)[K-create](#source-k-create)[K-store](#source-k-store)[K-configmap](#source-k-configmap)[K-response](#source-k-response)

The checked storage path reaches an etcd conditional transaction. Its successful return precedes response writing. No independent read authorization or general fresh authorization gate appears in that ordinary path. Update can perform an additional **create** authorization for create-on-update, and specialized components can add checks; therefore “Kubernetes checks exactly once for all writes” would be false.[K-etcd](#source-k-etcd)[K-update](#source-k-update)

**HAPI FHIR.** The inspected commit is `3f77c0353b0bf07f0b06eaaa56df43e501447bff`, dated November 10, 2026; its project version is `9.1.3-SNAPSHOT`. The change record is filed under `9_0_0`, which is not evidence that this behavior is deployed in a released 9.0 server.[HAPI-pom](#source-hapi-pom)

Its PATCH hook clears the response resource when disclosure is denied. The accompanying change record identifies the former saved-write-plus-403 behavior as a defect. This is a particularly direct precedent for separating outcome from representation, but the rule-list cache prevents treating it as evidence of fresh revocation evaluation.[HAPI-code](#source-hapi-code)[HAPI-fix](#source-hapi-fix)

The upstream tests distinguish several cases: write-only PATCH has success, empty content, and a persisted amendment; read-and-write PATCH exposes preserved fields; ordinary create/PUT return submitted content; a conditional create matching an existing record hides that record’s body but retains a `Location` identifying it. These assertions were inspected, not executed here.[HAPI-tests](#source-hapi-tests)

### Counterexamples that constrain any generalization

AWS’s S3 Encryption Client for Java documentation, currently showing 4.x, explicitly allows a high-level multipart upload already in progress to succeed after required S3/KMS permissions are revoked. Later upload requests fail. This is a real documented in-flight distinction, but it does not locate a database commit or guarantee delivery of particular response bytes.[S3-upload](#source-s3-upload)

Conversely, Google Cloud Logging documents that an ongoing copy can fail to write/finalize destination data when initiating-account permissions change or credentials expire. Already copied entries can remain after cancellation. This concerns unfinished multi-step work, not a successful atomic mutation followed by a withheld acknowledgement.[G-logging](#source-g-logging)

S3 also documents that a presigned download started before expiration can continue afterward, while a restarted request after expiration fails. This is an expiry counterexample for a **read**, not proof about explicit revocation or mutations.[S3-expiry](#source-s3-expiry)

## 4. Comparison: retries, response loss, and restoration

| System | Documented duplicate/outcome behavior | After permission loss or narrowing | After permissions return and a payload has been invalidated |
|---|---|---|---|
| **Stripe v1** | Stores first execution’s status/body, including `500`; retention at least 24 hours, after which pruning can make key reuse a new operation | Ordinary credential/permission errors apply; precise replay-cache authorization ordering **U** | Permission-triggered invalidation and restoration behavior **U**[Stripe-v1](#source-stripe-v1)[Stripe-errors](#source-stripe-errors) |
| **Stripe v2** | Within its API/account-or-sandbox/30-day scope, successful work is not repeated; response can be updated. Failed/partial work may be retried | Specific revoked/narrowed replay policy **U**; updated-response behavior is not proof of current authorization | Cache lifecycle and restoration **U**[Stripe-v2](#source-stripe-v2) |
| **EC2 client token** | Same token/parameters suppresses further action; result can show updated status. Scope can be regional/zonal | New requests encounter IAM rules; exact private dedupe/auth ordering **U** | Permission-driven response invalidation/restoration **U**. No generic EC2 token TTL established here[EC2-idem](#source-ec2-idem) |
| **Google AIP-155** | Prior success normally returned; current resource state allowed when historical success is unavailable. Validity period is API-defined | General authorization guidance still applies; revocation-specific replay interaction **U** | Current-state reconstruction is an allowed alternative in the AIP, not a requirement to resurrect discarded payloads[G155](#source-g155)[G211](#source-g211) |
| **Kubernetes ordinary create/update** | No general original-response replay cache in the examined path. Named creates can hit existing-object errors; version-conditional updates can conflict | A new request passes request authorization again; policy caches/propagation remain implementation concerns | Current retrieval and concurrency rules apply; no equivalent invalidated-response contract identified[K-auth](#source-k-auth)[K-store](#source-k-store)[K-concepts](#source-k-concepts) |
| **FHIR/SMART and HAPI specimen** | These provisions do not establish a general Idempotency-Key contract | New interactions require their relevant authority; exact replay semantics **U** | **U**; do not infer from minimal-response support[FHIR](#source-fhir)[SMART](#source-smart) |
| **IETF Idempotency-Key draft -08** | Completed retry should produce a response consistent with the user’s completed intent; resource documents expiry policy | Security section addresses cross-client cache leakage, but does not settle revocation/replay ordering | **U**; no universal invalidation/restoration policy[IDK](#source-idk) |

**A lost response leaves the caller uncertain.** It does not establish failed mutation or authorize a new logical operation. Stripe explicitly discusses side effects despite server errors and recommends reconciliation outside the safe retry window. AWS’s design guidance explains why duplicate suppression alone, with an unhelpful “already exists” result, can still leave clients unable to recover.[Stripe-errors](#source-stripe-errors)[AWS-retries](#source-aws-retries)

There are three distinct useful promises:

1. **Effect idempotency:** the logical mutation is not executed again.
2. **Outcome stability:** the provider remembers that this operation committed, failed, or remains unresolved.
3. **Representation replay:** the provider can and may return the original resource-bearing response.

The first two can survive loss or deliberate invalidation of the third. Conversely, returning a current resource does not reproduce the original response: it may incorporate subsequent edits, new policies, or a different disclosure lifetime. That distinction is central to the recommended HCP contract below.

### HTTP, OAuth, and the current IETF draft

HTTP permits successful responses without content. `204` indicates fulfillment; `202` indicates processing is incomplete. `401` specifically describes a request that was not applied because valid authentication was missing, making it a poor description of the **same** known-committed mutation. `403` is less specific; it should not be treated as a universal rollback assertion. None of these status codes defines database durability.[HTTP](#source-http)

RFC 7240 provides `Prefer: return=minimal` and `return=representation`. Preferences can be ignored; the header supplies neither authorization policy nor an exception to HCP’s response requirements.[Prefer](#source-prefer)

OAuth revocation invalidates evidence; bearer-token errors distinguish invalid evidence from insufficient scope. The cited RFCs do not define transaction cancellation, a post-commit response gate, or permission to learn operation completion. Introspection-cache guidance explicitly acknowledges stale decisions.[OAuth-revoke](#source-oauth-revoke)[OAuth-bearer](#source-oauth-bearer)[OAuth-introspect](#source-oauth-introspect)

The latest draft found is **`draft-ietf-httpapi-idempotency-key-header-08`**, published **October 22, 2026**, expiring April 25, 2027. It is an active Internet-Draft, not an RFC. Its revised completed-retry wording is still under discussion. It does not impose HCP’s 24-hour retention rule or a general exact-response requirement.[IDK](#source-idk)

## 5. Privacy versus reliability: what withholding actually buys

The following is threat-model analysis and recommendation. It is not a claim that every compared system uses this policy.

| Response being withheld | Information protected | Reliability cost | Assessment |
|---|---|---|---|
| **Bare completion acknowledgement** | The fact that this request committed; possibly success of existence, version, validation, or other conditions | Caller cannot distinguish failure from a completed side effect; retries, duplicate intent, and support/reconciliation become harder | Usually little content-confidentiality benefit for unconditional writes of known input; sometimes meaningful protection of a predicate or existence bit |
| **Exact echo of client-supplied content** | Usually no new content from the server to the same principal that already knew those bytes; it still confirms acceptance | Same uncertainty if success is suppressed; unnecessary retransmission can be avoided independently | Prefer minimizing the echo, but do not claim withholding erases what the client already knows |
| **Full resource, merged response, or server-derived result** | Previously stored fields, relationships, enrichment, verification results, identifiers, classification, provenance, and policy information | Losing content alone is manageable if a completion receipt remains; follow-up retrieval may require new authority | Stronger privacy case for withholding or filtering the representation after disclosure authority is lost |

### Bare acknowledgement: small disclosure is still disclosure

For an unconditional create containing “I prefer morning meetings,” a fixed acknowledgement reveals that the provider accepted and stored the supplied statement. If the same authenticated client supplied all the content, suppressing that acknowledgement usually protects very little additional personal content. It cannot retract the statement, remove the stored copy, or stop a malicious client retaining its input.

But “success” can reveal a protected predicate. Examples include:

- “Revise reference X only if its version is 7”: success confirms an existence/version condition.
- “Create only if no matching medical observation exists”: different outcomes can reveal a prior record.
- “Attach this relationship only if the target is valid”: success may reveal target state.
- “Save only after checking a confidential eligibility rule”: success exposes the rule’s result.

These examples are reasoning about conditional operations; they are not assertions that HCP implements each operation. FHIR’s security guidance independently recognizes existence leaks through write behavior.[FHIR-security](#source-fhir-security)

Therefore, completion visibility should be part of the authorization contract **before executing** such an operation. If revealing its outcome is unacceptable, the API needs a deliberately opaque operation/recovery model or must reject before execution. Discovering afterward that even a success bit is forbidden produces a genuine privacy/reliability tradeoff; a generic error does not solve it.

### Echo: verify the “all the content” premise

A pure echo is only a pure echo if the recipient principal already knew every byte and receives no extra information through status, headers, or timing. This premise can fail when a client is a conduit for encrypted/signed material, when another component supplied the request, or when a server normalizes or enriches it.

Inspect headers too. A resource URI, grant-bound reference, ETag/version, timestamp, generated identifier, or resolved relationship may be new information despite an empty body. An opaque identifier is not automatically harmless merely because it is difficult to guess.

### Full result: a write can become a read

Stripe’s customer-update example sends a metadata change and returns other stored customer properties. HAPI’s read-and-write PATCH test returns a merged resource containing a previously stored diagnosis marker. These are concrete examples of why the resulting representation can reveal much more than the input.[Stripe-customer](#source-stripe-customer)[HAPI-tests](#source-hapi-tests)

For HCP, the comparison must use the **Context Client disclosure**, not the provider’s full stored entry. Its disclosure can carry server-produced `ref`, `standing`, evidence verification, and `useUntil`; selected provenance requires its own authorization. A revision also retains classification from the prior entry. Thus HCP’s required write result cannot safely be described as merely “saved successfully.”[H7](#source-h7)[H5](#source-h5)

### Counterarguments to the recommended split

**Return the originally authorized full result.** This can be coherent when the operation’s authorization expressly includes that result and revocation affects only later requests. It avoids a second race and produces predictable clients. Kubernetes’s inspected path is evidence for that model. Its cost for HCP is that newly released personal content can reach a client after revocation; this must be stated plainly rather than hidden in the word “request.”

**Withhold everything.** This gives the strongest response-side protection when even completion is sensitive. Its cost is deliberately creating uncertain outcomes after known side effects. It still cannot stop confirmation through other permitted observations or recall handed-off bytes.

**Reauthorize only when serving cached retries.** This is simpler and protects future requests, but leaves the original-response race unresolved. It is insufficient if HCP promises that not-yet-released disclosures stop at revocation.

The recommended split is a design judgment balancing these costs; the research does not establish it as universal industry practice.

## 6. What the pinned HCP text establishes—and leaves open

| Pinned provision | Consequence for this decision |
|---|---|
| **§§5.2.3–5.2.4** | Create/revise return the resulting entry; Context Clients receive disclosures. No completion-only variant is defined here.[H5](#source-h5) |
| **§6.2.2** | Evidence is invalidated on revocation, current grant status is checked on each request, and post-revocation success using that grant’s evidence is prohibited. “Success” is not precisely ordered against mutation commit and response release.[H6](#source-h6) |
| **§§7.4–7.6** | Disclosure carries grant-specific data and copy-use rules. Token expiry, grant expiry, content validity, and copy `useUntil` are distinct.[H7](#source-h7) |
| **§8.4** | Non-read audit events must be durable before acknowledgement. That is not a complete atomicity or response-delivery contract.[H8](#source-h8) |
| **§§9.4.3–9.4.4, 9.6–9.7** | Create/revise use `201`; keys and responses are retained at least 24 hours, identical retries return the original response without another mutation/audit event, and existing authentication/authorization errors have defined mappings.[H9](#source-h9) |

The tension is real, but its resolution is not established by reading one clause in isolation. If “succeeds” means durable mutation, case B succeeded before revocation. If it means release of any successful response, case B would prohibit even an acknowledgement. If it means fresh protected disclosure, an acknowledgement and a resource representation may differ. HCP should choose and name these meanings.

There is a narrow internal precedent: **§5.2.7 relinquishes the caller’s own grant, while §9.4.6 returns `204`**. That explicit endpoint prevents a simplistic reading that forbids every successful byte after the grant becomes revoked. It does not grant create/revise an unspecified alternative result.[H5](#source-h5)[H9](#source-h9)

The issue boundaries are also useful. **#2** explicitly excludes committed mutations. **#34** covers key scoping and replay authorization; its Context Router comment records the existing cache-invalidation decision and leaves original committed-write ordering undecided. **#23** owns hard deletion versus retained replay. Issue #34’s opening references a different commit, so this report uses the user’s pinned revision rather than treating issue discussion as an adopted specification.[Issue2](#source-issue2)[Issue34](#source-issue34)[Issue34-comment](#source-issue34-comment)[Issue23](#source-issue23)

## 7. Recommended HCP contract

Everything in this section is a **proposal**. Normative verbs describe proposed behavior, not current conformance requirements.

### 7.1 Decide mutation authority separately from response authority

Check authentication and effective mutation authority at admission, and again at the final enforceable mutation decision **M**. Order M with revocation and relevant policy changes. If revocation or expiry wins before M, reject without applying the mutation.

Define M narrowly: the final authorization decision for the concrete, validated mutation immediately entering an irrevocable commit phase. It must not be request receipt, queue admission, or an unlimited reservation to perform future work. A delayed background step that can still be prevented must check its own authority; it cannot rely forever on an old admission.

**An already irrevocable commit may finish after revocation or expiry under this proposal.** This is a second, independent policy choice from allowing an acknowledgement after a prior durable commit. It must not be concealed inside terminology. If HCP instead requires that no mutation become durable after revocation/expiry, it needs a stronger, testable transaction/deadline contract. An ordinary final precheck does not supply that guarantee.

Revocation must promptly block new mutation decisions and new protected disclosures. Do not postpone its effectiveness until a slow commit, transport flush, or client acknowledgement completes. Bound the admitted operation’s scope and processing lifetime; publish how stalled or uncertain commits are reconciled. A timeout can stop waiting without proving that an irreversible database operation was cancelled.

### 7.2 Include a bounded original-request completion entitlement

For ordinary create/revise operations, authorizing the mutation should include permission to receive its terminal completion fact on **that original response path**. Once durable commit is known, preserve that fact even if mutation permission is subsequently lost.

This entitlement:

- Covers only the specific originally authorized operation and its original recipient/channel.
- Does not authorize another write, a resource representation, an arbitrary status lookup, or a later replay with revoked evidence.
- Does not turn an idempotency key into an access credential.
- Does not promise successful delivery or justify keeping a disconnected response channel alive indefinitely.
- Must be disclosed as part of the operation contract; it is an intentional authorization to reveal completion, not a claim that completion is non-sensitive.

Default to a fixed outcome plus, if needed, the client’s already-supplied operation identifier. Exclude entry content, canonical IDs, new `ref`s, versions, detailed timestamps, provenance, and rule diagnostics from the guaranteed minimal receipt. Authorize any additional metadata separately.

For a privacy profile where even the completion bit must become inaccessible immediately, state that exception **before execution**. Such a profile can withhold outcome information, but must explicitly leave the caller uncertain and provide an authorized recovery route. It should not be the accidental result of returning a generic auth error after the fact.

### 7.3 Treat the full result as a separately authorized disclosure

Specify whether write permission includes any result fields. My recommendation is:

- Mutation permission includes the tightly defined original-request receipt.
- Resource content and enriched/server-derived fields require explicit disclosure authority.
- For HCP, use the same-grant read/category/purpose/narrowing and applicable policy rules for that disclosure, including provenance authority where relevant.

This means a write-only grant can perform the write and receive its receipt. It does not silently acquire general read authority. HCP would need to say how a write requests a content-bearing result and supplies the purpose needed for its disclosure; this is not fully supplied by the pinned create/revise request shapes.

Before release, evaluate the actual prepared representation and its deadlines against current authority. Coordinate that decision with revocation and the defined handoff boundary; checking and then asynchronously sending without coordination leaves the same race intact. Do not silently switch to another grant or combine grants when the original one no longer authorizes the result.

If only mutation permission has been removed but the original grant still authorizes the representation, the committed result can still be disclosed. If the grant/evidence is invalid or read authority has disappeared, send the authorized completion-only result instead. The server should distinguish those cases rather than re-requiring permission to perform a write that already happened.

Current disclosure authority is necessary, but does not override a recorded payload invalidation. Under Context Router’s selected policy, a discarded prepared/cached payload must not be resurrected; any permitted reconstruction must be identified as a fresh disclosure. Define which permission changes make a payload “affected” so the original-response and replay policies compose consistently.

Do not extend a prepared copy’s deadlines merely to get it out of the server. A fresh authorized retrieval may generate a new disclosure; it must be identified as a new retrieval, not as the original replay. Expiration of a token, expiration of its grant, and expiration of a disclosed copy are separate checks with separate consequences.

### 7.4 Give completion-only success an explicit Core and binding representation

Define a Core write-result variant whose meaning is “this operation durably committed; no resource disclosure accompanies this result.” Use it consistently in HTTP and MCP, with no dependence on HTTP header support alone.

An illustrative shape—not a current HCP schema—is:

```json
{
  "operationKey": "the-client-supplied-key",
  "outcome": "committed",
  "representation": "not-included"
}
```

The exact names are negotiable. Avoid a detailed reason that reveals whether a policy change, resource state, or private rule suppressed the representation. `committed` is a historical fact, not a claim that the resource remains active, unchanged, or currently readable.

For HTTP, keep `201` for an original successful HCP create or revision and explicitly allow the new result variant. A bodyless `204` could also be designed, but changing status introduces additional compatibility work. Do not use `202` as a final acknowledgement of already completed work. For a later successful reconciliation, explicitly distinguish “committed previously” from “newly created now.” These are proposed mappings and require HCP agreement.

`Prefer: return=minimal` may be offered as a convenience after the Core contract exists. Authorization should be able to omit a protected representation even when the client asks for it. Neither the header nor a newly introduced JSON envelope is automatically conformant with the pinned draft.

### 7.5 Use errors that describe the request actually being rejected

| Situation | Recommended semantics |
|---|---|
| Original request denied before M, with no mutation applied | Authentication/authorization error as appropriate; no committed result |
| Original request known durably committed, representation no longer authorized | Successful completion-only result under the original-request entitlement |
| Original request’s commit outcome is uncertain | Do not assert committed or not committed. Preserve operation identity; direct safe reconciliation/retry under current authority |
| Later retry lacks valid evidence or sufficient authority | Deny the **new request** without revealing key existence, previous outcome, conflict details, or protected content |
| Later request currently authorized to learn this operation’s outcome; operation committed, original payload permanently invalidated | Return an explicitly defined committed-outcome result; do not rerun the mutation or claim to return the original resource response |
| Authorized same-key request with different intent/body | Defined idempotency conflict; do not disclose conflict information before the caller is allowed to learn it |

For a later retry, ordinary `401`/`403` does **not** mean the first attempt failed. The protocol should say this generally, rather than adding a revealing “your old write committed” detail to an unauthorized error. If HCP chooses errors for unavailable historical replay, use a distinct documented condition with an explicit no-reexecution rule; the preferred design here is a success receipt when completion disclosure is authorized.

Use the binding’s `invalid-token`/`401` category for invalid authentication evidence and `scope-denied`/`403` for valid evidence with insufficient authority. A revoked-evidence denial must be consistent with the explicit invalidation rule. Do not put `committed: true` into an unauthorized retry’s problem body, because that would disclose the outcome the authorization check is supposed to protect.

A lost response, timeout, process crash, or post-commit serialization failure is also not a rollback report. The operation record must remain truthful even if no successful reply is ever received.

## 8. Explicit timelines A–F

The table separates evidence about existing systems from the proposed HCP behavior. **M** is the final irrevocable mutation decision; **C** durable commit; **R** effective revocation; **H** handoff. An expiry is a time boundary rather than a revocation request.

| Timeline | What the evidence establishes | Recommended HCP outcome |
|---|---|---|
| **A. R before C** | Inspected Kubernetes processing is not continuously reauthorized. Other APIs do not supply a universal precommit cutoff | **Split the case.** If R precedes M, deny and do not mutate. If `M < R < C`, an already irrevocable commit may settle under the proposed admitted-work exception. Do not describe this as a strict no-durable-write-after-R promise. If C succeeds, acknowledge completion; withhold unauthorized representation |
| **B. C, then R, then H** | Kubernetes supplies a full-result implementation precedent; HAPI supplies success-with-protected-body-omitted precedent, without demonstrating fresh revocation | Keep the committed mutation. Return the original-request completion receipt. Do not hand off a full disclosure unless the separate current disclosure check permits it |
| **C. Authority expires during a slow durable commit** | No general cross-protocol guarantee. An expiry precheck cannot by itself prevent a later durable commit | If expiry wins before M, do not begin irrevocable mutation. If `M < expiry < C`, let the irrevocable outcome resolve, then report it truthfully. Expired disclosure authority prevents new protected content. Do not renew authority just to finish |
| **D. H, then R, before actual receipt** | Handoff and receipt differ; no cited contract can recall bytes already outside the provider’s control | Complete revocation for future decisions/releases without waiting for the recipient. Already handed-off bytes may arrive. Do not log “received” merely because the response was handed off |
| **E. C, response lost, later retry after permission loss** | New-request authorization and duplicate-effect protection are distinct; cache/auth ordering is undocumented for several compared APIs | Authenticate and authorize the retry before revealing operation state. Deny unauthorized access, retain duplicate suppression, and make no claim that the original write failed. Do not instruct automatic retry with a new key |
| **F. Permissions restored after cached response invalidation** | Compared protocols do not specify Context Router’s exact invalidation lifecycle; Google explicitly allows a different current-state response in its own model | An invalidated payload stays invalidated. With current outcome authority, return a committed receipt; with current read authority, permit separately identified retrieval. Never reexecute because the payload is gone. Handle replacement grants and new references explicitly |

**A and C are not fully determined by the order of durable commit and revocation alone.** A contract that uses M must state that addition openly. If maintainers prefer strict revocation-before-durable-commit wins, they must choose a mechanism and observable semantics that can uphold it; they cannot get it merely by promising a second permission check. The response recommendation for B remains useful whichever mutation-boundary policy HCP selects.

For D, distinguish a whole prepared response transferred to transport from a streamed response whose later chunks remain under application control. The latter needs a declared chunk/release policy. “Headers sent” does not mean every body byte has been released, and neither means the recipient has read them.

## 9. Assessment of Context Router’s existing retry decision

The selected policy—current authorization on retries, affected-payload invalidation on effective permission change, and durable duplicate suppression—is defensible. **The needed refinements concern scope, durability, disclosure rights, and recovery.** None of the comparisons makes that exact lifecycle mandatory.

### Preserve three kinds of state separately

Keep the conceptual distinction between:

1. The immutable operation outcome and identity used to prevent another mutation.
2. The caller/grant-specific response payload and whether it remains eligible for replay.
3. The current authorization to learn the outcome or obtain a fresh resource disclosure.

This is a behavioral model, not a required cache architecture. Payload invalidation must not overwrite “committed” with “unauthorized,” turn the key into a cache miss eligible for execution, or erase an unresolved in-progress record.

The mutation and its consumed-operation record must also be failure-consistent: use an atomic durable outcome or equivalent recovery protocol. A crash between committing the data and recording the key must not leave a committed write eligible for execution again. Conversely, a prewritten reservation does not prove the mutation committed. An unresolved reservation must be reconciled; expiry of a worker lease alone must not turn uncertainty into permission to repeat the side effect. AWS’s engineering guidance explicitly connects idempotency-token recording with mutation atomicity.[AWS-retries](#source-aws-retries)

### Coordinate invalidation with prepared copies and restart

Deleting a cache entry is insufficient if a response has already been copied into memory and can still be sent. Effective permission change must fence affected prepared responses that have not crossed the release boundary. Persist invalidation so restart or restored policy cannot make a discarded payload eligible again. Leave independently authorized clients/grants unaffected unless the underlying policy actually reaches them.

Invalidation is more conservative than authorization-on-every-replay. A system could instead keep an encrypted historical payload and release it only if later authorization permits, or reconstruct a current result as Google permits. Those are legitimate alternative policies with different privacy and recovery costs. Context Router’s monotonic invalidation intentionally gives up later exact replay, even after permissions return; document that choice.

### Avoid the grant-scoped duplicate-suppression trap

If the entire operation identity is `(grantId, key)`, replacement grant G2 can make the same attempted operation under old G1 look new. But if a key is globally shared across tenants or clients, it can create collisions and disclosure risks.

Define duplicate identity using the appropriate provider/tenant, Context Subject, stable client identity, operation, and client key. Retain original grant provenance and separate replay/disclosure authorization. Include the target and canonical request meaning in conflict detection. Do not allow a change of credential, grant, or response preference to silently turn the same intended mutation into new work.

Grant-bound references make this harder: a retry under a replacement grant may not legally reuse its old `ref`, and using a new `ref` changes the raw request body. HCP must define whether that is a reconciled operation, a conflict, or a separate status lookup. Do not normalize away a meaningful authorization distinction merely to make retries convenient. The IETF draft’s composite-key recommendation supports isolation, but does not decide this HCP identity problem.[IDK](#source-idk)

### Specify a recovery route when the original reference never arrived

“Just perform a fresh GET” is incomplete after a lost create response: the client may never have learned the new entry’s `ref`. Under replacement authority, even a known old reference may be unusable.

Recommended recovery behavior:

1. The client retains its operation key before the initial send.
2. A retry or dedicated reconciliation operation is checked under current authorization.
3. The provider uses durable operation identity internally to distinguish committed, uncommitted, and unresolved states; unauthorized callers learn none of these distinctions.
4. An authorized caller receives the allowed outcome. If resource access is also permitted, a separately specified recovery path can supply a currently valid grant-bound reference and a fresh disclosure, or the person can inspect the operation through management access.
5. A fresh read describes current or explicitly selected historical data; it is not labelled the discarded original response. Completion of version N does not mean N is still current or even available.

Do not append a second mutation event merely to replay or reconcile the same committed operation. A separately authorized new disclosure should have its own applicable disclosure/audit treatment; HCP should distinguish this from its prohibition on duplicating the original operation’s audit event.

A new grant is not equivalent to reactivating a revoked grant. Likewise, restoration of write authority alone should not restore resource-reading authority. A person-facing management recovery flow is acceptable when the client cannot be allowed to reconcile, but it must be explicit.

### State the duplicate-suppression horizon

“Durable” means surviving the promised failures; it does not mean retained forever. Specify how long a consumed key remains recognizable, how expiry is determined, and what happens after it can be forgotten. A safe client must not infer that a missing payload means a fresh key is safe.

Where the server can recognize an expired/consumed operation identifier, reject or reconcile it instead of executing again. Where the identifier is wholly forgotten, no content-free guarantee can distinguish it from a genuinely new operation without additional scope/epoch information. The client should reconcile through an authorized route instead of blindly choosing a new key.

### Keep hard deletion separate

Permission invalidation is not erasure. A duplicate-suppression fingerprint derived from personal content may still retain information; even a receipt can reveal sensitive facts. Whether deletion must erase these, and what token-only state may remain, belongs to #23 and the deletion contract. Do not claim that hashing automatically makes a retained fingerprint content-free, or that permission restoration authorizes reconstructing hard-deleted content.[Issue23](#source-issue23)

## 10. Does HCP need a focused issue?

**Yes.** The original-response question has a distinct decision boundary and should not disappear inside #34’s later-retry work. A focused companion issue should coordinate with #34 and #2, while leaving erasure to #23. It should present the response decision independently from the stronger mutation-cutoff decision, so agreement on B does not silently settle A/C.

### Proposed issue text — draft only, not published

**Title: Define original write-response semantics when authorization changes after mutation acceptance or commit**

**Baseline**

HCP `2.0-draft-3`, commit `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`. Relevant provisions: §§5.2.3–5.2.4, 5.5, 6.2.2–6.2.3, 7.4–7.6, 8.4, 9.4.3–9.4.4, 9.6–9.7, and corresponding MCP results/errors.

**Problem**

A provider authorizes a create/revise operation and durably commits it. Before the original response is handed to transport, the grant is revoked, expires, or loses relevant authority. The specification needs an explicit original-response outcome and a precise meaning of success.

Separate permission to mutate, permission to receive the resource representation, and permission to learn completion. Durable commit, provider handoff, and actual receipt are different events. No response, or denial of a later request, establishes that the first mutation failed. Revocation does not undo a committed mutation.

**Questions to resolve**

1. Does original mutation authorization include its complete response, only a completion receipt, or neither after authority changes?
2. Which response fields are authorized by `write`, and which need read/provenance/purpose authority? How does a write-only client receive success?
3. Is there a completion-only success variant when a required disclosure can no longer be released? Specify the Core result and HTTP/MCP mappings; do not rely on optional HTTP preferences to override Core.
4. What event orders mutation authorization with revocation and expiry? Explicitly distinguish final irrevocable execution from later durability. Does already irrevocable work complete after expiry/revocation? Do not delay revocation for network delivery.
5. What event orders protected response release with revocation, including prepared buffers, headers, and partial streaming? No contract should imply recall of already released bytes or proof of receipt.
6. What do authentication/authorization errors mean after an uncertain earlier attempt? An error on a new retry must not imply rollback of the original operation.
7. How does a currently authorized client recover completion and a usable reference when the original response was lost or invalidated? How do replacement grants interact with duplicate suppression and grant-bound references?

**Candidate resolution to evaluate**

Authorize a narrowly scoped original-request completion receipt as part of mutation authority. Once durable commit is known, return that success receipt even if protected representation disclosure is no longer allowed. Gate content-bearing results separately at the defined release boundary. Later requests use current authorization and do not inherit the original response entitlement. Preserve consumed operation identity when replay payloads become unavailable.

Separately decide whether the mutation cutoff is a final irrevocable decision or a stricter durable-commit boundary. This candidate does not assume those are the same event.

**Alternatives to evaluate**

- An authorized mutation includes its original full result despite intervening revocation, with the exposure stated explicitly.
- A strict profile withholds even completion information and accepts unresolved outcomes, with a separate authorized recovery mechanism.
- A response-disclosure error distinct from mutation failure, with explicit committed/uncertain semantics where revealing that distinction is permitted.

**Focused acceptance scenarios**

- Revocation before mutation becomes irrevocable; and revocation after that boundary but before durability.
- Durable commit, then revocation, then original response release.
- Token expiry and grant expiry during slow commit, separately.
- Full response handoff before revocation, with recipient delayed; and partial streaming with unsent bytes.
- Pure supplied-content create, merged/server-derived response, write-only grant, and a condition whose success reveals existing state.
- Lost reply followed by an unauthorized retry: no new mutation and no key/outcome disclosure.
- Restored authority after payload invalidation, including restart and replacement grant: no payload resurrection or duplicate write, with defined recovery.
- Separate unaffected grant/client continues according to its own authority.
- Audit records distinguish mutation outcome, response preparation/handoff, and unconfirmed receipt.

**Relationship to existing issues**

#2 covers in-flight reads. #34 covers replay authorization and idempotency scope. #23 covers deletion/erasure. Coordinate shared terminology and test cases, but do not resolve one by silently changing another’s scope. Existing application decisions are evidence of needs, not adopted protocol resolutions.

### Text changes required for the recommended contract

| Area | Required change or clarification |
|---|---|
| Core create/revise | Add the completion-only result and define the authority for each result component |
| Authorization/revocation | Define success and ordering; explicitly authorize the bounded original-response acknowledgement; separately decide admitted irreversible work |
| Disclosure rules | Define content authorization and deadlines for write results, including write-only requests and their stated purpose |
| HTTP and MCP bindings | Define success variants, headers/metadata limits, status/error mappings, and client handling |
| Idempotency | Make historical-payload replay conditional on authorization and availability while preserving duplicate suppression; specify unavailable replay and restored-authority behavior |
| Recovery and audit | Define operation reconciliation when no reference was received, dedupe across authority changes, and truthful outcome/release/receipt records |

**This requires changing the pinned HCP text.** Defining exactly what “succeeds” means may be a clarification, but adding a new write-result variant and permitting completion after a relevant authority change are substantive choices. If the current authors intended revocation to prevent every not-yet-durable write, the admitted-work exception is an additional substantive change. No existing issue comment, HTTP feature, or external API comparison adopts these changes on HCP’s behalf.

## 11. Evidence limitations

- Public API documentation often specifies requests and results without specifying micro-ordering between durable commit and response release. Those gaps are labelled unknown, not filled with assumptions.
- Official source inspection establishes the behavior of the inspected path/revision. It does not prove every configuration, custom interceptor, distributed deployment, or released binary behaves identically.
- Upstream tests were read, not run. No timing experiments were performed against Stripe, AWS, Google, Kubernetes, FHIR servers, or Context Router.
- Service documentation is a dated snapshot; API namespaces, protocol releases, and implementation commits are identified separately. A `/v2` namespace is not a substitute for an API date-version header.
- The proposed HCP contract is independent analysis. Its strongest justification is truthful operation outcomes with controlled additional disclosure, not an assertion that the compared systems agree.

## 12. Primary sources and reproducibility

All sources below are specifications, official documentation, or official project code. HCP files and implementation sources are pinned where stated. GitHub raw-file retrieval was used where the web renderer could not display a pinned source. No third-party commentary was used to establish behavior.

### HCP baseline and existing issues

<a id="source-h5"></a>

**H5**: HCP `2.0-draft-3`, pinned commit `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`, [§5.2.3 Create](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#523-create), [§5.2.4 Revise](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#524-revise), [§5.2.7 Relinquish Own Grant](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#527-relinquish-own-grant), and [§5.5 Errors](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#55-errors).

<a id="source-h6"></a>

**H6**: Same HCP pin, [§6.1.5 Grant Representation and §6.2 Revocation](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md#622-revocation-propagation), especially §§6.2.2–6.2.3. [§13.4 Token Lifetime](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md#134-token-lifetime) distinguishes token lifetimes from the grant model.

<a id="source-h7"></a>

**H7**: Same HCP pin, [§7.4 Disclosures to Context Clients](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#74-disclosures-to-context-clients), [§7.4.1 Provenance on Request](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#741-provenance-on-request), and [§7.6 Use-Until](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#76-use-until).

<a id="source-h8"></a>

**H8**: Same HCP pin, [§8.4 Durability](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s8.md#84-durability).

<a id="source-h9"></a>

**H9**: Same HCP pin, [§9.4.3 Create](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#943-create), [§9.4.4 Revise](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#944-revise), [§9.4.6 Grants](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#946-grants), [§9.6 Idempotency](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#96-idempotency), and [§9.7 Errors](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#97-errors).

<a id="source-issue2"></a>

**Issue2**: [HCP issue #2: Clarify revocation ordering for in-flight reads](https://github.com/loyalagents/hcp-spec/issues/2), including its explicit committed-mutation exclusion. Issue discussion is not normative specification text.

<a id="source-issue34"></a>

**Issue34**: [HCP issue #34: Clarify idempotency-key scope and authorization checks before response replay](https://github.com/loyalagents/hcp-spec/issues/34). Its opening baseline is `b790561830702c067cd7810c96ee78dd3d84741c`, distinct from the target examined in this report.

<a id="source-issue34-comment"></a>

**Issue34-comment**: [Context Router application-decision comment on #34](https://github.com/loyalagents/hcp-spec/issues/34#issuecomment-6817416594), identifying the selected replay policy and the still-undecided original-write response question.

<a id="source-issue23"></a>

**Issue23**: [HCP issue #23: Reconcile hard deletion with idempotency response replay](https://github.com/loyalagents/hcp-spec/issues/23). Used to establish scope, not to treat a candidate remedy as adopted.

### Stripe and AWS

<a id="source-stripe-v1"></a>

**Stripe-v1**: Stripe, [Idempotent requests](https://docs.stripe.com/api/idempotent_requests), current documentation, API v1 paragraphs on stored status/body, execution start, pruning, and parameter matching.

<a id="source-stripe-v2"></a>

**Stripe-v2**: Stripe, [API v2 overview — Idempotency](https://docs.stripe.com/api-v2-overview#idempotency), current `/v2` contract; distinguish namespace from the required date-version header. This report does not attribute behavior to every historical Stripe date-version.

<a id="source-stripe-keys"></a>

**Stripe-keys**: Stripe, [Restricted API keys — Assign permissions](https://docs.stripe.com/keys/restricted-api-keys#assign-permissions), including the same-resource Write-implies-Read rule.

<a id="source-stripe-errors"></a>

**Stripe-errors**: Stripe, [Advanced error handling](https://docs.stripe.com/error-low-level), “HTTP errors,” “Idempotency,” and retry/reconciliation guidance. The page states that its replay discussion concerns v1 and links separately to v2.

<a id="source-stripe-customer"></a>

**Stripe-customer**: Stripe, [Update a customer](https://docs.stripe.com/api/customers/update), request/response example showing a metadata update and a fuller customer response. The retrieved example uses `Stripe-Version: 2026-10-28.endive`.

<a id="source-ec2-idem"></a>

**EC2-idem**: AWS, [Ensuring idempotency in Amazon EC2 API requests](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html), introductory result semantics, “Idempotency in Amazon EC2,” and “RunInstances idempotency.”

<a id="source-ec2-run"></a>

**EC2-run**: AWS, [RunInstances — Response Elements](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RunInstances.html#API_RunInstances_ResponseElements). EC2 Query API version identification: [Query requests](https://docs.aws.amazon.com/ec2/latest/devguide/Query-Requests.html), `2016-11-15`.

<a id="source-ec2-policy"></a>

**EC2-policy**: AWS, [Grant permissions to attach an IAM role to an instance — Example policy for programmatic access](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/permission-to-pass-iam-roles.html). [IAM policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) describes request policy evaluation, without resolving the post-commit race.

<a id="source-s3-upload"></a>

**S3-upload**: AWS, [Amazon S3 Encryption Client for Java examples — Multipart upload, high-level API](https://docs.aws.amazon.com/amazon-s3-encryption-client/latest/developerguide/java-examples.html). The note concerning revoked S3/KMS permissions is the specific in-flight claim used here; the page identifies its examples as 4.x.

<a id="source-s3-expiry"></a>

**S3-expiry**: AWS, [Download and upload objects with presigned URLs — Expiration time](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#PresignedUrl-Expiration), including the already-started-download versus restart distinction.

<a id="source-aws-retries"></a>

**AWS-retries**: AWS Builders’ Library, [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/), sections on client request identifiers, semantic equivalence, and recording deduplication state with the mutation. Engineering rationale, not a uniform service guarantee.

### Google API guidance and service documentation

<a id="source-g133"></a>

**G133**: Google, [AIP-133: Standard methods — Create, Guidance](https://google.aip.dev/133#guidance), approved guidance; response resource and long-running-create provisions.

<a id="source-g134"></a>

**G134**: Google, [AIP-134: Standard methods — Update, Guidance](https://google.aip.dev/134#guidance), approved guidance; update response and long-running-update provisions.

<a id="source-g211"></a>

**G211**: Google, [AIP-211: Authorization checks](https://google.aip.dev/211#guidance), especially “Guidance” and “Multiple operations.”

<a id="source-g151"></a>

**G151**: Google, [AIP-151: Long-running operations](https://google.aip.dev/151#guidance), especially “Guidance” and “Errors.”

<a id="source-g155"></a>

**G155**: Google, [AIP-155: Request identification](https://google.aip.dev/155#guidance), especially [Stale success responses](https://google.aip.dev/155#stale-success-responses).

<a id="source-g-operation"></a>

**G-operation**: Google Route Optimization API, [google.longrunning.Operations.GetOperation](https://developers.google.com/maps/documentation/route-optimization/reference/rpc/google.longrunning#google.longrunning.Operations.GetOperation), IAM Permissions on operation `name`.

<a id="source-g-logging"></a>

**G-logging**: Google Cloud Logging, [Batch and route log entries retroactively — Failed to write export data](https://docs.cloud.google.com/logging/docs/routing/copy-logs#failed_to_write_export_data), and “Cancel a copy operation.” Read as a concrete multi-step service workflow, not a generic LRO revocation guarantee.

### Kubernetes implementation specimen

All code in the following notes is pinned to **v1.34.0**, commit `f28b4c9efbca5c5c0af716d9f2d5702667ee8a45`.

<a id="source-k-auth"></a>

**K-auth**: Kubernetes, [authorization.go, `withAuthorization`](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/filters/authorization.go#L57-L96); [authentication.go](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/filters/authentication.go#L61-L123); [default handler chain](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/server/config.go#L1014-L1051).

<a id="source-k-create"></a>

**K-create**: Kubernetes, [create.go, storage call through result response](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go#L181-L235).

<a id="source-k-store"></a>

**K-store**: Kubernetes, [generic registry/store.go, create validation, storage and result](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go#L477-L557).

<a id="source-k-response"></a>

**K-response**: Kubernetes, [response.go, transformation and write](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/response.go#L313-L344), and [writers.go, serialization](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/responsewriters/writers.go#L89-L119).

<a id="source-k-configmap"></a>

**K-configmap**: Kubernetes, [ConfigMap storage uses generic Store](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/pkg/registry/core/configmap/storage/storage.go#L36-L58).

<a id="source-k-etcd"></a>

**K-etcd**: Kubernetes, [etcd3/store.go, conditional storage success](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go#L301-L323), and vendored etcd [client.go, `OptimisticPut` transaction](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/vendor/go.etcd.io/etcd/client/v3/kubernetes/client.go#L83-L106).

<a id="source-k-update"></a>

**K-update**: Kubernetes, [update.go, create-on-update authorization and final response](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/update.go#L192-L280).

<a id="source-k-concepts"></a>

**K-concepts**: Kubernetes, [API concepts — Updates to existing resources](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources), official live documentation. The source specimen, rather than the moving documentation version, controls the code findings above. For timeout versus continuing work, see pinned [finisher.go](https://github.com/kubernetes/kubernetes/blob/f28b4c9efbca5c5c0af716d9f2d5702667ee8a45/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/finisher/finisher.go#L87-L145).

### FHIR, SMART, and HAPI implementation specimen

<a id="source-fhir"></a>

**FHIR**: HL7 FHIR **R4 4.0.1**, [RESTful API §3.1.0.1.8, create/update/patch/transaction](https://hl7.org/fhir/R4/http.html#ops); see also [Create](https://hl7.org/fhir/R4/http.html#create) and [Update](https://hl7.org/fhir/R4/http.html#update). This report deliberately uses the R4 baseline associated with the identified SMART guide, not a claim that R4 is the latest FHIR release.

<a id="source-smart"></a>

**SMART**: HL7 SMART App Launch **2.2.0 / STU 2.2**, [Scopes for requesting FHIR resources](https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#scopes-for-requesting-fhir-resources), particularly [Patient-specific scopes](https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#patient-specific-scopes). Permanent versioned guide.

<a id="source-fhir-security"></a>

**FHIR-security**: HL7 FHIR R4, [Security — Access Denied](https://hl7.org/fhir/R4/security.html#AccessDenied). Security guidance is trial-use guidance; distinguish it from the normative RESTful API page.

<a id="source-hapi-code"></a>

**HAPI-code**: HAPI FHIR, [AuthorizationInterceptor.java](https://github.com/hapifhir/hapi-fhir/blob/3f77c0353b0bf07f0b06eaaa56df43e501447bff/hapi-fhir-server/src/main/java/ca/uhn/fhir/rest/server/interceptor/auth/AuthorizationInterceptor.java): operation directions at lines 268–311; outgoing PATCH suppression at 528–541; rule-list cache at 894–902; post-commit rationale at 934–950. Official code inspected directly; no runtime experiment performed.

<a id="source-hapi-tests"></a>

**HAPI-tests**: HAPI FHIR, [AuthorizationInterceptorWriteResponseJpaR4Test.java](https://github.com/hapifhir/hapi-fhir/blob/3f77c0353b0bf07f0b06eaaa56df43e501447bff/hapi-fhir-jpaserver-test-r4/src/test/java/ca/uhn/fhir/jpa/provider/r4/AuthorizationInterceptorWriteResponseJpaR4Test.java): PATCH outcome/persistence at 98–117; separate read denial and merged content at 128–168; conditional-create/create/PUT distinctions at 205–278. Test assertions inspected, not executed.

<a id="source-hapi-fix"></a>

**HAPI-fix**: HAPI FHIR, [pinned change record 8779, write-only PATCH success without body](https://github.com/hapifhir/hapi-fhir/blob/3f77c0353b0bf07f0b06eaaa56df43e501447bff/hapi-fhir-docs/src/main/resources/ca/uhn/hapi/fhir/changelog/9_0_0/8779-write-only-patch-returns-success-without-body.yaml). Earlier protected-content exposure is separately described in the official [2026 changelog](https://hapifhir.io/hapi-fhir/docs/introduction/changelog.html), entry #8253. Do not infer release availability of the later fix from the directory name.

<a id="source-hapi-pom"></a>

**HAPI-pom**: HAPI FHIR, [pinned pom.xml](https://github.com/hapifhir/hapi-fhir/blob/3f77c0353b0bf07f0b06eaaa56df43e501447bff/pom.xml), version `9.1.3-SNAPSHOT`; commit `3f77c0353b0bf07f0b06eaaa56df43e501447bff` is the inspected development snapshot.

### HTTP, OAuth, and IETF work in progress

<a id="source-http"></a>

**HTTP**: **RFC 9110**, June 2022: [§9.2.2 Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2), [§15.3.2 201](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.2), [§15.3.3 202](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3), [§15.3.5 204](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5), [§15.5.2 401](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2), [§15.5.4 403](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.4).

<a id="source-prefer"></a>

**Prefer**: **RFC 7240**, June 2014: [§2 Prefer](https://www.rfc-editor.org/rfc/rfc7240.html#section-2), [§4.2 Return preferences](https://www.rfc-editor.org/rfc/rfc7240.html#section-4.2).

<a id="source-oauth-revoke"></a>

**OAuth-revoke**: **RFC 7009**, August 2013, [§2.1 Revocation Request](https://www.rfc-editor.org/rfc/rfc7009.html#section-2.1), including invalidation and propagation text.

<a id="source-oauth-bearer"></a>

**OAuth-bearer**: **RFC 6750**, October 2012, [§3.1 Error Codes](https://www.rfc-editor.org/rfc/rfc6750.html#section-3.1).

<a id="source-oauth-introspect"></a>

**OAuth-introspect**: **RFC 7662**, October 2015, [§4 Security Considerations](https://www.rfc-editor.org/rfc/rfc7662.html#section-4), introspection cache freshness and expiry constraints.

<a id="source-idk"></a>

**IDK**: **draft-ietf-httpapi-idempotency-key-header-08**, published October 22, 2026, active Internet-Draft, expires April 25, 2027: [§2.3 Key expiry](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-2.3), [§2.6 Enforcement](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-2.6), [§5 Security](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-5), and [Appendix A, revision from -07](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#appendix-A). [Official document history](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/history/).
