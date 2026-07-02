Memory mode: context-only.

Use only the current task files and the current agent conversation context. Do
not create or rely on `/app/memory.md`, scratch summaries, note files, or any
other durable external memory.

Do not copy raw stage documents into any durable file for later stages. During a
downstream-task stage, answer only from the current conversation context and the
currently revealed task file. The run validator will reject context-only runs
that create memory files, scratch notes, summaries, or other durable state under
`/app`.

For staged tasks, you may rely on facts you already read earlier in this same
agent session. Process stages in order. If a stage asks for an answer, update
the requested output while preserving earlier checkpoint answers.
