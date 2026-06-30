This is a continuous-session Harbor task for native DynamicMem TCE.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

1. Run `/app/next_stage` to reveal the first chronological raw app-log batch.
2. Update the memory/state allowed by the selected eval mode.
3. Run `/app/next_stage` again to reveal the later raw app-log batch.
4. Update memory/state again.
5. Run `/app/next_stage` again to reveal the native DynamicMem task queries.
6. Write `outputs/prediction.json` using the DynamicMem prediction contract.

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts.
