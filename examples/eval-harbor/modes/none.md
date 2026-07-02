Memory mode: none.

Use only the files already present in the task workspace. Do not create or rely
on any external memory file.

Do not copy raw task documents into durable notes, summaries, caches, or scratch
files for later steps. The run validator will reject none-mode runs that create
memory files or other durable state outside the required output path.

For a single-step task, write the final output to the path required by the task
instruction. For a multi-step task, follow the current step instruction only. Do
not create notes, memory files, summaries, or other durable state for later
steps.
