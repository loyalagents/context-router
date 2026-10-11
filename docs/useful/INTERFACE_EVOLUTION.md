# Interface Evolution

- Status: current policy
- Owner: the assigned change owner and integrator; independent review as risk requires

Track HTTP routes/payloads, GraphQL fields and generated clients, MCP transport/
authorization/discovery, and MCP tools/resources independently. Changing a route
does not authorize renaming a tool or changing its authority semantics.

## Required Sequence

1. Capture existing behavior in tests and concise consumer documentation.
2. Centralize shared configuration/client responsibilities without behavior drift.
3. Expand additively where compatibility is required; test old and new contracts.
4. Migrate known in-repo consumers and update operator/client setup guidance.
5. Remove only after an approved gate identifies supported external clients and
   configurations, a declared compatibility window, release/migration guidance,
   rollback/recovery and evidence that supported consumers still work.

Prefer additive/deprecated GraphQL fields, versioned incompatible REST payloads,
and optional MCP additions or parallel versioned tools. Unknown external consumers
must not be assumed absent. The [contract baseline](../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md)
and executable registry protect semantic transitions, callback allowlists,
consumer inventories and outbound sinks; keep them current in the same scoped PR.

Read the current code and [runbooks](../README.md), not historical assumptions
about hosted versus local transports. Local MCP and hosted OAuth are separate
compositions. `me` is retained; deprecated self-only `user(id)` and legacy apply
remain until explicitly reviewed removal. The pilot's early data-reset policy
does not waive wire compatibility or authorize weakening credential boundaries.

Visual-only UI work can often be independent. Coordinate frontend sessions,
shared clients, GraphQL output, MCP routing/auth/discovery, composition roots and
shared e2e setup under one integrator with an explicit landing order. A PR must
not leave a supported consumer incompatible with its producer unless an explicitly
tested compatibility adapter preserves the previous contract.
