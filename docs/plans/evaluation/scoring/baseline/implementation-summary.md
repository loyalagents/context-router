# Direct-Document Form Fill Baseline Implementation Summary

## Summary

Implemented `pnpm eval:fill-form-from-docs`, an eval-only baseline runner that
fills a form directly from local corpus documents without calling the backend or
using DB memory.

The runner reads the scenario form metadata, reads every manifest document from
the corpus root, sends one structured evidence packet to Vertex, validates the
returned fill actions locally, fills the PDF with backend `pdf-lib`, writes the
existing `filled-form.json` snapshot shape, and can optionally write a filled
PDF, response/debug artifact, and form score report.

## Behavior

- Uses text-like evidence files from the corpus manifest: `.txt`, `.md`,
  `.yaml`, `.yml`, and `.json`.
- Defaults `--documents-root` to
  `examples/eval/users/<scenario user>/corpora/<scenario corpus>`.
- Sends PDF field metadata and labeled evidence document text to Vertex.
- Does not send profile truth, expected field-map values, seed preferences,
  fact contracts, validation reports, or DB preferences to the prompt.
- Requires non-`SKIP` actions to cite `doc:<documentId>` source refs.
- Treats invalid, duplicate, low-confidence, unknown-field, bad-option, and
  unknown-source-ref actions as skipped fields with diagnostics.
- Reuses existing form scoring; `sourceSlugAgreementRate` is documented as not
  meaningful for this baseline because source refs are document refs, not DB
  slugs.

## Command

```bash
pnpm eval:fill-form-from-docs \
  --scenario alex-i9-realistic \
  --model gemini-2.5-pro \
  --out /private/tmp/alex-direct-doc-baseline/filled-form.json \
  --filled-pdf-out /private/tmp/alex-direct-doc-baseline/filled-form.pdf \
  --response-out /private/tmp/alex-direct-doc-baseline/response.json \
  --form-score-report /private/tmp/alex-direct-doc-baseline/form-score-report.json
```

## Verification

Ran:

```bash
node --test examples/eval/scripts/fill-form-from-docs.test.mjs examples/eval/scripts/scoring/form.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Targeted tests passed.
- `pnpm eval:test` passed with 214 tests.
- `pnpm eval:validate` passed with 0 errors and the existing 11 warning-only
  Alex realistic corpus realism warnings.
- `pnpm eval:verify` passed.

## Follow-Ups

- Run a live direct-document baseline smoke for `alex-i9-realistic` and compare
  its form score against the known-schema E2E score.
- Decide whether the response artifact should get a formal schema after the
  live baseline proves useful.
- Consider a future one-at-a-time no-DB extraction baseline only if the direct
  baseline and known-schema E2E comparison leaves ambiguity.
