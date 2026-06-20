# First Few Steps Implementation Summary

- Status: implemented first fixture slice
- Last updated: 2026-06-20
- Scope: first multi-form packet setup before `packet-small` corpus generation

## What Changed

The first slice sets up the packet subject and form fixtures without building a
more complex runner.

Implemented:

- Added the packet subject `maya-chen-newhire`.
- Added an official SF 1199A direct-deposit form fixture.
- Added a minimal W-4 field map.
- Added a minimal SF 1199A field map.
- Made `seedPreferences[]` optional for open-schema-first profiles.
- Added profile-only validation so truth-only users are validated before they
  have corpora.
- Tightened fixture loading so seed-backed profiles still require
  `seed-preferences.generated.json`.

## Key Design Decisions

Maya is a truth fixture, not a known-schema seed fixture.

`examples/eval/users/maya-chen-newhire/profile.yaml` intentionally omits
`seedPreferences[]`. This keeps the packet aligned with the real goal:
open-schema ingestion from documents. Known-schema seed bridging remains
available for older/debug fixtures, but it is no longer required for packet
profiles.

Address fields use simple form-ready facts.

Maya keeps both atomic address facts and form-ready values:

- `address.current.streetLine`
- `address.current.cityStateZip`

This avoids adding derived-field rendering before the first packet works.

Direct deposit is realistic but intentionally narrow in v1.

The SF 1199A map covers the first form copy only. It maps payee identity,
address, account type, financial institution name, account title, and nullable
phone. It skips duplicate copies, certifications, signatures, payment-type
checkboxes, claim/allotment fields, and agency-only fields.

Routing and account numbers are present in Maya's profile but not scored yet
because SF 1199A represents them as one-character boxes. Mapping those cleanly
should wait for either a digit-position renderer or explicit form-ready digit
facts.

## Files Added Or Updated

Packet subject:

- `examples/eval/users/maya-chen-newhire/profile.yaml`

Form fixtures:

- `examples/eval/forms/direct-deposit-sf1199a-24/form.pdf`
- `examples/eval/forms/direct-deposit-sf1199a-24/fields.generated.json`
- `examples/eval/forms/direct-deposit-sf1199a-24/fake-user-requirements.generated.md`
- `examples/eval/forms/direct-deposit-sf1199a-24/field-map.json`
- `examples/eval/forms/fw4/field-map.json`
- `examples/eval/forms/fw4/fields.generated.json`

Tooling and docs:

- `examples/eval/schemas/profile.schema.json`
- `examples/eval/scripts/validate.mjs`
- `examples/eval/scripts/generate-seed-preferences.mjs`
- `examples/eval/scripts/eval-runner/fixtures.mjs`
- `examples/eval/scripts/eval-runner/run.test.mjs`
- `examples/eval/README.md`
- `examples/eval/PLAYBOOK.md`
- `examples/eval/forms-notes.md`
- `docs/plans/evaluation/user-generation-forms/increase-form-complexity/orchestration.md`

## Validation

Commands run:

```bash
pnpm eval:derive-seeds
pnpm eval:validate --user maya-chen-newhire
pnpm eval:validate --form fw4
pnpm eval:validate --form direct-deposit-sf1199a-24
pnpm eval:validate
node --test examples/eval/scripts/eval-runner/run.test.mjs
pnpm eval:test
```

Results:

- Maya validates as a profile-only user.
- W-4 and direct-deposit form validation pass.
- Full eval validation passes with the existing Alex realistic-corpus warnings.
- Full eval script tests pass.

## Remaining Caveats

- SF 1199A routing/account digit boxes are skipped in v1.
- The W-4 first-name field still maps `identity.firstName`, not a joined first
  name plus middle initial value.
- No packet corpus exists yet, so the next meaningful validation gate is
  `packet-small`.
- No live open-schema run has been performed for the packet yet.

## Next Step

Build `packet-small`: a 6-10 document corpus for Maya that covers I-9, W-4, and
direct-deposit facts from realistic source documents, then add one-form
scenarios sharing that same corpus.
