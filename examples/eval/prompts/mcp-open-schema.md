# MCP Open-Schema Memory Ingestion Eval

Use the configured MCP server named `{{MCP_SERVER}}`.

Scenario:
{{SCENARIO_PROMPT}}

Form:
- id: `{{FORM_ID}}`
- schema mode: `{{SCHEMA_MODE}}`
- form mode: `{{FORM_MODE}}`

Corpus root:
`{{DOCUMENTS_ROOT}}`

Safe document index:
`documents.json`

Documents:
{{DOCUMENT_LIST}}

Instructions:
- Read only the corpus documents listed above from the local filesystem, relative to the corpus root.
- You may use `documents.json` only as a safe index of those same documents.
- Use the MCP server to inspect the currently available memory/preference schema.
- Reuse existing definitions when their meaning fits the document-supported fact you need to store.
- Create useful definitions and slugs when no existing definition fits, then store the supported active value through MCP.
- Prefer clear, stable slugs and descriptions that would make sense outside this one form.
- Store only facts supported by current, relevant documents.
- Do not guess missing values. Leave unsupported values absent.
- Do not use profile files, validation reports, fact-storage maps, expected snapshots, score reports, or any other answer-key artifacts.
- Do not fill the form directly. Backend form fill runs after memory export.
- When you are done, print `{{COMPLETION_MARKER}}`.
