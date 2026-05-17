# Elena Marquez

Synthetic form-fill demo user for the I-9 fixture at `examples/form-fill-demo/forms/i-9/form.pdf`.

## Demo Goal

This user is designed to test a two-step workflow:

1. Seed a small baseline from `simple/seed-preferences.json`.
2. Have an agent inspect `realistic/documents/`, extract durable I-9 facts, and then fill Section 1 of the I-9.

## Expected I-9 Behavior

The demo should be able to recover enough information to fill employee Section 1 fields for name, prior last name, address, date of birth, synthetic SSN, email, and U.S. citizen status after the realistic corpus is processed.

The telephone value is intentionally missing from every realistic document and from the seed preferences. The I-9 telephone field should be skipped or left blank.

Employee signature/date and all Section 2 employer review fields should be skipped in this employee-memory demo.

## Corpus Shape

The realistic corpus intentionally mixes polished records, messy exports, stale records, redactions, null fields, email-thread transcripts, and irrelevant files. The richer files are marked in `realistic/manifest.json` with `detailTier`, `authority`, `freshness`, and `expectedUse` metadata so agents can practice choosing current authoritative evidence over stale or noisy files.

## Safety Notes

All identity values are synthetic. The SSN-like value is reserved fake data for demos only. Do not use this fixture as compliance guidance.
