# Elena Marquez

Synthetic form-fill evaluation user for the I-9 fixture at
`examples/eval/forms/i-9/form.pdf`.

## Fixture Files

- `profile.yaml` is the authoritative source of Elena's local eval facts.
- `seed-preferences.generated.json` is generated from `profile.yaml`.
- `corpora/realistic/manifest.json` inventories the realistic document corpus.
- `corpora/realistic/documents/` contains the synthetic source documents.
- `../../scenarios/elena-marquez-i9-section1/` contains the first I-9 scenario
  fixture for this user.

## Expected I-9 Behavior

The fixture provides enough source information for employee-owned I-9 Section 1
identity, address, date of birth, SSN, email, and U.S. citizen status facts
after the realistic corpus is processed. The V1 I-9 field map intentionally
leaves the unlabeled citizenship checkbox widgets unmapped until field labeling
is made more reliable.

`contact.phone` is intentionally declared as `null` in `profile.yaml` and is
listed in the corpus manifest's `intentionallyMissing` array. The I-9 telephone
field should be left blank rather than guessed or filled with a placeholder.

Work-authorization identifiers that do not apply to Elena's U.S. citizen status
are also declared as `null` in `profile.yaml`. Those fields remain mapped in
the form-scoped I-9 field map so a future non-citizen fixture can reuse the same
map with concrete values.

Employee signature/date and all Section 2 employer review fields are outside
the employee-memory scenario and should be skipped.

## Safety Notes

All identity values are synthetic. The SSN-shaped value is reserved fake data
for local fixtures only. Do not use this fixture as compliance guidance.
