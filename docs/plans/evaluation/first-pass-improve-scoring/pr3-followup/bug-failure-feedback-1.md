# Feedback — Bug Failure Improvement (commit `303ef28`)

Review of the fix described in [`bug-failure-improvement.md`](./bug-failure-improvement.md)
against the failure in [`bug.md`](./bug.md) and the options in
[`bug-brainstorm-1.md`](./bug-brainstorm-1.md).

Focused unit suites pass locally (48/48 across `form-fill-validator`,
`pdf-field-filler`, `pdf-field-extractor`, `preference-extraction`). The new e2e
case `skips overlong text values instead of failing the whole fill` asserts the
exact behavior change end-to-end.

**Verdict: solid, well-scoped first pass. It fully fixes the crash (P2) and improves
diagnostics, but — by explicit choice — only *mitigates* the storage-quality
problem (P1) with a model-dependent prompt. That residual is acknowledged in the
doc; this feedback makes the boundary precise and lists what stays open.**

---

## What changed (as implemented)

1. **maxLength surfaced + guarded.** `pdf-field-extractor` now reads
   `PDFTextField.getMaxLength()` into `PdfFieldMetadata.maxLength`
   (`pdf-field-extractor.service.ts:64`). The validator blocks any `SET_TEXT`
   whose normalized text exceeds it, skips the field, and emits a new
   `pdf_text_max_length_blocked` event with `maxLength`/`valueLength`
   (`form-fill-validator.service.ts:205`).
2. **Shared normalization.** `normalizeTextValueForPdfField` was extracted to
   `pdf-text-value-normalization.ts` and is now used by *both* the validator and the
   filler, so the length measured at validation equals the text the filler writes.
3. **Filler error wrapping.** `pdf-field-filler` wraps every write in try/catch and
   rethrows with action + exact field name and `cause`
   (`pdf-field-filler.service.ts`).
4. **Stage-aware failure detail.** `form-fill.service` tracks a `stage` and returns
   `Form fill failed during <stage>: <sanitized>` (whitespace-collapsed, capped at
   500) on any thrown error.
5. **Eval CLI detail.** `fill-form.mjs` `terminalResponseDetail` surfaces the first
   useful warning / validation-event message in the thrown error for terminal runs.
6. **Prompt guidance.** Extraction prompt now labels nulls / blanks / comments /
   placeholders / workflow-status prose as evidence of absence, names example
   phrases, and asks for clear durable evidence before replacing a non-empty value.

---

## Strengths

- **The crash is genuinely fixed, the right way.** Blocking at *validation* (not the
  filler) means the over-length field is skipped while every other field still fills;
  the e2e returns `status: partial`, `filledCount: 2`, `skippedCount: 1`. This is the
  skip-and-report-don't-truncate behavior recommended in brainstorm option B, and it
  converts a hard run failure into a scoreable miss. Because `partial` is a scorable
  (non-terminal) status in `fill-form.mjs`, the eval scorer will now record the ZIP
  field as a miss instead of aborting the run — the correct signal.
- **maxLength comes from the authoritative source.** Reading `getMaxLength()` off the
  PDF field is more general than the field-policy-derived ceiling I sketched in the
  brainstorm — it covers *any* text field on *any* form with zero per-fact config.
- **Sharing `normalizeTextValueForPdfField` is a real correctness win, not just DRY.**
  The SSN path strips to 9 digits; measuring the *raw* length at validation while the
  filler writes the *normalized* value would let the two disagree (e.g. block a
  `123-45-6789` that the filler would have written as a fitting `123456789`).
  Extracting the shared helper guarantees validator and filler agree. Good catch.
- **Diagnostics are a meaningful upgrade.** Stage tracking + sanitized/capped warnings
  + field-named filler errors + the eval CLI surfacing the first useful message will
  make the next live failure self-explanatory instead of "please try again." The
  sanitize/cap (collapse whitespace, 500-char clamp) is a sensible guard against
  dumping raw model/stack text into artifacts.
- **Test coverage matches the change.** New specs cover prompt guidance, the maxLength
  block, extractor metadata, filler error wrapping, and the e2e partial-fill path.
- **Deferrals are reasoned, not hand-waved.** The doc explains why heuristic phrase
  filters, manifest-contract blocking (benchmark leakage), and write-path backstops
  were held back. That judgment is sound for a first pass.

---

## Gaps & risks (ordered by importance)

### 1. P1 (storing absence/status text as a durable fact) is not fixed — only nudged

This is the most important thing to be explicit about. The bad value can still be
written to active memory; nothing on the write path rejects it. Concretely:

- The **database score can still regress** for a weak model: `eval.address.current.
  postal_code` may still end up storing the status sentence and overwriting `97214`.
  This PR does not change that — it only stops the *downstream* form-fill step from
  crashing on it.
- The only P1 defense added is the **prompt**, which is advisory and model-dependent.
  The failing model (flash-lite) is precisely the kind that ignores soft guidance.

So the accurate framing of this PR: it **downgrades a hard crash to a graceful,
scoreable miss and lowers the rate** at which bad values are produced. It does **not**
guarantee bad values stay out of memory. The improvement doc says this; the risk is
that a reader skims "implemented" and assumes the root cause is closed. Recommend
stating the residual plainly in the TODO/summary so the next live run is read with
that expectation.

### 2. The prompt phrase list is overfit to this exact failure

The guidance enumerates `"pending task completion"` and `"collection pending"` —
essentially the failing string. That helps this case but won't generalize to a novel
absence phrasing, and the instruction is non-binding. Treat it as frequency-reduction,
not a filter. If a second live run still shows status text reaching storage, the
durable fix is the deferred **tiny origin-scoped non-storable-value filter for
inferred document-analysis suggestions** (brainstorm A / the doc's own "Revisit If
Needed") — applied only to inferred writes so future user-defined schemas where
status-like values are legitimate are unaffected.

### 3. Robustness is asymmetric: maxLength → graceful, any other write error → total abort

The filler now wraps-and-rethrows; the service catches and returns `failed` for the
*entire* document. So the known case (over-length text) degrades gracefully via the
validator, but any *other* unexpected pdf-lib throw (comb fields, encoding,
appearance generation, an invalid radio/dropdown value that slips past validation)
still zeroes out the whole fill rather than skipping the one bad field. That's a
deliberate-looking choice but it isn't called out as one. Decide intentionally:

- For **eval**, whole-abort-with-detail is defensible (you want to see the failure).
- For **product UX**, per-field skip-and-continue in the filler (mirroring the
  validator's posture) is friendlier — one odd field shouldn't blank the form.

Low urgency now that the known case is guarded pre-emptively, but worth a one-line
note recording the asymmetry so it's a choice, not an accident.

### 4. Minor / confirm-only

- **maxLength guard is `SET_TEXT`-only.** Correct for this bug (only text fields carry
  `maxLength`; options are enum-validated). Just confirming the scope is intentional.
- **Event only fires if earlier checks pass.** The maxLength block sits after the
  source-slug and confidence checks, so an over-length value that also lacks a valid
  slug is skipped for the *earlier* reason and won't emit `pdf_text_max_length_blocked`.
  Fine — the earlier skip is also legitimate — but it means the event isn't a complete
  census of over-length values. No action needed.
- **`maxLength === 0` edge.** `typeof field.maxLength === 'number'` would treat a
  (pathological) `0` as "block everything non-empty." Realistically never emitted by
  PDFs; ignorable.

---

## Suggested follow-ups (in priority order)

1. Record in the TODO/summary that P1 remains open: this PR makes the failure
   *graceful and scoreable*, not *prevented*. Re-run flash-lite known-schema and read
   the **database** score (not just form score) to confirm whether bad storage still
   happens.
2. If storage of status text recurs, implement the deferred origin-scoped
   non-storable-value filter on inferred suggestions (brainstorm A) — the smallest
   durable P1 fix that doesn't touch user-defined-schema legitimacy.
3. Decide explicitly whether the filler should skip-and-continue on non-maxLength
   write errors (product) or keep whole-abort-with-detail (eval), and note it.
4. Consider a generic shape backstop for high-risk facts (postal/state/date) only if
   1–2 prove insufficient; keep it behind real signal, per the doc's own caution
   about brittle heuristics.

---

## Bottom line

The change does exactly what a good first pass should: it removes the sharp edge
(the crash) cleanly and generically, improves observability so the next failure is
diagnosable, and reduces the input rate of the bad behavior — while honestly
deferring the harder root-cause work with documented reasoning. The one thing to keep
front-of-mind is that **the product-quality problem is mitigated, not closed**: a weak
model can still store absence/status text, and that will show up in database scoring
even though form fill no longer breaks.
