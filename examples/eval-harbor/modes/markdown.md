Memory mode: markdown.

Use `/app/memory.md` as a simple external memory file for durable facts you
discover while reading the task documents. Keep it concise and task-grounded.

Do not create any other durable memory, scratch note, summary, cache, or copied
raw-document file. During a downstream-task stage, answer only from
`/app/memory.md`, the current conversation context, and the currently revealed
task file. The run validator will reject markdown runs that store durable state
outside `/app/memory.md`.

For a staged task, update `/app/memory.md` whenever new information is revealed.
If a stage asks for an answer, update the requested output while preserving
earlier checkpoint answers. Do not use any other durable state file.
