# Elena Marquez Realistic Corpus

This folder contains 100 synthetic documents for an I-9 Section 1 demo. The corpus is intentionally mixed: some files contain strong I-9 facts, some contain partial or conflicting facts, and some are noise.

Use `manifest.json` for a machine-readable inventory of which files contain useful facts. The source documents live under `documents/` by category.

## Realism Model

The corpus now has three practical tiers:

- Hero files: richer records with headers, redactions, null fields, audit trails, stale/current cues, email-thread formatting, or policy context.
- Medium files: smaller but plausible source records that repeat or corroborate facts.
- Noise files: realistic unrelated files that should not produce I-9 values.

`manifest.json` annotates each file with `detailTier`, `authority`, `freshness`, and `expectedUse`. Agents should prefer current high-authority records, use stale files only as conflict tests, and obey guardrail files that say Section 2 is out of scope.

## Intentional Missing Value

The telephone value is deliberately absent from every source document and from `../simple/seed-preferences.json`. Some realistic files show this naturally as `phone: null`, `telephone: null`, blank phone fields, or prose stating that no phone was collected. An agent should leave the I-9 telephone field blank rather than guessing or writing a placeholder.

## Expected Scope

Extract employee Section 1 candidate facts only. Skip signatures, employee attestation dates unless explicitly provided for the form run, and all Section 2 employer review fields.

## Categories

- `identity/`: high-signal identity, name, birth date, citizenship, and SSN-like demo facts.
- `address-contact/`: current address and email records.
- `hr-onboarding/`: start date, HR profile, and I-9 process guardrails.
- `payroll-tax/`: payroll-adjacent documents that repeat some identity fields.
- `work-authorization/`: synthetic I-9 document-choice notes and Section 2 skip guardrails.
- `employer-context/`: employer facts that should not be used for employee Section 1 fields.
- `partial-conflicting/`: outdated, incomplete, or conflicting records.
- `noise/`: plausible unrelated files that should not contribute I-9 values.
