# Interface Evolution Track

- Status: dormant — activates only after Step 01 establishes the contract
  baseline and aggregate migration gate
- Outcome owner: local-migration coordinator (`/root`) until an interface-track
  sole writer is assigned
- Outcome: allow intentional UI and public-interface evolution without leaving
  supported producers, consumers, or external clients on incompatible contracts
- Concrete next action: Step 01 inventories the current contract families and
  consumers; after its baseline is approved, assign a track owner and propose
  the first additive interface change through the capture-to-remove sequence
- Review date: 2026-10-14 or Step 01 plan approval, whichever comes first
- Last reviewed: 2026-09-14

This is a cross-cutting track, not a separate product architecture. It allows UI
and interface work to proceed alongside the local-runtime migration without
leaving producers and consumers on incompatible contracts.

## Contract Families

Track these independently:

1. HTTP transport locations and REST payloads.
2. GraphQL fields, inputs, outputs, and generated clients.
3. MCP transport location and authorization/discovery metadata.
4. MCP tool/resource names, descriptions, and input/output schemas.

A change to one family does not implicitly authorize a breaking change to the
others. In particular, moving the MCP HTTP path is distinct from renaming or
changing an MCP tool.

## Required Sequence

1. **Capture:** add tests and concise documentation for the existing contract.
2. **Centralize:** route backend handlers and frontend callers through one
   canonical configuration/client layer without changing public behavior.
3. **Expand:** add the new route, field, or tool shape alongside the old one.
4. **Migrate:** move every known in-repo consumer and update setup documentation.
5. **Remove:** delete the compatibility surface only after an approved removal
   gate identifies supported external clients and configurations, the declared
   compatibility window, release/migration guidance, and a rollback plan.

GraphQL evolution should prefer additive fields and deprecation. REST payloads
with incompatible meanings should use a versioned route or payload. MCP tool
changes should prefer optional additions or a parallel versioned tool until
clients move.

## Initial Evidence To Preserve

- GraphQL currently uses `/graphql` and a checked-in generated schema.
- REST includes `/health`, `/api/preferences/analysis`, and `/api/form-fill/pdf`.
- MCP currently uses stateless JSON-response `POST /mcp`; `GET /mcp` returns 405.
- OAuth discovery metadata and dynamic client registration are coupled to the
  current MCP HTTP route.
- `MCP_HTTP_PATH` contributes to configuration and metadata, while the current
  Nest controller and middleware still register `/mcp` directly.
- Frontend GraphQL/backend URLs and raw fetch calls are spread across multiple
  components and should be centralized before route changes.

Step 01 must verify these observations against code and tests rather than treat
this planning document as the implementation source of truth.

## Parallel-Work Rules

Visual-only UI work can usually proceed independently. Coordinate changes that
touch frontend authentication, shared API clients, GraphQL generated output,
MCP routing/auth/discovery, `AppModule`, or shared e2e setup. One integrator owns
the landing order when two PRs touch those surfaces.

No PR may merge a new producer contract while leaving the repository's supported
consumer unable to run, unless the previous contract remains available through
an explicitly tested compatibility adapter.
