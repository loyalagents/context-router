You are working in `/app`.

This is step 4 of 4. The packet documents are no longer available. Fill the
forms using only the memory/state allowed by the selected eval mode.

Read:

- `forms/i-9.schema.json`
- `forms/fw4.schema.json`
- `forms/direct-deposit-sf1199a-24.schema.json`
- `forms/onboarding-audit.schema.json`

Write:

- `outputs/forms/i-9.json`
- `outputs/forms/fw4.json`
- `outputs/forms/direct-deposit-sf1199a-24.json`
- `outputs/forms/onboarding-audit.json`

Each output file must use this shape:

```json
{
  "schemaVersion": 1,
  "taskId": "maya-packet-hard-over-time-v1-formfill",
  "formId": "i-9",
  "fields": {},
  "abstentions": {},
  "notes": []
}
```

Use the exact field keys listed in each form schema. Use booleans for boolean
fields. Use strings for string fields. If an optional field is not supported by
the retained state, leave it out of `fields` and optionally explain under
`abstentions`.
