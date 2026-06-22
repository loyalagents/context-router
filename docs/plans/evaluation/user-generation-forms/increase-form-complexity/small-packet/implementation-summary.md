# Packet-Small Implementation Summary

- Status: implemented and live-verified as the first open-schema packet slice
- Last updated: 2026-06-22
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
- updated the field-policy test expectation for the new address storage slugs;
- clarified the I-9 email field intent so Section 1 uses the employee
  personal/contact email, not employer-issued work email;
- changed Maya's fixture emails to make the personal/work distinction clearer:
  `maya.chen@gmail.test` and `maya.chen@pacificledger.test`.

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
node --test --test-name-pattern "buildFormFillFieldPolicies covers packet-small W-4 and direct-deposit slugs" examples/eval/scripts/fill-form.test.mjs
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
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

Live packet-small run completed successfully.

Artifact root:

```text
/private/tmp/packet-small-clear-email-domains-20260622T010738Z
```

MCP stored-memory packet result:

```text
shared memory score: 24/24 known facts recovered
missing facts:       2/2 correctly absent
I-9 form:            12/12 known fields correct
W-4 form:             6/6 known fields correct
direct deposit form:  9/9 known fields correct
```

Direct open-schema no-memory baseline result from the same artifact root:

```text
I-9 form:            12/12 known fields correct
W-4 form:             6/6 known fields correct
direct deposit form:  9/9 known fields correct
```

Direct extraction diagnostics:

```text
I-9 extraction memory score:            24/24 known facts recovered
W-4 extraction memory score:            22/24 known facts recovered
direct-deposit extraction memory score: 24/24 known facts recovered
```

The two W-4 direct extraction misses were `banking.accountNumber` and
`identity.middleInitial`. They did not affect the W-4 form score because those
facts are not used by the mapped W-4 fields.

Interpretation: packet-small now shows parity between stored-memory MCP and
direct no-memory form filling on small context. The stored-memory path has the
stronger shared packet-level memory signal: one shared memory snapshot recovered
all 24 known packet facts before filling all three forms.

## Known Limitations

- This is a small correctness/plumbing corpus, not the harder context-size
  benchmark.
- Results are `N=1` and should be treated as directional until repeat runs are
  added.
- Direct deposit routing and account number facts are present in the dossier,
  memory score, and direct extraction diagnostics, but SF 1199A split
  one-character digit boxes remain skipped/not scored in the v1 form map.
- `sourceSlugAgreementRate` is diagnostic only for open-schema runs. Values can
  be correct under novel active slugs, so it should not be used as a headline
  metric.
- `status: pass` in packet artifacts means the pipeline completed. Use the
  memory and form score summaries to judge quality.
- The direct baseline has a 200K-character evidence cap. This is not blocking
  for packet-small or the planned packet-medium size, but it matters for future
  larger tiers.
- Packet-level reporting exists as a basic wrapper artifact, but it should get a
  clearer `qualitySummary` before packet-medium runs.

## Next Step

Before building `packet-medium`:

1. add a clearer packet `qualitySummary` to `packet-evaluation-run.json`;
2. checkpoint the packet-small fixture and runner changes;
3. plan packet-medium from the now-clean packet-small baseline.
