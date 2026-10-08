# Step 09 Activation Evidence

- Outcome: passed, exit 0; activation edits began only after final receipt and cleanup verification
- Date: 2026-10-04 America/Los_Angeles (final receipt 2026-10-05 UTC)
- Checkout: `/Users/lucasnovak/loyal-agents/context-router`; no development worktree
- Branch: `codex/local-migration-09-installation-and-packaging`
- Source HEAD, local main, origin/main and verified remote main: `7328ceea63a784577594d52af18062be8b583855`
- Source dirty: false, including nonignored untracked files; source still clean after exit
- Copied source SHA-256: `09bb8ce191a3cac5508f819b22cdd17336de4f83f446b261e9e901f8c2cb383e`
- Base comparison: performed; caller integrity: true; cleanup errors: none
- Final JSON elapsed: 1,150,286 ms; final console elapsed: 1,150,746 ms (19m11s)

## Verified Prerequisite

The live GitHub API reported [PR #167](https://github.com/loyalagents/context-router/pull/167)
MERGED, not draft, at `2026-10-05T03:18:11Z`, with merge
`7328ceea63a784577594d52af18062be8b583855` and final tested head
`e064e74b5fc30f6c3c24cee17e1c5b11d43ffa7b`. Its
[standard CI](https://github.com/loyalagents/context-router/actions/runs/37255310437)
and [dedicated gate](https://github.com/loyalagents/context-router/actions/runs/37255310441)
were completed/successful on that head. Head and merge trees both equal
`e11f9c4f6db90f576f665becce27f1c5974fc4fb`. Live `git ls-remote` confirmed
remote main; no replacement base was needed.

History was non-shallow, with 224 reachable main commits; connectivity fsck
passed. The checkout began clean. Creating the requested branch was the only
Git mutation before the gate. No stash, reset, source edit, live model run,
asset download or personal client/installation change was performed.

## Command And Results

```sh
PATH=/Users/lucasnovak/.nvm/versions/node/v24.21.0/bin:$PATH \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python \
MIGRATION_GATE_BASE_SHA=7328ceea63a784577594d52af18062be8b583855 \
RUNNER_TEMP=/private/tmp/step09-activation-QyWeWsSV \
MIGRATION_GATE_CI_SUMMARY_PATH=/private/tmp/step09-activation-QyWeWsSV/local-migration-gate-summary.json \
pnpm migration:gate
```

Toolchain: Node 24.21.0, pnpm 10.25.0, Python 3.12.8, Playwright 1.63.0,
Chromium 153.0.8010.12 revision 1243, owned loopback PostgreSQL 15.19,
Docker server 27.3.1. Native host: MacBookPro18,2, Apple M1 Max, 64 GiB,
macOS 15.1.1 build 24B91, arm64. This is prerequisite validation, not installed
Step 09 or broader Apple Silicon qualification.

| Phase | Result | Elapsed ms |
| --- | --- | --- |
| contract-baseline | passed | 28262 |
| documentation | passed | 1472 |
| backend-unit-build | passed | 125964 |
| backend-database | passed | 220120 |
| local-orchestrator | passed | 5961 |
| eval-fixtures | passed | 36044 |
| eval-deterministic-scenarios | passed | 7459 |
| web-production-build | passed | 86833 |
| harbor-static | passed | 2379 |
| restart-smoke | passed | 82441 |
| packaged-composition-smoke | passed | 509623 |
| repository-integrity | passed | 1785 |

## Preservation And Cleanup

The [final exported receipt](activation-gate-summary.json) records successful
database removal and administration cleanup. After exit 0, both exact owned
directories were absent:

- `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/context-router-lmbg-RZH58c`
- `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/context-router-lmbg-workspace-zS70K5`

Docker inspection returned `No such container` for the exact owned container
`lmbg-postgres-793abffb078edb0d04204bd6`. The receipt records removal of
`context_router_4696da2f9527071e34bf6e02_test`. HEAD/main/origin-main were
unchanged and `git status --porcelain=v1` remained empty after cleanup.

Private preflight and console evidence remains in
`/private/tmp/step09-activation-QyWeWsSV` (private parent and console file).
Sandbox network/Docker/Git restrictions required reviewed tool escalation;
the successful GitHub reads, gate and exact resource inspection are the
evidence, not earlier sandbox DNS/authentication errors. No approval was rejected.
