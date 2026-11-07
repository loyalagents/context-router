# HCP Integration

- Status: relationship and design reference; alignment planned, conformance not assessed
- Read when: planning HCP alignment or changing an HCP mapping or conformance claim
- Last reviewed: 2026-11-07

## Relationship And Ownership

Context Router is a personal memory application intended to adopt the
[Human Context Protocol (HCP)](https://github.com/loyalagents/hcp-spec). HCP defines
an interface through which applications and assistants exchange personal context
under the person's control. Context Router provides a practical setting for
implementing that interface and testing the specification's assumptions.

| Repository | Owns |
| --- | --- |
| `context-router` | The application, its current behavior and compatibility contracts, its HCP assessment and implementation plans, and evidence for any future conformance claims. |
| `hcp-spec` | Normative protocol requirements and schemas; general implementation guides, skills, and tooling as adoption experience makes them useful. |

Application code and tests establish what Context Router does today. The chosen
HCP draft establishes the requirements for intended HCP behavior; its normative
text governs where schemas differ. This document records the relationship and
assessment questions, not a second copy of the specification or a claim that the
current app implements it. The spec's implementation list links here for details.

## Reference Baseline

The initial exploration used:

- **HCP v2, `2.0-draft-3`**, at
  [`2e2939c9bebcefb3bed7bb3522231c0e4d65a315`](https://github.com/loyalagents/hcp-spec/tree/2e2939c9bebcefb3bed7bb3522231c0e4d65a315).
  Start with its [introduction](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/introduction.md),
  then the relevant parts of the [specification](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/specification.md).
- **Context Router**, at
  [`a5d6a4d`](https://github.com/loyalagents/context-router/tree/a5d6a4d564de83e963ac7956c2c4efcb872575b3).
  See [Local Application](../current/LOCAL_APPLICATION.md) for the product and
  [the work portfolio](../plans/README.md) for current priorities.

These are exploration baselines, not qualified HCP implementations. Draft 3 is
unstable, and subsequent drafts may change the wire contract. At implementation
activation, explicitly select the target draft, revision, bindings, and profiles;
record later changes rather than silently following the spec's default branch.
Both repositories can be checked out independently. A sibling `hcp-spec` checkout
is useful for exploration but is not a build or runtime dependency.

## Current Behavior And Alignment Questions

This is an initial map, not an exhaustive conformance assessment. The linked app
references describe current behavior; HCP section numbers below refer to Draft 3.

| Area | Current Context Router behavior | HCP assessment needed |
| --- | --- | --- |
| Memory model | [Definitions and preferences](../current/PREFERENCE_SCHEMA.md) use slugs, typed values, locations, and active/suggested/rejected states. | Map entries, categories, dimensions, versions, and lifecycle; decide how existing values and identities are represented (§§4–5, 11). |
| Authorization | [MCP policy and grants](../current/MCP_AUTHORIZATION.md) narrow client capabilities by slug, action, and sensitivity. Local clients use separate instance credentials. | Map approved purposes, grant duration, standing rules, revocation, and client/operator identity (§6, §§12–13). |
| Retrieval and disclosure | Literal search and [AI-assisted search](../current/WORKFLOWS.md) return permitted preferences through the current MCP tools. | Assess purpose-bound relevance and quantity limits, grant-specific references, redaction, minimization reports, and `useUntil` (§7). |
| Provenance and conflicts | [Mutation provenance](../current/AUDIT_AND_ACCESS_HISTORY.md) is distinct from value provenance; accepting an inferred suggestion preserves its source type. | Map assertion, submission, confirmation, and revision semantics; assess conflict detection and resolution (§§3–4, 15). |
| History and governance | Mutation audit and MCP access logs are separate. Human management uses the dashboard and GraphQL. | Assess required audit events, durability, disclosure summaries, export/import, and separation of context from governance operations (§§5, 8–10). |
| Public interfaces | Existing MCP tools, resources, result contracts, and supported clients have compatibility coverage. | Select HCP HTTP/MCP bindings and discovery behavior while preserving supported consumers (§§9–10, 18–19). |

HCP governs observable interface behavior rather than internal storage (§1.4).
An additive adapter may therefore reuse application services and storage
boundaries. Grants, disclosure, lifecycle, and audit semantics still require
assessment; changing tool names or serializing existing rows is not sufficient.

## Decisions Before Implementation

1. **Identify the HCP-facing clients and operators.** Determine how the app,
   assistants, and any bridges map to HCP's roles. Draft 3 requires Provider
   Interop (HTTP Binding and OAuth Interop) when accepting HCP clients operated
   by others; Agent Interop adds MCP over Streamable HTTP (§18). Local deployment
   alone does not make a client first-party. The fit with current local client
   credentials is an implementation and possible specification-feedback question.
2. **Choose the supported entry types and profiles.** Accepting model-inferred
   entries requires the Memory Manager Profile (§15). Other profiles apply under
   their stated conditions; adopting HCP does not automatically activate every
   domain or credential feature.
3. **Establish evidence for the selected scope.** Track each requirement against
   current behavior, evidence, gaps, and a decision. HCP's schema/example checks
   are useful inputs; they are not the behavioral conformance suite described as
   forthcoming in §20. Partial implementation must be labeled as such, without
   claiming a whole binding or profile before its requirements are satisfied.

## Implementation Feedback And Reusable Guidance

As alignment proceeds, classify findings by where they belong:

- **Application work:** keep Context Router's mapping, rollout, compatibility
  decisions, tests, and acceptance evidence in this repo.
- **Reusable adoption guidance:** contribute implementation-neutral examples,
  guides, skills, and tooling to `hcp-spec` as working integrations reveal useful
  patterns. Build on its existing schemas and guides, and coordinate with the
  planned conformance suite. Skills should route to the guidance and normative
  requirements rather than become a separate protocol definition.
- **Specification questions:** capture the relevant draft/section, a concrete
  example, and the observed ambiguity or mismatch in `hcp-spec`. Propose a
  clarification or change explicitly; do not silently redefine the protocol to
  match this app. When a change is accepted, reassess its effect on the app's
  mapping; update the target draft only when that revision is explicitly adopted.

Use synthetic, reproducible examples for shared feedback. The
[HCP pilot guide](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/guides.md)
distinguishes protocol conformance from memory quality and task outcomes; retain
that distinction when using Context Router's evaluations as evidence.

## Working Across The Repositories

Keep one canonical implementation brief under the
[work portfolio](../plans/README.md) when alignment work is scoped and activated;
link to this reference rather than duplicating it. This documentation establishes
direction without changing pilot priorities or authorizing a runtime migration.

Follow [interface evolution](INTERFACE_EVOLUTION.md) for existing consumers and
[the validation policy](AGENT_WORKFLOW.md#validation-and-context-discipline) for
changes. Backend behavior changes remain tests first. General HCP guidance must
not weaken existing credential, compatibility, persistence, or recovery boundaries.

For changes in `hcp-spec`, follow its
[build instructions](https://github.com/loyalagents/hcp-spec#building-and-checking):
the specification pages are generated from section sources, and schemas are
generated from tooling. Edit the owning sources and validate affected outputs.
