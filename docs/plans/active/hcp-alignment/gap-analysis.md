# Context Router And HCP: Gap Analysis

- Status: historical source assessment plus C6 inventory and merged bounded source evidence; demo-first C6–C9 routing below; no conformance established
- Assessed: 2026-11-07
- Plan and decisions: [HCP alignment brief](README.md)
- Relationship: [HCP integration reference](../../../useful/HCP_INTEGRATION.md)

**Current C8 candidate:** [CR #221](https://github.com/loyalagents/context-router/pull/221)
is being aligned with unmerged spec #49 at `be930499`. This addresses the selected
G02/G10/G14 write-purpose, completion and recovery cases; the
[C8 brief](c8-resolution-brief.md#updated-49-application-plan-2026-11-27) records
tests and independent review. Runtime/adoption pins remain unchanged. Full grant
issuance breadth, MCP writes, §18.3 Provider Interop and profile qualification remain
C9 obligations; remaining #38 correction restrictions, D3 erasure and CR-Q9 data
gates are unchanged. The historical assessment below is not rewritten by this patch.

## Baseline And Method

The assessment compared Context Router
[`ca5dd77b8953b660b8e2d916d645ef690cdaf8bd`](https://github.com/loyalagents/context-router/tree/ca5dd77b8953b660b8e2d916d645ef690cdaf8bd)
with hcp-spec
[`b764a058eac15a4cd843892e60473089b2e835bb`](https://github.com/loyalagents/hcp-spec/tree/b764a058eac15a4cd843892e60473089b2e835bb),
whose normative **2.0-draft-3** content remains at the
[pinned reference revision](https://github.com/loyalagents/hcp-spec/tree/2e2939c9bebcefb3bed7bb3522231c0e4d65a315).
The subsequent merges at the assessed heads were documentation changes.

Evidence is source and existing test inspection across authorization, data
lifecycle, bindings, consumers, and storage, followed by independent plan review.
No application, tests, builds, or personal-data inspection were run for this
assessment. Source pointers below are repository-relative for navigation; assess
them at the recorded revision when reproducing the findings. HCP links are pinned.

"Partial" means a useful implemented foundation with additional requirements.
"Missing" means no matching behavior was found in the inspected implementation.
"Different semantics" identifies an existing contract that needs an explicit
transition. External authorization-server configuration and receiving-client
behavior are unverified. These groups are planning IDs, not an exhaustive list of
every normative MUST or a compliance score. C0 expands the selected requirements
into executable evidence; normative text governs schema differences.

The [alignment plan](README.md#outcome-and-scope) now permits direct HCP redesign
without backwards compatibility. Current-evidence cells remain observations of
the assessed revision, not promises to retain those interfaces. Prospective work
below follows that direction: fresh stores, permission to delete all existing CR
application data and database migrations, and coordinated replacement of affected
application consumers. Historical conversion is outside the planned scope.

## Authorization And Consent

| ID / HCP requirement | Current evidence | Assessment and required change |
| --- | --- | --- |
| G01. Actors and packages — [§§3, 18][hcp-3] | Separate human/browser/MCP/inference authorities; [local credential records](../../../../apps/backend/src/mcp/local/local-mcp-credentials.ts) hold instance ID, label, generation, revocation and policy. Hosted clients resolve through the [client registry](../../../../apps/backend/src/mcp/auth/mcp-client-registry.service.ts). | Partial. Add HCP client/operator/requesting-party bindings, per-client subject pseudonyms, and immutable actor snapshots. Product labels, locality, and bridge authorship do not establish first-party operation. Proposed Agent Interop + Memory Manager scope remains conditional on the role map. |
| G02. Positive grants and purpose — [§6][hcp-6] | [PermissionGrant](../../../../apps/backend/prisma/schema.prisma) stores user/client/target/action/effect. [Authorization](../../../../apps/backend/src/mcp/auth/mcp-authorization.service.ts) intersects capabilities, maxima, slug rules and sensitivity; an unmatched narrowing rule is not an additional restriction. | Missing HCP grant semantics. Record grant ID, actors, category/action/purpose details, narrowing, status and duration. Establish explicit HCP authority; do not inherit old grants implicitly. If historical records are adopted, account for existing person-imposed restrictions before exposure. Free-text query intent is not approved purpose; unknown narrowing must fail closed. |
| G03. Consent and token lifetime — [§§6, 13][hcp-13] | [SQLite credentials](../../../../apps/backend/src/infrastructure/storage/sqlite/sqlite-mcp-credentials.ts) persist until rotation/revocation. The [HTTP transport](../../../../apps/backend/src/mcp/local/local-mcp-http.ts) has a session idle timeout. Hosted [JWT guard](../../../../apps/backend/src/mcp/auth/mcp-auth.guard.ts), metadata and DCR supply existing plumbing. | Different semantics. Temporary authorization is the default; persistence is a separate affirmative act. Consent shows purposes, operator, narrowing, expiry and copy ceiling. Separate grant, token, browser and transport lifetimes. Add HCP OAuth authorization details/resource binding/current-grant checks. Hosted AS enforcement is unverified; unbound machine-user client-credentials behavior does not establish a person's HCP grant. |
| G04. Revocation and copies — [§§6.2, 7.6][hcp-6] | Admission rechecks authority after body ingestion. [Local MCP tests](../../../../apps/backend/test/local-mcp/tools.test.mjs) deliberately permit an already-admitted mutation to commit after revocation; [lifecycle tests](../../../../apps/backend/test/local-mcp/lifecycle.test.mjs) preserve admitted work after rotation. | Partial with a concurrency mismatch to resolve. Define authorization/commit/disclosure ordering; add grant surrender, use-until, registered notification delivery and person-visible outcomes. Sleep/restart matters for local expiry and retries. A grant's expiry does not cap already-disclosed copies; notification of revocation ends their use. No notification endpoint caps copies at one hour. |
| G05. Standing rules, directives and sharing — [§§3.12, 6.3–6.4][hcp-6] | Current per-client slug permissions have no corresponding operator-wide standing-rule/directive records. Existing assistant setup does not demonstrate host-side HCP obligations. | Missing. Apply standing rules across applicable existing/future grants, return directives on required responses, and provide human controls. Initially issue no onward-sharing permission, but implement required sharing reports, including recording/rejecting unauthorized sharing. Provider conformance does not certify recipient purpose/copy/directive behavior. |

Retain fail-closed authority enforcement and human/context-client separation.
The new OAuth deployment needs an explicit local trust-boundary design; reusing
hosted Auth0 implicitly would change the installed application's dependency model.
See [local runtime boundaries](../../../current/LOCAL_APPLICATION.md).

## Entries, Provenance, And Lifecycle

| ID / HCP requirement | Current evidence | Assessment and required change |
| --- | --- | --- |
| G06. Content, identity and versions — [§§4, 5, 11][hcp-4] | [Preference storage types](../../../../apps/backend/src/domains/shared/storage/storage-types.ts) and [schema](../../../../apps/backend/prisma/schema.prisma) contain mutable typed values, three statuses and no monotonic version. One row is allowed per user/context/definition/status. [Reviewed revision](../../../../apps/backend/src/modules/preferences/preference/preference-revision.ts) is explicitly a state hash, not a historical/monotonic version. | Different semantics. Stable entries and immutable content/assertion/evidence versions, atomic expected-version checks, prior-version retention, and independent classification/lifecycle transitions. Accept strings and arbitrary General Context objects; define HCP content and location semantics directly. If historical adoption is selected, define faithful mappings for legacy boolean/array values and location context. Preserve unknown nested entry members through supported round trips. |
| G07. Provenance and inference — [§§3.5–3.8, 4.4, 5.2.3][hcp-3] | [Preference service](../../../../apps/backend/src/modules/preferences/preference/preference.service.ts) separates value source from mutation actor. [MCP SET](../../../../apps/backend/src/mcp/tools/preference-mutate.tool.ts) uses INFERRED with optional numeric confidence. Historical source/evidence lacks full HCP model, operator, grant and confirmation records. | Partial. Capture asserter and assertion time, submitting client/operator, authorizing grant, provider and version-bound confirmations; provider assigns authority fields. Inference requires non-null high/medium/low confidence. Define any valid numeric mapping prospectively; never invent missing historical confidence/model identity. IMPORTED/SYSTEM are not direct HCP declaration types. |
| G08. Confirmation and proposals — [§§3.8, 5.4][hcp-5] | Accept/reject upserts an active/rejected preference and deletes the suggestion. Rejection can suppress later suggestions for a definition/location. [Reviewed apply](../../../../apps/backend/src/modules/preferences/document-analysis/reviewed-suggestion.service.ts) checks exact state and commits per-item writes/audit; legacy apply remains supported. | Different semantics. Confirm/reject the version shown using expectedVersion; retain the original asserter/type on confirmation and clear confirmations on revision. Editing into a new person assertion differs from confirming an inference. Keep unapplied document suggestions outside HCP entries; HCP has no suggested state. Bind new proposal provenance to server-owned facts where claimed. |
| G09. Categories and sensitivity — [§4.5][hcp-4] | [Definitions](../../../current/PREFERENCE_SCHEMA.md) use slugs and a sensitivity boolean; category is enriched from a slug prefix in the [SQLite repository](../../../../apps/backend/src/infrastructure/storage/sqlite/sqlite-preference.repository.ts). | Missing HCP classification. Define reviewed registered/custom categories separately from slugs/dimensions. Any permitted category can reach an entry, but a standing-rule denial on any category overrides that route. Use the highest category sensitivity and disclose only covered categories. Definition editing must not silently widen HCP exposure. |
| G10. Conflict handling — [§§4.7, 15][hcp-15] | [Extraction](../../../../apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts) consolidates same-slug candidates before persistence. Active-slot uniqueness and overwrites do not retain independent contradictory assertions. | Missing. Apply a declared detector on every relevant write/revision in either arrival order; persist contradictions, standing-aware quarantine, reevaluation and human resolution. A shared dimension alone is insufficient. Structural detection is permitted; protocol correctness and detector quality need separate evidence. |
| G11. Lifecycle and erasure — [§§4.2.4, 5.2.5, 5.4.2][hcp-5] | [Delete](../../../../apps/backend/src/modules/preferences/preference/preference.service.ts) physically removes the row while audit snapshots can retain content. [Reset](../../../../apps/backend/src/modules/reset/user-data-reset.service.ts) and [history clear](../../../../apps/backend/src/modules/preferences/audit/history-clear.service.ts) have separate app semantics. | Different semantics. Withdrawal hides and retains an entry; management hard deletion makes it unrecoverable. Enforce expiry before disclosure even before a cleanup sweep. Account for revisions, snapshots, caches, backup/key copies and recovery. Preserve person access to retained non-active states. Existing clear-memory/history controls need explicit HCP scope. |

### Historical Adoption And Bypass Inventory

Fresh HCP stores are the target; all existing CR application data and database
migrations may be discarded during implementation. Preservation, backups, and
historical conversion are not delivery requirements. This documentation phase
performs no deletion. Historical CR data is not an HCP v1 export. If conversion is
requested as later additional scope, faithful adoption depends on the facts
available for each record. Keep unrepresentable records outside HCP-managed data;
never manufacture authorization or assertion history. A deliberate fresh person
declaration is possible; generic migration approval is not that declaration.
Existing acceptance of an inference does not transform its original asserter.

For shared entries, ordinary GraphQL/profile set/accept/reject/delete, legacy MCP,
both document-apply versions, [identity seeding](../../../../apps/backend/src/infrastructure/storage/sqlite/sqlite-identity-storage.ts),
[location deletion](../../../../apps/backend/src/modules/preferences/location/location.service.ts),
definition changes, reset/history clear and offline imports must use the same
invariants if retained; otherwise remove, disable, or exclude those paths from
HCP-managed records. The reviewed apply path
directly uses a storage compare-and-set facet, so wrapping PreferenceService alone
does not cover it. Location deletion can cascade stored preferences.

Before HCP-managed records enter shared production data, also rebuild or remove
legacy reads, exports, resources and AI prompt builders, or exclude HCP records
from them. No old wire contract must be preserved. This boundary
is necessary for the product's claimed protection; do not assume that a new HCP
endpoint automatically governs other interfaces.

## Retrieval, Audit, And Bindings

| ID / HCP requirement | Current evidence | Assessment and required change |
| --- | --- | --- |
| G12. Query and minimization — [§§5.2, 7.1–7.3][hcp-7] | [Literal search](../../../../apps/backend/src/mcp/tools/preference-search.tool.ts) permits omitted-query enumeration and filters before capping. The default [maximum](../../../../apps/backend/src/config/mcp.config.ts) is 100, independently applied to active/suggested arrays. [Smart search workflow](../../../../apps/backend/src/modules/workflows/preferences/preference-search/preference-search.workflow.ts) ranks slugs and filters before inference; its tool filters again. | Partial. Require approved purpose; reject unauthorized requested categories/purpose. Apply lifecycle, entry purposes, grant and standing-rule filters, then declared final relevance ordering and one total cap: default 5, maximum 20. No padding or pagination. Preserve pre-prompt filtering; slug order alone does not establish ordering among every returned entry. |
| G13. Disclosure — [§7.4–7.6][hcp-7] | Literal results include stable IDs/status/source type. Smart search returns enriched stored rows, including application identifiers and attribution fields; see [repository types](../../../../apps/backend/src/modules/preferences/preference/preference.repository.ts) and [tool](../../../../apps/backend/src/mcp/tools/smart-search.tool.ts). | Missing HCP projection. Use an allowlist, not a spread of old rows: opaque stable-per-grant references, version, permitted content/evidence/assertion, covered categories, standing, useUntil, applicable directives and minimization method. Relationships name only same-response refs. Optional authorized provenance exposes permitted names/kinds, not private party/document/grant identifiers. |
| G14. Durable audit and summaries — [§8][hcp-8] | Mutation/audit commits share the [SQLite unit of work](../../../../apps/backend/src/infrastructure/storage/sqlite/sqlite-unit-of-work.ts). [MCP access logging](../../../../apps/backend/src/mcp/mcp.service.ts) swallows append failures and locally records counts rather than disclosed entry/version/use-until. History can be cleared. | Partial. Add HCP events, roles/operator snapshots, grants, purposes, disclosure records, summaries and retention semantics. Non-read events are durable before acknowledgement; reads can be synchronous or have the explicitly bounded window allowed by §8.4 (at most 10 seconds). Best-effort loss is not a bounded guarantee. Do not record query text. Append-only requirements do not make hash chains universally mandatory. |
| G15. Governance and portability — [§§5.4, 18.4][hcp-5] | Dashboard/GraphQL supports editing, grants, and history. [Grant-list tool](../../../../apps/backend/src/mcp/tools/permission-grant-list.tool.ts) sees the caller's CR rules. Demo import and evaluation exports have different formats/semantics. | Partial UX foundation. Add complete human entry/conflict/grant/purpose/rule/audit/disclosure controls, hard delete and HCP export/import. Export includes retained lifecycle states; import needs dry-run outcomes, duplicate/conflicting-ID behavior, category mapping and no deleted resurrection. Management HTTP authority is distinct; context-client scope cannot grant governance. |
| G16. HTTP and retry — [§9][hcp-9] | Existing GraphQL/local administration/MCP routes have no HCP HTTP operation contracts. Session request-ID handling is not durable operation idempotency. | Missing. Implement context and governance routes, HCP-Version on responses, required media/error shapes, discovery, audit cursors, and create/revise idempotency retained at least 24 hours. Bind replay to a reviewed authorization/erasure policy; Q2 is unresolved. Retain truthful uncertain-commit outcomes and no automatic unprotected mutation replay. |
| G17. MCP transport and tools — [§10][hcp-10] | [Local transport](../../../../apps/backend/src/mcp/local/local-mcp-http.ts) supports 2025-06-18/2025-11-25 with initialized sessions; lockfile SDK is 1.27.1. [Bridge](../../../../apps/backend/scripts/mcp-bridge/bridge.mjs) rejects extra capabilities and requires session IDs. Six [registered tools](../../../../apps/backend/src/mcp/mcp-tool.providers.ts) are CR-specific. Mutation is intentionally text-only in the [contract test](../../../../apps/backend/test/contracts/mcp-contract-baseline.spec.ts). | Different semantics. HCP targets MCP 2026-07-28, per-request state and server/discover. Replace existing tools/bridges as needed with HCP tools and exact input/output/error behavior using structuredContent plus JSON text; old contracts need not be preserved. The official SDK supports the new revision, but upgrading a dependency alone does not opt into it. |
| G18. Discovery, claims and consumers — [§§18–20][hcp-18] | Schema resource is GraphQL SDL; local capabilities resource reports model readiness. Existing local-MCP, browser and storage tests establish CR-specific contracts. | Missing HCP discovery/evidence. Publish actual operator, categories, schemas, bindings, methods and durability, and only complete conformance claims. Inventory supported clients and their copy/directive behavior. HCP's schema checks are not the forthcoming behavioral suite; qualify the selected Parts against runtime scenarios and exact candidates. |

The [official MCP SDK migration guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
was consulted on 2026-11-07 to verify the new revision and explicit opt-in path.
Recheck concrete SDK/client versions when C7 is activated. This observation does
not qualify the current bridge or any assistant host for HCP.

## Highest-Value Acceptance Scenarios

These are acceptance requirements, not test results; C1–C3 are merged and bounded
C4 is activated under the canonical plan, with its decision/review dependencies:

- Two clients cannot substitute actors, link subjects through provider identifiers,
  use another grant's refs, read another grant, or gain governance through scope.
- Authentication cannot create access; persistence needs a separate act. Refresh,
  idle sessions, suspend/restart and clock boundaries cannot extend a temporary grant.
- Wrong purpose, unknown narrowing, alternate-category access and standing-rule
  changes behave consistently before inference and final disclosure.
- Stale confirmations and concurrent revisions change nothing; rejected current
  versions cannot be revised by a Context Client. Commit/lost-reply/retry produces
  one operation and one mutation event, without automatic uncertain MCP replay.
- Conflict results are symmetric in arrival order, distinguish complementary
  statements from contradictions, and preserve other unresolved conflict edges.
- Absent, inaccessible and foreign-grant entry references have nondisclosing
  failures. Sparse queries are unpadded; private provenance and non-active entries
  cannot leak through results, relationships, resources, or old read paths.
- Withdrawal/expiry hides entries immediately; export includes retained states;
  unknown fields survive round trips; import and recovery cannot resurrect erased
  entries or revoked authority. Erasure covers content-bearing caches and snapshots.
- Disclosure audit failure, process loss, notification failure, and dormant-store
  recovery preserve the declared durability and truthful person-facing outcomes.

Existing starting points include [local MCP tests](../../../../apps/backend/test/local-mcp),
[reviewed SQLite apply](../../../../apps/backend/test/local-database/reviewed-apply.spec.ts),
[PostgreSQL apply](../../../../apps/backend/test/integration/reviewed-apply.spec.ts),
and [shared storage contracts](../../../../apps/backend/test/integration/storage-contracts/storage.contract.ts).
Implementation acceptance must exercise both selected bindings and rebuilt or
retained application consumers, and prove superseded paths cannot bypass HCP
controls. Schema validation or tests mirroring new helper functions are insufficient.

## C0 Requirement And Test Matrix

C0 adds this prospective matrix at CR base `cb9d3f9fc36a6c90dcc5bcf96dbdd33e9bf70fa2`;
**the assessed source evidence above is unchanged**. D8 now selects local SQLite
only. Every row is an acceptance obligation or reasoned exclusion, **not a test
pass**. The [scope record](README.md#c0-scope-record) fixes the contracts; this
matrix supplies observable checks. `Build` means build for C3, `Contract` means
fixed at C0, `Deferred` names the disabled capability/dependency, and `N/A` means
inapplicable to this bounded slice. CR-Q1's read contract was selected on
2026-11-08; CR-Q3's deadline discrepancy still separates application experiment
acceptance from pinned-spec compliance.

| ID / gap / source | Disposition and checkpoint | Observable acceptance or deferral condition |
| --- | --- | --- |
| C0-R01 · G01 · §§3.2–3.5, 18 | Contract + Build C1/C2: actors and authority | A/B grants bind their registered client/operator, subject and purpose; subject pseudonyms differ by client and stay stable across restart. Request-supplied subject/operator/requesting-party/management-role substitutions cannot alter authority. Real operator identity is not inferred from product name. Additional A1/A2 grants for one client isolate purpose/category authority; no silent union. Revoking A1 leaves A2 valid, including overlapping permissions; grants alone do not isolate shared-client internal features. |
| C0-R02 · G02/G03 · §§6.1, 13.3–13.6 | Contract + Build C2: real local consent/OAuth | Actual TLS-verified browser authorization-code/S256-PKCE journey, separate login/consent acts and independent management credential. Wrong resource/issuer/redirect/verifier, code replay and login-only access fail. Both RFC 9396 details and scope-only purpose selection work; granted details match the committed grant and token response. No token becomes usable before grant/audit commit. |
| C0-R03 · G03 · §§6.1.3–6.1.6, 8.1, 13.4 | Build C2: temporary authority; grant dormancy deferred to C2; C1 entry recovery accepted | Default 4h/max 24h absolute expiry, tokens at most 1h/remaining grant; neither restart nor session activity extends them. Equality/past-expiry denies. Consent shows exact expiry and copy ceiling. No refresh or persistent grant is issued. A 48h stopped-provider scenario cannot satisfy the pinned audit deadline; separately scoped catch-up tests can prove application behavior only, without renewed expiry or backdated audit. Shorter tests do not close the discrepancy. |
| C0-R04 · G02/G05/G09 · §§4.2.6, 4.5, 6.1.5, 6.3 | Contract + Build C2/C3: purposes/categories/narrowing | Wrong requested purpose or any unauthorized requested category fails the whole query. Omitted categories search only purpose-approved categories. Intersect assertion and management purpose restrictions. `entryIds` narrowing cannot widen category authority; unknown key fails issuance and unknown persisted restriction reaches nothing. Own-grant output substitutes refs for private IDs. |
| C0-R05 · G05 · §§6.3–6.4 | Build C2/C3: policy enforcement, fixture controls | Existing/future grants obey operator exact/domain/subdomain and `requires` rules; any denied category hides a multi-category entry via all routes. A rule covering all grant categories revokes it. Changes race through the same final-release gate. Matching directives accompany query/get/own-grant, including clients with no directive claim; deny/ask-first/permit precedence cannot widen access. Fixture changes require management authority and durable events. |
| C0-R06 · G04 · §§6.2, 7.6, 8.4 | Contract selected; Build C2/C3; CR-Q1 clarification remains upstream | Barrier-controlled read before release loses to revoke and returns no context. Audited release before revoke can arrive later; slow recipient cannot delay revoke. Later reads under revoked grant A1 fail; A2 and B remain independently usable within their own grants. Audit/revoke failure and process-loss cases do not create successful unaudited reads or resurrect authority. Check authority at admission and again in the coordinated final check/audit/release boundary; a separate check/send gap is unacceptable. After an audit barrier, advance time past each token/grant/entry/prepared-copy deadline in turn: final time check denies release without renewing deadlines or erasing the committed audit attempt, and history must not claim receipt. No spec PR is a prerequisite for this selected read experiment contract. |
| C0-R07 · G04/G13 · §§6.2.2–6.2.4, 7.6 | Contract + Build C3: bounded copies | `useUntil` ≤ release time + 1h and earlier explicit validity; a short grant does not shorten existing copies. A revoked-grant denial is notice to that client. Human view reports no notification endpoint and last possible copy deadline, never remote deletion or invented notification success. Notification delivery/retries N/A until endpoints are supported in C5. |
| C0-R08 · G06/G07 · §§3.5–3.7, 4.2, 5.2.3, 11 | Contract + Build C1: entry/version/provenance | Seeded strings and structured objects retain IDs/subject, v1/v2 immutable content/assertion/evidence/provenance, actual or explicitly simulated fixture authority and timestamps. Provider fields cannot be caller-overridden; person-declared alone remains unverified. No inference, issuer identity or confirmation is manufactured. C3 seed authority is closed before A/B serving. |
| C0-R09 · G06/G13 · §§4.2, 7.4, A.3 | Build C1/C3: unknown-field round trip | Nested unknown entry/content/assertion/record members survive serialize → commit → reopen → authorized internal/management whole-entry read with values/types intact. Unknowns do not change authorization. Public content/assertion extensions survive disclosure as stored; private record/top-level extensions are withheld. Export/import acceptance remains C5, not implied by storage round trip. |
| C0-R10 · G11 · §4.2.4, §8.1 | Build C1/C3: lifecycle; C1 overdue application recovery accepted 2026-11-08 | Non-active/expired fixtures never disclose, including still-active rows past validUntil and historical-version get against current lifecycle/policy. Expiry changes status/audit once without new content version; reopening does not revive it. Test exact expiry and rollback; 48h catch-up is accepted C1 application evidence only, with no claim to meet the conflicting deadline. Respect deleted/revoked precedence rather than overwriting it with expired. |
| C0-R11 · G12 · §§5.2.1–5.2.2, 7.1–7.3 | Build C3: minimized retrieval | Filter before scoring; tokenize only public `content.value` strings/primitive structured-value leaves, then deterministic descending token overlap and tie-break. Vary only private provenance/metadata/withheld categories: no new match or changed ordering among entries with unchanged eligibility. Positive-match sparse/empty results, default 5 and requested 1/5/20, ceiling 20, no padding/pagination, one cap over the whole response. Required query/purpose and malformed limits fail validation. Get returns `method:none`; query `lexical`; no withheld counts. |
| C0-R12 · G13 · §§5.2.2, 7.4 | Contract + Build C3: disclosure/ref isolation | Same entry has stable A ref over versions/restart and different B ref. Foreign/absent/inaccessible/non-active refs fail identically as not authorized. Disclosures contain only allowlisted fields and covered categories, no stored ID/subject/status/private provenance. Relationships include only targets in that same response, expressed as refs. |
| C0-R13 · G14 · §§3.9, 8.1–8.4, 8.7 | Contract + Build C1–C3: synchronous audit | Compare successful response with durable retrieval event after restart: exact entries/versions/useUntil, actors/grant, purpose, directives, categories searched and quantity. Empty success is audited. Query text, tokens and full snapshots are absent. Inject append/commit failure: no successful body. Lost delivery after commit remains a logged attempt, not evidence of receipt. State transitions and their events commit/rollback together. |
| C0-R14 · G15/G02 · §§5.2.6–5.2.7, 5.4, 6.1.5, 6.1.9, 8.3 | Build C2/C3: minimal human control | Human lists active/all grants, inspects disclosure events and revokes. A can read/relinquish only A's presented grant, never enumerate all or revoke B. Every management route rejects a context token even with forged management scope. Human/session credentials cannot be substituted for context bearer tokens. Unimplemented management operations remain unavailable. |
| C0-R15 · G16 · §§9.2–9.7 | Build C2/C3: selected HTTP contract | Selected query/get/grant/audit/revoke routes obey Core shapes, `HCP-Version:2.0` on successes/errors/bodyless responses, LD+JSON success and problem+JSON mapped errors; unsupported request version rejects. Audit-history pagination has stable opaque cursor/order; it does not add query pagination. Mutation/import/export/sharing endpoints remain unavailable. |
| C0-R16 · G06/G14/G18 · CR storage contract + D7 | Contract + Build C1: fresh SQLite/recovery | Fresh init → seed → close → reopen and reset → fresh init pass with private root/schema/ownership checks. Wrong/partial schema, symlink/escaped root or live/unproven owner refuses without touching neighbors. Rollback on late failure; kill/reopen after acknowledged commit preserves data/audit. Interrupted init cannot serve. Reset invalidates all old store identities, tokens/grants/refs and touches no original documents/model/client settings. Mac filesystem/process checks are required where used. |
| C0-R17 · G06–G15/G18 · D4 shared-access boundary | Contract + Build C1/C3; broader integration Deferred C6 | Old GraphQL/MCP/document/model/import/reset/history-clear modules have no HCP-store handle; old routes/credentials cannot read/write experiment records. Test the actual selected composition. Before production exposure, complete producer/consumer inventory and replace/remove every bypass; no compatibility adapter requirement. |
| C0-R18 · G18 · §§18–19 | Contract + Build C2/C3; full discovery Deferred C8 | TLS AS/resource metadata resolves to local fixture endpoints; unsupported capability absent from experimental manifest. No full-Part identifiers or conformant-discovery assertion. C8 must supply full §19 document including jwks_uri and evidence for every advertised claim. Optional provenance action is disabled until separately selected/tested. |
| C0-R19 · G06–G11/G16 · §§3.8, 4.7, 5.2.3–5.2.5, 9.6, 15 | C4 activated 2026-11-09; decisions and plan review first | Originally disabled pending C4 dependencies; the November 13 implementation and evidence record below supersedes that state. C4 tests expected-version, symmetric conflicts, confidence, lost reply/restart and no resurrection before enabling them in the isolated experiment. |
| C0-R20 · G03–G05/G11/G14/G15 · §§5.4, 6, 8.3/8.6 | Deferred C5 with dependency | Persistent grants, extra OAuth flows (CR-Q4), full governance editors/summary/export, HCP-native portability, hard deletion, sharing reports including unauthorized reports, notification registration/retry and full retention are deferred. No sharing permission now does not remove the later sharing-report obligation. Resolve CR-Q2/Q3 before affected erasure/dormancy/recovery. |
| C0-R21 · G17/G18 · §§10, 18 | Deferred C7/C8 | MCP 2026-07-28 tool/output/error contract (CR-Q7), bridges and actual assistant-host behavior stay disabled. C7 needs HTTP/MCP semantic parity and host credential/copy/directive evidence; C8 exhaustive package/profile qualification, not schema-only certification. |
| C0-R22 · G01/G07 · §§14, 16–17; D8 | N/A with reason | No credentials/issuer-attested health/education, delegates, operator-blind encryption, model calls, real hosts or hosted/PostgreSQL HCP deployment in this slice. These profiles/features are not activated by ordinary synthetic personal statements. HCP v1 portability is considered in C5 protocol scope; legacy CR conversion/upgrade/compatibility is out of scope, not deferred. |

C1 and C2 write failing behavior tests before backend changes, then run focused
checks at each increment. C3's suite must exercise the real selected HTTP/SQLite
composition and barrier-controlled concurrency, process termination/reopen and
browser consent, not only unit mocks. Record exact commands/fixtures/revision at
implementation time; no new scripts or speculative CI commands are created by C0.
No package/profile claim, real-host result, installed artifact qualification, or
physical host-power-loss result follows from this matrix or the earlier source audit.

## C1 Implementation Evidence (2026-11-08)

C1 was activated only for the portions below and merged in PR #204. Tests live under
`apps/backend/test/local-database/hcp-experiment/`; the canonical brief records
candidate-bound validation/review. The original source audit and C0 matrix above
remain historical/prospective evidence, not full conformance results.

| Row | C1 implementation and evidence | Still deferred |
| --- | --- | --- |
| C0-R08 | Provider-assembled simulated bootstrap provenance, unverified assurance, empty confirmations, stable IDs/subject and retained immutable v1/v2; `entries.spec.ts`. | Real authenticated seed approval/closed authority in C3; production writes/inference C4. |
| C0-R09 | Nested JSON entry/content/assertion/evidence/classification/private-record values and types survive serialization, SQLite commit/reopen and whole-entry internal inspection. Unknowns are opaque. | Authorized public disclosure allowlist C3, export/import C5. Internal inspection is not an authorization API. |
| C0-R10 | Atomic current-entry expiry and audit before admission/inspection, exact deadline, simulated 48h outage, batch audit/commit failure, later deadline during commit, repeat reopen, deleted/revoked precedence; `expiry.spec.ts` and process suite. | HTTP nondisclosure C3; grant expiry C2. Pinned-spec deadline conformance remains unresolved under CR-Q3. |
| C0-R13 | Entry/version initialization and expiry state/audit share the data transaction; append-only guards; process loss before/after commit. | HTTP disclosure attempt audit, response release and authority races C2/C3. |
| C0-R16 | Real private SQLite init/admission/reopen/reset, durable complete marker, exact manifest/schema/pins, exclusive lease, live/unproven owner refusal, stopped process recovery and new identity after repeated reset; ownership/process suites. | Physical host loss/cross-boot/other platform and installed-artifact evidence. Unproven partial initialization is refused, with harness-only stopped sandbox teardown. Future credentials/grants/refs do not exist in C1. |
| C0-R17 | Explicit non-listening composition; source consumer check; actual old adapter open/bootstrap rejects experiment root and copied HCP file under old database name. | Real C3 route/credential isolation and complete C6 production read/write bypass inventory. |

C1 changes no old migration, adapter, CI route or application launch path. SQLite
is the only selected HCP adapter. This is historical C1 evidence, not a C2 pass.

## C2 Requirement Selection (2026-11-08)

The [concrete C2 plan](README.md#c2-activation-and-concrete-plan-2026-11-08) is
activated from merged C1 at `077d0a13b223d9f450e1464076e7a7a5b3ac4c05` and was
independently reviewed before implementation. The canonical brief records focused
C2 implementation evidence and corrections; final review/qualification passed
in merged PR #205. Candidate-era pending prose is historical. The table preserves acceptance scope rather than asserting conformance.

| Rows | C2 acceptance | Explicit remaining boundary |
| --- | --- | --- |
| R01–R03 | Registered/server-bound actors, client pseudonyms, real affirmative HTTPS OAuth consent for RAR and scope-only requests, temporary/token bounds and grant expiry/restart | No persistent grant, extra flow, delegate or actual assistant host; dormant deadline claim remains blocked |
| R04–R05 | Internal entry/category/purpose/narrowing evaluator; authenticated policy changes; standing rules/directives; own-grant restriction presentation through minimal opaque refs | Public query/get and filtering-before-ranking remain C3; full governance editor C5 |
| R06 | Immediate grant-specific revocation, durable events, current-authority checks, issuance/own-grant races, A1/A2/B and slow-recipient independence | Full content-release/audit/entry/copy deadline races remain C3 |
| R13–R15 | Grant/policy transitions and truthful audit, independent human controls, own-grant/relinquishment, cursor history and selected HTTP framing | No fabricated disclosure history; content retrieval/audit C3, writes C4, complete governance C5 |
| R16–R17 | Preserve/renew affected C1 ownership, durability, reset, process recovery and isolated-composition checks as grants/credentials enter the same store | No legacy adapter, shared production-store exposure, personal-state operation or installed artifact; integration C6 |
| R18 | Actual AS/protected-resource metadata and clearly experimental capability manifest | Canonical claim-bearing discovery and complete Part/profile/package evidence remain C8 |

R07/R09–R12 disclosure work, R19–R22 and all unselected later capabilities retain
their prior C3–C8/deferred/inapplicable dispositions. R12 contributes only the
minimal grant/entry opaque-ref primitive needed by R04's already-selected own-grant
contract. Token details and own-grant retain the `narrowedTo.entryIds` key with
grant-local ref values, while internal authority and human inspection retain the
private entry IDs. C3 public retrieval is now activated by the November 9 instruction below.

## C3 Requirement Selection (2026-11-09)

Activated from C2 merge `6a7db3f5531557a489e6398945b352952e0220a0`; the
[concrete plan](README.md#c3-concrete-implementation-plan) maps R04–R15/R17/R18
and renews affected C1/C2 authority/durability/isolation evidence (R01–R03/R16).
The checkpoint table is an acceptance plan, not test results. Public writes,
confirmations, inference and durable mutation replay remain R19/C4; full governance,
portability, notifications and additional OAuth flows remain R20/C5. R21/R22 keep
their deferred/inapplicable scope. No normative pin or conformance claim changes.

### C3 Candidate Evidence (Now Merged)

| Selected rows | Implemented synthetic evidence | Remaining boundary |
| --- | --- | --- |
| R04/R05/R07 | Query purpose/category/narrowing intersection, historical get current+selected eligibility, all-category rules before lexical ranking, positive relevance and 1/5/20 cap; actual HTTPS regression cases | No semantic ranking/model or full governance editor |
| R08/R09/R11/R12 | Explicit exact-bundle authenticated initializer closure; preserved unknown public JSON versus allowlisted private withholding; per-grant refs, informational relationship provenance and same-response refs; directives recorded as IDs | C4 writes/confirmations/inference and lifecycle relationships; C5 export/import |
| R06/R10/R13 | Serialized final authority/policy revalidation, durable attempted-read audit, postcommit token/grant/current/selected/copy deadlines; revoke/policy races, slow recipient, injected failure and kill/reap/reopen | Receipt/client compliance and physical host loss not proved; pinned dormant deadline discrepancy unresolved |
| R14/R15/R17/R18 | Independent human paginated history and conservative copy deadline, governance denial for context credentials, TLS-verified Chromium A1/A2/B journey and legacy route/credential rejection | No installed integration, notifications, canonical discovery or conformance claim |

The [canonical checkpoint record](README.md#c3-implementation-checkpoints-2026-11-09)
owns freeze-time commands, passed checks and carry-forward. Final review/CI and
the human merge of PR #206 are recorded in the C4 activation; older pending
statements retain their historical scope.
C1/C2 affected regression evidence was renewed; this is a bounded synthetic
application candidate, not package/profile or independent-host interoperability.

## C4 Requirement Selection (2026-11-09)

Activated from C3 merge `a1ad0c6c248af74f8353c26c7a86f2f43f1ee2ec` under
the [concrete C4 plan](README.md#c4-activation-and-concrete-plan-2026-11-09).
This expands C0-R19 and affected shared contracts, not a claim that they pass.
Lucas selected CR-Q2 permission-change response-cache invalidation on November 11;
on November 13 he selected original-request completion-only success with separately
authorized data and requested C4 resume. The changed release contract passed
affected plan review before dependent backend edits. The earlier concrete plan received
conditional independent approval; the changed cache contract passed affected review.
No dependent backend changes precede those gates; C5–C8 remain unactivated.

| C4 row / source gap | Acceptance and planned evidence | Boundary |
| --- | --- | --- |
| C4-R01 · G02–G05/G09; C0-R01–R06 | Fresh affirmative read/write consent; old reads/bootstrap deny writes; same-detail category/action/purpose/narrowing; A1/A2/B isolation; policy/revoke/deadline ordering via actual HTTPS and browser | Paired read/write, single approved write purpose; no persistent/extra OAuth flows or implied asserter assurance |
| C4-R02 · G06/G07; C0-R08/R09/R13/R16 | Stable ID/ref, immutable +1 versions, provider-owned provenance, arbitrary supported JSON/unknown preservation, expectedVersion race and full rollback; valid expired/deprecated revision versus deleted-state refusal; SQLite reopen | Fresh SQLite only; no legacy conversion or issuer/credential-content authority |
| C4-R03 · G08/G11; C0-R10/R14 | Latest confirmation disposition, same-version history, stale review refusal, fresh version without endorsements, edit-as-person authority; management UI and context credential denial | CR-Q5 selected application history; no undo, resurrection or full C5 governance/export |
| C4-R04 · G07/G08 | Unapplied proposals produce no HCP entry/ref/context audit; exact apply under current grant; registered controlled model/source and required high/medium/low confidence | Synthetic producer seams only; no real model/doc ingestion or installed workflow integration |
| C4-R05 · G10 | Declared typed contradiction plus same dimension without contradiction; both arrival orders, complete pair collection, same/different asserters and authoritative/unverified/confirmed standing | Structural fixture vocabulary, not semantic quality/universal ontology |
| C4-R06 · G10/G11 | Multiple edges, client/provider re-evaluation, fresh human acceptance/rejection/dismissal and peer effects, authoritative withdrawal quarantine, expiry precedence, transactional audit and restart | No automatic resolution beyond the pinned same-asserter rule; no issuer profile |
| C4-R07 · G16; C0-R06/R07/R13/R15 | CR-Q2 table: exact-body key replay, different body/operation/target, concurrent retry, lost response, restart, revoked/expired/narrowed authority, later conflicted/deprecated denial, original expired copy deadline; durable permission-change payload invalidation without duplicate execution, no resurrection after restored permissions/restart, unaffected grant/client isolation; management consumed-operation versus still-valid grant; known-commit original completion-only success without protected data/headers; loss of write with retained read authority; uncertain commit never falsely acknowledged; actual status/body/audit checks | Permission reset reviewed November 11; completion contract selected November 13 and proposed in hcp-spec #36; slow-commit normative cutoff remains separate; no MCP retry or erase conformance claim |
| C4-R08 · G11/G14/G16 | Every content-bearing result/ledger/history dependency inventoried for later erasure; same operation never retried after known durable result; no test-only deletion bypass offered | C5 owns actual hard-delete/purge/retention/recovery proof; content-free marker is proposed, not an upstream resolution |
| C4-R09 · G14/G18; C0-R16–R18 | Affected ownership/durability, isolated HTTP/composition/legacy denial, C1–C3 regression and docs consumers; independent full diff and exact-candidate CI/receipts | No installed artifact, real host, client-copy compliance, physical power-loss or full conformance evidence |

### C4 Implementation Evidence (2026-11-13)

The [local implementation/adoption record](README.md#c4-local-implementation-and-adoption-record-2026-11-13)
maps the selected rows to person/model writes, exact human review and retained
history, private controlled staging, per-edge conflict handling, durable retry
receipts and original-channel minimal completion. The 57 focused write/graph tests,
backend build, three real Chromium journeys and 97 selected composition/dependency/
document contract tests pass locally. Combined regressions and final review/CI are
tracked in that canonical record; these are not conformance results. No installed
root, real producer/client, legacy adapter, spec source or pin changes.

Reusable findings remain local except the authorized issues #34/#36. In particular,
unverified model-ID equality across submitting clients, pair-local human resolution,
the coupled grant/token deadline evidence and the complete C5 erasure inventory
remain explicit adoption boundaries. The supplied research motivates the selected
completion behavior but does not alter the pinned normative target.

## C5 Planning Requirement Expansion (2026-11-14)

C4 is merged in PR #207 at `666f9d1b5ff3dde322ad4c368b44d2f4399f203e`;
its [merge/evidence record](README.md#c4-merge-and-c5-planning-ownership-2026-11-14)
supersedes earlier candidate-era pending statements. This table expands C0-R20 and
affected shared rows for **the activated bounded C5 implementation**, at that base and the unchanged normative
pin. The user authorized runtime after independent plan approval; this table is not a test result. The original source assessment
above remains historical. The [C5 plan](README.md#c5-planning-and-decisions-2026-11-14)
owns selected D1–D6 directions, including D3 hard-delete deferral, checkpoints,
copy inventory and validation. These product selections do not resolve the named spec dependencies.

| C5 row / gaps | Required behavior and observable acceptance | Dependency / remaining claim |
| --- | --- | --- |
| C5-R01 · G03/G15; C0-R02/R03/R14 | Temporary default, distinct affirmative persistence act, correct visible lifetime and durable election/modality; no forged/stale/preselected persistence | D1; persistent null grant expiry must be separate from finite OAuth/token/session state; C5c |
| C5-R02 · G03/G04/G16; R02/R03/R06 | Rotating public refresh, resource/client/grant isolation, concurrent reuse/rollback/restart/revoke; no lifetime extension or silent scope widening | C5c; CR-Q4 still blocks complete OAuth profile until minimum/conditional flows resolved; omitted device/client-credentials not hidden |
| C5-R03 · G09/G11/G15; R04/R05/R19 | Management-only category/purpose edits at expectedVersion, no new content version, from/to audit, null/empty meaning, current+historical enforcement, stale same-version review and response invalidation | C5b; selected D2 exact-capability exception is experimental pending #38; login never content authority |
| C5-R04 · G10/G11; R19 | Active+conflicted candidate reevaluation after category edits; preserve original assertion ordering, holds, peer states and unaffected edges | C5b; no automatic model identity assurance or semantic detector claim |
| C5-R05 · G05/G15; R05/R14 | Full stable-ID rule/directive list/set/remove, operator/claim/category matching, immediate future/existing-grant rules, all-denied revoke, delivered text and precedence | C5b; CR-Q8 provisional; CR-Q9 before sensitive C6/C7; clients' actual following remains C7 evidence |
| C5-R06 · G14/G15; R13/R14/R15 | Audit snapshots of actual offered categories/client identities and copy bounds; full §8.3 filters/JSON-LD export; summary including write copies, empty reads, multigrant notification and uncertainty | C5b/d/e; CR-Q15 interpretation before implementation; no verified-receipt claim |
| C5-R07 · G05/G14/G16; R20 | Valid-grant attributable sharing report commits event even on403, wrong/foreign refs do not leak, audit failure cannot falsely acknowledge durable report | C5d despite no onward permissions; CR-Q14 blocks post-revocation attribution path and broader historical-permission semantics |
| C5-R08 · G04/G14/G15; R06/R07/R20 | Durable independent revocation/outbox, same signed token per attempt/restart, ≥5 attempts/≥1h retryable failures, terminal202/400 outcomes, no fake sleep attempts, person-visible failure/last deadline | C5d; CR-Q13 strict-age interoperability and #3 dormancy deadline claims remain unresolved; endpoint/signing lifecycle must be fixed first |
| C5-R09 · G03/G04/G15; R07/R14 | Retain proposed1h provider cap, distinguish grant/copy expiry, truthfully show legal-retention declarations before consent and at revoke/summary | C5c/d; no real recipient compliance or legal-obligation verification claim |
| C5-R10 · G11/G15; R09/R14/R20 | Export defaults to all retained current lifecycle states, rules/directives; versions/audit opt-in, exclude only deleted when asked, no erased data, correct durable options event | C5e; #25 invalid example is nonblocking; no credentials/granted authority exported |
| C5-R11 · G06/G07/G11/G15; R09/R20 | v2 manual import preserves subject/declaration/provenance/confirmations/unknowns; deleted never active; same-ID changed content rejected even at higher version; no manufactured history; local and intra-batch conflict/expiry admission before exposure, with atomic graph audit and no foreign management authority | C5f; D4/#21 association, D5/#24 policies, #19 history/collision/audit import and #19/#37 cross-provider ordering/relationships gate their cases; v1 optional/omitted |
| C5-R12 · G05/G15/G16; R05/R20 | DryRun no domain/audit change; review binds exact bundle and destination; revalidate atomically; all accepted outcomes/policy effects/import audit commit together; stale preview and lost reply safe | C5f; zero-entry policy-only imports and foreign source audit cannot bypass person review or become local authority |
| C5-R13 · G11/G14/G16; R16/R19/R20 | Hard deletion explicitly unavailable; retained-history protections unchanged, no purge tables/framework or false success | D3=A; C5g deferred pending #23/#39, mandatory Core capability incomplete; future design begins with a concrete transaction |
| C5-R14 · G11/G14/G16; R03/R06/R13/R16 | Retained history no implicit TTL; transient retention separately bounded; consumption never becomes a fresh operation; no restored credentials/content after recovery | Cross-cutting C5; selected D6 denies expired-copy replay even under otherwise valid authority, requiring renewed expectations, affected review and explicit §9.6 disposition before implementation |
| C5-R15 · G01/G15/G18; R01/R14/R17/R18 | Every new management route rejects context credentials; actual synthetic browser/HTTPS/SQLite journey and early denial regressions; complete C5 roadmap disposition | C5h; C6 integration/bypass cleanup, C7 MCP/real clients/N4, C8 resolution/adoption and C9 package/profile qualification remain separate |

Blocking dependencies prevent only the named branches while independent planning
and later authorized work continue. They cannot be relabeled as completed C5 or
used to waive a MUST. Required source/OS/browser/persistence evidence, independent
complete-diff review and all applicable exact-candidate CI follow the unchanged
workflow. The original planning-only checks remain historical; the activated runtime
candidate and focused evidence are recorded in the
[C5 implementation checkpoint](README.md#c5-implementation-checkpoint-2026-11-15-utc).
C5-R01–R12/R14/R15 are implemented within the stated experimental boundaries,
with final review/CI passed in merged PR #208; the [C5 merge record](README.md#c5-merge-and-c6-planning-ownership-2026-11-15) preserves scope and local aggregate crashes. C5-R13 remains an explicit capability gap.

## C6 Current Access-Path Inventory (2026-11-15)

Refreshed by read-only source inspection at CR C5 merge
`c3c953a769596930b5b760735344f3f89626fd55`. This supersedes the historical bypass
inventory for C6 planning, not its original source observations. The
[concrete proposal](README.md#c6-application-planning-2026-11-15) selects an isolated
source dashboard only. No runtime was launched and no new behavior is proved here.
Paths below are relative to the repository, primarily under `apps/backend/src/`.
The inventory groups every current producer/consumer family, including direct
adapter paths and downstream copies; generated hooks are consumers of their named
GraphQL route, not a separate authorization boundary.

**Disposition vocabulary:** **rebuild** replaces the selected application contract
using HCP services; **remove** removes an obsolete control/contract from the HCP
surface; **disable** offers no operation there; **exclude** means no HCP store,
credential or data handle reaches that retained composition/tool. Exclusion is a
positive boundary to verify, not compatibility machinery. All first-slice exclusions
apply before its first serving readiness. Their ordinary hosted/installed versions
remain unchanged. Future rebuild/removal requires the stated capability selection,
with no legacy adapter, conversion or deprecation window required.

| Path / current caller → consumer or storage | First source slice disposition and why | Later owner/trigger |
| --- | --- | --- |
| HCP `composition/hcp-authorization.ts` → `authority.ts` → `http.ts` and transactional store | **Rebuild** source selection and management presentation around this existing composition. Use authenticated `managementEntries`, `managementEntry`, `audit`, `reviewPersonWrite`, `commitReviewedPersonWrite` and `releaseWrite`. Raw `store.inspectEntries` remains internal, never the dashboard API. | C6a–d; same authority for every new application route |
| `composition/local-ui-application.module.ts`, `application-features.module.ts`, `local-mcp-features.module.ts`, hosted `app.module.ts`; `apps/web/local-ui.mjs` | **Exclude** ordinary Nest/GraphQL/MCP/model roots and their old SQLite/PostgreSQL adapters. Do not inject an HCP handle into them or select through the old local/hosted mode flag. | C6 eventual composition selection; retained hosted/PostgreSQL HCP stays out of scope |
| `modules/preferences/preference/{preference.resolver,preference.service}.ts`: set/suggest/accept/reject/delete → UOW preference upserts/deletes + audit | **Exclude** all old GraphQL mutations. Accept/reject moves between row types; deletion physically removes a row, unlike HCP version/confirmation/withdrawal contracts. | Rebuild selected manual/profile actions in later C6; remove superseded HCP-facing APIs together |
| Web profile `ProfileForm.tsx`, preferences `ManualPreferenceForm.tsx`, `SuggestionInbox.tsx`, `PreferenceItem.tsx`, generated hooks | **Remove** these controls from HCP navigation; **rebuild** only exact person correction. Existing batch profile set/delete and implicit definition creation have no HCP authority. | C6 profile/manual UX selection; ordinary dashboard remains isolated |
| `mcp/mcp-tool.providers.ts`: all six tools in `mcp/tools/` | **Exclude** `preference-list.tool.ts`, `preference-search.tool.ts`, `preference-mutate.tool.ts`, `smart-search.tool.ts`, `schema-consolidation.tool.ts`, `permission-grant-list.tool.ts`. These read definitions/active/suggested rows, mutate values/definitions, invoke AI or expose legacy grants. | C7 replaces tools/binding; no old MCP transport or credentials in C6 source dashboard |
| `mcp/resources/schema.resource.ts`, `mcp/local/local-capabilities.resource.ts` | **Exclude** GraphQL SDL and model-readiness resources. They advertise old interfaces and may probe model status; neither is HCP discovery. | C7 transport; C9 claim-bearing discovery |
| `document-analysis.resolver.ts`: `applyPreferenceSuggestions` V1 → per-item `PreferenceService.setPreference` | **Exclude** resolver, hosted web V1 path, orchestrator and eval callers. Submitted evidence/confidence and partial batch writes cannot become HCP provenance/authority. | C6 document proposal contract, separately activated |
| `reviewed-suggestion.service.ts`: `prepare`/`applyPreferenceSuggestionsV2` → serializable `tx.preferences.compareAndSetActive`; SQLite/Postgres preference repositories; local web `SuggestionsList.tsx` | **Exclude** the direct CAS facet and V2 callers. Wrapping `PreferenceService` alone misses this writer. No V1 fallback in HCP. | C6 replacement must remove/replace CAS semantics under exact HCP review and atomic audit |
| `document-analysis.controller.ts`, `document-analysis.service.ts`, `preference-extraction.service.ts` | **Exclude** analysis/upload and duplicate-consolidation paths: active values + definitions/schema enter model prompts; extracted/staged outputs return to web/orchestrator. | C6 actual document producer; authorized pre-prompt selection, truthful source/model provenance and private staging before activation |
| `modules/workflows/preferences/preference-search/{preference-search.resolver,preference-search.workflow}.ts`; schema-consolidation workflow; `preference-schema-snapshot.service.ts` | **Exclude** search/schema AI reads. MCP supplies filters, but dashboard resolver supplies identity callbacks (`slugs => slugs`, `values => values`). Old MCP filtering does not protect GraphQL prompt construction. | C6 selected AI/search work; model activation separate |
| `modules/preferences/form-fill/{form-fill.controller,form-fill.service,form-fill-prompt-builder.service}.ts` | **Exclude** the PDF form-fill controller route: active preferences → prompt → model → PDF/results/download. The PDF is another data disclosure/export sink. | Later C6 product selection with output/prompt authority tests |
| Preference resolver `activePreferences`/`suggestedPreferences`/`preference`; definition resolver catalog/schema export; web `LocalPage.tsx`, profile/preferences/schema pages and caches | **Exclude** all old read routes, hooks and caches. Global/location merge, full rows, schema and stable IDs are not HCP disclosures. | Rebuild only selected HCP entry/list/history views now; other consumers later |
| Audit/access query services, GraphQL history and web history; local MCP-management permission targets/previews | **Exclude** old snapshots, history export and definition/authority projections. Historical payloads can contain values even when current preferences do not. | C6 HCP audit/summary UI uses its own management service; no legacy-history escape |
| `modules/auth/verified-human-identity.resolver.ts:seedInitialProfileMemory`; SQLite/Postgres identity storage `createInitialProfileValue` | **Exclude** first-login profile-hint seeding. It directly inserts a preference after identity commit, bypassing `PreferenceService`; login/hints cannot fabricate HCP assertion or consent. | C6 chosen identity/onboarding flow before use |
| `domains/shared/storage/seed-catalog.ts`, `prisma/seed.ts`, SQLite local runtime | **Exclude** catalog writes to legacy definition storage and legacy identity/bootstrap. **Rebuild** only explicitly approved synthetic HCP fixture initialization. | C6 source initialization now; eventual selected schema/bootstrap later |
| `apps/backend/scripts/demo/{domain,mcp-import,records}.mjs`, `examples/demo-10-2026/`, desktop demo preparation/runtime | **Exclude** old importer: temporary legacy MCP authority → definition/set operations with historical records. Do not invent historical HCP consent or model facts. | Separate C6 demo/installed selection; current demo and presenter edits untouched |
| `modules/preferences/location/location.service.ts`, SQLite/Postgres location repositories and FK schema | **Exclude** create/update/delete and location-scoped reads. Location delete cascades preference rows; location edits also change their meaning. | Later C6 choose explicit HCP meaning/lifecycle, never reuse implicit cascade deletion |
| `preference-definition.{resolver,service}.ts`, schema editor and MCP definition mutations | **Exclude** create/update/archive and old catalog mapping. Definitions affect sensitivity, validation, permissions, exports and model input. | Later C6 reviewed classification/schema design; no silent widening on a definition edit |
| `modules/reset/user-data-reset.service.ts`, corresponding GraphQL/UI | **Disable** reset in HCP surface; **exclude** reset facets deleting preferences, histories, definitions, locations and grants. No shared HCP handle. | Later C6 bounded owned fresh-store/reset delivery; legacy discard does not cover new HCP records |
| `modules/preferences/audit/history-clear.service.ts`, `clearMyHistory`, history UI | **Disable** HCP history clear. Retained append-only HCP history is not the old deletable access/audit stream. | Hard deletion remains C5-D3/#23/#39; no substitute erasure via clear/reset |
| `apps/local-orchestrator/src/server/{analysis-client,apply-client}.ts`; `examples/eval/scripts/ingestor/`, `materialize-synthetic-memory.mjs`, exporter/memory-snapshot clients and queries | **Exclude** GraphQL upload/apply V1, reset/set/suggest/accept/definitions and value/schema snapshot outputs. Downstream scoring and agents must not see HCP records through these files. | Rebuild only if separately selected; old formats are not HCP portability |
| `examples/eval-harbor/sidecars/cr-memory/server.py`, direct Prisma/SQLite seed/probe/admin scripts, root `test-*.sh` callers | **Exclude** independent FastMCP/storage/snapshot service and operational direct-store callers from HCP roots/endpoints. Similar tool names are not integration evidence. | Relevant eval/tool owner when explicitly selected; never count as HCP qualification |
| Desktop `runtime/maintenance.mjs`, local identity/MCP administration, backup/restore/recovery, demo reset | **Exclude** installed/offline operators from the synthetic source envelope; preserve installed paths and ownership guards. | C6 later delivery selection requires target inventory and installed evidence; no silent personal/demo reset |
| Existing HCP `producer.ts`, fixture seed and C5 governance/portability/outbox paths | **Exclude** producer seam from public application entrypoints; label controlled fixture producer `modelExecuted:false`. **Reuse** current governed import/export, policy and history services without wider accepted cases or arbitrary endpoints. | Later actual producer provenance; C5 limitations/selected decisions remain; no model execution now |

Inventory method: inspect composition imports, resolver/controller/tool registrations,
service and UOW facet callers, direct identity/location/repository writes, web hooks,
AI input builders and offline scripts through their storage/output boundary. The
future implementation must repeat reachability checks for changed files, not rely
only on filename grep or a `PreferenceService` wrapper. The current
`isolation.spec.ts` checks real old adapter admission (including an HCP database
renamed to the legacy filename) plus exact source-import boundaries; extend its
allowlist only for named source entrypoint files. Canary synthetic entries should
never reach old prompts, schema/history exports, PDFs, eval snapshots or diagnostics.

### C6 First-Slice Requirement And Evidence Matrix

The rows define the first-slice acceptance contract at the unchanged normative pin;
merged implementation evidence is recorded below. The complete C6 roadmap
is broader; G06–G15/G18 are only partially addressed by this slice.

| ID / requirement | Observable acceptance | Evidence owner / boundary |
| --- | --- | --- |
| C6-R01 · G01/G02/G15/G18; §§5.4, 6.1.9, 18.4 | Authenticated person enumerates every retained state and inspects exact current/prior version plus history; context/legacy credentials cannot enumerate. Historical version view labels current classification/lifecycle honestly. | C6b browser/HTTP; management inspection is not bulk Context Client retrieval |
| C6-R02 · G06–G11/G16; §§3.5/3.8, 5.2.4, 6; C5-D2 | String-valued supported target only; exact replacement/evidence/assertion effects shown; fresh one-use reviewed authority, correct selected purpose and principal restrictions; stale/forged/expired/foreign-session review has no mutation. Old version/provenance preserved, +1 version, new person assertion, no inherited confirmations. | C6b source/SQLite/HTTPS/browser tests first; no issuer/structured editor or real-model claims |
| C6-R03 · G14/G16; §§8, 9.6; C4 completion and C5-D6 | Version/graph/audit/receipt atomic; failure before commit rolls back; kill/lost response after commit never duplicates. Final serialization/render authority expiry withholds protected details but known commit may acknowledge minimally. Changed-then-restored policy never revives old review/cache. | C6b/c actual process failure + browser; no automatic mutation retry; retained original copy deadline |
| C6-R04 · G06/G14/G18; C0-R16 | Explicit owned fresh setup/fixture approval; same schema-3 store/config/credential/issuer reopens; entries/history/grants survive, bootstrap stays closed; valid browser/review authority keeps its original deadline/binding/consumption checks; expired or invalidated authority never revives and pending forms never auto-submit. Wrong/live/unproven/partial/symlink/legacy roots, missing descriptor, expired TLS or busy origin refuse safely. | C6a/c SQLite/process/TLS/Mac; no migration/reset/repair or physical host-loss qualification |
| C6-R05 · G06–G15/G18; C0-R17 | Every inventory family has no HCP handle. Real selected server denies the legacy GraphQL, MCP, local-admin, document analysis/PDF and upload route families; GraphQL operations for both apply versions/reset/history clear are unavailable. Old adapter rejects HCP store/copy. Canary content absent from legacy exports/prompts/logs. | C6a/d composition/import checks plus real admission/route probes; no universal JavaScript sandbox claim |
| C6-R06 · G01/G13/G18 | Pinned HTTPS browser with owned profile-local trust only; bad CA/hostname/expiry/origin denies; no secret output or arbitrary egress; profile/store ownership and termination are separate and bounded. | C6a/c target-Mac/browser/process; installed/personal profiles and OS trust unchanged |
| C6-R07 · G15/G18; §18 | Existing C5 controls/limitations remain accurately presented; unsupported actions are unavailable, not mislabeled success. Hard deletion absent, withdrawal not erasure. First source slice is partial C6, no conformance claims. | C6d complete-diff, doc consumers, exact-candidate CI once authorized for publication; D3 before personal data, CR-Q9 before sensitive exposure, C6 continuation/C7–C9 unactivated |

No C5 pass is relabeled as a C6 result. Reuse unchanged evidence only with the
implementation's explicit input/impact assessment. The complete plan owns focused
checks, the proposed freeze milestone and remaining platform/artifact evidence.

### C6 Merged Source Evidence

The inventory above remains the application disposition for the first slice.
The [implementation checkpoint](README.md#c6-source-implementation-checkpoint-2026-11-15)
and [source runbook](../../../useful/HCP_SOURCE.md) now supersede planning-only
availability statements for that slice. C6-R01/R02 have source dashboard inspection,
view-only guard, exact replacement and authority tests. R03/R04 have actual source
process/SQLite fault, lost-reply, duplicate-suppression and reopen evidence. R05 has
exact import isolation, real old-adapter denials and source-origin route denials.
R06 has owned Chromium/TLS/lease checks and R07 has truthful source controls/runbook
limits. Both fresh reviews approved the corrected source candidate in the
[final handoff](README.md#c6-reviewed-source-handoff-2026-11-15); each result remains
bounded by its test inputs. PR #209 source CI passed; the
[current status](README.md#demo-first-continuation-2026-11-19) records the accepted
bounded human correction journey and deferred human Ctrl-C/full stop-reopen checks.
The existing add-statement route is available code, not part of that human pass.
No C5 pass is relabelled C6, and
no full-C6, installed-delivery, real-model or conformance claim is made.

### Current Completion Routing

The first demo can reuse the existing management/read/review/write/release seams;
small presentation separation permits independent UI ownership without a framework
rewrite. C6 owns early UI handoff and polished source launch/navigation, memory
browsing/detail, selected add/edit/review/history/grant flows and clear failure or
uncertain results. Add and any newly selected controls need their own evidence.

| Remaining requirement/work | Owner and trigger |
| --- | --- |
| Document/model review/apply, profile, location/category/schema, seed/demo and fresh-store/reset workflows; G06–G15/G18 | C6 owner at each selected expansion, with the inventory's exclusions retained until replacement. Defer from initial demo; finish selected workflows or explicitly exclude optional scope by C9. Installed Mac delivery is a separate selected milestone, with actual artifact evidence. No legacy compatibility/conversion obligation; new HCP history remains protected. |
| C5 hard deletion, broader portability/reporting/notifications/OAuth/dormancy and N3 independent grant-deadline evidence | C5 capability owners coordinated by the orchestrator; resolve feature-relevant questions in C8 and complete mandatory selected-package gaps by C9. D3 erasure resolution/implementation is earlier if any personal-data extension is selected; CR-Q9 resolved/adopted before sensitive data. A demo deferral never waives a MUST. |
| G16–G18 bounded host/binding | C7 owner: one host/version and synthetic query/get initially, optional useful writes with completion/retry evidence. Provisional CR-Q7/CR-Q8/N4 contracts precede affected implementation/trial; normative merge may follow in C8. Stable shared contracts and isolated ownership/resources permit overlap with UI. |
| Protocol fixes and application realignment | C8 spec/CR owners: concrete cases/options/decisions, justified fixes, independent review/merge and explicit adoption/new pin with renewed affected app/consumer evidence. Nonrelevant issues need owner/revisit; unresolved selected requirements remain qualification blockers. |
| Complete claims and discovery | C9 owner: full selected capability and package/profile matrix, including pinned §18.3 Provider Interop for independently operated clients. C7 remains an incomplete experiment against this requirement; withholding claims or using a local bridge does not satisfy it. |

This routing supersedes old C8 qualification references as C9 while retaining
historical evidence IDs. No continuation, host setup, off-device trial, personal
state, model, installed delivery or upstream change is activated by this plan.

## Assessment Boundary And Next Use

C8 is now active under its [resolution/adoption brief](c8-resolution-brief.md).
Batch A renews C4-R07 and C5-R11/R12/R14 for completion, duplicate suppression,
current authority and consumed-import recovery. It does not qualify write-only
grants, hard deletion, the full MCP binding or additional governance completion
contracts. Both pins remain unchanged pending an explicitly recorded upstream
merge and adoption. The matrix's historical evidence is not relabelled against an
unmerged revision; C9 retains every mandatory selected capability/profile gap.

The [alignment plan](README.md) owns architecture choices, activation decisions,
checkpoint order, adoption evaluation, and validation. The [local question record][questions]
owns open protocol questions and example/tooling findings while we test the current
HCP materials. Concrete adoption evidence can support later focused upstream
improvements. Neither document changes the specification or activates the migration.

On activation, preserve these IDs, refresh changed source evidence, expand the
selected normative requirements into testable rows, and record dispositions and
remaining platform/client evidence. Do not infer full conformance from this
source review, a package name, a green schema checker, or historical CR CI.

[questions]: spec-questions.md
[hcp-3]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s3.md
[hcp-4]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s4.md
[hcp-5]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s5.md
[hcp-6]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s6.md
[hcp-7]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s7.md
[hcp-8]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s8.md
[hcp-9]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s9.md
[hcp-10]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s10.md
[hcp-13]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s13.md
[hcp-15]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s15.md
[hcp-18]: https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/source/s18.md
