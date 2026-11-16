# HCP Integration

- Status: relationship and design reference; source gaps documented, conformance not established
- Read when: planning HCP alignment or changing an HCP mapping or conformance claim
- Last reviewed: 2026-11-15 UTC

## Relationship And Ownership

Context Router is a personal memory application intended to adopt the
[Human Context Protocol (HCP)](https://github.com/loyalagents/hcp-spec). HCP defines
an interface through which applications and assistants exchange personal context
under the person's control. Context Router provides a practical setting for
implementing that interface and testing the specification's assumptions.

| Repository | Owns |
| --- | --- |
| `context-router` | The application, its current behavior and interface contracts, its HCP assessment and implementation plans, and evidence for any future conformance claims. |
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

The detailed [source gap analysis](../plans/active/hcp-alignment/gap-analysis.md)
records the reviewed revisions, current code/test evidence, HCP requirements,
gaps and proposed acceptance scenarios. It supersedes the initial six-area map
in this reference; it is not runtime conformance evidence.

The canonical [active alignment brief](../plans/active/hcp-alignment/README.md)
owns the proposed architecture, package/profile scope, historical-data policy,
activation decisions, and testable checkpoints. The accepted direction is to
redesign directly around HCP without backwards compatibility: APIs, tools, schemas,
and application consumers may change together, with no required legacy adapters
or compatibility projections. All existing CR application data and database
migration history may be deleted; preservation and historical conversion are not
required. Start with a fresh HCP schema and isolated synthetic stores. Prioritize
working HCP behavior quickly and concrete adoption findings that lead to reusable
specification, guidance, or tooling fixes. Deployment/adapter support is a separate
C0 decision, now settled as SQLite only. C1–C4 merged in PRs #204–#207. The
[C4 merge record](../plans/active/hcp-alignment/README.md#c4-merge-and-c5-planning-ownership-2026-11-14)
binds final review/CI to merge `666f9d1b5ff3dde322ad4c368b44d2f4399f203e`.
C4 implements isolated person/model writes, immutable versions, confirmation and
lifecycle history, private staging, structural conflicts and durable retries.
Permission changes permanently invalidate affected response candidates while
preserving duplicate suppression. Known committed writes can acknowledge minimal
success on their original channel, with response data authorized separately.
These are bounded application contracts, not full pinned-spec conformance.

**Bounded C5 merged in [PR #208](https://github.com/loyalagents/context-router/pull/208).**
The [merge record](../plans/active/hcp-alignment/README.md#c5-merge-and-c6-planning-ownership-2026-11-15)
records exact source/CI identities, final independent review, successful CI and the
two unexplained local aggregate crashes. C5 provides synthetic governance,
persistent rotating refresh, summaries/reporting, signed revocation delivery and
reviewed v2 portability within its selected contracts. D3 hard deletion remains
deferred; broader import/reporting/OAuth/dormancy and full Core remain incomplete.
Earlier candidate-era pending/writer wording is historical.

**C6's bounded first source slice is implemented and independently reviewed.** The [concrete proposal](../plans/active/hcp-alignment/README.md#c6-application-planning-2026-11-15)
selects an isolated source synthetic dashboard using HCP management services and
exact person-write authority, with [complete access-path dispositions](../plans/active/hcp-alignment/gap-analysis.md#c6-current-access-path-inventory-2026-11-15).
The [activation](../plans/active/hcp-alignment/README.md#c6-implementation-activation-2026-11-15)
permits its implementation and fresh review, but not installed delivery, model
inference, personal-data use or C7/C8, or closure of the remaining C6 roadmap. `hcp-spec` stays unchanged locally
and remotely; C4/C5 publication permissions do not extend to this implementation task.
Hard deletion must be revisited before any personal-data extension, and CR-Q9 must
be resolved and explicitly adopted before sensitive real-data exposure.

The bounded source dashboard is implemented; use the
[source runbook](HCP_SOURCE.md) for explicit synthetic initialization, owned browser,
exact correction and reopen. The [reviewed handoff](../plans/active/hcp-alignment/README.md#c6-reviewed-source-handoff-2026-11-15)
records passing focused checks, resolved fresh-review findings and the decision
that C6 warrants no new upstream issue/comment. Human retest and exact-candidate
CI remain separate acceptance gates. The [external review follow-up](../plans/active/hcp-alignment/README.md#c6-external-review-follow-up-2026-11-15)
records subsequent application fixes and the authorized draft PR publication.
This does not close broader C6 or qualify an installed artifact.

Lucas's bounded C4 publication authorization produced permission-cache feedback
on [#34](https://github.com/loyalagents/hcp-spec/issues/34#issuecomment-6817416594),
committed-write [#36](https://github.com/loyalagents/hcp-spec/issues/36),
conflict-lifecycle [#37](https://github.com/loyalagents/hcp-spec/issues/37),
mutation-purpose [#38](https://github.com/loyalagents/hcp-spec/issues/38), and
extension-presentation evidence on [#29](https://github.com/loyalagents/hcp-spec/issues/29#issuecomment-6885856155).
These are submitted proposals, not merged/adopted resolutions. Conservative
old/new purpose intersection, dormant deadlines and slow physical COMMIT remain
explicit limitations. The experiment considers active and conflicted candidates
and refuses older experimental formats without migration/reset; SQLite hot-journal
recovery may precede application admission. Specification sources, the sibling
checkout and the target revision remain unchanged.

[Open Draft 3 questions](../plans/active/hcp-alignment/spec-questions.md)
stay in Context Router while the upgrade tests the current HCP specification,
schemas, guides, and tooling. The plan's [adoption approach](../plans/active/hcp-alignment/README.md#test-the-current-adoption-experience)
records what works, unanswered questions, and manual work before proposing focused
upstream improvements. C2 uses issue-first handoffs to separately owned spec work;
no hcp-spec source changes or target adoption are assigned here.

The notes do not amend the pinned requirements. Local deployment does not establish
first-party operation; accepting inferred entries requires Memory Manager; whole
binding/profile claims need full evidence. Schema/example checks alone do not
establish that evidence.

## Implementation Feedback And Reusable Guidance

As alignment proceeds, classify findings by where they belong:

- **Application work:** keep Context Router's mapping, rollout, contract-change
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

Keep the [canonical alignment brief](../plans/active/hcp-alignment/README.md)
under the [work portfolio](../plans/README.md); promote it when runtime work is
scoped and activated rather than copying it. Link to this reference for repository
ownership. These documents do not change pilot priorities or authorize a migration.

The plan records an HCP-specific exception to legacy-contract preservation and
compatibility windows in [interface evolution](INTERFACE_EVOLUTION.md). Coordinate
producer/consumer changes and test the new contracts under
[the validation policy](AGENT_WORKFLOW.md#validation-and-context-discipline).
Backend behavior changes remain tests first. The redesign must preserve credential
separation, privacy, truthful provenance, persistence, and recovery guarantees.
The accepted redesign includes discarding old CR data/migrations without another
preservation decision; the plan scopes reset mechanics and checks. New HCP data
retains its lifecycle guarantees. Policy for unrelated work is unchanged.

For changes in `hcp-spec`, follow its
[build instructions](https://github.com/loyalagents/hcp-spec#building-and-checking):
the specification pages are generated from section sources, and schemas are
generated from tooling. Edit the owning sources and validate affected outputs.
