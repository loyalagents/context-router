# Local Application

- Status: implemented foundation and alpha kit; demo setup/connections confirmed, remaining pilot acceptance active
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
`http://127.0.0.1:8787/mcp` in personal mode and 8790 in demo by default; the dashboard uses a current ephemeral loopback address.
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
- The UI lists and renames MCP client instances, opens their exact activity,
  edits maximum policy and grants atomically after a server preview, reconciles
  concurrent changes with explicit choices for conflicting draft edits, and revokes authority. Current names appear on history and
  live preference attribution while stable actor keys and credentials remain unchanged. Provisioning,
  rotation remain installed/manual CLI work.
  See [MCP setup](../useful/MCP_LOCAL_SETUP.md). Claude Code and Codex CLI have
  scoped user-run evidence. Claude Desktop 2.31226.1 Pro ordinary chat passed
  discovery, permitted/denied operations, shared dashboard checks, restart,
  credential independence and over 35 minutes idle with explicit recovery using
  the standalone stdio bridge. The controlled actual-Claude lost-reply follow-up
  also passed: one committed mutation, no replay and one explicit recovery read.
  This qualifies the recorded retained app/bridge/client pair on the measured Mac;
  D carries unchanged-boundary compatibility evidence, not a new live-client run;
  ChatGPT desktop remains unqualified.
  See the [pilot evidence](../plans/active/colleague-pilot/plan.md).
- Model download is explicit and verified, about 5.7 GB; compatible assets live
  outside the app bundle for reuse. Menu Restart enables/recovers AI and opens the
  current dashboard with a fresh unlock. Browser close leaves the app running;
  Quit drains owned processes. There is no automatic updater or login service.
- Manual developer compositions and matching-pair backup/restore remain
  documented in [identity](../useful/LOCAL_IDENTITY_ADMIN.md),
  [model](../useful/LOCAL_MODEL.md) and [UI](../useful/LOCAL_UI.md) runbooks.

## Installed Historical Demo

The CR menu enters/reopens a separate persistent demo store, returns to personal,
and resets demo through a new store/identity. The sample has 189 active memories
from 198 historical 2024–2025 records. Reopen preserves presenter edits and grants;
reset restores original definitions/import history and fresh A/B/C credentials,
retaining old stores and stable isolated provider profiles. Demo reuses verified
installed model weights with a fresh owned inference session. Missing or invalid
weights keep the no-model path; demo downloads remain disabled. Assets are retained.

Demo uses the same dashboard and navigation as personal mode, with historical
data and an authenticated demo banner. The optional five-step walkthrough is
collapsed below the dashboard; normal profile, preferences, schema, permissions
and history views remain available. **Demo setup…** offers native Sign in/Open,
qualified executable selection and exact reviewed Desktop apply, with packaged
Terminal commands as a secondary fallback. Codex A writes; Claude Code
subscription B and Desktop C read with health/finance restrictions. Later grants
are shown from actual state. Provider sessions are explicit user actions. The
menu owns only bounded inspect/prepare/apply helpers; external assistants remain
independent. See the
[installed helper workflow](../useful/INSTALLED_MAC_APP.md#historical-demo-mode).
Manual source UI does not advertise native menu controls. The user confirmed
Codex/Claude Code/Desktop connectivity, permission restrictions, Quit/reopen
persistence, reset and return to personal mode for merged PR #183. On October 29
the user also confirmed full demo setup on the delivered `674750a` app, including
Claude Code 2.1.299, Claude Desktop and Codex connections. See the
[current acceptance record](../plans/active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29).
That confirmation does not enumerate a new local-model, permission-denial,
idle/restart or reset matrix, or qualify personal-mode onboarding/distribution.

## Qualification And Known Limits

Do not turn merged code or automated checks into a broader support/release claim.

| Area | Current evidence or limitation |
| --- | --- |
| Installed platform | Measured MacBookPro18,2, M1 Max, 64 GiB, macOS 15.1.1 (24B91). Other Apple Silicon configurations need compatibility evidence; Windows/Linux installers are not qualified. |
| Distribution | Integrated `674750a` app/kit passed package/archive/full-byte verification and automated artifact checks. Launch/demo readiness and later demo setup/connections were reported on the user's Mac. This does not establish a fresh download/quarantine route or another Mac. No Developer ID, notarization or publisher authentication; colleague acquisition/approval remains open. See [current acceptance](../plans/active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29); [D's observations](../plans/active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12) remain historical. |
| Model | Pinned llama.cpp b11146 and Qwen3.5-9B Q4_K_M. One active operation, no queue. Text and qualified PDF text subset; no image/OCR support. See the exact configuration in the model runbook. |
| Quality exception E | Known personal-email omission in the frozen adversarial extraction fixture; 18/21 recall (85.71%). The original quality scorer verdict remains FAILED. Not permission for wrong-person facts or other quality failures. |
| Recovery exception H | A repeat production cancellation failed the five-second settlement requirement and latched AI unavailable. Later recovery observations do not erase that failure. Whole-generation owned-process shutdown and fresh inference credentials are required; retain data and compatible weights. |
| Lifecycle | Normal restart/Quit and scoped sleep/wake observations exist. Candidate 14 fixes sleep consuming the shutdown budget; real sleep during shutdown, forced owner loss and cross-boot recovery remain unqualified. Fail closed on uncertain ownership. |
| MCP | Credentials remain until revoked/rotated; sessions expire after 30 minutes idle and have bounded IDs/capacity. Claude Desktop showed the expiry failure and recovered on a separate explicit request after a direct 35-minute final-pair interval. Automatic client replay is not supported; never repeat an uncertain mutation before inspecting state/history. The controlled actual-Claude lost-reply check passed on retained B and its standalone bridge: one mutation/audit event, honest uncertainty, no replay and one explicit recovery read. C/D are not new actual-client observations. |
| Upload/UI findings | Stale post-apply display was addressed in merged [PR #173](https://github.com/loyalagents/context-router/pull/173); D's packaged UI evidence and C's earlier failures retain their scope. [PR #195](https://github.com/loyalagents/context-router/pull/195) adds installed-app AI setup/recovery guidance. The reported model-root and Claude executable-version confusion are tracked in [UI usability](../plans/backlog/ui-usability/README.md). Rejected PDF and remaining attribution disposition stay separate: the bounded [PR #177](https://github.com/loyalagents/context-router/pull/177) correction merged, but the unavailable original incident and broader cases are not diagnosed by it. |
| Replacement/storage | `674750a` passed 15 installed, 4 prior-artifact replacement and 11 synthetic demo phases, including isolated persistence/authority checks. Same-envelope model reuse remains the contract; weights in an older trial envelope are not automatically used by the default installation. Earlier real-model transition evidence retains its original scope. Current live-model use/retention and complete colleague disk budgets remain separate; see [current acceptance](../plans/active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29). |

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
