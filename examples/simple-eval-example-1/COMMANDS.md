# Commands

## Successful Final Run

```bash
USER_ID=alex-i9-test
CORPUS=realistic
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_ROOT="/private/tmp/${USER_ID}-${CORPUS}-${RUN_ID}-ingest"

mkdir -p "$RUN_ROOT"

pnpm eval:ingest-documents \
  --user "$USER_ID" \
  --corpus "$CORPUS" \
  --documents-root "examples/eval/users/$USER_ID/corpora/$CORPUS" \
  --reset-memory \
  --export-stored-preferences "$RUN_ROOT/stored-preferences.json" \
  --database-score-report "$RUN_ROOT/database-score-report.json" \
  --out "$RUN_ROOT/ingestion-run.json" \
  --run-id "$RUN_ID"
```

The captured successful run used:

```text
RUN_ID=20260607-214329
RUN_ROOT=/private/tmp/alex-i9-test-realistic-20260607-214329-ingest
```

The temp artifacts from that run were copied into:

```text
examples/simple-eval-example-1/intermediary-files/final-ingestion-run/
```

## Useful Inspection Commands

```bash
jq '.status, .summary' \
  examples/simple-eval-example-1/intermediary-files/final-ingestion-run/ingestion-run.json

jq '.documents[] | select(.error)' \
  examples/simple-eval-example-1/intermediary-files/final-ingestion-run/ingestion-run.json

jq '.summary' \
  examples/simple-eval-example-1/intermediary-files/final-ingestion-run/database-score-report.json

jq '.knownPresent[] | select(.classification != "known_present_correct")' \
  examples/simple-eval-example-1/intermediary-files/final-ingestion-run/database-score-report.json

jq '.intentionallyMissing[] | select(.classification != "missing_absent_correct")' \
  examples/simple-eval-example-1/intermediary-files/final-ingestion-run/database-score-report.json
```

## Corpus Validation

```bash
pnpm eval:validate --user alex-i9-test --corpus realistic --write-report
```

At capture time, validation passed with warning-only realism issues.

