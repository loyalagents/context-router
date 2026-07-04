You are working in `/app`.

This is a staged memory task. Repeat this loop until `/app/next_stage` says no
more stages are available:

1. Run `/app/next_stage`.
2. Read the revealed stage instruction and files under `/app/current_stage`.
3. During `memory-update` stages, remember useful facts for later using your
   configured memory substrate.
4. During the `downstream-task` stage, write `outputs/permissions-report.json`
   using the requested JSON contract.

Do not inspect hidden expected answers or verifier files.
