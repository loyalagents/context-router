# Step 08 Interface and Consumer Inventory

Status: implementation inventory; the exact HTTP transition is independently
reviewed. All affected independent reviews and the full local gate passed; final-head CI and human acceptance are tracked separately. This follows [LM-008](../decision-log.md) and
the [interface evolution policy](../tracks/interface-evolution.md).

| Interface | Step 08 behavior | Known consumers and disposition |
| --- | --- | --- |
| `me` | Retained, with the same principal fields | Hosted dashboard, local dashboard/profile queries, operator smoke/eval clients and unknown external GraphQL clients remain supported |
| `user(id)` | Deprecated in the schema; still self-only with its existing result shape | `test-auth.sh`, `test-graphql.sh`, identity e2e/local-identity/SQLite/local-UI contract tests and unknown external GraphQL clients remain supported; no removal date is claimed |
| `applyPreferenceSuggestions` | Retained legacy upsert/silent-item-failure behavior | Hosted `SuggestionsList`, developer orchestrator `apply-client.ts`, eval ingestor `query.mjs`/`client.mjs`, audit/document e2e and unknown external GraphQL clients remain supported |
| `applyPreferenceSuggestionsV2` | Additive reviewed-state comparison with ordered per-item outcomes | Local `SuggestionsList` migrates to v2; exact definition/row/location and canonical state are checked in one serializable write/audit unit; no uncertain write retry |
| `clearMyHistory` | Additive confirmed clear of both history streams | Retained History UI in hosted and local compositions; principal comes from authentication, not input; live memory/provenance/identity/grants/credentials remain |
| Document analysis REST | Same route/envelope/status domain; optional review descriptor and safe failure category | Hosted and local document upload, eval ingestion, shell clients and unknown external REST clients; local upload additionally enforces the selected capability/configuration intersection and browser boundary |
| Form-fill REST | Same route/envelope with absent/v1 behavior retained; additive v2 preserve-existing and explicit per-field overwrite | Local FormFillClient always sends v2. Hosted FormFillClient still omits policies. Eval `fill-form.mjs` and its tests retain explicit v1/absent policy. Backend eval/e2e and unknown external REST clients remain supported |
| Local browser APIs | New same-origin unlock/logout/capabilities and per-instance MCP list/inspect/grant/revoke | LocalSession and McpClients only; credential issuance/rotation/maximum policy stay CLI-only |
| MCP HTTP and tool/resource schemas | Retained separate authority and Origin denial | Existing native MCP clients/CLI/eval clients remain; browser credentials cannot authenticate MCP, and MCP credentials cannot authenticate browser APIs |
| Hosted web support routes | Retained in hosted mode, excluded from local route admission/navigation | Hosted Auth0 login/logout, debug-token and generic chat compatibility tests remain; no hosted service is required for local dashboard operation |

The compatibility window continues through Step 08 and until a later independently
reviewed removal gate supplies release guidance and rollback. External clients are
assumed to exist. Published compatibility guidance is not evidence that deployed
external configurations were inspected.

Local GraphQL documents are complete named documents discoverable by the contract
checker and web code generator. Centralized `authenticatedFetch` preserves hosted
callers and maps local calls to an exact same-origin allowlist with explicit bearer,
no cookies, no redirects, no-store caching and no write retry. The registry retains
per-consumer fingerprints plus the actual transport sinks.

The HTTP fixture-format version remains 1; form-fill payload schema versions 1 and
2 are distinct from that fixture version. The checker's strict response-domain
classification is preserved: additions and policy metadata require an exact HTTP
transition record and affected-consumer review. Additive GraphQL output fields,
new mutations and initial `user(id)` deprecation do not remove legacy selections.

Definition shape edits retain Steps 04/07 semantics: they govern future writes;
they do not revalidate or migrate every existing value. Step 01's stronger
aspiration is not a new guarantee made by Step 08. The UI and current domain
validation must not imply that changing a definition cleaned up older values.

Cancellation and deadline tests use deterministic inference fixtures. They prove
control propagation and publication behavior, not model quality. Step 06's known
E email omission and H inconclusive native cancellation evidence remain unchanged.
There is no GraphQL consolidation resolver to migrate; the existing MCP workflow
already receives execution options.

The retained `askVertexAI` GraphQL query is also exposed by local composition,
even though the local dashboard hides the legacy chat page. It retains its schema
and sanitized legacy error while using the same browser request signal/deadline,
shared model admission and final publication check as other local AI operations.
