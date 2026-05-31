# Elena Marquez

Synthetic form-fill evaluation user for the I-9 fixture at
`examples/eval/forms/i-9/form.pdf`.

## Fixture Files

- `profile.yaml` is the authoritative source of Elena's local eval facts.
- `seed-preferences.generated.json` is generated from `profile.yaml`.
- `corpora/template-smoke/` is the deterministic scaffold-generated corpus
  used to smoke-test template rendering.
- `../../scenarios/elena-marquez-i9-template-smoke/` contains the generated
  scenario skeleton for the template-smoke corpus.

## Expected I-9 Behavior

The fixture provides enough profile and template-smoke source information for
employee-owned I-9 Section 1 identity, address, date of birth, SSN, email, and
U.S. citizen status facts. The V1 I-9 field map intentionally leaves the
unlabeled citizenship checkbox widgets unmapped until field labeling is made
more reliable.

`contact.phone` is intentionally declared as `null` in `profile.yaml` and is
left out of generated seed preferences. The I-9 telephone field should be left
blank rather than guessed or filled with a placeholder.

Work-authorization identifiers that do not apply to Elena's U.S. citizen status
are also declared as `null` in `profile.yaml`. Those fields remain mapped in
the form-scoped I-9 field map so a future non-citizen fixture can reuse the same
map with concrete values.

Employee signature/date and all Section 2 employer review fields are outside
the employee-memory scenario and should be skipped.

## Safety Notes

All identity values are synthetic. The SSN-shaped value is reserved fake data
for local fixtures only. Do not use this fixture as compliance guidance.
