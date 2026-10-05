# Step 08 Activation Evidence

- Outcome: passed, exit 0; Step 08 activated only after restoration verification
- Branch: `codex/local-migration-08-local-ui` in `/Users/lucasnovak/loyal-agents/context-router`
- Source HEAD, local main, origin/main and verified remote main: `5e2a67dd785500ba053b2e836c47166e8adeada8`
- Source dirty: false, including nonignored untracked files
- Copied source input SHA-256: `cf0f28df1a03cbf699e705aea647a4de7d9b51db718264cfa6ef643b6386e3fa`
- Base comparison: performed; caller integrity: true
- Toolchain: Node 24.21.0, pnpm 10.25.0, Python 3.12.8; owned loopback PostgreSQL 15.19
- Total elapsed: 839386 ms (13m59s)
- Last updated: 2026-10-04

## Prerequisite

GitHub API reverified PR #166 as merged at `2026-10-04T01:55:30Z`, merge
`5e2a67dd785500ba053b2e836c47166e8adeada8`, final head
`a1a3e0167579f20839b5f91e2a5e52b5a2fd2a6e`. Both
[standard CI](https://github.com/loyalagents/context-router/actions/runs/37168124820)
and [migration CI](https://github.com/loyalagents/context-router/actions/runs/37168124816)
were completed/successful on that head. Head and merge trees match
`da85c715f87bdce522f7faed8b50c7f532d34d20`. Git history was non-shallow,
223 reachable main commits; connectivity fsck passed. No base substitution.

## Command And Phases

```sh
PATH=/Users/lucasnovak/.nvm/versions/node/v24.21.0/bin:$PATH \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python \
MIGRATION_GATE_BASE_SHA=5e2a67dd785500ba053b2e836c47166e8adeada8 \
pnpm migration:gate
```

| Phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | passed | 27991 |
| documentation | passed | 1425 |
| backend-unit-build | passed | 97164 |
| backend-database | passed | 225001 |
| local-orchestrator | passed | 6222 |
| eval-fixtures | passed | 37462 |
| eval-deterministic-scenarios | passed | 7545 |
| web-production-build | passed | 28983 |
| harbor-static | passed | 2382 |
| restart-smoke | passed | 75042 |
| packaged-composition-smoke | passed | 287100 |
| repository-integrity | passed | 2075 |

## Preservation And Cleanup

All twelve paths in the [handoff allowlist](../step-08-handoff.md) were inspected,
copied and hashed with staging state before a named path-scoped stash, including
the two new documents. Nothing was staged. The exact recovery object is
`45b7e81c3ef299939807ceb2f4d49c1888215eb0`; name
`step08-authorized-preparation-0abf1_0j`. Its tracked/untracked contents and base
were verified before the gate. After exit 0, `git stash apply` restored it without
conflicts; all twelve SHA-256 hashes, byte lengths, porcelain status and empty
index matched the originals. The stash remains retained. Subsequent documented
activation edits intentionally extend these restored files.

The gate removed its owned database and loopback administration container. Its
disposable workspace and diagnostic directory were confirmed absent after exit;
both gate and read-only receipt watcher terminated with exit 0. No competing
listener, real state, personal client configuration or live model was used.

Private evidence remains at `/private/tmp/step08-preservation-0abf1_0j`:
`manifest.json`, `preparation.patch`, original file copies, `status.bin`,
`activation-gate.log`, `activation-summary.json`, and
`activation-gate-resource-lifecycle.json`. The read-only watcher captured the
summary before final workspace/diagnostic deletion, so its status still says
running and cleanup-pending. This is not a final JSON receipt. Final success,
caller integrity and elapsed time are established by the gate console, exit 0
and subsequent absence checks; resource deletion is also recorded in the
captured lifecycle. Future gates will use the supported summary-export variables.
