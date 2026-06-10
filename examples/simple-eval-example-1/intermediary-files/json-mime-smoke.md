# JSON MIME Smoke Test

During testing, the utility account export failed when uploaded as JSON:

```bash
curl -sS -X POST "$EVAL_BACKEND_URL/api/preferences/analysis" \
  -H "Authorization: Bearer $EVAL_AUTH_TOKEN" \
  -F "file=@examples/eval/users/alex-i9-test/corpora/realistic/documents/address-contact/005-utility-account-export.json;type=application/json" \
  | jq .
```

Observed result:

```json
{
  "suggestions": [],
  "filteredSuggestions": [],
  "status": "ai_error",
  "statusReason": "AI service unavailable - please try again later",
  "filteredCount": 0
}
```

The same file content worked when uploaded as text:

```bash
cp examples/eval/users/alex-i9-test/corpora/realistic/documents/address-contact/005-utility-account-export.json \
  /private/tmp/005-utility-account-export.txt

curl -sS -X POST "$EVAL_BACKEND_URL/api/preferences/analysis" \
  -H "Authorization: Bearer $EVAL_AUTH_TOKEN" \
  -F "file=@/private/tmp/005-utility-account-export.txt;type=text/plain" \
  | jq .
```

Observed result:

```text
status: success
```

The successful text upload returned useful suggestions for profile email, address fields, home address, citizenship status, and communication preferences.

Conclusion: this looks like a backend/Vertex MIME handling issue rather than invalid fixture content. The example uses `.txt` for document 005 so the e2e known-schema ingestion flow can be documented while the backend issue remains tracked separately.

