# Current State

- Status: mandatory startup reference
- Source of truth: application code/tests; [Local Application](../current/LOCAL_APPLICATION.md)
- Current priorities: [work portfolio](../plans/README.md)

The cloud-to-local migration foundation is delivered through human-merged
[PR #168](https://github.com/loyalagents/context-router/pull/168). The numbered
program is closed; optional LAN/hosting work is backlog, not the next mandatory
step. [Closeout](../current/LOCAL_MIGRATION_CLOSEOUT.md) preserves exact merge/CI,
historical contract transitions and remaining limitations.

The installed Apple Silicon Mac candidate owns a native menu/guardian, Node
backend, Next.js dashboard and selected llama.cpp/Qwen model. Application data
uses SQLite; human identity, browser sessions, MCP client credentials and
inference credentials are distinct. Dashboard and loopback HTTP MCP share
services/data and one active AI operation, with no queue or hosted fallback.
MCP is `http://127.0.0.1:8787/mcp`; the UI composition also serves `/graphql`.
Hosted PostgreSQL/Auth0/Vertex and developer/reference compositions remain;
`pnpm dev` still selects the hosted root.

Next: an [assisted colleague pilot](../plans/active/colleague-pilot/README.md),
using colleagues' own documents. Claude Desktop is required first; ChatGPT desktop
is wanted but nonblocking. Claude Desktop's standalone bridge passed discovery,
reads/writes/denials, restart, credential independence and direct final-pair idle
recovery. The controlled actual-Claude uncertain-mutation follow-up passed with one
commit, no replay and a separate explicit recovery read. Recovery
used a separate explicit request, not automatic replay. Existing Claude Code/Codex
CLI evidence is scoped. External assistants may send tool results off-device.

Early pilot builds explicitly designated by the product owner may reset CR-managed
user data rather than maintain backwards migration. Other releases preserve state
or refuse incompatibility without modifying it; see the [reset policy](../plans/active/colleague-pilot/README.md#pilot-reset-policy).
This is a policy, not an implemented reset
command: require warning/consent, preserve original documents, compatible model
weights, security floor and ownership checks. Do not delete metadata to bypass
uncertain state. Personal data, downloads, client configuration and live model
runs need their own bounded authorization.

The current `674750a` app/kit includes merged #194 delivery tooling and #195 AI
guidance. October 27 automated checks passed: installed 15 phases, replacement
4, synthetic demo 11 and shipped bridge/Node support. On October 29 the user
confirmed full demo setup, including Claude Code 2.1.299, Claude Desktop and Codex
connections in demo mode. The [current acceptance record](../plans/active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29)
separates those observations from personal-mode onboarding, specific local-AI
operations and the remaining manual acceptance. Earlier artifact receipts and
negative evidence retain their historical scope.

Do not claim a general release: the app has no Developer ID or notarization;
measured installed hardware is M1 Max/64 GiB/macOS 15.1.1. Fresh downloaded-launch
and other-Mac acceptance, cross-boot/forced-loss recovery and complete colleague
disk budgets remain separate. Model quality/cancellation exceptions E/H and the
remaining PDF/attribution disposition are unchanged. The bounded attribution
correction merged in #177; it does not diagnose the unavailable original incident.

Follow [AGENTS.md](../../AGENTS.md) and [the workflow](../useful/AGENT_WORKFLOW.md).
One writer owns the main playground checkout; independent worktree tasks need
isolated resources and an integration order. Keep backend tests first, targeted
iteration and batch corrections; qualify a frozen candidate only at the agreed
finalization milestone. Use the workflow's default of focused local checks and CI,
with exceptions for full local runs; existing commands, contract gates and CI
remain intact.
No automatic merge, publication, reset, or weakening of safety/compatibility.

Use runbooks on demand: [installed Mac](../useful/INSTALLED_MAC_APP.md),
[local UI](../useful/LOCAL_UI.md), [MCP](../useful/MCP_LOCAL_SETUP.md),
[identity](../useful/LOCAL_IDENTITY_ADMIN.md), [model](../useful/LOCAL_MODEL.md).
Run `./print-repo-structure.sh` for the live layout; don't load historical plans
or large evidence files merely for orientation.
