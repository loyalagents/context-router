# Step 03: Local Identity

- Status: active; plan independently approved; implementation in progress
- Program step: `03-local-identity`
- Target branch: `main`
- Planning and implementation branch:
  `codex/local-migration-03-local-identity`
- Planning base: Step 02 PR
  [#161](https://github.com/loyalagents/context-router/pull/161), human-merged
  at `6b420ed24e9dd344af8990c9045832990ae1b5ec`
- Planning owner, implementation owner, and sole repository writer: `/root`
- Change classification: `local-only` main-line migration work. The retained
  hosted-baseline adapter on `main` is hardened only for the new principal
  boundary; `hosted-v1-maintenance` is intentionally unchanged and no backport
  or production-remediation claim is authorized
- Supported modes after merge: the existing hosted application and an explicit,
  non-listening `local-identity-preview`; neither is selected by missing
  configuration
- Implementation PR: one draft PR from the branch above; no automatic merge
- Last updated: 2026-09-22

## Outcome

Introduce one stable, opaque human principal boundary and an executable
single-user local implementation without weakening hosted authentication or
conflating a person with an MCP client. The local preview persists its principal
and independent credential under an explicitly supplied private state root,
uses PostgreSQL only as this step's temporary application-state adapter, and
starts without human Auth0 configuration or any network listener. Existing
hosted GraphQL, REST, web, MCP, OAuth/DCR, tool, resource, grant, restart, and
packaging behavior remains supported on `main`. This PR does not change or
remediate the deployed hosted-v1 maintenance line.

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

Step 03 owns only the narrow human-principal seam, main-line hosted-baseline
identity hardening,
the drained-writer audit and frozen link-or-deny dispositions required before
any verified-email binding to a historical account,
the private local identity state/credential, an explicit non-listening local
preview, its real process/restart evidence, and corresponding registry,
gate, and documentation changes.

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
consumers, tests/recovery/gate implications, and security/privacy. Fresh
read-only reviewers independently approved architecture/scope,
testing/recovery, compatibility/consumers, and security/privacy before product
implementation. Their findings and dispositions are recorded in the plan.
Material changes to the principal model, state protocol, issuer migration,
network reachability, public contracts, or supported-mode/gate shape return the
affected dimensions to fresh review.

After plan approval, commit this activation checkpoint, open one draft PR using
the local-migration template, and continue on the same branch. After
implementation, fresh reviewers compare the complete base-to-HEAD diff with
the approved plan. Final local and remote evidence must be recorded before the
PR is marked ready for human review. A human owns merge.
