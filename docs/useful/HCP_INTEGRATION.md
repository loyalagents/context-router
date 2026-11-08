# HCP Integration

- Status: relationship and design reference; source gaps documented, conformance not established
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

## Assessment And Proposed Alignment

The detailed [source gap analysis](../plans/backlog/hcp-alignment/gap-analysis.md)
records the reviewed revisions, current code/test evidence, HCP requirements,
gaps and proposed acceptance scenarios. It supersedes the initial six-area map
in this reference; it is not runtime conformance evidence.

The canonical [backlog alignment brief](../plans/backlog/hcp-alignment/README.md)
owns the proposed architecture, package/profile scope, historical-data policy,
activation decisions, and testable checkpoints. It proposes an additive HCP
interface over shared application/storage semantics, beginning with isolated
synthetic data. Existing reads and writes need explicit compatibility boundaries.
Implementation and personal-data migration remain unactivated.

[Open Draft 3 questions](../plans/backlog/hcp-alignment/spec-questions.md)
stay in Context Router while the upgrade tests the current HCP specification,
schemas, guides, and tooling. The plan's [adoption approach](../plans/backlog/hcp-alignment/README.md#test-the-current-adoption-experience)
records what works, unanswered questions, and manual work before proposing focused
upstream improvements. No hcp-spec changes are part of this documentation phase.

The notes do not amend the pinned requirements. Local deployment does not establish
first-party operation; accepting inferred entries requires Memory Manager; whole
binding/profile claims need full evidence. Schema/example checks alone do not
establish that evidence.

## Implementation Feedback And Reusable Guidance

As alignment proceeds, classify findings by where they belong:

- **Application work:** keep Context Router's mapping, rollout, compatibility
  decisions, tests, and acceptance evidence in this repo.
- **Reusable adoption guidance:** contribute implementation-neutral examples,
  guides, skills, and tooling to `hcp-spec` as working integrations reveal useful
  patterns. Build on its existing schemas and guides, and coordinate with the
  planned conformance suite. Skills should route to the guidance and normative
  requirements rather than become a separate protocol definition.
- **Specification questions:** capture the draft/section, concrete example and
  observed ambiguity in the local question record first. Use the existing HCP
  materials; distinguish application adaptation from missing guidance, unclear
  requirements, or reusable tooling needs. Raise focused hcp-spec questions or
  changes when evidence warrants, resolving blockers before affected implementation.
  Do not silently redefine the protocol to match this app. Reassess accepted
  changes and adopt a new target revision explicitly.

Use synthetic, reproducible examples for shared feedback. The
[HCP pilot guide](https://github.com/loyalagents/hcp-spec/blob/2e2939c9bebcefb3bed7bb3522231c0e4d65a315/spec/2.0-draft-3/guides.md)
distinguishes protocol conformance from memory quality and task outcomes; retain
that distinction when using Context Router's evaluations as evidence.

## Working Across The Repositories

Keep the [canonical alignment brief](../plans/backlog/hcp-alignment/README.md)
under the [work portfolio](../plans/README.md); promote it when runtime work is
scoped and activated rather than copying it. Link to this reference for repository
ownership. These documents do not change pilot priorities or authorize a migration.

Follow [interface evolution](INTERFACE_EVOLUTION.md) for existing consumers and
[the validation policy](AGENT_WORKFLOW.md#validation-and-context-discipline) for
changes. Backend behavior changes remain tests first. General HCP guidance must
not weaken existing credential, compatibility, persistence, or recovery boundaries.

For changes in `hcp-spec`, follow its
[build instructions](https://github.com/loyalagents/hcp-spec#building-and-checking):
the specification pages are generated from section sources, and schemas are
generated from tooling. Edit the owning sources and validate affected outputs.
