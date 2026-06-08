# Intermediary Files

This folder contains run artifacts produced while executing the known-schema ingestion eval.

Final successful run artifacts live under:

```text
final-ingestion-run/
```

Files:

- `ingestion-run.json`
  - Backend user id.
  - Definition setup summary.
  - Document-by-document upload, suggestion, filtered suggestion, skipped null suggestion, and apply counts.

- `stored-preferences.json`
  - Exported active backend preferences after ingestion.
  - This is the database scorer input.

- `database-score-report.json`
  - Deterministic scoring report comparing stored active preferences against fixture truth.

Also see `json-mime-smoke.md` for the JSON upload issue found during testing.

