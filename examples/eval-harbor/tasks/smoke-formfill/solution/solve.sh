#!/bin/sh
set -eu

mkdir -p outputs/forms

cat > outputs/forms/new-hire.json <<'JSON'
{
  "schemaVersion": 1,
  "taskId": "smoke-formfill",
  "formId": "new-hire",
  "fields": {
    "employee.fullName": "Maya Chen",
    "employee.email": "maya.chen@example.com",
    "employee.phone": "+1-415-555-0138",
    "employee.address.street": "240 King Street, Unit 12B",
    "employee.address.city": "San Francisco",
    "employee.address.state": "CA",
    "employee.address.postalCode": "94107",
    "employment.startDate": "2026-07-15"
  },
  "abstentions": {},
  "notes": []
}
JSON
