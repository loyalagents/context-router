# C7a Synthetic MCP Read Brief

- Status: PR #212 published; Claude review corrections independently approved, final validation pending; controlled synthetic clients only, no host trial
- Base: merged main `f92260060152b6872b5732587027bd161bc4f590`; publication branch `codex/hcp-c7-read-plan`
- Sequencing: original orchestrator chat `01a1b827-ae7c-7b23-9160-d7b69d0ee2b0`; implementation chat `01a20029-3e43-7d70-9e84-4dcc8acd73e7` is sole checkout writer/integrator (including docs/builds/disposable fixtures); orchestrator and reviewers read-only
- Profile: sensitive authority/transport work; coordinator/writer and scoped read-only reviewers requested Astra / `xhigh`; actual execution settings unverified
- Target: HCP `2.0-draft-3` at `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`; adoption baseline `b764a058eac15a4cd843892e60473089b2e835bb`, not sibling HEAD
- Parent: [current alignment status](README.md), [gap analysis](gap-analysis.md), [local questions](spec-questions.md)

## Selected Outcome And Limits

Lucas explicitly activated the reviewed tests-first C7a implementation, including
dependency verification/acquisition and disposable synthetic HTTPS/SQLite/browser
checks. The four uncommitted planning files carry forward from the reviewed handoff.
The finalization milestone is implemented C7a, known findings resolved, sufficient
focused local checks and contributor instructions, fresh complete-diff review,
and a concrete handoff to the orchestrator. Lucas subsequently authorized this
writer to commit the C7a changes and open one PR, followed by a handoff prompt for
an independent Claude Code review. This supersedes the earlier publication limit
and delegates this publication step from the orchestrator; sequencing remains with
the orchestrator. Merge/release and C7b remain unapproved. Exact-candidate CI is
required on the published candidate; the PR description records publication and CI
state, while the local receipts below retain their original scope.
Earlier planning-only statements below describe the planning assignment, not this
activation. C7b/C8/C9 and the sibling repository remain outside this activation.

Implement `hcp_queryContext` and `hcp_getEntry` over MCP **2026-07-28 Streamable
HTTP** in the existing isolated synthetic provider. One cohesive implementation
PR should contain tests, shared read-release adaptation, a small transport adapter
and contributor instructions. First prove the binding with controlled clients;
propose **Claude Code 2.1.299, foreground terminal on the measured Apple Silicon
Mac**, as the one later host trial. Do not silently substitute a newer version or
count the installed legacy demo's successful connection as HCP evidence.

No MCP writes/reporting, governance tools, model execution, document ingestion,
personal data, installed delivery, legacy compatibility or data conversion. Existing
new-store history/authority guarantees remain. The provider still lacks complete
Provider Interop: pinned §18.3 applies to the independently operated host, and
calling this an experiment does not satisfy it. C8 owns normative resolution and
explicit CR adoption; C9 owns remaining mandatory capability/qualification work.
D3 erasure precedes any personal-data extension; CR-Q9 resolution/adoption precedes
sensitive real data. The sibling `hcp-spec`, both pins, existing human sandbox,
installed app, model assets and client settings remain untouched.

## Host, Transport And Actors

Source inspection finds `@modelcontextprotocol/sdk` **1.27.1** in the CR lockfile.
The official [v1 SDK documentation](https://ts.sdk.modelcontextprotocol.io/)
limits that line to 2025-11-25. The [v2 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
documents explicit modern-era selection; merely updating a dependency does not
select it. The official [client manifest](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/package.json)
currently identifies 2.4.0, Node >=20 and CommonJS exports. Propose that exact v2
client as the independent test peer, pinned with registry integrity at implementation
activation; publication/installability has not been checked here. Keep the old SDK
and its isolated consumers unchanged. No package installation occurred in planning.

Official [Claude Code runtime documentation](https://code.claude.com/docs/en/mcp#mcp-client-runtimes)
documents v2 support before 2.1.299 and direct HTTP modern negotiation. This supports
the proposed version's feasibility, not a verified connection. For the future
isolated process, select `MCP_SDK_GENERATION=v2` and
`MCP_PROTOCOL_NEGOTIATION=auto`; the server offers only 2026-07-28 so fallback
cannot produce a passing trial. Record actual executable/version and observed
wire revision. The same documentation supports host-held HTTP credentials;
automatic reauthorization, credential persistence and actual error/result handling
remain trial evidence.

Use a dedicated direct HTTPS `/v2/mcp` endpoint, with the provider also retaining its HTTP
context/governance surface. Do not use the legacy stdio bridge: pinned §10.5 would
make a bridge a separate HCP Client with onward-disclosure duties. For automated
C7a fixtures, keep the current `as.hcp.test` origin and explicit test-only DNS/CA
mapping. For the later host trial, recommend a **fresh** source profile using
`https://localhost:<selected-port>` with a matching certificate and issuer/resource,
loopback-only listener, exact Host/Origin checks and a separately registered client.
This small source-profile extension belongs to the later host activation, not C7a.
It avoids system DNS/hosts/trust changes. Preserve existing C6 descriptors/stores;
never rewrite an existing instance's issuer, credentials or TLS identity.

The [Claude Code network documentation](https://code.claude.com/docs/en/network-config#custom-ca-certificates)
supports process-scoped `NODE_EXTRA_CA_CERTS`. A later trial must prove CA, hostname
and expiry checking on the actual executable; never disable TLS checks. Only the
named process gets fixture trust, through its bounded activation.

| Actor | Authority and credential boundary |
| --- | --- |
| Synthetic Context Subject / Authorizing Principal | A human operator acts as the explicitly named synthetic persona and approves the exact fixture and grant. This does not claim that Lucas stated its facts. |
| CR Provider Operator / co-located Authorization Service | Lucas operates the isolated local experiment. Existing private human credential/browser session permits management, never substitutes for a Context Client grant. |
| Controlled A/B clients | Test-only OAuth Code + PKCE clients, separate grants/tokens and grant-relative refs. Automated consent is fixture evidence, not human acceptance. |
| Proposed Claude host / HCP Client | Dedicated registration and temporary OAuth grant held by the host integration. Record Anthropic as the independently operated assistant service; local launch by Lucas does not establish a First-Party deployment. No directive-following claim or legal-retention claim is invented. |
| Model | Receives only admitted tool descriptors, HCP disclosure/error content and applicable directives. Holds no grant, management credential, access/refresh token, PKCE verifier, cookie or CA private key. |

Future host grant recommendation: temporary read-only `general_preferences`,
purpose `https://example.test/purpose/synthetic-review`, optionally narrowed to the
approved fixture entry; no persistence, refresh, write or onward permission.
Acquire it through existing exact consent and Code + PKCE in an isolated host
integration; do not reuse A/B credentials or paste a token into a prompt. Token
delivery and process isolation must be designed/tested before the host trial,
including preventing model shell/file tools from reaching credential material.
The actual client/operator registration and off-device destination are named in
that activation. Synthetic tool results reaching Anthropic need explicit bounded
approval; this roadmap grants none.

## Shared Ownership And Release Contract

The implementation integrator is the sole writer for `http.ts`, `authority.ts`,
`disclosure.ts`, `composition/hcp-authorization.ts`, shared fixture setup and any
dependency lockfile. A small `mcp.ts` adapter and pure descriptor/serialization
module may be added beside them. `management-presentation.ts` remains a pure UI
consumer with its [existing contract](../../../useful/HCP_SOURCE.md#small-view-and-action-contract).
No parallel writer touches shared routes/composition. An independent UI task needs
its own worktree/resources and an agreed integration order.

Reuse `readRequest`, `selectRead`, `prepareRead`, `releaseRead`, `project`, current
grant/token/policy checks and the same transactional `context.read` audit. Do not
route MCP through legacy Nest tools, create a second store or duplicate the policy
engine. Retain one authority owner and one release path for both bindings.

**Whole-response handoff is the critical change.** Current `releaseRead` serializes
the HTTP body inside its SQLite transaction, commits audit, rechecks deadlines,
then synchronously calls `res.end(bytes)`. MCP must construct and validate the
complete JSON-RPC envelope, structured result and text copy **inside that same
pre-commit serialization boundary**. Extend the seam with a bounded pure wire
representation/serializer; it receives only the admitted result and validated RPC
ID, never store/credential access. After commit, only final clock checks and the
synchronous transport handoff are permitted. No Promise, SDK queue, result
re-wrapping, additional JSON serialization, await/drain or callback to application
code may intervene before bytes are handed off. A serializer failure rolls back
the read audit and releases no success. A deadline crossed during COMMIT withholds
the already-built success while retaining the truthful attempted-read event.

Propose a small request-scoped Node HTTP adapter for this three-method surface,
validated against the pinned MCP wire contract and an independent official v2
client. This avoids migrating unrelated v1 consumers and makes final handoff
explicit. It is not a general MCP framework: implement `server/discover`,
`tools/list`, `tools/call`, plus required transport/protocol rejection behavior.
If the v2 server is used instead, first prove a synchronous final transport seam;
returning an authorized object into an asynchronous SDK handler is insufficient.

Use [MCP 2026-07-28 transport framing](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http):
per-request metadata/version and matching required mirrored headers, normal JSON
responses, no session ID or initialize-based authority. Validate Host/Origin,
method/name/version mirrors and request bounds before dispatch; reject mismatches,
unsupported versions and unsupported methods according to MCP. Advertise only
tools, no subscriptions/resources/prompts/sampling/tasks. Discovery/list responses
use zero private cache lifetime; modern complete responses include required wire
discriminators and server identity metadata. No protected result cache, SSE replay,
automatic read replay or fallback to a legacy endpoint. A repeat read is a fresh
authorized/audited retrieval. Discovery is public static experimental metadata;
list/call require valid Context Client authorization on every request.

Keep the existing experimental HCP manifest truthful. Do not add full Core,
MCP, Agent Interop or directive-following claims. An experimental discovery
reference may identify the source and empty `conformsTo`; it cannot be described
as satisfying §10.2/§19 qualification. No unsupported HCP operation appears in
`tools/list`.

## CR-Q7: Provisional Descriptors, Results And Errors

The pinned [§10](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s10.md)
governs. Bundle the relevant Core schema definitions from the normative pin with
their source IDs and internal references; never fetch schemas during a request or
depend on sibling HEAD. Present self-contained root-object schemas so the host
does not need remote `$ref` resolution. Validate against the pinned Core definitions
and the narrower Context Client shape; whole-entry alternatives must not permit a
stable ID, subject, private record/provenance or withheld counts to escape.

| Tool input | Proposed schema and shared service behavior |
| --- | --- |
| `hcp_queryContext` | Core `operations/query-request.json`; required `query` and `purpose`. Query: nonblank string, <=8192 UTF-16 code units. Purpose: existing URI validation, <=512 characters. Optional nonblank `purposeDescription` <=2048; optional categories array <=100, nonempty strings <=512, deduplicated without reordering; `[]` searches none. Optional positive safe-integer `maxEntries`, default 5, effective ceiling 20 (larger requests clamp, matching HTTP). No extra fields, cursor, stable IDs or credentials. |
| `hcp_getEntry` | Core `operations/get-entry-request.json`, Context Client subset: required nonempty `ref` and `purpose`, optional `purposeDescription` as above and positive safe-integer `version`. No `entryId` or extra fields. Pass `ref` separately to the shared read service; malformed type is invalid request, any unknown/private/cross-grant ref is indistinguishable unavailable. A prior version still requires current and historical eligibility. |

Output schema for each tool is a root object with two alternatives: its pinned
`operations/query-result.json` or `operations/get-entry-result.json` narrowed to
disclosures only, **or** Core error `{type, detail}`. Include the Core error-code
enum from §5.5, both fields required; do not invent success for an internal fault.
Require `directives` (possibly empty) in this Context Client result. Query success
contains `entries` (0–20), `categoriesSearched`, `retrievalId`, `timestamp`,
`minimization:{method:"lexical"}`, and `directives`. Get success contains one
`entry`, the same metadata except `categoriesSearched`, and method `none`.
Preserve allowed nested extension data as current projection does; no assurance
is inferred from it. One authorized HCP object `R` produces exactly:

```text
result: {
  resultType: "complete",                  // modern wire envelope, not inside R
  isError: false,
  structuredContent: R,
  content: [{type: "text", text: JSON.stringify(R)}],
  _meta: {"io.modelcontextprotocol/serverInfo": {name, version}}
}
```

An empty query is ordinary success with `entries:[]`, actual searched categories,
fresh retrieval ID/timestamp, applicable directives and durable read audit. It is
not `null`, an absent result, an error or a prose-only answer. Missing get is a
denial. Report-sharing's no-result ambiguity is deferred because that tool is
absent; C8 still owns its resolution before complete binding adoption.

| Condition | MCP response | HTTP parity / disclosure boundary |
| --- | --- | --- |
| Missing/invalid/expired/revoked credential or expired grant | HTTP 401 and bearer challenge, no tool result | Same authority failure; no challenge grants authority or automatically widens access |
| Request-only category/action/purpose outside the presented grant | HTTP 403, `WWW-Authenticate` `insufficient_scope`; scopes derive only from the request; purpose-only denial names its requested purpose in `error_description` | HTTP context denial stays 403. Use shared explicit denial classification before entry lookup; never turn generic stored-policy/entry denials into challenges |
| Missing, foreign-grant, outside-narrowing, inactive, expired or otherwise withheld entry/version; standing-rule or final-release policy denial | HTTP 200 tool error, `isError:true`, `structuredContent:{type:"scope-denied",detail:"Entry not available under this grant."}` | HTTP context 403. Same generic response for all hidden-entry cases, no revealing challenge, ref echo or private policy explanation |
| Recognized tool with invalid Core arguments | HTTP 200 tool error with `type:"malformed-request"` and bounded generic detail | HTTP context 422. Do not let SDK argument validation remap this to a protocol error |
| Invalid MCP envelope, unknown method/tool, malformed JSON/version/header mismatch | MCP protocol/transport error as specified, no HCP success | Distinct from Core errors; no entry selection or successful-read audit |
| Storage/audit/serialization/internal failure | Bounded internal protocol/server error, no protected result or raw exception | No success or false delivery claim; rollback before commit, retained attempted event after a committed attempt |

For tool errors, serialize the **same error object** to the text block. This is
the provisional CR-Q7 choice aligning §10.3's JSON text rule with §10.4; its example's
`"scope-denied: ..."` text is not serialized JSON. Record that discrepancy for C8;
do not call the local choice an adopted amendment. HTTP 401/403 are transport
outcomes and are not forced into a successful tool envelope. Metadata, error
details, descriptors, logs and both result representations exclude credentials.

## CR-Q8 And N4

Retain [CR-Q8](spec-questions.md#cr-q8)'s conservative C3 default: omitted categories
expand to grant-approved categories for the requested purpose, then standing rules
apply. If any is denied, the whole query fails. Explicit allowed-only categories
can succeed but still withhold an entry having any denied category. `[]` is a
successful empty search. Do not synthesize an effective-category view or quietly
broaden/narrow a query to hide that denial. MCP describes this limitation; HTTP
and MCP run the same selection code. Normative clarification/adoption stays C8.

For [N4](spec-questions.md#c7-http-query-parsing-follow-up-n4), add a query-specific
JSON path; leave OAuth/human form parsing unchanged. Accept `application/json`
case-insensitively, optionally `charset=utf-8` (including quoted value and normal
whitespace). Reject duplicate/unknown media parameters, non-UTF-8 charset,
form/text/multipart/LD+JSON query bodies and non-identity content encoding. Keep the
32 KiB raw-body bound, strict UTF-8 decoding and object-only Core arguments.
HTTP query failures remain 422 `malformed-request`; MCP unsupported media/encoding
is a transport refusal (415), malformed JSON is a parse error, and duplicate keys
are an invalid-request protocol error with untrusted ID omitted/null.

Reject duplicate JSON member names at **every object depth before JSON.parse can
discard them**, comparing decoded names (`purpose` and `\u0070urpose` collide).
Use a bounded JSON tokenizer/parser, not a regex or reviver that sees only the
surviving member; do not normalize/case-fold ordinary key names. Apply the same
policy to the raw MCP envelope and HTTP query; valid identical names in separate
objects are allowed. MCP Core validation follows framing validation. HTTP get's
existing duplicate query-parameter rejection remains. Test parameterized JSON,
invalid UTF-8/JSON, nested/escaped duplicates, encodings and size limits. These are
reviewable application contracts, not a new general parser migration.

## Tests-First Checkpoints And Parity Matrix

1. **Contract/transport red tests.** Add real HTTPS MCP tests beside `read.test.cjs`,
   reusing owned fixtures and OAuth drivers. Cover descriptors/schema closure,
   modern framing, request-only versus stored denials and N4 before changing
   parsing/authority. Pin the official v2 peer and verify import/protocol behavior
   without a host/model. Stop for a concrete contract correction if it cannot
   consume these descriptors; do not relax HCP or silently fall back.
2. **Shared release and adapter.** Write final-envelope expiry/revoke/serialization
   failure tests first, extend the one release seam, then add routing. Run focused
   read, policy, authority and affected write-result/governance consumers after
   each behavior change. The backend tests-first rule applies throughout.
3. **Integrated source handoff.** Complete the matrix below using isolated SQLite,
   HTTPS and actual process reopen/fault fixtures. Extend isolation/import/route
   checks for the named HCP MCP adapter; legacy routes remain denied. Run affected
   source/dashboard/OAuth browser checks only where shared routes changed. Capture
   adoption findings locally and prepare a bounded later host-activation handoff.
4. **One frozen candidate.** Resolve known findings, finish source instructions and
   focused checks, then fresh independent complete-diff authority/transport,
   persistence, compatibility and scope review. That is the proposed finalization
   milestone; the orchestrator confirms it at runtime activation. Publish one
   cohesive PR when authorized and require all applicable exact-candidate CI.

| Scenario, through both HTTP and MCP | Required observable evidence |
| --- | --- |
| Permissions | Same purpose/category/action/narrowing decisions, explicit versus omitted/empty categories, multi-category standing-rule denial; MCP's different 401/403/tool-error wrapping is intentional and tested |
| Reference isolation | A1/A2/B grants produce different refs; cross-grant, stable ID, unknown ref/version and withheld entry have indistinguishable denials; current/prior-version authorization checked |
| Lifecycle and time | Active-only reads; expired/deprecated/conflicted/deleted and restricted current/historical versions withheld; token expiry and **independent grant expiry while token remains otherwise valid**; restart does not revive authority |
| Release versus revoke | Revoke/policy change between preparation and release withholds all success bytes; change-then-restore does not revive ticket; unrelated grants survive; expiry during whole MCP serialization and COMMIT; no asynchronous gap before actual `res.end` |
| Durable audit | Successful and empty reads have one durable `context.read` each; original use-until/directives/versions/retrieval ID match both representations. Audit failure releases none; lost socket/post-commit interruption/reopen preserves attempted/unconfirmed truth. No query text/token/full payload log |
| Directives and copies | Same directive precedence/delivery and <=one-hour/entry-validity bound; not shortened merely to grant expiry. No false recall or host enforcement claim; CR-Q9 synthetic limitation retained |
| Schema and content | Same allowlisted HCP object under both interfaces; exact structured/text JSON equality, <=20 results, no pagination/private ID/provenance/count leak, bounded Core errors and protocol errors distinguished |
| Credential and composition separation | Management/cookie/legacy credentials cannot call MCP; Context Client cannot reach governance; per-request credential required, no session carryover; canary secrets absent from descriptors/results/errors/logs/model-visible fixture captures; no old data/prompt/export bypass |

Future focused commands start with pinned Node 24.21.0 / pnpm 10.25.0 and backend
build, then selected Jest HCP specs and serial Node `read.test.cjs`,
`read-recovery.test.cjs`, new MCP tests and affected source/OAuth/dashboard suites.
Use pinned Chromium only for affected browser behavior. Exact commands/files are
recorded with the implementation; no build/runtime tests are run for this brief.
Apply every relevant [validation matrix](../../../useful/AGENT_WORKFLOW.md#default-and-exceptions)
row: authority/persistence/composition require affected real Mac fixtures plus
applicable native/source/UI/packaging CI, not an automatic full local migration
run. No named aggregate gap currently selects that command. Artifact, other-Mac,
physical-loss, actual host, copy/directive and manual evidence stay separate.

## Decisions, Remaining Evidence And Activation

The schema/error, omitted-category and parsing choices above are safe provisional
choices for this synthetic slice; no user decision or upstream merge is needed
to finish planning. C7a implementation cannot claim host compatibility until the
official peer and actual pinned host have their respective evidence. The SDK
package pin/import must be verified during dependency activation. Failure to
preserve final release, a peer rejecting required schemas/framing, or a real host
that cannot keep credentials outside model reach is a blocker for that affected
step, not a reason to reopen unrelated C6 or implement every C8 issue first.

Recommended next activation: **authorize the sole writer to implement C7a
query/get plus N4 in an isolated source composition, tests first, including the
named v2 test dependency and one reviewed PR; exclude host setup/model use and
the localhost source-profile extension.** This plan itself authorizes none of
those changes, commits or publication. A subsequent C7b activation must name the
exact host binary/version, fresh sandbox/profile/port/TLS identity, temporary
grant and credential-delivery/isolation mechanism, accepted synthetic prompt and
off-device destination, process/trust/client changes, stopping/retention scope
and human evidence. Source or SDK tests do not substitute for that activation.

HCP adoption disposition: CR-Q7 lacks complete output/error descriptors and has
conflicting text-result examples; CR-Q8 remains an interpretation; N4 is application
interoperability work. The current material supports a bounded implementation
without a new skill/framework. Keep findings here and in the local questions for
the C8 review checkpoint; no upstream issue/PR or hcp-spec change is required now.
Broader OAuth, governance/erasure, reporting, complete MCP, Provider Interop and
host copy obligations remain mandatory selected-capability work by C9.

## Planning Review And Validation

Fresh read-only review approved the complete four-document planning diff against
the base above, with no actionable blocking findings. Requested reviewer settings
were Astra/xhigh; actual execution settings remain unverified. The reviewed brief
before this evidence-only receipt had SHA-256
`b426b9cad0073297d0d1a09cb7668391333f2d8a40f696b5a967a2ef125ac5ae`.
Authority/transport, privacy, schema/error, scope and validation coverage carry
forward because this receipt/status update changes none of those contracts.
The reviewer confirmed that environment-based token configuration alone is not
proof of model/credential isolation; C7b's existing stop gate remains required.

Planning checks on Node 24.21.0 / pnpm 10.25.0 passed:

- `scripts/check-toolchain.mjs`; path/basename/content reader discovery with `rg`;
  the maintained-document reader-inventory test in `ci-path-filters.test.mjs`
  (**1/1**). No additional direct reader of the edited prose was found.
- Markdown links across **163 files**, using the exact merged-base baseline:
  zero known or unexpected violations.
- `MIGRATION_GATE_BASE_SHA=f92260060152b6872b5732587027bd161bc4f590 node scripts/local-migration/check-nonruntime.mjs`:
  contract base comparison performed, **41 capabilities / 58 consumers**; separate
  `git diff --check` covers the uncommitted changes. The initial contract check
  flagged the proposed legacy-named endpoint reference; selecting the dedicated
  `/v2/mcp` route resolved it without registry, checker or CI changes.

No build, runtime test, full migration gate or CI run was performed for this
uncommitted planning assignment. Applicable exact-candidate CI remains required
at publication under existing routing. No runtime, actual host, installed-artifact
or new human acceptance evidence is claimed. PR #209's human Ctrl-C/full
stop-reopen/expired-session/pending-form cases remain deferred; do not repeat C6
merely to close this planning handoff.

## C7a Implementation Record (2026-11-21)

Implementation stays on `codex/hcp-c7-read-plan` at base/HEAD
`f92260060152b6872b5732587027bd161bc4f590`, carrying all four reviewed planning files.
This chat owns the complete uncommitted diff, builds and disposable test resources;
the orchestrator retains publication/sequencing. No upstream or personal-state
operation occurred. Requested coordinator/writer profile is Astra/xhigh; actual
execution settings are unverified. A scoped read-only wire reviewer requested
`gpt-6-astra`/`xhigh`; tool acceptance was observed, actual execution unverified.
The prior plan review is retained; complete-diff and affected correction review
are recorded in the local handoff below.

Primary verification established the target revision and the official
`@modelcontextprotocol/client` **2.4.0** package, Node >=20 and CommonJS import.
The downloaded registry tarball matched SHA-512
`LgrD2OphHuG12vfKFKz6SOnq7bKHQmhGJIAYdD+MZBn2npHEyry6uD8zvktodtl5CQM85MO0anUyD9JwmUmxww==`.
Its peer test pins `versionNegotiation:{mode:{pin:"2026-07-28"}}`, captures actual
headers/envelopes over verified fixture HTTPS, and checks discovery, descriptors,
query/get and generic Core errors. The peer imports only in tests; production uses
a small synchronous Node adapter and exact Ajv 8.18.0/ajv-formats 3.0.1 validators.
All preexisting lockfile resolutions remain unchanged. Nine bundled schemas retain
their normative source IDs; descriptor references are local and output validation
checks both pinned Core and the disclosure-only subset.

The wire review corrected three planning details: MCP recommends server identity
metadata (CR still supplies it); unreadable modern request IDs are **omitted**, never
null; discover/list require `ttlMs:0` and `cacheScope:"private"`. CR selects 406
for unacceptable Accept, 415 for media/encoding, 413 for oversize, 400 for other
framing/argument errors and 500 for internal protocol failures. Required MCP
unsupported-method/version/header statuses and codes remain exact. Both required
media types may carry positive quality values. No legacy negotiation is accepted.

The adapter includes the required invocation limiter: 60 calls per registered
client per monotonic minute, shared across grants/tokens, bounded by configured
registrations, reset on restart. It never limits governance/revocation. N4 also
bounds JSON nesting to 64. These are bounded application policies, not normative
HCP amendments. Complete message-pattern/subscription support remains a C9 gap.

Tests-first checkpoints observed expected transport/parser failures before runtime
edits and whole-response serializer failures before extending release. Corrections
also had failing Accept-quality and category-specific-purpose regressions. The
serializer test fixture initially used a clock inconsistent with OAuth issuance;
that prerequisite was corrected before release implementation. Unexpected serializer
faults latch the store unavailable, so tests inspect rollback only after normal
owned reopen. No unavailable-state bypass was added.

During iteration: N4/HTTP reads **27/27**, adapter/read/serializer **21/21**,
MCP semantic/recovery parity **34/34**, expanded boundary checks **13/13**, and
focused Jest policy/write-result/parser/isolation **25/25** passed. These counts
describe their named runs, overlap, and are not added into one total. The parity
driver reuses established read/recovery cases with raw MCP contract assertions
before normalizing binding-specific wrappers; direct HTTP probes in those cases
remain HTTP. A separate source-launcher test exercises the actual source profile.
Independent grant-deadline tests inject a shorter grant deadline at the already
authenticated authority seam while the real token stays valid; ordinary temporary
OAuth tokens remain capped by their grant. This closes the isolated final-clock
branch evidence gap without claiming a naturally issued overlong token.

Final local selection: stable backend build; new C7 wrapper and affected HCP
authority/policy/write-result/isolation/parser Jest tests; existing read/recovery,
OAuth/dashboard/source/write/governance/portability HTTPS/SQLite consumers; pinned
Playwright 1.63.0/Chromium 153.0.8010.12 source/OAuth browser tests; doc reader
inventory, links, exact-base contracts and whitespace. These exercise target-Mac
filesystem/process/recovery and browser risks. Native/installed code is unchanged;
artifact/other-Mac/manual host evidence and exact-candidate CI remain separate.
No named aggregate gap selects a full local migration gate. Final results and
complete-diff review will be appended after the candidate is frozen.

Contributor steps and bounded C7b prerequisites are in the
[source handoff](../../../useful/HCP_SOURCE.md#controlled-mcp-read-checks-c7a).
C7b still requires exact host/version, fresh localhost TLS/profile/port/registration,
OAuth delivery inaccessible to model tools, temporary narrow consent, the synthetic
prompt/destination, stopping/retention and human evidence. No host, trust, model,
off-device submission or installed-artifact work is activated by this implementation.

### C7a Local Handoff

The complete 25-file candidate was independently reviewed by `final_review`,
requested `gpt-6-astra` / `xhigh`, with actual execution settings unverified.
The first frozen manifest SHA-256 was
`29b4d381025bbbbfd468f952eef288bb7ea45905ecc33983f54ef14b73a8c331`.
Review found one P2: scope-challenge encoding split Unicode surrogate pairs and
could turn a request-only denial into HTTP 500. A new raw MCP regression reproduced
the failure before the fix. Complete-sequence UTF-8 encoding now preserves astral
characters and replaces lone surrogates only in the denial hint; matching and
authority are unchanged. Raw query/get argument-bound coverage and N4's stale
planning disposition were corrected in the same round.

The reviewer approved that three-file delta with no unresolved findings against
R2 manifest SHA-256
`cb1cec5a4ca856ff1be4bcf88da47f6f4ec3eef6422a87ab1d7c9b02b30ad1bb`.
All unaffected complete-diff review coverage carries forward. The following
status/evidence-only documentation receipt changes no reviewed runtime contract.

Final local evidence uses Node **24.21.0**, pnpm **10.25.0**, and disposable
synthetic resources on the target Apple Silicon Mac:

| Check | Result and scope |
| --- | --- |
| Backend build | Passed again after the Unicode fix and frozen dependency refresh. |
| Affected local-database Jest selection | **7 suites / 106 tests passed**: C7 wrapper, parser, isolation, authority, policy, write-result and writes. The later C7 run below renews the changed wrapper coverage. |
| Final C7 direct suite | **63/63 passed** across MCP/official peer, read/recovery parity, release/source, query JSON and whole-response serializer files, after the fix and dependency refresh. Includes the new Unicode and argument-bound cases. |
| Existing HCP HTTP consumers | **141/141 passed** across read/recovery, OAuth, dashboard, source, writes, governance and portability. |
| Source/OAuth browser cases | **13/13 passed**, Playwright **1.63.0** / Chromium **153.0.8010.12**, revision **1243**. |
| Existing SDK integrations | **2/2 passed**: real HTTP handshake and stdio bridge, after refreshing dependency links. |
| Documentation/contracts/style | Maintained-reader inventory **1/1**; links **163 files**, zero violations; exact-base comparison **41 capabilities / 58 consumers**; source/test/package Prettier and whitespace passed. |

Counts overlap and are not additive. The only post-first-freeze runtime change is
the MCP denial-header encoder. HTTP consumers and browser inputs are unchanged;
their earlier results carry forward. Dependency installation had left a stale
legacy SDK Ajv link at 8.20.0 after restoring its original 8.18.0 lock resolution.
Frozen installation with `--force --ignore-scripts` refreshed the links without
changing the lockfile; direct and legacy SDK Ajv both resolve to **8.18.0**.
The rebuilt C7 suite and legacy SDK integrations renew affected execution evidence.
All preexisting lock resolutions remain unchanged. The lock was manually merged
from pnpm-generated additions to preserve those resolutions, then verified by
frozen installation; its added blocks are not in pnpm's usual sorted order.
This is the accurate provenance of the earlier lock, not a generated-format claim.

Logs and immutable review manifests are under `/private/tmp/c7a-*`: final Jest,
consumer and browser logs; `final-r2-c7`, `legacy-sdk-smoke`, `unicode-red` and
`unicode-green`; and `frozen-manifest` / `frozen-manifest-r2`. The final handoff
manifest includes this evidence-only documentation delta. No tests, CI triggers,
contract baseline or approval requirements were weakened. The contract check is
not a claim that this mixed runtime diff qualifies for nonruntime CI selection.

**Historical local handoff: targeted checks passed; final validation pending.**
At that handoff the checkout was uncommitted; no publication, merge or release had
occurred. Subsequent publication is recorded below. Applicable standard CI (including native) and full
migration CI source/UI/packaging lanes must qualify the exact published candidate;
prior PR #211 results do not qualify this diff. No full local migration gate was
selected under the validation policy. Installed artifacts, other platforms,
the separately activated C7b human host trial and deferred C6 manual cases remain
unqualified here. C8 protocol resolution/adoption and C9 completeness remain owned.
The sibling `hcp-spec` stays clean at `5fc62a413794b5927f1251968e04381044af92c1`;
the normative/adoption pins and retained C6 human sandbox are unchanged.

### Claude Review Correction Round

Lucas requested assessment and fixes for the external review of PR #212 at
`8f72a248ebb4fe3d408107d276c3b43f51211e26`. Its availability and scope-token
injection reproductions were independently confirmed on disposable fixtures.
This candidate was committed/pushed in [PR #212](https://github.com/loyalagents/context-router/pull/212).
[Standard CI](https://github.com/loyalagents/context-router/actions/runs/44961548193)
and [migration CI](https://github.com/loyalagents/context-router/actions/runs/44961548075)
passed for that original head; the review identifies test merge
`60f24a49eaca1eef10145d79a0a364cf4af5b107`. Those passes do not qualify the corrections.
Accept the underlying defects and the parity/schema/depth/diagnostic/doc corrections.
Qualify the report's wording: a write-authorized grant here also requires read;
the injected challenge solicits broader consent rather than bypassing consent.

The sole writer retains ownership. Independent read-only plan review
`review_corrections_plan` approved the following checkpoints, adding classification
governance to ingress coverage. Requested reviewer profile is Astra/xhigh; actual
execution remains unverified. No host, upstream, personal-state or merge work is
activated. Continue the existing PR under its publication authorization.

1. Add failing Core-admission, retained-data, challenge and boundary regressions.
   Preserve Core-valid unknown evidence types/extensions. Validate ordinary/human
   writes, classification edits, policy, import current/history and seed inputs.
2. Share pure pinned schema validation between ingress, descriptors and both read
   bindings. Refuse invalid output before serialization/audit via a narrow expected
   error; preserve the latch for unexpected serializer, async, audit and store faults.
   Assert rollback, continued management/revocation and unrelated valid reads.
3. Validate Core category syntax, emit only advertised requested read scopes, add
   raw no-challenge denial assertions, remove nested dialect declarations, enforce
   exactly 64 containers, and identify modern versions in legacy initialize errors.
4. Reconcile lockfile provenance/publication wording, freeze the corrected candidate,
   run affected local checks and independent complete-diff review, then update the
   existing PR and renew exact-candidate CI. Carry forward only unaffected evidence.

Implementation now uses `core-contract.ts` for pinned Core validation and the
same bounded read contract in both HTTP and MCP. Known invalid read output raises
only `ReadResultError`; the narrow store exemption preserves rollback and retains
latching for generic serializer/async/audit/storage faults. Admission validates
full mutation documents, classification, directives, fixture fields/assembled
entries and imported current/history records. Core-valid unknown evidence and
extensions remain supported. No retained data is silently removed or rewritten.

Malformed categories now produce malformed-request instead of the earlier Unicode
challenge behavior; valid unknown slugs/URIs never become OAuth scope hints. Only
requested advertised read scopes are emitted. Raw stored-rule/historical-purpose
denials are checked separately from normalized parity. Schema dialect declarations
are root-only, nesting counts objects/arrays exactly, and recognized legacy
initialize errors list the supported revision. These corrections follow the
[JSON Schema root rules](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1.1)
and [MCP versioning diagnostic guidance](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#backward-compatibility-with-initialization-based-versions).

The lockfile is intentionally unchanged: accurately documenting its manual merge
avoids re-resolving unrelated dependencies for an ordering-only nit. The original
head's frozen installation and CI evidence remain applicable to those unchanged
dependency inputs; runtime/test evidence is renewed below.

Fresh read-only reviewer `claude_corrections_final` approved the complete 34-file
base-to-candidate diff with no actionable findings. Its manifest SHA-256 is
`456f9226afc8ae880e5a07e769b04aeadeea117aefd8905a9ff03591a4f05f6c`;
all file hashes and all nine pinned schema objects were verified before/after
review. Requested Astra/xhigh settings remain unverified in execution. The later
import fixture correction supplies required relationship actor/time fields while
preserving the existing foreign-relationship rejection assertion; affected review
and the selected suite are renewed. All runtime inputs remain byte-identical to
the complete reviewed candidate.

Correction evidence uses Node **24.21.0** / pnpm **10.25.0**, disposable synthetic
stores and the target Apple Silicon Mac. Both reported exploits were reproduced;
new admission, retained-data, schema/category and depth regressions failed before
the runtime correction. Backend build, focused integration/MCP **18/18**, affected
Jest **4 suites / 79 tests**, existing HTTP consumers **141/141**, and source/OAuth
browser **13/13** passed. Counts overlap. The final HCP Jest selection and renewed
import fixture suite are recorded with their outcomes in the PR description,
alongside exact corrected-candidate standard/native and full migration CI.
Documentation links, maintained readers, exact-base contracts, style and whitespace
are checked after the final evidence-only documentation update. No full local
migration gate is selected under the unchanged validation policy; original
dependency/legacy SDK evidence carries forward only for unchanged inputs.

**Targeted checks passed; final validation pending.** The PR description is the
publication/CI receipt; no pass-only commit is required. Host/manual/installed
artifact evidence remains outside this round, and no merge is authorized.

### Revealed Evidence Re-review Correction

Lucas requested fixes for the Claude re-review at
`b78c580af54c97514888b7a4a1e3e0c03063ef9b`. Accept its medium-severity finding:
the pinned stored-entry schema permits an extra evidence-item `revealed` member,
while the disclosure schema constrains it. Copying a value such as `5` can refuse
every matching read; the earlier non-latching fix already preserves management
and revocation. All earlier findings were confirmed resolved. Both previous-head
CI workflows subsequently passed, but do not qualify this correction.

The bounded interpretation follows pinned §14.9: `revealed` describes provider
derivation for a disclosure. This synthetic General Context slice derives no
credentials. Reject its presence, regardless of value, at new mutation/person,
current/history import and fixture/seed admission. Omit only that top-level member
from query/get projections of retained evidence, preserving nested opaque members,
unknown evidence types, unrelated invalid-shape refusals and stored document bytes.
Neither the pinned schemas nor `validCore` are changed. This is an application
admission/projection rule, not a claim that Core entry schema forbids that member.

Independent read-only plan review `review_corrections_plan` approved these
checkpoints (requested Astra/xhigh, actual execution unverified):

1. Observe failing admission/person/key-reuse and retained-projection regressions.
2. Add the shared own-property guard and copy-only projection; build and run focused
   checks, including malformed and valid forged values, historical reads and reopen.
3. Freeze, independently review affected contracts against the complete PR, renew
   the MCP/write/import/read coverage and documentation readers, then publish to
   the existing PR and renew exact-candidate CI. Carry forward only unaffected
   prior review and evidence; no full local migration gate is selected.

The reviewer identified a deliberate boundary: existing committed mutation
receipts replay stored response bytes before new-admission validation. Preserve
those bytes and known-commit recovery; do not rewrite receipts or claim this
correction removes the member from every possible response. The guarantee covers
new mutation admission and query/get disclosure projection. No stored data,
personal client, host/model, installed artifact, spec pin or upstream work changes.
Final local results, review approval and CI identities belong in the PR receipt;
the previous round's broader evidence remains scoped to unchanged inputs.
