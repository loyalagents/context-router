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

Do not claim a general release: the app has no Developer ID or notarization; measured installed
hardware is M1 Max/64 GiB/macOS 15.1.1. Other hardware, signed distribution,
cross-boot/forced-loss recovery and complete colleague disk budgets need evidence.
Controlled Candidate 14-to-corrected-app replacement now has scoped synthetic
state/authority evidence; prior personal-transition receipts support real-asset
reuse. The Safari-quarantined B archive was refused as damaged; whole-bundle
sealing is repaired. Integrated D includes #173's saved-preference refresh and
#175's bounded packaging traversal. D passed installed/replacement and #170/#173
packaged UI checks; its source passed the full local gate and exact-head CI. The
user reported completing per-app Open Anyway, and the matching downloaded menu
was observed. Normal test-menu Quit still needs confirmation and cleanup evidence;
downloaded AppKit Ready/dashboard and model-enabled startup remain unproved.
See [current scoped results](../plans/active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12).
Model quality/cancellation exceptions E/H, rejected PDF and the separately active
wrong-person-attribution investigation remain invitation dependencies. No
attribution implementation is included here.

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
