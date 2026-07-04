This is a continuous-session Harbor staged-memory task backed by DynamicMem.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

1. Run `/app/next_stage` to reveal the next stage.
2. If the stage is `memory-update`, read `documents.json` and `docs/`, then
   update only the allowed memory/state.
3. If the stage is `downstream-task`, answer the visible task file from retained
   memory only. Use `/app/submit_state` or `/app/submit_service` when the task
   file asks for those helpers.
4. Repeat until `/app/next_stage` says no more stages are available.

Public stages have two roles:

- `memory-update`: read only the newly revealed raw app-log delta and update the
  memory/state allowed by the selected eval mode. Do not create or modify
  `outputs/prediction.json` in these stages.
- `downstream-task`: no source logs are revealed. Answer the visible task using
  retained memory from earlier stages.

For DynamicMem, a public `T` downstream task may be internally presented as two
validated task-family steps. Follow the currently visible task file:

- If `dynamicmem-state-task.json` is visible, write a candidate JSON under
  `/tmp`, then run `/app/submit_state <candidate.json>`. Retry until the helper
  prints `OK`.
- If `dynamicmem-service-task.json` is visible, write a candidate JSON under
  `/tmp`, then run `/app/submit_service <candidate.json>`. Retry until the
  helper prints `OK`.
- If legacy `dynamicmem-task.json` is visible, write `outputs/prediction.json`.

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts. In particular, do not read `/tests`,
`/data/stages.json`, `stages/payload.json`, `tests/expected`, or verifier
source files.

Do not preserve raw stage documents for later stages by copying them into
scratch files, summaries, caches, or hidden memory files. A downstream-task
stage is closed-book with respect to raw app-log documents: use only the
currently revealed task JSON, the conversation context, and the memory substrate
allowed by the selected eval mode.
