# dynamicmem-user001-cp00-04-trajectory-v1

This Harbor task is generated from DynamicMem (`xiewenya/dynamicmem`, MIT
license). Harbor is only the runner. The task preserves the native DynamicMem
checkpoint content:

- raw `app_log_large.json` entries are revealed as chronological checkpoint deltas;
- hidden expected files store the upstream checkpoint task packs for the full trajectory;
- each visible stage exposes sanitized State Completion and Personalized
  Service queries for that checkpoint;
- the agent writes upstream-compatible `outputs/prediction.json`.

Source user: `001_user_001` / `user_001`
Checkpoint trajectory: `0, 1, 2, 3, 4`
Final checkpoint: `cal_quarterly_005` as of `2024-12-31 18:00:00`
Observed raw logs: `1455`
State completion evaluations: `189`
Personalized service items: `189`

Human-review materials:

- `tests/expected/difficulty.json`
- `tests/expected/soundness-report.md`
- `tests/expected/benchmark.json` hidden upstream-compatible benchmark slice
- `tests/expected/visible-tasks.json` sanitized checkpoint-stage task payloads

Regenerate from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --checkpoint-indices 0,1,2,3,4 \
  --model gpt-5.4-mini \
  --reasoning-effort high
```

Do not expose `tests/expected/` files to agents.
