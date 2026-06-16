# PR3 Follow-Up Bug Failure Improvement

- Status: implemented follow-up
- Last updated: 2026-06-16

## Bug

After the PR3 follow-up, live known-schema E2E showed a flash-lite-only failure.
The model read this YAML comment as a real address value:

```yaml
address: # Address collection pending task completion
```

It proposed that status text as multiple address values, including
`eval.address.current.postal_code`, and known-schema auto-apply overwrote the
correct active value `97214`. Form fill then failed when the bad value reached a
short PDF ZIP field.

The important product concern is that document analysis accepted absence/status
text as a durable preference value. The eval harness correctly made the failure
visible.

## Options Considered

- Prompt improvement: chosen for this pass. The prompt now explicitly says that
  nulls, blank fields, YAML/JSON comments, placeholders, workflow status, and
  task-state prose are evidence of absence, not preference values. It also asks
  for stronger evidence before replacing a non-empty current value.
- Better terminal failure detail: chosen for this pass. Failed form-fill
  responses now preserve the generic warning and add a sanitized stage-specific
  detail so eval artifacts explain what failed.
- Heuristic status-value filtering: deferred. A small product invariant like
  "absence/status markers are not values" may still be useful, but broad phrase
  filters can become brittle and can make eval quality look better than the
  underlying extraction behavior.
- Manifest contract blocking: deferred. Blocking suggestions outside a
  document's declared fact contract would have stopped this known-schema run,
  but it uses eval truth and can become benchmark leakage. This may become a
  diagnostics-only warning later.
- Write-path backstop: deferred. Rejecting inferred writes globally is stronger
  than needed for this first fix and could affect future user-defined schemas
  where status-like values are legitimate.
- Overwrite warning classifier: deferred. Warnings for suspicious overwrites are
  useful, but defining "suspicious" cleanly requires heuristics. The existing
  overwrite diagnostics already exposed this bug clearly.
- Fact-specific validators: deferred. Postal-code/state/date/email validators
  need either schema metadata or a slug/fact registry. That is larger than this
  prompt and failure-visibility fix.
- Verifier model: future option. A second model could adjudicate risky
  overwrites, but that should be measured separately because it changes the eval
  target from raw extractor quality to extractor plus verifier quality.

## Implemented

- Updated the document-analysis extraction prompt to treat absence/status text
  as non-values and to require clear durable replacement evidence for non-empty
  updates.
- Added stage-aware failed form-fill warnings, for example
  `Form fill failed during pdf_fill: ...`.
- Wrapped PDF field write errors with the action and exact field name before
  they reach the form-fill service.
- Updated eval fill-form terminal errors so CLI output includes the first useful
  backend warning or validation-event message when available.
- Added focused backend and eval tests for the prompt guidance and failure
  detail behavior.

## Revisit If Needed

If flash-lite or another low-cost model still stores absence/status text after
the prompt change, consider adding diagnostics-only undeclared-fact warnings
first. If repeated product-level failures remain, consider a tiny origin-scoped
non-storable value filter for inferred document-analysis suggestions before
adding broader validators or verifier-model adjudication.
