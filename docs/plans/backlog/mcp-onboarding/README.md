# MCP Onboarding Product Follow-Up

- Status: source bridge implemented for the pilot trial; real Claude Desktop acceptance pending
- Outcome owner: product owner and assigned colleague-pilot coordinator
- Trigger: the assisted colleague pilot requires Claude Desktop; ChatGPT desktop follows
- Next action: complete the reviewed [connection slice](../../active/colleague-pilot/plan.md)
  trial and real-client acceptance; broader C/C+ onboarding remains backlog
- Last reviewed: 2026-10-10

This is the canonical onboarding brief, prioritized by the
[assisted pilot](../../active/colleague-pilot/README.md). Claude Desktop is a
first-pilot requirement. ChatGPT desktop is wanted next, not a first-pilot blocker.
Broader C/C+ conveniences below are not automatically required for the minimum
slice. This is product work after the completed migration, not another numbered step.

## Starting Point And Future Options

Step 07 provides CLI-managed, independently revocable client instances over
loopback HTTP. Merged Step 08 reuses the dashboard for listing those
instances, explaining effective authority, editing narrowing grants and
revoking access (discussion option B). Credential issuance, rotation and
maximum-policy changes remain CLI operations; Step 09 packages that supported
manual administration path without activating full onboarding.

Full onboarding (option C) would add UI creation, maximum-policy editing,
rotation and secure one-time credential delivery with client-specific setup
guidance. This can remove terminal use for Context Router's credential tasks;
it does not automatically eliminate terminal use required by a third-party CLI.

Optional C+ conveniences could add consent-based external-client configuration,
connection diagnostics and assisted reconnect/rotation. Choose these only for
demonstrated needs. Do not promise one-click support across clients without
verifying their supported configuration and credential-handling mechanisms.

## Boundaries To Preserve

- UI is additive to a supported CLI, never its replacement. Both use the same
  backend operations, durable client records and authority rules. CLI-created
  clients appear in UI; UI-created clients remain CLI-manageable. No credential
  migration is required merely because a UI is added.
- Keep per-instance identity and independent revocation. Product labels are not
  authority; narrowing grants cannot exceed credential maximum policy.
- Never send human-file or inference credentials to the browser. Review local
  session authorization, secret display/export, clipboard lifetime, logs,
  rotation ambiguity, failure/recovery and explicit consent before implementation.
- Creating credentials, configuring third-party apps, and starting the
  application/model are separate responsibilities. The installed app owns managed startup,
  installation and explicit replacement; the implemented app retains a documented
  manual MCP setup and does not include an automatic updater.
- No implicit OAuth server, LAN exposure, automatic edits of external app
  configuration, second client registry or general plugin framework.

## First Pilot Slice

Qualify client versions/account modes with current official docs and a real
installed-app test. Retain loopback HTTP; investigate a thin authenticated local
stdio bridge only if the chosen client needs it. Do not build a second backend,
registry or OAuth service as an incidental adapter. No public/LAN exposure or
automatic personal-client edits without reviewed scope and consent.

Prefer a guided dashboard connect/reconnect flow if it is the smallest reliable
experience. Assistance and documented commands remain acceptable for the initial
few Git-capable colleagues; full zero-terminal C+ is not an agreed requirement.
Any bridge needs bounded startup/exit, private credential handling, version/asset
ownership, clear errors and explicit reconnect behavior without replaying writes.
Use the canonical [Claude Desktop acceptance checklist](../../active/colleague-pilot/README.md#claude-desktop-acceptance)
for the minimum pilot slice rather than maintaining a second test list here.

Explain that CR is local while a cloud-backed assistant may send tool results
off-device. ChatGPT qualification must name the actual desktop app/mode/account;
support in Codex does not prove support in ordinary ChatGPT conversations.

The minimum Claude Desktop implementation plan belongs in the active pilot's
`plan.md`; this backlog brief supplies shared boundaries, not a second active plan.
If broader C/C+ work is separately activated, move its remaining brief under
`docs/plans/active/` and create its reviewed plan there. Once a slice ships,
distill durable behavior into the MCP setup/current-system documentation and
remove superseded planning material; retain only wanted unactivated work here.
Git remains the archive.
