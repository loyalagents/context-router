# dynamicmem-user001-cp00-02-memory-final-v1

This Harbor task is generated from DynamicMem (`xiewenya/dynamicmem`, MIT
license). Harbor is only the runner. The task preserves the DynamicMem
checkpoint content:

- raw `app_log_large.json` entries are revealed as chronological checkpoint deltas;
- hidden expected files store the upstream checkpoint task packs for the full trajectory;
- each visible stage exposes sanitized State Completion and Personalized
  Service queries for that checkpoint;
- the agent writes upstream-compatible `outputs/prediction.json`.

Source user: `001_user_001` / `user_001`
Checkpoint trajectory: `0, 1, 2`
Final checkpoint: `cal_quarterly_003` as of `2024-06-30 20:00:00`
Stage contract: `update-only-then-final`
Scored checkpoints: `2`
Observed raw logs: `716`
State completion evaluations: `37`
Personalized service items: `37`

Human-review materials:

- `tests/expected/difficulty.json`
- `tests/expected/soundness-report.md`
- `tests/expected/benchmark.json` hidden upstream-compatible benchmark slice
- `tests/expected/visible-tasks.json` sanitized checkpoint-stage task payloads

Scoring:

- official DynamicMem reward uses the configured LLM-as-judge when
  `DYNAMICMEM_LLM_JUDGE_API_KEY` or `OPENAI_API_KEY` is available;
- generated tasks default to `DYNAMICMEM_LLM_JUDGE_BASE_URL=https://openrouter.ai/api/v1`
  and `DYNAMICMEM_LLM_JUDGE_MODEL=google/gemini-3.5-flash`;
- deterministic key/value scoring is retained in `score-summary.json` as a
  proxy and fallback for oracle/local smoke runs.

Regenerate from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --checkpoint-indices 0,1,2 \
  --stage-pattern update-only-then-final \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --codex-web-search disabled \
  --agent-timeout-sec 86400 \
  --verifier-timeout-sec 86400 \
  --build-timeout-sec 600
```

Do not expose `tests/expected/` files to agents.
