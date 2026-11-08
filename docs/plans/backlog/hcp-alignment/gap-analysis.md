# Context Router And HCP: Gap Analysis

- Status: source-level assessment; no runtime conformance established
- Assessed: 2026-11-07
- Plan and decisions: [HCP alignment brief](README.md)
- Relationship: [HCP integration reference](../../../useful/HCP_INTEGRATION.md)

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

These are proposed evidence requirements, not new test results:

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

## Assessment Boundary And Next Use

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
