# Agent-Assisted Onboarding

- Status: future idea; unactivated, not implementation approval
- Owner: product owner; implementation owner unassigned
- Revisit: after the initial Claude Desktop connection works; candidate for an early demo
- Captured: 2026-10-11

## Idea And Benefit

Let a user ask CR to prompt an existing assistant, such as a local Claude or
Codex agent, to propose useful preferences and stable personal facts from sources
that assistant can access with the user's permission. This could bootstrap an
empty CR without asking people to enter everything again or prepare documents.

Demo: import suggestions from one assistant, review and approve them in CR, then
show a second connected assistant using the approved context.

## Smallest Flow To Explore

1. The user chooses an assistant and the sources it may consult.
2. CR prepares a structured request for proposed facts, supporting evidence and
   source references, distinguishing explicit statements from inferences.
3. CR presents suggestions for review, highlighting duplicates, conflicts and
   sensitive information. Save only the entries the user approves.
4. Make approved context available through existing per-client permissions.

Investigate each client's actual access/export capabilities; do not assume it can
read all past conversations, account memory or other agents' stores. Compare a
guided copy/paste exchange with direct agent invocation before choosing a mechanism.
Explain any off-device processing and obtain permission for the selected sources.
Exclude credentials, secrets and facts belonging to another person.

## Open Questions And Boundaries

- Which clients and sources support a useful first demo, and can CR initiate the
  request through a documented interface?
- How should source evidence, stale facts and conflicts with existing CR values
  be shown and retained?
- Can the existing review/apply flow be reused with truthful partial or uncertain
  outcomes and no automatic replay of writes?

Initial scope would exclude ongoing synchronization, autonomous background
discovery and broad conversation-history ingestion. This idea adds no requirement
to the first colleague pilot. [MCP onboarding](../mcp-onboarding/README.md) owns
client connection and credential setup; this brief owns the proposed data-bootstrap
experience. Choose scope, owner and acceptance checks before activation.
