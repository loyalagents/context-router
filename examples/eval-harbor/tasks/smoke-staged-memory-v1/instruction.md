You are working in `/app`.

This is a tiny staged Harbor smoke task. It is intended to validate live agent
execution, staged reveal, and scoring. It is not intended to measure model
quality.

Repeat this loop until `/app/next_stage` says no more stages are available:

1. Run `/app/next_stage`.
2. If the revealed stage is `memory-update`, read the current stage files and
   retain the facts in this same agent session.
3. If the revealed stage is `downstream-task`, read `dynamicmem-task.json` and
   write `outputs/prediction.json`.

Do not inspect hidden expected answers or verifier files.
