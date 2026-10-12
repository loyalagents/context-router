# Local Application

- Status: implemented foundation; assisted pilot preparation is next
- Sources: `apps/desktop/`, backend local composition and storage modules,
  `apps/web/`; [migration closeout](LOCAL_MIGRATION_CLOSEOUT.md)

## Runtime And Data Boundaries

The installed Apple Silicon Mac application owns a native menu/guardian, bundled
Node backend, Next.js dashboard and selected llama.cpp inference process. SQLite
stores application data; a separate private identity root holds a stable human
principal and independent human credential. Browser unlock/session, per-instance
MCP credentials and private inference credentials are distinct authorities.

The dashboard and MCP use the same application services, SQLite store and one
model admission owner. MCP is loopback Streamable HTTP at
`http://127.0.0.1:8787/mcp`; the dashboard uses a current ephemeral loopback address.
GraphQL `/graphql` is exposed only through the selected UI/hosted compositions,
not the MCP-only preview. Local mode has no Auth0 or hosted-model dependency and
no silent cloud fallback. Hosted PostgreSQL/Auth0/Vertex composition remains
available for reference/development; `pnpm dev` still selects that hosted path.

Uploaded raw files are not retained as product records. Extracted proposals,
accepted preferences, definitions and history may contain personal information.
History remains until explicitly cleared; clearing it does not undo mutations.
Local storage is not a promise that an external MCP assistant processes results
on-device. Use narrow per-client grants and explain off-device assistant use.

No product telemetry is authorized. Preserve offline behavior after explicit
asset acquisition; broaden network/telemetry claims only with dependency evidence
and review. A future hosted-provider option needs separate opt-in, never fallback.

The installed envelope keeps data/identity, model assets, private sessions/exports
and ownership metadata separate. See [installed administration](../useful/INSTALLED_MAC_APP.md)
for actual commands; never bypass failed ownership checks or edit managed metadata.
The [pilot reset policy](../plans/active/colleague-pilot/README.md#pilot-reset-policy)
permits only product-owner-designated releases to reset; others preserve state or
refuse incompatibility without modifying it. This is a future delivery policy,
not a new command or a waiver of filesystem/process safety.

## Current User Flows

- Preferences, definitions/schema, profile, grants, history and AI-assisted
  document proposals/search use the existing dashboard. Mutations retain domain
  validation and propose-before-apply behavior; no UI redesign is required.
- The UI lists MCP clients, narrows grants and revokes authority. Provisioning,
  rotation and maximum-policy administration remain installed/manual CLI work.
  See [MCP setup](../useful/MCP_LOCAL_SETUP.md). Claude Code and Codex CLI have
  scoped user-run evidence; **Claude Desktop and ChatGPT desktop are not qualified
  local integrations yet**. A source-only stdio bridge now supports an assisted
  Claude Desktop trial; automated SDK/SQLite evidence does not complete actual
  Desktop acceptance. See the [connection plan](../plans/active/colleague-pilot/plan.md).
- Model download is explicit and verified, about 5.7 GB; compatible assets live
  outside the app bundle for reuse. Menu Restart enables/recovers AI and opens the
  current dashboard with a fresh unlock. Browser close leaves the app running;
  Quit drains owned processes. There is no automatic updater or login service.
- Manual developer compositions and matching-pair backup/restore remain
  documented in [identity](../useful/LOCAL_IDENTITY_ADMIN.md),
  [model](../useful/LOCAL_MODEL.md) and [UI](../useful/LOCAL_UI.md) runbooks.

## Qualification And Known Limits

Do not turn merged code or automated checks into a broader support/release claim.

| Area | Current evidence or limitation |
| --- | --- |
| Installed platform | Measured MacBookPro18,2, M1 Max, 64 GiB, macOS 15.1.1 (24B91). Other Apple Silicon configurations need compatibility evidence; Windows/Linux installers are not qualified. |
| Distribution | Unsigned/unnotarized candidate. No qualified signed/private distribution or Gatekeeper download-to-launch route; a checksum alone is not publisher authentication. |
| Model | Pinned llama.cpp b11146 and Qwen3.5-9B Q4_K_M. One active operation, no queue. Text and qualified PDF text subset; no image/OCR support. See the exact configuration in the model runbook. |
| Quality exception E | Known personal-email omission in the frozen adversarial extraction fixture; 18/21 recall (85.71%). The original quality scorer verdict remains FAILED. Not permission for wrong-person facts or other quality failures. |
| Recovery exception H | A repeat production cancellation failed the five-second settlement requirement and latched AI unavailable. Later recovery observations do not erase that failure. Whole-generation owned-process shutdown and fresh inference credentials are required; retain data and compatible weights. |
| Lifecycle | Normal restart/Quit and scoped sleep/wake observations exist. Candidate 14 fixes sleep consuming the shutdown budget; real sleep during shutdown, forced owner loss and cross-boot recovery remain unqualified. Fail closed on uncertain ownership. |
| MCP | Credentials remain until revoked/rotated; sessions expire after 30 minutes idle and have bounded IDs/capacity. Actual client automatic reconnect beyond expiry is unqualified; never replay an uncertain mutation. |
| Upload/UI findings | Stale post-apply display was reproduced and addressed in unmerged [PR #173](https://github.com/loyalagents/context-router/pull/173); installed-app retest remains pending. Rejected PDF and possible another-person email attribution remain unverified and require triage before the real-data pilot, not blanket acceptance under E. |
| Replacement/storage | Installed fixture replacement/cleanup checks passed. Real version A-to-B replacement, colleague download friction and peak/retained disk use require pilot evidence. |

Exact receipts and negative evidence remain in the
[evidence index](../evidence/local-migration/README.md). Candidate 13 live-model
observations do not qualify changed Candidate 14 lifecycle inputs. Signing,
complete original human acceptance, all hardware, and whole-system zero egress
were not established by migration completion.

## Where Work Goes Now

Use the [portfolio](../plans/README.md): assisted colleagues first, stabilization
in risk-appropriate slices, wanted future capabilities kept separately. Public
contracts, compatibility windows and executable gate modes still apply; consult
[interface evolution](../useful/INTERFACE_EVOLUTION.md) before changing them.
