# Packet-Small Implementation Summary

- Status: implemented fixture slice; live run pending local backend/auth/model
  setup
- Last updated: 2026-06-20
- Scope: `packet-small` corpus and one-form scenarios for
  `maya-chen-newhire`

## What Changed

Created the first shared-dossier packet for Maya Chen:

- added `examples/eval/users/maya-chen-newhire/corpora/packet-small/`;
- authored 8 realistic source documents, about 6.5 KB total source text;
- added a V2 `realistic-generated` corpus manifest;
- wrote `validation-report.json`;
- added one-form scenarios for I-9, W-4, and SF 1199A direct deposit;
- normalized `identity.otherLastNames` to `null` for the blank I-9 optional
  field;
- expanded the open-schema fact storage map for address, DOB, middle initial,
  tax filing status, and banking facts;
- expanded high-confidence document validation so packet-specific address, tax,
  and banking facts are checked in source bodies;
- updated the field-policy test expectation for the new address storage slugs.

## Final Corpus Shape

Corpus:

```text
user: maya-chen-newhire
corpus: packet-small
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: 8
source bytes: 6,464
```

Documents:

- driver license OCR;
- SSN card OCR;
- HR onboarding profile export;
- I-9 Section 1 draft export;
- W-4 withholding setup export;
- direct-deposit portal confirmation;
- payroll/direct-deposit instructions;
- other-employee sample packet.

Scenarios:

- `maya-chen-newhire-i9-packet-small`;
- `maya-chen-newhire-fw4-packet-small`;
- `maya-chen-newhire-direct-deposit-packet-small`.

`contact.phone` is intentionally missing for I-9 and direct deposit. The corpus
keeps phone-like source text out of document bodies for v1.

## Verification

Passed:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-small --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-small
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-small
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-small
node --test examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/validate.test.mjs
node --test --test-name-pattern "buildFormFillFieldPolicies derives policies from field and storage maps" examples/eval/scripts/fill-form.test.mjs
pnpm eval:test
```

The committed packet-small validation report has:

```text
errors: 0
warnings: 0
documentsChecked: 8
factsProvenPresent: 47
factsMissing: 0
unsupportedDeclaredFacts: 0
```

## Live-Run Status

Not run in this environment.

Readiness check results:

- local backend health check at `http://localhost:3000/health` could not
  connect;
- `EVAL_BACKEND_URL`, `EVAL_GRAPHQL_URL`, `EVAL_AUTH_TOKEN`, and
  `EVAL_MODEL_LABEL` were unset;
- GCP/Vertex env vars checked here were unset.

This means the fixture slice is validated, but the open-schema stored-memory run
and direct open-schema no-memory baselines still need to be run in a configured
local or remote eval environment.

## Known Limitations

- This is a small correctness/plumbing corpus, not the harder context-size
  benchmark.
- Direct deposit routing and account number facts are present in the dossier and
  storage map, but SF 1199A split digit boxes remain skipped in the form map.
- `N=1` remains the first target once live runs are configured.
- Packet-level reporting is not implemented yet.

## Next Step

Run the live `packet-small` comparison in a configured environment:

1. reset Maya's memory;
2. run open-schema memory setup once on `packet-small`;
3. fill I-9, W-4, and direct deposit from that same memory;
4. run `eval:direct-open-schema` once per scenario;
5. compare stored-memory versus direct no-memory results before building
   `packet-medium`.
