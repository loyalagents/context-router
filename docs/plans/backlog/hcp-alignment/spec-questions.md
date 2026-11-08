# HCP Draft 3 Adoption Questions

- Status: local adoption notes; open questions, no upstream submissions or resolutions
- Recorded: 2026-11-07
- Draft: **2.0-draft-3**, normative baseline
  [`2e2939c9bebcefb3bed7bb3522231c0e4d65a315`](https://github.com/loyalagents/hcp-spec/tree/2e2939c9bebcefb3bed7bb3522231c0e4d65a315)
- Reviewed repository head:
  [`b764a058eac15a4cd843892e60473089b2e835bb`](https://github.com/loyalagents/hcp-spec/tree/b764a058eac15a4cd843892e60473089b2e835bb);
  specification sources and schemas are unchanged from that baseline
- Origin: Context Router's [source gap analysis][cr-analysis] and
  [proposed alignment plan][cr-plan], assessed at
  [`ca5dd77b8953b660b8e2d916d645ef690cdaf8bd`](https://github.com/loyalagents/context-router/tree/ca5dd77b8953b660b8e2d916d645ef690cdaf8bd)

These notes stay in Context Router while we test how well the existing HCP
specification, schemas, and guides support adoption. They record source-review
findings, synthetic cases, and possible resolution directions; they are not
observations from an implemented HCP integration. Runtime work remains unactivated.
Normative text continues to govern examples and schemas.

Use the [adoption approach][cr-plan] to investigate each question when it affects
the selected slice. Record whether existing materials answer it, whether it is an
application mapping decision, or whether a concrete gap merits a focused upstream
question/change. The proposals below are not accepted requirements and do not
change the pinned baseline. Preserve the stable IDs and record evidence and
dispositions here; a blocking ambiguity must be resolved before implementing the
affected behavior, without holding up independent work.

| ID | Kind | Decision or correction needed |
| --- | --- | --- |
| [CR-Q1](#cr-q1) | Ordering clarification | Revocation across admission, commit, and response delivery |
| [CR-Q2](#cr-q2) | Requirement interaction | Idempotent replay after erasure or authority changes |
| [CR-Q3](#cr-q3) | Deployment clarification and deadline conflict | Individual operators, local discovery, and dormant providers |
| [CR-Q4](#cr-q4) | Support requirement clarification | Minimum and conditional OAuth grant types |
| [CR-Q5](#cr-q5) | History clarification | Lifecycle changes without content versions |
| [CR-Q6](#cr-q6) | Editorial/example consistency | HTTP success framing and stale minimization-test wording |
| [CR-Q7](#cr-q7) | Binding artifact clarification | Complete MCP outputs and no-result success |

<a id="cr-q1"></a>

## CR-Q1: Revocation Ordering For In-Flight Work

**Source:** [§6.2.2, revocation propagation](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md#622-revocation-propagation),
with [§6.2.3, notification](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md#623-revocation-notification).

The existing rule requires immediate invalidation, current-grant checks on every
request, and no successful request under that evidence after revocation completes.
The question is the observable ordering of success, not whether an otherwise
unexpired token can authorize a new request after revocation.

**Cases:** a request passes its authority check, then revocation completes while
inference or storage work continues. Does a subsequent write commit or read
response fail? Separately, a mutation commits before revocation completes but its
reply has not been sent. May the committed result be acknowledged afterward?
What happens when bytes have already begun to reach the client?

**Requested clarification:** define the relevant boundary among admission,
authorization, durable commit, disclosure release, and response transmission.
Specify outcomes for already-committed mutations without implying that cancelling
a request can undo a committed change. Distinguish provider access revocation
from the notified recipient's obligations for copies already received.

**Possible direction:** add binding-neutral concurrency scenarios with an explicit
ordering rule. Leave locking, cancellation, and storage mechanisms to providers.
This answer affects authorization and disclosure architecture before implementation;
it should not be chosen implicitly by a transport's current session behavior.

<a id="cr-q2"></a>

## CR-Q2: Idempotency After Erasure Or Authority Changes

**Sources:** [§9.6, idempotency](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#96-idempotency),
[§5.4.2, hard deletion](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#542-hard-deletion),
[§7.4, disclosures](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#74-disclosures-to-context-clients),
[§7.6, use-until](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#76-use-until), and §6.2.2.

**Case:** create succeeds with key K. The person hard-deletes the entry. Within
24 hours, the client retries the identical request with K. Section 9.6 requires
retaining and returning the original response, while §5.4.2 requires the entry
to be unrecoverable and never returned again. Deleting the key alone could allow
the retry to create the entry anew.

**Requested clarification:** state precedence and a replay outcome that preserves
erasure and prevents recreation. Is a content-free operation tombstone and a
defined error the intended response? Define which actors, grant, operation, and
target partition the key namespace.

Also specify replay behavior when the original grant has expired or been revoked,
policy has narrowed, or the original disclosure's `useUntil` has passed. Current
authorization remains required; a cache lookup must not bypass it. Returning an
expired disclosure is not automatically permission to use it, but the expected
wire result needs to be explicit. Section 9.6's reference to original `id` and
`record.version` also needs to account for Context Client disclosures using `ref`
and `version`.

**Possible direction:** define a replay decision table and tests for normal retry,
changed body, changed authority, expired copy, and erasure. Specify which response
content can remain in an idempotency cache after hard deletion. Clarify the MCP
retry policy separately: its tools have no corresponding idempotency-key input
in this draft, and an HTTP header does not automatically cover MCP retries.

This answer is needed before designing durable response caches and erasure;
providers should not silently choose between resurrecting content and violating
the retry contract.

<a id="cr-q3"></a>

## CR-Q3: Individual, Local, And Intermittently Available Providers

### Actor Mapping

**Sources:** [§3.2.4 and §3.2.8](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s3.md),
[§10.5, who holds the grant](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s10.md#105-who-holds-the-grant),
[§12.1](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s12.md), and [§18.3](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s18.md#183-when-provider-interop-is-required).

Section 3.2.4 permits an individual operating their own provider, while §3.2.8
describes Client Operators and Provider Operators as organizations. Consider a
person running a desktop memory store and connecting an independently operated
assistant through a locally installed bridge.

**Requested clarification:** provide an actor table for this deployment. How is
the individual Provider Operator identified? Which accountable operator is shown
for the credential-presenting integration, bridge, and recipient assistant, and
how is downstream processing attributed? Section 10.5 already identifies a local
stdio bridge to a remote provider as a client in its own right; explain the
related fully local-provider case and the receiving host's responsibilities.

The requirement for Provider Interop when accepting externally operated HCP
Clients remains clear. Local execution and shared code authorship do not establish
common operation or remove another organization's onward-disclosure obligations.

### Local Discovery And Authorization

**Sources:** [§19.1 and §19.3](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s19.md),
[§9.1](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md), [§13](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md), and informative
[§21.7](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s21.md).

Section 19.1 explicitly requires HTTPS discovery for an MCP-only implementation;
for an HTTP-binding implementation it locates discovery relative to the base URL.
Section 21.7 describes HTTPS more broadly. A loopback provider with local consent
and no always-online service needs a documented deployment pattern.

**Requested clarification:** reconcile the discovery descriptions and explain how
the normative HCP/MCP/OAuth metadata, redirect, resource and signing-key requirements
apply locally. Include the required `jwks_uri` when clients have no registered
notification endpoint. This is a request for a precise supported pattern, not an
assertion that all loopback HTTP is prohibited or that public hosting is required.

### Dormancy, Expiry, And Notification Delivery

**Sources:** [§6.1.4](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md), [§8.1](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s8.md),
[§9.9](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md#99-revocation-notification-delivery), and
[§7.6](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#76-use-until).

**Case:** a temporary grant expires while the desktop provider is closed for
48 hours. Section 6.1.4 permits recording expiry on the next request without a
scheduled sweep for a dormant store, while §8.1 requires the expiry audit event
at the earlier of first access or 24 hours after expiry.

**Requested clarification:** reconcile those deadlines for unavailable providers.
Also specify what happens to pending notification retries across sleep/shutdown:
§9.9 requires at least five attempts over at least an hour before abandonment.
An expired grant must still fail immediately when presented after reopening.

**Possible direction:** add a local deployment guide with an actor diagram,
discovery/authorization example, and restart timeline; correct the conflicting
normative deadline in its owning source. The existing no-endpoint rule already
caps copies at one hour and should be explained, not treated as an exemption from
other provider obligations.

<a id="cr-q4"></a>

## CR-Q4: Required OAuth Grant Types

**Sources:** [§13.2](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md#132-grant-types),
[§13.3](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md#133-grant-request), and
[§13.6](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md#136-security-baseline).

The table lists Authorization Code + PKCE, Device Authorization, and Client
Credentials, but does not explicitly state whether every authorization server
must implement all three. Section 13.3 refers to the chosen grant type.

**Case and question:** may a user-facing provider conform using Authorization
Code + PKCE alone? Which client/deployment features require additional flows,
and how must supported types be advertised?

**Possible direction:** state minimum and conditional support requirements in a
short matrix, then align discovery/examples and conformance scenarios. This must
preserve mandatory PKCE, authorization-details acceptance, resource restriction,
and the person's preauthorized grant binding whenever Client Credentials is used.
The question concerns flow support, not permission to omit those requirements.

<a id="cr-q5"></a>

## CR-Q5: Lifecycle History Without New Content Versions

**Sources:** [§4.7.3, resolution](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s4.md#473-resolution),
[§4.2.1, mutability](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s4.md#421-mutability),
[§4.2.4, status](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s4.md#424-status), and
[§3.8, confirmation](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s3.md#38-confirmation).

Section 4.7.3 says a prior state remains available through version history after
accepting a conflict. Status and confirmation changes do not create a new version;
classification may also change without one under the other cited sections.

**Case:** a first-version entry is confirmed or deprecated while resolving a
conflict, without any content revision. What prior state must remain observable,
and through which management/export/history surface?

**Requested clarification:** distinguish prior content versions from lifecycle
transition history. Correct the reference if it means content history, or state
the additional observable history requirement if lifecycle history is intended.
Leave storage representation unconstrained. This question does not assume an
undo or restore operation is already required.

<a id="cr-q6"></a>

## CR-Q6: HTTP Examples And Conformance-Test Wording

**Sources:** [§9.3 and the §9.4 examples](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md),
[§20.1](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s20.md#201-scope-of-the-suite), and
[§7.5](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#75-reporting).

Two editorial inconsistencies can mislead implementers or become incorrect test
fixtures:

- Section 9.3 requires successful responses to use `application/ld+json` and every
  response to carry `HCP-Version`. Concrete success examples in §§9.4.1, 9.4.2,
  9.4.5 and 9.4.11 use `application/json` and omit the header. The bodyless 204
  example in §9.4.16 also omits it. Request examples using `application/json` are
  not the problem under §9.3.
- Section 20.1 still calls for reporting `redactedFields`, while §7.5 defines a
  method-based minimization report and does not define that member.

**Requested correction:** align the examples and test description with the
operative requirements, then add suitable example-consistency checks. Do not
change implementation behavior to follow the stale examples or add withheld-data
reporting that the current disclosure contract does not authorize.

<a id="cr-q7"></a>

## CR-Q7: Complete MCP Outputs And No-Result Success

**Sources:** [§10.3 and §10.4](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s10.md),
[§5.2.8](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#528-report-onward-sharing), and
[Appendix A.2](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/appa.md).

Section 10.3 requires input/output schema references and structured results plus
serialized JSON text. The tool examples provide input schemas only. Section
5.2.8 says reporting sharing has no result; the published schemas include
[its request](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/schemas/2.0-draft-3/operations/report-sharing-request.json)
but no corresponding result schema.

**Question:** what exact successful result and output schema should
`hcp_reportSharing` expose, and how do the successful and Core-error alternatives
fit each tool's output schema? An empty object is a possible resolution, not an
existing normative conclusion.

**Possible direction:** publish complete MCP descriptors and request/success/error
examples for every tool, including the no-result case, with checks against the
Core and MCP error mappings. Role-aware behavioral scenarios are still needed:
schema validity alone does not prove safe Context Client disclosure.

The target MCP revision is explicitly 2026-07-28. Availability of that published
revision is not an open question in this record; actual SDK/host compatibility
remains implementation evidence.

## Disposition And Reusable Work

All seven questions remain open. At the relevant checkpoint, record the task and
source consulted, attempted interpretation or synthetic scenario, outcome, any
workaround, and the remaining impact. Distinguish source-review findings from
runtime observations and distinguish CR adaptation work from missing HCP guidance,
ambiguous requirements, or reusable tooling opportunities. Keep observations in
this file and the [alignment brief][cr-plan], rather than creating an upstream
record before the need is understood.

When evidence supports an upstream clarification or improvement, propose it as a
focused hcp-spec issue or change with references and a reproducible example. A
blocking question may be raised before the whole adoption experiment finishes.
Record the answer/issue link and adopted revision here; never silently change the
target. Reusable scenarios, descriptor examples, guides, or skills should follow
demonstrated adoption needs and coordinate with the planned conformance suite.

This file does not amend hcp-spec, establish conformance, or file external issues.

[cr-analysis]: gap-analysis.md
[cr-plan]: README.md#test-the-current-adoption-experience
