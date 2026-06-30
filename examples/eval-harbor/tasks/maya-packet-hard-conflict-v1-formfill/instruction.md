You are working in `/app`.

Fill three JSON forms for Maya Chen using only the packet-hard-conflict-v1 documents in
this workspace.

Read:

- `documents.json` for the safe document index.
- `docs/` for the packet documents.
- `forms/i-9.schema.json`
- `forms/fw4.schema.json`
- `forms/direct-deposit-sf1199a-24.schema.json`

Write:

- `outputs/forms/i-9.json`
- `outputs/forms/fw4.json`
- `outputs/forms/direct-deposit-sf1199a-24.json`

Each output file must use this shape:

```json
{
  "schemaVersion": 1,
  "taskId": "maya-packet-hard-conflict-v1-formfill",
  "formId": "i-9",
  "fields": {},
  "abstentions": {},
  "notes": []
}
```

Use the exact field keys listed in each form schema. Use booleans for boolean
fields. Use strings for string fields.

Use only information supported by current, relevant documents for Maya Chen. Do
not use profile files, manifests, validation reports, field maps, expected
answers, score reports, or any other answer-key artifacts.

If a schema lists an unsupported field and the packet does not support a value,
leave it out of `fields` and optionally add a short explanation under
`abstentions`.
