# dynamicmem-user001-cp01-native-v1

This Harbor task is generated from DynamicMem (`xiewenya/dynamicmem`, MIT
license). Harbor is only the runner. The task preserves the native DynamicMem
checkpoint content:

- raw `app_log_large.json` entries are revealed in chronological batches;
- hidden expected files store the upstream checkpoint task packs;
- the final visible task exposes sanitized State Completion and Personalized
  Service queries;
- the agent writes upstream-compatible `outputs/prediction.json`.

Source user: `001_user_001` / `user_001`
Target checkpoint: `cal_quarterly_002` as of `2024-03-31 14:30:00`
Observed raw logs: `466`
State completion keys: `37`
Personalized service items: `37`

Human-review materials:

- `tests/expected/difficulty.json`
- `tests/expected/soundness-report.md`
- `tests/expected/benchmark.json` hidden upstream-compatible benchmark slice
- `tests/expected/visible-task.json` sanitized final-stage task payload

Regenerate from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \
  --source-dir /path/to/DynamicMem/001_user_001 \
  --model gpt-5.4-mini \
  --reasoning-effort high
```

Do not expose `tests/expected/` files to agents.
