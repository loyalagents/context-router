# MCP Known-Schema Memory Ingestion Eval

Use the configured MCP server named `{{MCP_SERVER}}`.

Scenario:
{{SCENARIO_PROMPT}}

Form:
- id: `{{FORM_ID}}`
- schema mode: `{{SCHEMA_MODE}}`
- form mode: `{{FORM_MODE}}`

Corpus root:
`{{DOCUMENTS_ROOT}}`

Documents:
{{DOCUMENT_LIST}}

Instructions:
- Read only the corpus documents listed above from the local filesystem.
- Use the MCP server to inspect the available memory/preference schema if needed.
- Store supported facts from the listed documents into backend memory through MCP.
- Use existing known-schema definitions; do not invent new definitions for this run.
- Store only facts supported by current, relevant documents.
- Do not guess missing values. Leave unsupported values absent.
- Do not use profile files, validation reports, fact-storage maps, expected snapshots, score reports, or any other answer-key artifacts.
- Do not fill the form directly. Backend form fill runs after memory export.
- When you are done, print `{{COMPLETION_MARKER}}`.
