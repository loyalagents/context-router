# HCP Draft 3 Adoption Questions

- Status: CR read-revocation contract selected; dormant-expiry deadline discrepancy open; C1 evidence/guidance and later portability issues submitted; no adopted spec resolutions
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
observations from a qualified HCP integration. C1/C2 are merged and bounded C3 is
activated on 2026-11-09; accepted expiry recovery does not change the spec pin.
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
| [CR-Q8](#cr-q8) | Request-scope interpretation | Omitted query categories after a partial standing-rule denial |
| [CR-Q9](#cr-q9) | Requirement interaction | Directive delivery can reveal withheld categories |

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
CR has now explicitly selected the read-release behavior in the C0 scope record,
rather than inheriting session admission semantics. The upstream clarification
and the later mutation/commit question remain separate work.

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

## C0 Adoption Review And Dispositions

C0 source inspection used the original normative and adoption-material pins above,
plus the existing [pilot/authorization guides](https://github.com/loyalagents/hcp-spec/blob/b764a058eac15a4cd843892e60473089b2e835bb/spec/2.0-draft-3/guides.md)
(G1, G4, G5). No HCP runtime was run. CR's C0 base is
`cb9d3f9fc36a6c90dcc5bcf96dbdd33e9bf70fa2`; [D1–D8 and the bounded contracts](README.md#c0-decisions-d1d8)
record the resulting application decisions. D8 was explicitly selected by the
product owner: local SQLite only; hosted/PostgreSQL HCP support is out of scope.

**What the materials answered.** §§3.2–3.7 distinguish subject, authorizing
principal, client and operator; §§6.1/13 separate authentication, consent, grant
and token lifetimes. §§6.1.5/6.3 clearly settle fail-closed narrowing, purpose and
multi-category standing-rule enforcement. §§7/8 settle grant-scoped refs,
allowlisted disclosures, copy ceilings, query-text exclusion and synchronous
audit as an allowed implementation. §§4.2/A.3 permit native JSON with unknown
members; no JSON-LD processing or legacy projection is needed. These are CR
adaptation work, not requests to simplify HCP.

**Manual interpretation.** The team traced these sections into one actor table,
one C1–C3 brief and [22 requirement/test rows](gap-analysis.md#c0-requirement-and-test-matrix).
This is experienced-team source-review evidence, not unaided onboarding or a
working integration. The published schemas check shapes, not the race, consent,
disclosure and recovery obligations. G1's broad pilot sequence and G4's consent
patterns are useful, but do not provide a complete local first-slice fixture.

| Question | C0 disposition | Smallest useful upstream change / next action |
| --- | --- | --- |
| CR-Q1 | **CR read behavior selected, 2026-11-08; upstream clarification open.** Check at admission and at coordinated final release; revoke before release denies, already-sent bytes may arrive later. No slow-socket wait. Mutation boundary remains C4 work. | [hcp-spec #2](https://github.com/loyalagents/hcp-spec/issues/2) asks the spec owner to clarify/test the existing §6.2.2 rule. It need not block the chosen CR read experiment after activation; a local choice is not upstream adoption or conformance evidence. |
| CR-Q2 | **Deferred dependency, C4/C5.** No durable content-response cache, write retry or hard-delete API in C1–C3. | C4 owner produces the existing erase/retry/authority decision table before cache implementation. Do not use a content tombstone proposal as already accepted behavior. |
| CR-Q3 actors | **Nonblocking guidance/editorial gap.** §3.2.4 explicitly permits individuals. Record the actual test operator; do not invent an organization or independent operator for A/B. | Change §3.2.8 operator wording to “person or organization accountable” and reconcile name descriptions; add one fully local actor table. Orchestrator prepares focused upstream work after this planning assignment; revisit before real-host C7. |
| CR-Q3 local deployment/discovery | **Application choice + nonblocking missing example.** Local HTTPS with isolated trust avoids a loopback HTTP exception. Real OAuth metadata plus an experimental manifest suffices for this nonconformant slice. | Add a guide example of local AS/resource URLs, exact redirect/resource binding and trust setup. Explain that partial implementations must not advertise complete Parts. Revisit with C3 evidence; no normative exemption proposed. |
| CR-Q3 expiry | **Known normative deadline discrepancy.** Includes entries and grants; next-request permission conflicts with 24h audit/status deadlines. Catch-up is a proposed CR application behavior, not literal compliance. | [hcp-spec #3](https://github.com/loyalagents/hcp-spec/issues/3) hands coordinated `s4.md`/`s6.md`/`s8.md` investigation to a spec owner. C1 long-dormancy entry recovery was explicitly accepted at activation; affected conformance remains blocked until resolution/adoption. No backdating or short-restart substitution. |
| CR-Q4 | **Deferred claim blocker, C5/C8.** Choose authorization-code/PKCE now, reject unsupported flows. This does not establish that one flow satisfies the complete OAuth profile. | Clarify §13.2's minimum/conditional support in a flow/deployment matrix and metadata example. C5 owner resolves before OAuth-profile qualification; additional flows must follow the adopted answer. |
| CR-Q5 | **Deferred dependency, C4.** No conflict-resolution or confirmation workflow in this slice. Mutable lifecycle plus truthful expiry events and immutable content are clear enough for C1. | C4 owner resolves prior lifecycle-history observability before implementing the affected transitions; small wording change or explicit history scenario, not a speculative event-sourcing framework. |
| CR-Q6 | **Nonblocking concrete correction.** Operative §9.3/§7.5 govern the CR fixtures. | Orchestrator prepares the exact editorial corrections below after this planning assignment; do not stall independent CR storage work. |
| CR-Q7 | **Deferred dependency, C7.** No MCP endpoint/tool in C1–C3. | C7 owner supplies complete success/error output descriptors and no-result examples before binding implementation; coordinate with the conformance suite. |

### Proposed CR-Q1 Read-Release Resolution

The user selected this behavior for CR on 2026-11-08. The following is a
reviewable upstream clarification proposal for §6.2.2, **not adopted normative
wording**. The spec owner may clarify the existing rule/examples without using
this exact text; CR's selected read contract does not depend on that PR landing:

> For a read, the provider MUST serialize its disclosure-release decision with
> revocation of the grant. Before release it MUST check current grant authority
> and complete the audit durability required by §8.4. If revocation precedes
> release, the provider MUST release no context under that grant. Release is the
> provider's irreversible handoff of the authorized response to its transport;
> admission and audit preparation are not release. Bytes handed to the transport
> before revocation may arrive afterward; this is an earlier disclosure, whose
> use remains governed by §6.2 and §7.6. Revocation MUST NOT wait for network
> delivery or client acknowledgement.

Review/test examples to accompany it:

1. A read is admitted and paused before release; revoke durably invalidates A1;
   read resumes. No context is released; subsequent reads under A1 fail. A2 and
   B remain independently usable within their own grants.
2. A1's audited response has been handed to transport; the recipient stalls;
   revoke completes immediately without waiting for delivery. Previously released
   bytes may arrive; later A1 access fails, and that failure is itself notice.
3. Audit commit fails before release. No successful context response leaves. If
   audit commits but transport handoff fails, history must not assert receipt.
4. Pause during durable audit and cross the token, grant, entry or prepared-copy
   expiry in separate cases. A final time check after durability prevents release;
   committed history stays truthful as an attempted disclosure, never proof of
   receipt. No expiry is renewed merely to finish an in-flight request.

The implementation needs a precise atomic authority/policy/expiry recheck,
durable-audit and release boundary; holding a mutex until socket drain is not a
resolution. Time-dependent validity must also be checked after audit durability
immediately before handoff. Tests must instrument provider handoff and remote
receipt separately.
This text deliberately leaves committed mutation/lost-reply behavior to CR-Q1's
C4 extension and CR-Q2; it does not imply that revoke undoes committed writes.

### Proposed CR-Q3 Dormant-Expiry Resolution

The concrete counterexample is a temporary grant and entry validity expiring
while the local provider is stopped for 48 hours. §6.1.4 permits recording on the
next request, but §8.1 requires grant expiry audit no later than first access or
24 hours, and §4.2.4 imposes a corresponding deadline for entry status/audit.
The new entry evidence is [§4.2.4](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s4.md#424-status).

Proposed coordinated source changes, pending protocol review:

- `source/s8.md` §8.1: retain the deadline while the store is available; explicitly
  exempt unavailable/dormant intervals and require overdue grant-expiry events
  durably appended before serving requests on resumption. Expired evidence must
  never authorize access, whether or not that event has been appended.
- `source/s6.md` §6.1.4: replace the contradictory dormant-store explanation with
  a reference to that exact availability rule, not a second deadline definition.
- `source/s4.md` §4.2.4: apply the same exception to overdue entry status/events,
  preserving immediate nondisclosure after validity and existing state precedence.
- Use actual append timestamps, with original effective expiry retained in the
  grant/entry and optional event detail. Never backdate an event to simulate an
  unavailable process. Audit failure keeps service closed until reconciliation
  can commit; repeated reopen/access does not append duplicate transitions.

Acceptance example: stop before expiry, advance the test clock 48 hours, reopen
and reconcile before admitting any read; expired grant/entry cannot disclose,
new events show truthful timing, and second reopen changes nothing. Repeat with
an injected audit failure. Test ordinary availability and equality at expiry too.
Clean shutdown may revoke live test grants, but crash/sleep must still be covered.
An affected compliance claim requires explicit normative resolution/adoption;
application tests of this proposed catch-up behavior cannot waive the pinned
deadline. The November 8 C1 activation accepts that bounded synthetic entry-recovery
experiment with the discrepancy recorded; grant/HTTP enforcement remains C2/C3. The behavior does not renew a grant,
entry validity or copy deadline. Notification retry remains C5, with no endpoints now.

### Concrete Nonblocking Corrections And Examples

For CR-Q6, edit the owning `source/s9.md` success examples in §§9.4.1, 9.4.2,
9.4.5 and 9.4.11 to use `Content-Type: application/ld+json`, and show
`HCP-Version: 2.0` on them and the bodyless §9.4.16 response. Leave request
`application/json` unchanged. In `source/s20.md` §20.1 replace the obsolete
`redactedFields` test wording with checking the declared minimization method and
absence of withheld-data counts under §7.5. A small HTTP-example consistency
check should detect header/media drift; regenerate pages from sources and run
existing schema checks. This is reviewable correction scope, not an implemented
or submitted patch.

A first-slice guide should explicitly avoid a misleading discovery workaround:
§18 forbids claiming incomplete Parts; §19.3 links advertised bindings to those
claims; `schemas/2.0-draft-3/discovery.json` requires nonempty `conformsTo` and
`bindings`. `conformsTo: []` with `bindings: ["http"]` is not a conformant solution.
Until a complete binding is qualified, use an explicitly experimental manifest
and actual OAuth metadata. Eventual HCP discovery still requires `jwks_uri`
without registered notification endpoints. No schema relaxation is proposed.

Two small examples may become useful after C3: honest synthetic bootstrap
provenance versus simulated storage fixtures, and unknown JSON-member preservation
versus allowlisted Context Client disclosure. The normative rules already answer
both; only demonstrated repeated implementation work should drive reusable tooling.
**No integration skill or general adoption framework is justified by C0 alone.**
C3's owner should revisit these examples against its working fixtures, preserving
the original source-review baseline and experienced-team limitation.

### Issue-First Handoffs

Selected split from the November 8 discussion: CR owns implementation and
application tests; a separately assigned spec task investigates issues and owns
any required source/example/schema changes. The user explicitly requested these
two issues, published on 2026-11-08 with the pinned sources and cases above.
Both are open; no separate spec task or individual assignee has been assigned.

| Submitted issue | Body / resolution boundary |
| --- | --- |
| [#2 — Clarify revocation ordering for in-flight reads](https://github.com/loyalagents/hcp-spec/issues/2) | §6.2.2's “succeeds,” §6.2.3's prohibition on delaying revoke, and §8.4's durability options; ordered release/revoke timelines, audit failure and expiry during audit. Records CR's selected admission + coordinated final-check behavior. Asks whether existing wording establishes that result and requests precise examples/wording if needed. Committed-write semantics remain separate. |
| [#3 — Reconcile dormant-provider grant and entry expiry audit deadlines](https://github.com/loyalagents/hcp-spec/issues/3) | §§6.1.4, 8.1 and 4.2.4; the 48h stopped-provider counterexample. Distinguishes effective expiry from delayed status/audit processing. Proposes truthful catch-up before service resumes without renewing permission/content validity. Requests a consistent availability rule covering grants and entries, plus restart/audit-failure tests. |

Each issue links its CR question ID and pinned sources, identifies whether it
is clarification or contradictory requirements, and names its scope and ownership
handoff. The orchestrator still needs to assign a spec owner.
The spec owner should assess alternative readings and effects on other providers,
not merely copy CR's proposed wording. The orchestrator tracks the answer and any
PR, then separately decides CR adoption and which tests need renewing. An issue
is a handoff, not an amendment to the protocol or evidence the problem is fixed.
CR-Q6's concrete editorial correction can be a later issue or a focused spec PR;
this handoff does not turn every local implementation choice into a spec issue.

### Upstream State And Ownership

At the C0 handoff on 2026-11-08, **CR-Q1 read clarification: [issue #2 submitted/open](https://github.com/loyalagents/hcp-spec/issues/2);
CR-Q3 expiry deadlines: [issue #3 submitted/open](https://github.com/loyalagents/hcp-spec/issues/3)**.
Other proposals were then unsubmitted; the later C1 follow-up below records the
subsequent issue publication. For both issues at that handoff: **resolution PR submitted:
no; merged: no; spec revision adopted by CR: no**. CR's selected read behavior is a local
application contract, not an upstream resolution. The original normative and
adoption-material pins remain unchanged; the `hcp-spec` checkout remains unchanged.

The user requested planning the current-permission behavior and authorized the
issue-first division of work and publication of these two issues. Assignment to
another spec task remains pending. The orchestrator retains
coordination and can assign a spec owner when that work is activated. The CR
writer need not also be the spec writer; this selected ownership split preserves
the later workflow's obligation to resolve justified findings, not just list them.

CR-Q1 no longer blocks the chosen C2/C3 read implementation contract after runtime
activation. CR-Q3 still prevents literal deadline compliance: separately scoped
application tests of fail-closed catch-up must not be called a pass against that
requirement. Interim C1 entry-recovery scope is accepted; resolve/adopt the protocol correction
before an affected conformance claim.
Independent work need not await a spec issue or PR. Deferred CR-Q2/Q4/Q5/Q7 remain
attached to C4/C5/C7 before their affected capabilities or claims. Any merged spec
change requires an explicit target decision and affected tests/review; neither an
issue answer nor a chat transition silently updates the baseline.

[cr-analysis]: gap-analysis.md
[cr-plan]: README.md#test-the-current-adoption-experience

## C1 Adoption Findings And Disposition (2026-11-08)

The original normative pin and adoption-material head are unchanged. The C1
implementation uses §§3.5–3.7, 4.2/4.2.1/4.2.4, 8.1/8.2/8.4/8.7, 11 and A.3.
Tests are in `apps/backend/test/local-database/hcp-experiment/`; candidate-bound
commands/results belong to the canonical brief's C1 record.

- **Application adaptation:** plain native JSON and separate lifecycle suffice for
  immutable v1/v2 plus nested unknown-member round trips. Provider-owned simulated
  provenance avoids inventing real consent, assurance, model or issuer facts. The
  published prose answered these requirements; no general framework was needed.
- **Application adaptation:** SQLite DELETE/EXTRA/fullfsync, an exclusive permanent
  ownership lease and an atomic complete-initialization marker make the durability
  and filesystem boundaries explicit. These are CR storage choices, not new HCP
  requirements. Real Mac process-loss and reopen tests exercise them; physical
  power-loss certification is not claimed.
- **Known specification gap / CR-Q3:** tests now exercise entry expiry after a
  simulated 48-hour outage, with actual append time, original effective deadline,
  whole-batch rollback on audit failure, repeat reopen and no new version. This is
  the explicitly accepted application recovery experiment; it cannot satisfy the
  pinned literal 24-hour status/audit deadline while stopped. Grant/HTTP work is
  still C2/C3. No normative exception was silently adopted.
- **Guidance/tooling disposition at initial handoff:** no new upstream patch or
  general skill was prepared. The later issue-first follow-up below proposes
  focused startup/recovery durability guidance. The candidate examples recorded
  at C0 (honest fixture provenance; preservation versus disclosure) remain owned
  by the C3 writer for review against the complete HTTP journey. No unaided
  newcomer-adoption evidence is claimed.

At the initial C1 handoff, hcp-spec #2 and #3 were submitted
and open at C0 handoff, with no resolution PR submitted/merged/adopted and no
separate spec owner assigned. The initial C1 implementation made no upstream
writes or spec source changes; the authorized follow-up below adds issue evidence.
The original orchestrator owns assignment/follow-through; reassess issue status
and any explicit target adoption before affected conformance work. C1 does not
start C2, change the selected read-release contract, or resolve CR-Q2/Q4/Q5/Q7.

### Published C1 Issue Follow-Up (2026-11-08)

The user explicitly requested a subagent to update or create `hcp-spec` issues
from C1's findings. The issue publisher reviewed existing issues #2–#13 and their
comments, then published these parent-reviewed texts and verified exact readback:

| Action | Evidence and disposition |
| --- | --- |
| [Added evidence to #3](https://github.com/loyalagents/hcp-spec/issues/3#issuecomment-6730464600) | Entry-only exact-deadline and simulated 48-hour recovery; original effective deadline versus actual controlled-clock append time; atomic status/audit rollback, repeated recovery and process loss. Issue remains open; original body preserved. This does not establish grant/HTTP behavior or resolve the pinned deadline conflict. |
| [Created #14: initialization/recovery audit durability guidance](https://github.com/loyalagents/hcp-spec/issues/14) | Requests a short provider-neutral guide/checklist for implicit storage-engine writes, configuration ordering, durable admission and failure/retry tests. SQLite is an optional concrete example, not a mandated architecture or new protocol requirement. Open, with no assignee or labels. |

Issue #2 was left unchanged because C1 adds no HTTP read-revocation evidence.
The provenance/preservation examples remain deferred to C3, which should account
for existing [#5](https://github.com/loyalagents/hcp-spec/issues/5) and
[#6](https://github.com/loyalagents/hcp-spec/issues/6). Issues #4–#13 were already
present and were not created by this follow-up. The original orchestrator owns
assignment and resolution follow-through; publication does not imply a resolution
PR, merge, target adoption or conformance.

Both posts identify base `cb9d3f9fc36a6c90dcc5bcf96dbdd33e9bf70fa2` plus the
uncommitted, unpublished F2 candidate, whose 22-path manifest SHA-256 is
`74bf158561bf2f509ef8f9530165306b7c53379c989face886414682bccf64dd`.
They report 35 local C1 tests and distinguish process-loss testing from physical
power loss, with CI and artifact qualification still pending. The spec sources
and normative/adoption pins remain unchanged.

The subagent was sole issue publisher; the parent remains sole local writer.
Astra/xhigh was requested and accepted by the spawn API; underlying execution
settings are unverified. Connected GitHub access was unavailable, so authenticated
CLI performed the authorized writes. This record and the brief's status pointer
are a post-F2 documentation-only delta; runtime, test and other F2 inputs are unchanged.

### Post-C1 Portability Questions (2026-11-08)

The subsequent user discussion produced two source-analysis questions against the
same normative pin, not C1 runtime findings: C1 implements neither import nor
export. Existing open/closed issues and relevant PRs were checked before publishing
the focused issues; exact published bodies were read back. Both remain open at
the publication checkpoint, with no resolution or target adoption recorded.

| Issue | Question and implementation boundary |
| --- | --- |
| [#19 — Newer entry versions and exported history](https://github.com/loyalagents/hcp-spec/issues/19) | The current import rule rejects an already-held ID with changed content, without a higher-version exception. Asks whether this conservative policy is intentional and how optional historical versions participate; a larger number does not prove common ancestry. It does not assume synchronization is required. |
| [#21 — Subject identity binding across providers](https://github.com/loyalagents/hcp-spec/issues/21) | Asks how a foreign subject URI is associated with the destination person, which checks are required or implementation policy, and how mismatches are handled while retaining subject/provenance and assurance. It does not mandate a universal ID or permit silent subject rewriting. |

The original C1 chat completed the separately requested, repository-read-only
source review with two further issues, verified open by the orchestrator on
November 8: [#24 — categoryMap and imported policies](https://github.com/loyalagents/hcp-spec/issues/24)
and [#25 — invalid empty-export example/checker bypass](https://github.com/loyalagents/hcp-spec/issues/25).
These are source-analysis findings, not C1 runtime evidence. The exported-audit-
history import question remains a C5 revisit, not an established defect. The
orchestrator owns follow-through before C5; no resolution or revision adoption is
recorded. This investigation is not a dependency for C1 publication or the
selected C2 consent/grant slice. Import/export remains C5; any finding that affects
an earlier selected contract must be explicitly assessed before that capability
changes. No fork, issue answer or upstream merge silently changes the normative
pin, authorizes implementation, or establishes conformance.

## C3 Adoption Review Scope (2026-11-09)

C3 owns the deeper completed-journey adoption review against the unchanged pins.
The [concrete plan](README.md#c3-concrete-implementation-plan) requires evidence
for release ordering (#2), dormant expiry limitations (#3), startup/recovery guidance
(#14), honest authenticated versus simulated fixture provenance, and preservation
versus allowlisted disclosure. Current instruction: leave hcp-spec unchanged both
locally and remotely, including issues/comments/PRs. Record concrete proposals here;
the original orchestrator owns follow-through when upstream work is explicitly
authorized. Existing issue status is historical unless reverified; neither issue
resolution nor upstream merge changes CR's target without explicit adoption.
Portability #19/#21/#24/#25 remains C5, and CR-Q2/Q5 require C4 disposition.

### C3 Experienced-Team Findings And Local Proposals

The normative pin and original adoption baseline remain unchanged. On 2026-11-09
the writer read connected GitHub issue records and verified #2/#3/#5/#6/#14 open.
Existing C2 evidence on #3 ([comment](https://github.com/loyalagents/hcp-spec/issues/3#issuecomment-6747676430))
was written by another authorized chat; C3 made no upstream changes. #5 concerns
stored-entry/disclosure example labeling; #6 concerns the provenance summary versus
controlling §7.4. These observations do not adopt any later issue resolution.

A read-only Astra/xhigh adoption reviewer inspected the C3 implementation and the
pinned G1/G4/G5 guides, clauses and schemas; API acceptance was observed, underlying
execution unverified. The reviewer did not run tests. Three application defects
were found and given failing-first regression checks: directive IDs belong in
`data.directives` (§8.2), stored relationships need provider-recorded actor/time
(§4.2.3), and get evaluates the entry's categories rather than unrelated categories
in its grant (§§5.2.2/7.1). These are implementation corrections, not spec defects.

| Demonstrated adoption work | Concrete reusable proposal, retained locally | Owner and revisit |
| --- | --- | --- |
| §§3.5–3.7 distinguish authentication/assertion/confirmation, but truthful initialization required exact-bundle review, actual timestamps, traceable initializer authority and permanent closure. | Paired simulated-storage versus newly authenticated-statement example. Show that startup or generic migration approval cannot invent historical consent or confirmation. Use corrected C3 fixtures as evidence. | Original orchestrator; only prepare/publish upstream after explicit authorization. |
| §§7.4/A.3 answer preservation versus disclosure, but stored-entry, disclosure and audit shapes were easy to conflate. The published generic query-result schema also permits stored entries, while event `data` is unconstrained. | One checked stored-entry → Context Client disclosure → matching audit example: unknown public/private members, relationship provenance stripped to same-response refs, and directive IDs. Add a small role-specific semantic fixture check for withheld fields and event-specific data; coordinate with #5/#6. | Original orchestrator; explicit upstream authorization, with a candidate-bound corrected fixture. |
| Release ordering needs distinct admission, durable attempted audit, handoff and receipt concepts. Deadline and kill/reopen tests made these boundaries observable; the grant case crosses its bound token deadline too, so it does not independently test the explicit grant-deadline check. | Extend #2/#14 with a provider-neutral timeline/failure matrix: precommit, postcommit/pre-handoff, slow recipient, token/grant/current/selected/copy deadlines, and recovery-before-admission. Distinguish independent deadlines from coincident bounds. CR's synchronous SQLite/event-loop method is an example, not a protocol mandate. | Original orchestrator; #2 clarification and #14 guidance, on explicit upstream authorization. |
| G1's evidence ladder and G4's explicit consent patterns worked; G1/G5 do not give a complete isolated local HTTPS slice. | Small deployment example connecting actor identities, private fixture trust, OAuth/resource URLs and honest experimental capabilities. Reuse C2 material with C3's complete read journey. | Original orchestrator; revisit before C6/C7 or a second implementer's reproduction need. |

No general integration skill is justified yet; bounded examples and semantic checks
address the demonstrated friction without becoming a second protocol definition.
The existing prose was sufficient for lexical minimization, explicit whole-request
purpose/category scope checks, current-plus-selected historical eligibility,
entry-level standing-rule withholding, one-hour copies and no-endpoint limits.
Omitted-category queries under partial standing rules need the interpretation
recorded in [CR-Q8](#cr-q8); directive delivery through withheld categories raises
the separate [CR-Q9](#cr-q9) interaction. CR's shorter immutable
copy lifetime is a provider choice; it is not a new spec rule. Explicit empty query
categories search nothing, duplicate categories normalize, and positive maxEntries
is capped at 20, as recorded in the concrete plan. Omitted query categories select
the purpose-approved set; a standing rule over that requested set denies the whole
query. This is the selected experiment interpretation, not a settled answer from
the specification. A get instead checks the referenced entry. Informational fixture relationships
are limited to derivedFrom/duplicates; lifecycle effects and confirmation/rejection
semantics remain C4. In particular, C4 must derive standing from the latest
confirmation disposition before accepting confirmation/rejection records.

The 48-hour stopped-provider experiment remains atomic recovery evidence, not
compliance with the pinned deadline conflict in #3. No recipient-copy compliance,
unaided newcomer onboarding, installed-artifact qualification or full conformance
is established. C3 reproducible commands and exact candidate results belong in the
[canonical brief](README.md#c3-implementation-checkpoints-2026-11-09). CR-Q2/Q5
remain C4 prerequisites; portability #19/#21/#24/#25 remains C5. The orchestrator
owns all proposal follow-through; hcp-spec is unchanged locally and remotely.

<a id="cr-q8"></a>

## CR-Q8: Omitted Query Categories After A Partial Standing Rule

**Sources:** [§5.2.1, query defaults](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md#521-query),
[§6.3, standing rules](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md#63-standing-rules).

**Case / Claude N1:** a purpose-approved grant covers `general_preferences` and
`work_context`; a later rule denies only `work_context` to its operator. C3 keeps
the grant active. A query explicitly including the denied category returns 403.
Omitting categories also returns 403 because C3 expands the request to the grant's
purpose-approved categories before applying the rule. Explicitly querying only
`general_preferences` succeeds. Reading the own grant still succeeds and lists
both approved categories; it provides no effective-category view or explanation
of the new default-query denial.

**Question:** does the §5.2.1 default include every category approved in the grant,
then fail under §6.3, or only categories currently readable after applying standing
rules? Clarify the default and what a client can discover without exposing private
governance policy. Explicit requests covering denied categories must still fail;
an allowed-category query must still withhold entries with any denied category.

**Disposition:** retain C3's fail-closed interpretation and add actual HTTP
regressions for explicit and omitted categories, with allowed-category controls.
This closes a test gap without changing runtime behavior. The original
orchestrator owns clarification before affected real-client C7 integration;
upstream publication and adoption require separate authorization. This question
is recorded locally, not submitted or resolved in hcp-spec.

<a id="cr-q9"></a>

## CR-Q9: Directives Can Reveal Withheld Categories

**Sources:** [§6.4, directive delivery](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md#64-directives),
[§7.4, disclosure classification](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md#74-disclosures-to-context-clients).

**Case / Claude N2:** an entry has `general_preferences` and `work_context`, while
the requesting grant covers only the former. Its disclosed classification omits
`work_context`, but a directive scoped to that category is delivered with its text
and categories. In a one-entry response this reveals the withheld category's
association with the entry. The existing C3 directive test exercises this case.

**Question:** how should §6.4's delivery through every actual category interact
with §7.4's reason for withholding other categories? Clarify whether this is an
intentional disclosure exception, what the person must be told, or whether a
different directive representation/delivery rule is needed. Merely dropping the
directive could omit a required restriction and is not an adopted resolution.

**Disposition:** no C3 code change; retain the selected §6.4 interpretation in
isolated synthetic fixtures (`general_preferences` is Low; `work_context` is
Medium under the pinned §4.5 vocabulary). The original orchestrator owns resolution
and explicit adoption before sensitive real-data exposure in C6/C7. No general
claim that category withholding prevents inference through directives is made.
Keep the question local until upstream work is explicitly authorized.

### C7 HTTP Query Parsing Follow-Up (N4)

**Application interoperability limitation:** the shared request parser matches
content types exactly. C3 rejects `application/json; charset=utf-8` with 422,
accepts a simple form-encoded query, and uses JSON.parse's last-value behavior for
duplicate JSON keys. These are parser choices, not an established authorization
bypass or a new normative HCP interpretation.

**Owner / revisit:** the C7 binding owner must define and test query media-type
handling before real-client qualification: parameterized JSON, rejection of
unsupported query encodings, and an explicit duplicate-key policy. Prefer a
query-specific JSON path while retaining form parsing for OAuth/human routes;
verify compatibility with the then-selected binding. This record neither changes
the parser nor activates C7. C3's selected-client evidence does not establish
general HTTP interoperability.
