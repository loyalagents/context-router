This is a continuous-session Harbor task for a native DynamicMem checkpoint trajectory.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

1. Run `/app/next_stage` to reveal the next checkpoint stage.
2. Read only that stage's raw app-log delta and `dynamicmem-task.json`.
3. Update the memory/state allowed by the selected eval mode.
4. Add or update that checkpoint's prediction in `outputs/prediction.json`.
5. Repeat until `/app/next_stage` says no more stages are available.

Each revealed stage is an update-and-answer checkpoint. Future checkpoint logs
and future checkpoint tasks are not visible until their stage is revealed.

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts.
