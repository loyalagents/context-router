You are working in `/app`.

Read `docs/employee-packet.md` and fill the JSON form described by
`forms/new-hire.schema.json`.

Write the completed form to:

```text
outputs/forms/new-hire.json
```

Use only information supported by the packet. Do not invent missing values.

The output must use this top-level shape:

```json
{
  "schemaVersion": 1,
  "taskId": "smoke-formfill",
  "formId": "new-hire",
  "fields": {
    "employee.fullName": "...",
    "employee.email": "...",
    "employee.phone": "...",
    "employee.address.street": "...",
    "employee.address.city": "...",
    "employee.address.state": "...",
    "employee.address.postalCode": "...",
    "employment.startDate": "..."
  },
  "abstentions": {},
  "notes": []
}
```

Keep field paths exactly as keys under `fields`.
