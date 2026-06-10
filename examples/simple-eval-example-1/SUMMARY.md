# Simple Eval Example 1 Summary

## What This Example Captures

This folder records a first full known-schema document-ingestion eval run for:

- user: `alex-i9-test`
- corpus: `realistic`
- run id: `20260607-214329`
- flow: generated realistic corpus -> validate corpus -> ingest documents -> auto-apply returned suggestions -> export active stored preferences -> score database storage

The final ingestion run completed mechanically:

```text
eval ingest-documents passed
documents=10 uploaded=10 applied=51
```

That means the e2e harness worked: all planned documents uploaded, backend analysis returned successfully, auto-apply did not hit hard failures, stored preferences were exported, and database scoring completed.

## Files In This Example

- `generated-files/`
  - Snapshot of the eval fixture inputs used for the final run.
  - Includes `profile.yaml`, `seed-preferences.generated.json`, and the realistic corpus under `generated-files/corpus/`.

- `intermediary-files/final-ingestion-run/`
  - `ingestion-run.json`: document-by-document upload/apply summary.
  - `stored-preferences.json`: exported active backend memory after ingestion.
  - `database-score-report.json`: deterministic score against fixture truth.

- `COMMANDS.md`
  - Commands used to reproduce the successful run and inspect the result.

## What Worked

- The known-schema ingestor successfully reset backend memory, ensured existing target definitions, uploaded all 10 documents, and auto-applied suggestions.
- The exporter produced a scorer-compatible `stored-preferences.json`.
- The database scorer produced a deterministic report.
- The ingestor correctly skipped non-storable `null` suggestions instead of trying to write active preferences with null values.
- The intentionally missing phone path was visible in the score, which is useful for abstention evaluation.

## What Did Not Work Well

The pipeline ran, but extraction quality was not yet good.

Final database score summary:

```json
{
  "knownPresentTotal": 22,
  "knownPresentCorrect": 15,
  "knownPresentWrongSlug": 1,
  "knownPresentWrongValue": 6,
  "knownPresentMissing": 0,
  "valueRecoveryRate": 0.727,
  "acceptedSlugAccuracy": 0.682,
  "acceptedSlugRecoveryRate": 0.682,
  "intentionallyMissingTotal": 1,
  "missingAbsentCorrect": 0,
  "missingHallucinated": 1,
  "missingAbstentionRate": 0
}
```

Important failures:

- The newsletter/noise document overwrote target facts with community-office values:
  - `address.current.city`: expected `Portland`, stored `Oakmont`.
  - `address.current.street`: expected `7428 Evergreen Terrace`, stored `123 Main Street`.
  - `contact.email`: expected `alex.rivera@example.test`, stored `announcements@example.test`.
  - `identity.legalName`: expected `Alex Jordan Rivera`, stored `Community Management Team`.
- The backend stored `profile.phone = "Not on file"`, so the intentionally missing `contact.phone` fact was scored as hallucinated.
- `workAuthorization.citizenshipStatus` was semantically close but string-mismatched:
  - expected `alien authorized to work`
  - stored `An alien authorized to work`
- `identity.otherLastNames` was found under `profile.other_last_names`, but not under an accepted scorer slug for that fact.

## JSON Upload Caveat

The utility account export was originally a `.json` document. Uploading it as `application/json` repeatedly returned:

```text
status: ai_error
statusReason: AI service unavailable - please try again later
```

The same file contents worked when uploaded as `text/plain`. For this example, document 005 was changed to:

```text
documents/address-contact/005-utility-account-export.txt
```

This is a local workaround for documenting the e2e eval flow. The backend should still be fixed or hardened so JSON uploads either work as text-like documents or fail with a clearer unsupported-MIME error.

## Takeaway

The eval harness is now useful. It can run the full known-schema ingestion path and produce actionable scoring output. The first complete run shows the next backend/product problem: suggestion application is too willing to let low-authority noise or stale artifacts overwrite high-authority current facts.

