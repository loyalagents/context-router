# MCP Onboarding Product Follow-Up

- Status: deferred; not activated or an approved implementation plan
- Outcome owner: product owner and next assigned coordinator
- Trigger: reassess after the packaged local app is usable, or if the user
  explicitly makes terminal-free MCP onboarding a release requirement
- Next action: assess actual setup friction in supported clients; choose the
  smallest useful slice before planning implementation
- Last reviewed: 2026-10-04

This is product work outside the numbered local-first migration. It is not
Step 09, Step 12, or a mandatory migration/release gate. The accepted deferral
is [LM-022](../local-migration/decision-log.md#lm-022-full-mcp-onboarding-is-additive-product-work-not-a-migration-gate).

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
  application/model are separate responsibilities. Step 09 owns managed startup,
  installation and updates; it retains a documented, tested manual MCP setup.
- No implicit OAuth server, LAN exposure, automatic edits of external app
  configuration, second client registry or general plugin framework.

If zero-terminal MCP onboarding becomes a launch requirement, explicitly
reprioritize the minimum necessary slice and its acceptance criteria. Until
then this follow-up must not expand Step 08/09 or delay migration completion.

Once activated, create a reviewed implementation plan here. Once shipped,
distill durable behavior into the MCP setup/current-system documentation and
remove this planning material; Git remains the archive.
