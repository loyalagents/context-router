# Step 03: Local Identity

- Status: implemented and locally validated in PR
  [#162](https://github.com/loyalagents/context-router/pull/162); pending final
  pushed-head remote evidence and human merge
- Program step: `03-local-identity`
- Target branch: `main`
- Planning and implementation branch:
  `codex/local-migration-03-local-identity`
- Planning base: Step 02 PR
  [#161](https://github.com/loyalagents/context-router/pull/161), human-merged
  at `6b420ed24e9dd344af8990c9045832990ae1b5ec`
- Planning owner, implementation owner, and sole repository writer: `/root`
- Change classification: `local-only` main-line migration work. The retained
  hosted-baseline adapter on `main` is reduced to one provider adapter over the
  new principal boundary; `hosted-v1-maintenance` is intentionally unchanged
  and no backport or production-remediation claim is authorized
- Supported modes after merge: the existing hosted application and an explicit,
  non-listening `local-identity-preview`; neither is selected by missing
  configuration
- Implementation PR: one PR from the branch above, prepared for human review;
  no automatic merge
- Last updated: 2026-09-23

## Outcome

Introduce one stable, opaque human principal boundary and an executable
single-user local implementation without conflating a person with email, a
provider credential, or an MCP client. A narrow verified-identity assertion
makes Auth0 one edge adapter and allows another provider to use the same exact
`provider + issuer + subject` resolver without changing core services or the
schema. Existing users are intentionally not migrated: main-line upgrade
fixtures delete user-owned data rather than add legacy issuer sentinels,
email-link manifests, admission scans, or backup/re-forward machinery.

The local preview persists its authoritative principal and independent
credential under an explicitly supplied private state root. A durable root
operation and complete candidate precede database mutation, and explicit
recovery resolves empty/exact commit state before canonical ready publication.
It uses PostgreSQL only as this step's temporary application-state adapter and
starts without human Auth0 configuration or any network listener. Existing
hosted GraphQL, REST, web, MCP, OAuth/DCR, tool, resource, grant, restart, and
packaging shapes remain supported for fresh main-line state. This PR does not
change or remediate the deployed hosted-v1 maintenance line.

The detailed and test-first implementation contract is in
[`plan.md`](plan.md). It is deliberately one PR with five internal checkpoints.
The checkpoints are validation and commit milestones, not branch or PR
boundaries.

## Entry Evidence

Step 02 PR #161 was human-merged at
`6b420ed24e9dd344af8990c9045832990ae1b5ec`; its final tested head was
`00e4240564b3b63997d63cc581c6e52fbba0f613`. Standard CI
[35318582335](https://github.com/loyalagents/context-router/actions/runs/35318582335)
and the dedicated Local Migration Baseline Gate
[35318582309](https://github.com/loyalagents/context-router/actions/runs/35318582309)
passed.

Before this directory was created, `HEAD`, local `main`, `origin/main`, and
both merge bases resolved to the Step 02 merge SHA; history was complete and
non-shallow; the worktree and new branch were clean; and no other writer owned
the identity, composition, generated-contract, lockfile, or gate hotspots. Two
unrelated branches mention `.github/workflows/ci.yml`, so Step 03 does not own
or edit that file without a new coordination record.

The activation `pnpm migration:gate`, bound to the exact Step 02 merge SHA,
passed all 12 manifest phases in 461,692 ms using Node 24.21.0, pnpm 10.25.0,
Python 3.12.8, and PostgreSQL 15.15. Base comparison was performed and caller
integrity remained true. A uniquely named, loopback-only, tmpfs PostgreSQL 15
container was used after the gate's automatic Docker data directory proved
unusable on this host; the exact container was stopped and auto-removed after
the successful run. No shared database, image download, or unrelated container
was used.

## Required Reading

- [`AGENTS.md`](../../../../../AGENTS.md), the root
  [`README.md`](../../../../../README.md), [`docs/README.md`](../../../../README.md),
  and every file in [`docs/IMPORTANT/`](../../../../IMPORTANT/)
- [`../orchestration.md`](../orchestration.md),
  [`../decision-log.md`](../decision-log.md),
  [`../step-template.md`](../step-template.md), and
  [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md)
- the complete Step 01
  [`README.md`](../01-contract-baseline-and-product-scope/README.md) and
  [`plan.md`](../01-contract-baseline-and-product-scope/plan.md), the
  human-readable and executable contract baselines, and the GraphQL, HTTP, MCP,
  OAuth/DCR, client-policy, and profile fixtures they reference
- the complete retained Step 02
  [`README.md`](../02-composition-boundaries/README.md) and
  [`plan.md`](../02-composition-boundaries/plan.md)
- identity, authorization, reset, access-history, runtime, and operator guidance
  under [`docs/current/`](../../../../current/) and
  [`docs/useful/`](../../../../useful/)

## Scope Guardrails

Step 03 owns only the narrow human-principal/provider-adapter seam, exact
issuer-aware external-identity key, intentional fresh-data transition, private
local identity state/credential, explicit non-listening local preview, real
process/restart evidence, and corresponding registry, gate, and documentation
changes. Email is profile data only; there is no historical-account claim path.

It does not implement SQLite, a generic repository layer, a local model, local
MCP authentication or transport, browser sessions or UI cutover, LAN access,
native launch/runtime-closure machinery, process supervision, signing,
installer/keychain/final data-directory policy, multi-user IAM, or public
contract removal. The local preview intentionally excludes `McpModule` and the
web application. Step 07 owns local MCP credentials; Step 08 owns browser
sessions and final `user(id)` evolution; Step 09 owns final platform storage,
keychain, backup, destructive identity reset, and installation policy.

## Review And Landing

Read-only discovery covered architecture/provider leakage, contracts and
consumers, tests/recovery/gate implications, and security/privacy. The original
review approvals are superseded where they assumed historical-user migration or
the journaled candidate protocol. The user's explicit fresh-data clarification
triggered a material plan revision back to LM-002 and LM-007. Fresh read-only
architecture, persistence/recovery, compatibility, and security reviews
approved the same substantive plan checksum `1416604905 48917`. Findings and
dispositions are recorded in the plan.

The historical-user implementation was corrected with normal follow-up commits
rather than rewritten or force-pushed. All five checkpoints are complete on the
same branch. Fresh architecture/scope and security/lifecycle reviewers approved
the final base-to-HEAD corrections, and the exact-base local 12-phase migration
gate passed on 2026-09-23. Final pushed-head standard CI and the dedicated
migration workflow are recorded in the PR before landing. A human owns merge.
