# Assisted Mac alpha kit

- Status: plan reviewed; kit implementation and scoped qualification in progress
- Owner: `/root`, sole writer/integrator in the main checkout
- Branch: `codex/assisted-mac-alpha-kit`
- Base: verified GitHub main `a2ed2b95` on 2026-10-25
- Finish line: reviewed kit, scoped rehearsal, required validation and one draft PR;
  colleague acceptance and permission to distribute remain later milestones

## Inventory and scope

The existing packager emits a complete ad-hoc sealed Apple Silicon app ZIP, a
build receipt and an external full-byte receipt. Personal Claude Desktop uses
the existing three-module stdio bridge and a separately pinned Node 24.21.0.
Its production endpoint is fixed at `127.0.0.1:8787/mcp`. Demo setup does not
configure or qualify personal Claude onboarding.

GitHub confirms native assistant setup (#184), client permissions (#187) and
focused checks (#192) have merged. Older active-plan ownership and unfinished
implementation statements do not activate those tasks. The newest retained app
was built from `89b9547f53d4914e8a57f4b329b9a035288c8954`; it excludes current
client-permissions product changes. Build a fresh candidate with the existing
packager. Reuse only verified cached acquisition inputs; no download is needed.

| Build input | SHA-256 |
| --- | --- |
| Node 24.21.0 Darwin arm64 archive | `6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe` |
| llama.cpp b11146 macOS arm64 archive | `1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711` |
| Qwen3.5-9B license | `bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a` |

No reset release is designated. Preserve the running app, personal envelope,
client configuration, provider profiles and original documents/model assets.
Do not read private document contents or tokens into shared evidence.

Owned paths: kit assembly and operator instructions under
`scripts/local-migration/installation/`, its focused test under
`apps/desktop/test/` (already selected by CI), and release-relevant pilot/portfolio links. Document
attribution/PDF fixes, colleague quickstart/feedback, and AI wording belong to
the planned parallel tasks. Share exact setup facts with their owners when
available; do not duplicate those changes.

## Reviewed implementation boundary

Add a small operator-only kit assembler around the current package outputs.
Require an independently supplied build-receipt SHA-256 and a clean commit
matching that receipt; verify package manifest,
external byte receipt, archive hash, pinned Node archive, and source bridge
bytes, including the extracted archive rather than only the adjacent app.
Copy the unchanged app ZIP, external receipt, sanitized release metadata,
three bridge modules, pinned Node archive and operator instructions into one
new output directory. Emit file checksums and a separately hashed kit archive.
Do not copy build logs, local absolute paths, databases, credentials or private
evidence into the shareable kit. Preserve detailed build receipts privately.

The kit is a transport container, not an installer. Operators manually place the
app and immutable bridge/Node support in durable private user-owned locations,
verify checksums received over a trusted channel, and use existing installed
CLI provision/permissions/grant commands. Recipients need neither checkout nor
pnpm/clang. Do not execute from temporary support paths or modify a sealed app.
Personal Claude configuration remains an explicit reviewed manual edit, using
absolute paths, a new private credential file, and cleared Node debug/options
environment. Defaults grant no targets; start with chosen narrow read access.

No runtime/backend/credential/lifecycle changes are planned. A demonstrated
blocker gets a bounded diagnosis and tests-first correction if within scope;
broader changes need a concrete next-step proposal. No updater, signing project,
general onboarding framework, new provider, or CI optimization.

## Checkpoints and evidence

Independent plan review by `/root/plan_review` approved SHA-256
`2c11dbe8a36bd3c0ee4579d63fd1f3437771200286ef8b010134b757cef5fb9f`.
Its recommendations were incorporated before implementation: place tests in
the existing desktop CI glob, and exercise the extracted kit's actual Node/bridge
closure. No scope, integrity, privacy, state or validation blocker remained.
Later status/evidence prose does not change those reviewed boundaries.
The [operator instructions](../../../../scripts/local-migration/installation/ASSISTED_ALPHA_OPERATOR.md)
are copied into the kit; their recipient commands are manual and approval-bound.
The assembler is operator-only and never installs or edits a client.

**A — inventory and plan.** Verify ownership, main, retained artifacts and inputs;
independently review this plan for scope, package integrity, persistence, privacy
and validation. Sensitive review requests Astra Extra High; factual inventory
requests Astra High. The tool accepts those settings but does not independently
attest runtime execution. Coordinator uses the session configuration, also not
independently attested. Reviewers are read-only.

**B — kit and isolated rehearsal.** Add focused assembly tests for mismatched
source/hash, tampering, existing destinations and shareable allowlist. Run the
existing bridge deterministic checks. Build once from a frozen clean source,
verify the actual ZIP/extracted bundle, and run the existing installed smoke and
real old-to-new synthetic replacement harness on isolated roots/ports. Record
normal settlement, authority/state retention and sampled disk usage. Use the
existing test-only endpoint injection for bridge integration; never bind or
interrupt a personal listener to exercise the production fixed-port CLI.
Exercise the extracted kit's actual bridge modules with its separately extracted
pinned Node outside the checkout: existing synthetic transport tests via a
fixture-only import path, plus CLI startup/EOF checks without initialization.
Record the selected executable/module hashes. This checks the shipped support
closure without contacting port 8787, actual Claude or a provider.
Synthetic/no-model evidence cannot establish document extraction quality,
actual Claude, model operation, AppKit or Gatekeeper acceptance.

**C — frozen candidate and draft PR.** Resolve known findings, run independent
complete-diff review, focused checks and all applicable exact-candidate CI. Open
the draft promptly once stable; run review and remote CI against stable inputs.
Record source/head/test-merge identities separately and compare product/build
inputs before carrying evidence across docs/test-only deltas. Generated binaries
and private evidence remain ignored/outside Git; retain durable local locations
and SHA-256 identities in the handoff/PR.

The [validation matrix](../../../useful/AGENT_WORKFLOW.md#default-and-exceptions)
applies: documentation/tests, Mac packaging, and actual-artifact delivery rows.
This PR adds delivery tooling and instructions around unchanged product/runtime
and packager inputs. Focused tooling/bridge checks, actual Mac installed and
replacement checks, affected documentation readers/links/whitespace, and full
applicable source CI supply the selected evidence. No change currently needs the
full local gate's extra aggregate lifecycle boundary; do not duplicate it solely
because a new archive is assembled. Reassess if implementation changes that
boundary. Completed #174/#183/#184 implementation gates remain historical, with
no new claim against their artifacts.

## Outstanding pilot commitments

| Commitment | Disposition for this draft milestone |
| --- | --- |
| Trusted acquisition and downloaded launch | Provide exact kit/hash and bounded human Safari/Finder/Open Anyway steps. No binary publication. Previous D observation is historical and cannot qualify this kit or a fresh Mac. |
| AppKit Ready, unlock, model download/restart | Human rehearsal on exact new artifact after separate consent; no inference/download/personal-app mutation in automation. Retain model E/H limits. |
| Supported document import/review/save | Existing deterministic coverage plus a bounded synthetic text human exercise; live extraction and attribution/PDF outcome belong to human acceptance and the separate investigation. |
| Personal Claude and >35 minute idle/uncertain result | Carry prior client evidence only as historical context. Prepare exact personal setup and read/reopen steps; current actual-client/version/account acceptance remains pending. No demo substitution. |
| Replacement and disk accounting | Actual old-to-new synthetic replacement, measured archive/app/support footprint, nominal pinned model size and explicit staging/backup allowance. Samples are not exact peak or fresh-Mac qualification. |
| Recovery | Use supported Quit/restart, offline backup/restore, new-path rotation and refusal/diagnosis. Uncertain ownership, forced loss and reboot remain unsupported; never delete journals. |
| Colleague invitation | Later product-owner decision after named remaining acceptance and parallel blocker disposition; draft readiness does not authorize invitation. |

The user's current request explicitly schedules actual colleague acceptance
after this PR. These commitments remain visible, not silently waived. Any
necessary live or personal operation requires its own bounded authorization
after independent kit preparation is complete.
