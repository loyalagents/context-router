# Choosing A Model Provider Follow-Up

- Status: deferred product follow-up; not activated or an approved implementation plan
- Outcome owner: product owner and next assigned AI-provider coordinator
- Trigger: revisit after Step 09 closeout; optional Steps 10/11 are not prerequisites
- Source: user-requested follow-up on 2026-10-10;
  [LM-025](../local-migration/decision-log.md#lm-025-choosing-a-model-provider-is-a-separate-product-follow-up)
- Last reviewed: 2026-10-10

## Outcome And Scope

Let users choose the provider and model for Context Router's own AI-assisted
extraction, search and form workflows. Start with one selection shared across
those features, with truthful capability checks and unsupported states. This
setting does not select or change an MCP client's own model.

The intended choices are:

| Choice | Ownership and data destination |
| --- | --- |
| CR-managed local model (default) | CR manages its verified runtime and assets; inference stays on-device. |
| Use existing Ollama (optional) | Reuse the user's service and model store without a duplicate CR download/store. The user owns runtime lifecycle; CR never stops the service or unloads its models. Establish whether the selected model executes locally or in the cloud before use. |
| OpenAI API (optional) | Explicit opt-in to sending the required inputs off-device; secure provider credentials and a clear destination. |
| Anthropic (Claude) API (optional) | The same explicit off-device opt-in and credential requirements. |

Ollama's localhost endpoint alone is not proof of local inference: model choice
can involve [cloud processing](https://docs.ollama.com/cloud). The reviewed design
must distinguish local and cloud execution explicitly, require opt-in before
off-device processing, and reject ambiguous destinations. Connection checks must not silently submit user
content. Prefer a verified same-machine endpoint for the first existing-Ollama
slice; arbitrary remote/custom endpoints are not implied. Review endpoint,
redirect and proxy handling so they cannot bypass the declared destination or
leak credentials. Importing compatible model files into CR-managed storage is a
distinct possible follow-up, unnecessary for the first use-existing-Ollama scope.

This is outside the numbered migration, adds no Step 09 acceptance gate and
does not renumber Steps 10/11. Optional hosted product inference would be a
future extension to [LM-005](../local-migration/decision-log.md#lm-005-local-model-by-default),
whose current local-product/evaluation-only boundary remains in force until a
separately reviewed implementation changes it. No new provider is supported or
authorized to process data by this document.

## Boundaries To Preserve

Use the existing AI ports as the starting point; evolve only demonstrated
capability, configuration and lifecycle needs. Keep permission-filtered inputs,
schema/domain validation, and propose-before-apply behavior in application
services regardless of provider. Provider selection is not permission to widen
MCP grants, send additional data, bypass safety rules or apply model output
without the existing checks. Never silently fall back to a cloud provider.

Only authenticated local administration may change provider settings, credentials
or off-device consent; MCP tool permissions confer none of that authority and do
not constitute consent. Explain that the shared selection also governs CR AI work
initiated through MCP. Preserve the local principal, data and existing grants.

Consent must describe the data classes each feature submits, including saved
preference values/schema context as well as user input and document content.
Specify whether file extraction happens locally or at the selected provider.
Preserve CR's raw-file non-retention; provider-side file storage or other persistent
processing needs an explicitly reviewed lifecycle and disclosure. Do not equate
disabled application storage with no provider retention; check the chosen endpoint
and account controls, such as [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data),
again at activation.

Credentials need protected storage, replacement/removal behavior and redaction
from browser responses, URLs, arguments and logs. Show the selected provider,
model, data destination and actionable errors. Explain off-device processing
without promising provider-side non-retention. Preserve non-AI operation when a
provider is unavailable. Treat external service busy/loss and uncertain
cancellation truthfully; CR must not take ownership of a user's Ollama service
as a recovery shortcut.

Coordinate with [local AI scheduling](../local-ai-scheduling/README.md) on
per-provider capacity, deadlines, cancellation and settlement. The current
one-operation/no-queue contract and Step 06 E/H evidence describe the existing
selected local configuration; they neither qualify new providers nor dictate
one slot for every future provider. Preserve that baseline until affected
contracts and replacement evidence are reviewed. Define provider switching
during queued or active work so an existing request cannot silently change
destination or replay after an uncertain outcome. Bind each complete workflow,
including secondary model calls, to one provider/model/configuration and consent
snapshot, rechecking current authority and consent before every dispatch. Consent
withdrawal prevents new off-device calls; it cannot recall already-sent data.
Refresh UI/MCP capability and destination reporting consistently after a switch.
Hot switching is not required; a reviewed quiescent/restart boundary is acceptable
for the first version.

Keep caller deadlines/cancellation and provider-side settlement guarantees
distinct: aborting CR's request is not proof that external inference stopped.
Preserve bounded caller behavior without falsely claiming remote settlement or
merely disabling execution controls to make a new adapter fit the current ports.

## Proposed Checkpoints

1. **Selection contract and existing Ollama.** Inventory AI-port consumers plus
   installed-app preparation, status and restart paths; the managed status path
   currently calls the concrete local model service outside those ports. Then
   define the shared selection, local/cloud destination checks, truthful
   capabilities, configuration persistence and switching lifecycle. Review the
   contract, then implement the smallest adapter and settings UX with backend
   tests first. End with targeted tests for selection/restart, unsupported
   features, external busy/loss, cancellation and no CR-owned duplicate assets
   or lifecycle actions against the external service.
2. **One hosted provider.** Choose OpenAI or Anthropic during activation; neither
   vendor nor an exact model version is preselected here. Prove the same boundary
   with explicit consent, secure credentials, capability checks, clear destination
   and errors. End with tests for no off-device calls before consent, credential
   failures, rate limits, deadlines, malformed responses and no silent fallback.
3. **The second hosted provider.** Reuse the demonstrated contract, adding only
   required differences. End with equivalent consumer and privacy checks plus
   regression coverage for the managed local and Ollama choices.

These are planning checkpoints, not a required PR count or implementation
authorization. Defer per-feature routing, automatic fallback and a general-purpose
provider framework. Choose exact supported models and capabilities from evidence
when each provider is activated.

## Acceptance And Activation

Before implementation, assign ownership and independently review the concrete
plan across architecture, compatibility, credentials/privacy and lifecycle
risks. Follow [interface evolution](../local-migration/tracks/interface-evolution.md)
for changed contracts. Test backend behavior first and retain each checkpoint's
targeted results and limitations.

Acceptance must show that shared UI/MCP consumers use the selected provider
without widening authority, invalid output cannot bypass application validation,
and local/off-device labels match actual execution. Include browser evidence for
selection and consent, denial tests for unauthorized settings changes and new
off-device calls after consent withdrawal, persistence/restart checks for settings
and credentials, and cancellation/service-loss checks appropriate to each provider's
guarantees.
Use deterministic synthetic fixtures by default; live provider/model runs,
downloads and personal-state changes need their separately bounded approvals.

Apply the canonical [validation policy](../../../useful/AGENT_WORKFLOW.md#validation-and-context-discipline):
focused checks during iteration, then freeze a candidate at the agreed milestone
and complete applicable final gates and independent complete-diff review. This
docs-only entry needs link/consistency and whitespace checks, not runtime builds.
When activated, add the reviewed implementation plan here; after shipping, move
actual behavior to the model, dashboard, MCP and installed-app runbooks.
