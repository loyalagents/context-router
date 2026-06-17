# Open-Schema PR3 MCP Runner — Review Feedback 1

- Reviewer pass: code + doc review only (no implementation changes made)
- Date: 2026-06-16
- Branch: `os-pr-3` (commit `5093234` "first pass")
- Scope reviewed: `docs/plans/evaluation/scoring/open-schema/pr3/{implementation-plan,implementation-summary}.md`,
  `examples/eval/scripts/e2e-mcp-agent.mjs`, `examples/eval/scripts/e2e-mcp-agent.test.mjs`,
  `examples/eval/prompts/mcp-open-schema.md`,
  `examples/eval/schemas/{evaluation-run,mcp-agent-run}.schema.json`,
  `examples/eval/scripts/memory-snapshot/mapper.mjs`, and the known-schema runner
  path / PR1+PR2 exporters and scorers for comparison.

## Summary

PR3 wires the deterministic `command` adapter through the full open-schema
artifact chain behind `pnpm eval:e2e-mcp-agent --schema-mode open --form-mode
backend`. It branches the runner into PR1's `memory-snapshot.json` export +
`definition-baseline.json` capture and PR2's open-schema scorers after the agent
writes memory, while leaving the known-schema chain intact.

The diff is appropriately scoped (11 files): the runner (`e2e-mcp-agent.mjs`,
+450/−), its tests (+443), the open prompt, two schema extensions, a
backward-compatible `mapper.mjs` tweak, and docs.

**Scope and non-goals are respected.** `parseArgs` rejects everything PR3 says it
should: `--agent codex` (`e2e-mcp-agent.mjs:859`), live Claude open mode
(`:883` — open requires `--agent command`), `--form-mode agent` (`:871`), and the
command adapter still requires `--allow-test-command-agent` (`:895`). No
identity-hardening or fresh-user isolation was added (correctly deferred to
Checkpoint 4).

**Known-schema behavior is preserved.** The known stage list
(`KNOWN_STAGE_NAMES`), known artifact names, and the known export/score stage
arguments are byte-equivalent to before — the refactor wraps the
database/stored-preferences/combined stages in `schemaMode === 'open' ? [...] :
[...]` arrays and the `else` branch reproduces the prior stages exactly. The
`mcp-agent-run.schema.json` change moves `storedPreferences` /
`databaseScoreReport` / `combinedScoreReport` from unconditional `required` into a
`schemaMode: known` conditional, so the *effective* known required-set is
unchanged while the open set is added. `schemaMode` is itself `required` and
enum-constrained to `known|open`, so exactly one conditional branch always fires.

The `mapper.mjs` change is backward-compatible: `evaluationModeFor` now also maps
the new `mcp-open-schema-agent` / `mcp-known-schema-agent` producer labels to
`mcp-open-schema` / `mcp-known-schema`, while preserving the existing `mcp-agent`
branches and the default fallthrough — no PR1 regression.

The open prompt (`mcp-open-schema.md`) is hidden-truth-safe (read only listed
corpus docs; explicit "do not use profile files, validation reports, fact-storage
maps, expected snapshots, score reports"; reuse-existing-definitions-first
guidance) and matches the plan.

I found **no blocking issues**. The one finding worth acting on before leaning on
the open runner is a direct test for the new `captureDefinitionBaseline`
function; everything else is minor.

## Findings

Ordered by severity. Nothing here blocks merge.

### Medium

**Md1. The real `captureDefinitionBaseline` is never exercised by a test.** Every
open-mode e2e test injects a stub via `successfulRunners`
(`e2e-mcp-agent.test.mjs:1261`) that writes a canned `definition-baseline.json`,
so the actual function body (`e2e-mcp-agent.mjs:634-689`) — the
`fetchMemorySnapshotGraphql` call, the `me.userId` presence check (`:653-656`),
the **backend-user-mismatch guard** that throws when the baseline query resolves
to a different backend user than setup (`:657-661`), and the
`normalizeDefinitionRows`/`sortDefinitionRows`/`buildDefinitionBaselineArtifact`
wiring — has no direct coverage. This is the only new non-trivial logic in PR3,
and its identity guard is exactly the kind of check that matters for open-schema
correctness (a baseline captured against the wrong user would silently mislabel
which definitions the agent created). It reuses well-tested PR1 helpers and the
stage harness handles its throw, so risk is contained, but I'd add a focused unit
test with a fake `fetchImpl`: (a) happy path writes a baseline with expected
`definitionIds` / `strategy: baseline-only` / `backendUserId`; (b) a `me.userId`
that differs from `setupResult.backendUserId` rejects with the mismatch message;
(c) a missing `me.userId` rejects. The PR3 plan's Checkpoint 4 test list
("baseline ... failure paths") is satisfied at the *stage-skip* level but not at
the *function* level.

### Minor

**M1. `mcp-agent-run` schema permits cross-mode artifact keys.** The conditional
`allOf` *requires* the per-mode artifact keys, but the base `artifacts.properties`
still lists all known and open keys as optional, and there is no
`additionalProperties: false`-style exclusion per mode. So an open run that also
carried `storedPreferences` (or a known run carrying `memorySnapshot`) would still
validate. The runner's `agentRunArtifactMap` only ever emits the correct per-mode
set (`e2e-mcp-agent.mjs:1402-1432`), so this is latent, not live. If you want the
schema to fully enforce the contract, add the opposite-mode keys to a
`not`/`propertyNames` exclusion in each conditional branch. Low priority.

**M2. Open mode reuses `prepareKnownSchemaMemory` for `setup-open-schema-memory`.**
`stageRunners.setup` is `prepareKnownSchemaMemory` in both modes
(`e2e-mcp-agent.mjs:90`), and open mode just forces `ensureDefinitions = false`
(`:923-925`). Functionally correct — the stage still needs backend-user resolution
and optional value reset — but the known-schema-specific name reading under an
`setup-open-schema-memory` stage label is a clarity smell. A thin
`prepareOpenSchemaMemory` wrapper (or a rename to a mode-neutral
`prepareAgentMemory`) would make the open path self-documenting. Naming only.

**M3. `evaluation-run.summaries.databaseScore` / `combinedScore` are reused for the
open scorers' summaries.** In open mode these keys hold the open-schema database
and combined summary shapes (`e2e-mcp-agent.mjs:274,397`), which differ from the
known summaries. The `summary` `$def` is permissive enough to validate both, but
the artifact does not self-describe which scorer produced the summary — a consumer
must read `settings.schemaMode` to interpret `summaries.databaseScore`. Acceptable
for v1; worth a note if a downstream comparison tool starts reading these
generically.

### Observations (no action needed)

- **Identity chain is solid for a pre-Checkpoint-4 runner.** setup resolves
  `backendUserId` → `captureDefinitionBaseline` cross-checks the baseline query
  resolves to that same user → `export-memory-snapshot` independently re-queries
  `me.userId` and (via PR1 `readBaselineFromArtifact`) validates the baseline's
  `userId`/`backendUserId`. That is good defense-in-depth even though the hard
  MCP/backend identity preflight is explicitly deferred.
- **Redaction is layered and tested.** `redactForArtifact` scrubs the auth token,
  every sensitive-looking provider env value (`isSensitiveAgentEnvKey`), and
  `Bearer`/JWT/`sk-` patterns; the open-mode failure-path tests
  (`:867,925,978`) assert `secret-token` never appears in output. Good.
- **Baseline-before-agent ordering is correct.** `capture-definition-baseline`
  runs after setup and before `run-mcp-agent`, with `--reset-memory` scoped to
  active values (definitions persist), so post-run ID diffs truthfully isolate
  agent-created definitions.

## Open Questions / Assumptions

1. **Should `score-open-schema-database` returning `unscorable` (exit 1) hard-fail
   the whole open run?** It does, because `runStage` treats the score stage's
   exit 1 as a stage failure — identical to known mode's `score-database`. I read
   this as intended (a not-ready fixture is a setup-class failure, and the plan
   says "Runtime/setup failures stop the run"), but flagging since an open
   command-adapter run over a deliberately-unscorable fixture will stop rather
   than emit a labeled unscorable artifact chain.

2. **`mcp-open-schema-agent` producer label.** PR3 sends `--producer
   mcp-open-schema-agent` and PR1's `mapper.mjs` was extended to recognize it.
   Assumption: this label is the durable producer name for MCP open runs (it now
   appears in `memory-snapshot.json.storageInput.producer` and drives
   `evaluationMode`). If PR4/live runs introduce a distinct label, the mapper's
   producer set will need another entry — worth centralizing the allowed producer
   labels rather than string-matching in two files.

3. **Live Claude open smoke remains reserved** (`:883`). Confirming the intent is
   that Checkpoint 4 flips this gate, not PR3.

## Merge Recommendation

**Safe to merge as PR3.** The open-schema runner wiring is correct and faithfully
reuses the PR1 exporter / PR2 scorers; the known-schema chain is provably
unchanged (stage names, artifact names, and stage args are identical, and the
schema change preserves the known required-set while adding the open one); all
reserved modes (codex, live-Claude-open, agent-form-fill) still fail fast; the
prompt is hidden-truth-safe; and redaction plus failure-path stage-skipping are
well covered. Md1 (a direct `captureDefinitionBaseline` test) is the one
follow-up I'd prioritize before treating open command-adapter runs as trustworthy,
but it is non-blocking given the function reuses tested helpers and the e2e
wiring/failure paths are otherwise thoroughly asserted.

## Verification Run

All commands run from repo root on branch `os-pr-3`:

| Command | Result |
| --- | --- |
| `node --test e2e-mcp-agent.test.mjs export-memory-snapshot.test.mjs score.test.mjs` | **pass** — 41/41 |
| `pnpm eval:test` | **pass** — 284/284, 0 fail |
| `pnpm eval:validate` | **pass** — `errors=0 warnings=11` (known Alex realism warnings) |
| `pnpm eval:verify` | **pass** — exit 0 |

Cross-checks performed: confirmed `schemaMode` is `required` and enum-limited so
the `mcp-agent-run` `if/then` conditionals always fire; confirmed the known stage
list / artifact names / export+score stage args are unchanged from the
pre-PR3 runner; confirmed `mapper.mjs` keeps the existing `mcp-agent` producer
branches; confirmed the open happy-path test asserts stage order, `ensureDefinitions
= false`, the full open export arg set (`--schema-mode open`,
`--schema-reset-mode baseline-only`, `--baseline-in`, `--producer
mcp-open-schema-agent`, `--include-suggestions`), and per-mode artifact maps;
confirmed `captureDefinitionBaseline` is stubbed in all e2e tests (basis for Md1).
</content>
