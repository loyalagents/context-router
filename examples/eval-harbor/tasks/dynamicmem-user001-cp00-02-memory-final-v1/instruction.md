This is a continuous-session Harbor staged-memory task backed by DynamicMem.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

1. Run `/app/next_stage` to reveal the next stage.
2. If the stage is `memory-update`, read `documents.json` and `docs/`, then
   update only the allowed memory/state.
3. If the stage is `downstream-task`, read `dynamicmem-task.json`, then write
   `outputs/prediction.json`.
4. Repeat until `/app/next_stage` says no more stages are available.

Stages can have two roles:

- `memory-update`: read only the newly revealed raw app-log delta and update the
  memory/state allowed by the selected eval mode. Do not create or modify
  `outputs/prediction.json` in these stages.
- `downstream-task`: no source logs are revealed. Read `dynamicmem-task.json`
  and answer using retained memory from earlier stages.

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts. In particular, do not read `/tests`,
`/data/stages.json`, `stages/payload.json`, `tests/expected`, or verifier
source files.

Do not preserve raw stage documents for later stages by copying them into
scratch files, summaries, caches, or hidden memory files. A downstream-task stage
is closed-book with respect to raw app-log documents: use only the currently
revealed `dynamicmem-task.json`, the conversation context, and the memory
substrate allowed by the selected eval mode.
