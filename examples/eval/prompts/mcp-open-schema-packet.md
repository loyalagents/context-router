# MCP Open-Schema Packet Memory Ingestion Eval

Use the configured MCP server named `{{MCP_SERVER}}`.

Packet:
- user id: `{{USER_ID}}`
- corpus id: `{{CORPUS_ID}}`
- schema mode: `open`
- form mode: `backend`

Scenarios that will be filled after this one ingestion:
{{SCENARIO_LIST}}

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
- This is a shared user dossier for multiple forms. Store durable facts broadly across identity, address, tax, work authorization, employment, and direct deposit.
- Reuse existing definitions when their meaning fits the document-supported fact you need to store.
- Create useful definitions and slugs when no existing definition fits, then store the supported active value through MCP.
- Prefer clear, stable slugs and descriptions that would make sense outside this one form.
- Store only facts supported by current, relevant documents.
- Do not guess missing values. Leave unsupported values absent.
- Do not use profile files, validation reports, fact-storage maps, expected snapshots, score reports, or any other answer-key artifacts.
- Do not fill any form directly. Backend form fill runs after this shared memory ingestion.
- When you are done, print `{{COMPLETION_MARKER}}`.
