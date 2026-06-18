# Summary

Reviewed the PR3 plan/summary docs, the PR3 commit on `os-pr-3` (`5093234` on top of PR2 `cff7259`), and the `HEAD~1...HEAD` diff. PR3 appears scoped to Checkpoint 3: deterministic command-adapter open-schema MCP runner wiring.

The scope boundary looks respected. Open mode is accepted by the parser, but only for `--agent command`, while live Claude open-schema remains rejected in `examples/eval/scripts/e2e-mcp-agent.mjs:883`. Open mode defaults to the open-schema prompt and forces known-definition setup off in `examples/eval/scripts/e2e-mcp-agent.mjs:923`. The open stage list adds `capture-definition-baseline`, `export-memory-snapshot`, and the two open-schema score stages in `examples/eval/scripts/e2e-mcp-agent.mjs:54`, while the known stage list and known artifact names remain separate in `examples/eval/scripts/e2e-mcp-agent.mjs:43` and `examples/eval/scripts/e2e-mcp-agent.mjs:1426`.

The artifact chain is consistent with PR1/PR2. The runner captures `definition-baseline.json` before the agent stage in `examples/eval/scripts/e2e-mcp-agent.mjs:193` and `examples/eval/scripts/e2e-mcp-agent.mjs:634`, exports `memory-snapshot.json` with `--baseline-in`, `--include-suggestions`, `--producer mcp-open-schema-agent`, and `--schema-reset-mode baseline-only` in `examples/eval/scripts/e2e-mcp-agent.mjs:1505`, then scores with PR2's `open-schema-database` and `open-schema-combined` modes in `examples/eval/scripts/e2e-mcp-agent.mjs:253` and `examples/eval/scripts/e2e-mcp-agent.mjs:380`.

The schema changes match the new runner contract. `evaluation-run.schema.json` now allows the open stage names in `examples/eval/schemas/evaluation-run.schema.json:135`, and `mcp-agent-run.schema.json` allows `schemaMode: "open"` plus mode-specific artifact-path requirements in `examples/eval/schemas/mcp-agent-run.schema.json:39`, `examples/eval/schemas/mcp-agent-run.schema.json:198`, and `examples/eval/schemas/mcp-agent-run.schema.json:216`.

# Findings

No blocking correctness findings.

I did not find evidence that PR3 enables live Claude open-schema runs, `--agent codex`, `--form-mode agent`, backend API changes, backend identity hardening, schema-state cleanup, upload-level schema discovery, or known-schema artifact/scoring contract changes.

# Open Questions

- `definition-baseline.json` is validated operationally when `export-memory-snapshot` re-reads it via `--baseline-in` in `examples/eval/scripts/export-memory-snapshot.mjs:69`, but it does not have a standalone JSON schema. That is not a PR3 blocker because malformed baselines fail before scoring, but adding a schema later would make the artifact contract easier to validate independently.
- The deterministic command adapter is correctly marked test-only in `examples/eval/scripts/e2e-mcp-agent.mjs:1291`. I assume PR4 will be the first place where live Claude open-schema output is reviewed for benchmark usability after identity and schema-state isolation are implemented.

# Merge Recommendation

Safe to merge as PR3. The implementation wires the open-schema runner path through static PR1/PR2 artifacts, preserves known-schema behavior, and keeps live/open production-risk items reserved for later checkpoints.

# Verification Run

- `node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/score.test.mjs` passed: 41 tests.
- `pnpm eval:test` passed: 284 tests.
- `pnpm eval:validate` passed: 0 errors, 11 existing Alex realistic corpus warnings.
- `pnpm eval:verify` passed: 284 tests plus validation, with the same 11 corpus warnings.
