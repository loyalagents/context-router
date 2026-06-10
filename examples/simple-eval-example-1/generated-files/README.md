# Generated Files

This folder contains a snapshot of the eval inputs used by the final successful ingestion run.

Contents:

- `profile.yaml`: Alex's eval profile.
- `seed-preferences.generated.json`: generated seed preference mapping for the profile.
- `corpus/manifest.json`: V2 realistic corpus manifest.
- `corpus/validation-report.json`: corpus validation report.
- `corpus/documents/`: the 10 generated source artifacts uploaded during ingestion.

Note: `corpus/documents/address-contact/005-utility-account-export.txt` contains JSON-like utility export content but uses `.txt` for this example because uploading the same content as `application/json` hit a backend/Vertex MIME handling issue.

