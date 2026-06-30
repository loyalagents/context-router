Memory mode: markdown.

Use `/app/memory.md` as a simple external memory file for durable facts you
discover while reading the task documents. Keep it concise and task-grounded.

For a single-step task, update memory and write the final output to the path
required by the task instruction. For a multi-step task, update `/app/memory.md`
during ingestion steps and write the final output only when the current step
asks for it. Do not use any other durable state file.
