# First Fixture Slice Implementation Summary

- Status: implemented setup slice
- Last updated: 2026-06-20
- Scope: form/profile groundwork before `packet-small`

## What This Slice Did

This slice prepared the evaluation fixtures needed before building a shared
multi-form dossier. It did not create the `packet-small` corpus; that is covered
separately in `../small-packet/implementation-summary.md`.

Implemented:

- chose the first new-hire packet forms: I-9, W-4, and direct deposit;
- added the official SF 1199A direct-deposit fixture under
  `examples/eval/forms/direct-deposit-sf1199a-24/`;
- added minimal field maps for W-4 and SF 1199A;
- created the `maya-chen-newhire` profile as the packet subject;
- added tax, banking, employment, identity, contact, work-authorization, and
  form-ready address facts for Maya;
- kept Maya truth-only for open-schema work by omitting `seedPreferences[]`;
- documented that open-schema packet fixtures can rely on corpus evidence
  instead of generated known-schema seeds.

## Form Map Shape

I-9:

- reused the existing `i-9` field map;
- covers Section 1 identity, address, email, SSN, and citizenship-status fields;
- leaves attestation, signature, date, and employer-side fields skipped.

W-4:

- has 48 mapped PDF fields;
- maps 8 field entries to facts and skips 40;
- covers first name, last name, SSN, formatted address, and filing status;
- skips signature, employer-only, worksheet, computed, and certification fields.

SF 1199A direct deposit:

- has 213 mapped PDF fields;
- maps 11 field entries to facts and skips 202;
- covers payee/person-entitled name, account holder name, address, account
  type, bank name, and nullable phone;
- scores only the first copy of the repeated form pages;
- skips routing and account split-digit boxes for v1 because they need either a
  digit-position renderer or explicit per-digit facts.

## Maya Profile Shape

Maya is the first packet subject:

```text
userId: maya-chen-newhire
name: Maya Lin Chen
forms: i-9, fw4, direct-deposit-sf1199a-24
```

Important profile choices:

- `contact.phone` is `null` so the packet can test abstaining from unsupported
  phone fields;
- `address.current.streetLine` and `address.current.cityStateZip` are stored as
  form-ready address facts for simple W-4 and direct-deposit mapping;
- W-4 values stay simple: filing status is mapped, while computed worksheet
  values are skipped;
- banking includes routing and account numbers even though the SF 1199A v1 map
  does not fill the split-digit boxes yet.

## Deferred From This Slice

Deferred intentionally:

- authoring packet-small documents;
- adding packet-small one-form scenarios;
- running live open-schema ingestion or direct baselines;
- packet-level reporting;
- routing/account split-digit rendering for SF 1199A;
- larger `packet-medium` corpus generation.

## Follow-Up

The next slice was `packet-small`: author a small realistic dossier for Maya,
validate it, add one-form scenarios, and prepare the live stored-memory versus
direct open-schema comparison.
