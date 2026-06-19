# Increase Evaluation Context Complexity Brainstorm

- Status: temporary brainstorm
- Last updated: 2026-06-19
- Scope: ideas for making evaluation corpora larger and harder, especially to
  test open-schema memory, direct Vertex baselines, and form filling under
  larger context windows

## Summary

Increasing context complexity is a good next evaluation direction, but it should
be done as a controlled ladder instead of one large hard fixture. Bigger context
can mean more documents, longer documents, more irrelevant facts, conflicting
facts, stale facts, other-person facts, or harder extraction formats. Those
failure modes should be separated enough that score reports explain what broke.

Recommended ladder:

```text
small: current realistic corpus
medium: 2-3x documents/tokens with mostly benign distractors
large: 5-10x documents/tokens with stale, conflicting, and other-person facts
stress: near model/context/tool limits, used only after the lower tiers are stable
```

For each tier, compare:

- MCP open-schema run;
- known-schema run, where applicable;
- backend form fill from stored memory;
- direct Vertex open-schema baseline;
- existing one-shot direct document baseline, if useful.

The headline metric should remain final form correctness. Active-memory value
recovery, missing-value abstention, schema quality, slug agreement, and latency
should be diagnostics that explain why the form did or did not work.

## Scenario Ideas

1. More documents, same target facts
   - Keep the same I-9 target facts, but add 20-50 extra documents such as HR
     notices, policy docs, receipts, facility memos, and onboarding reminders.
   - Measures whether the agent can ignore irrelevant context.

2. Longer source documents
   - Expand current fixtures with realistic boilerplate, headers, footers,
     signatures, legal disclaimers, repeated tables, and unrelated sections.
   - Measures extraction from long individual documents rather than many short
     documents.

3. Distractor identity facts
   - Add documents that mention a manager, HR representative, spouse,
     emergency contact, former tenant, or prior applicant.
   - Measures whether facts are attributed to the evaluated user, not another
     person in the corpus.

4. Stale versus current values
   - Include an old address, old email, prior work authorization date, and prior
     legal name, then include newer authoritative evidence.
   - Measures recency and authority reasoning.

5. Conflicting evidence
   - Add two plausible documents that disagree on a value such as address,
     passport number, or work authorization expiration date.
   - Measures whether the system chooses the best-supported value and exposes
     conflict diagnostics.

6. Form-irrelevant durable memory
   - Add facts not needed for the current form, such as work email, start date,
     department, manager, preferred name, employee ID, or office location.
   - Measures whether open schema stores reusable facts, not only form answers.

7. Form-relevant sparse evidence
   - Put a critical value in only one low-signal document, such as SSN in a card
     OCR transcript or I-94 number in a noisy export.
   - Measures recall under noise.

8. Intentionally missing with distractors
   - Keep phone intentionally missing, but add fax numbers, HR phone numbers,
     support numbers, ticket numbers, document IDs, and other phone-like text.
   - Measures abstention and hallucination resistance.

9. Multi-form reuse
   - Ingest once, then fill I-9 plus another onboarding form using the same
     memory snapshot.
   - Measures whether storage creates reusable memory instead of overfitting to
     one target form.

10. Fresh user versus contaminated user
    - Run open schema against a user with no eval-created definitions, then
      against a user with generic profile definitions, then against a user with
      stale or awkward definitions.
    - Measures schema contamination and reuse behavior.

11. Document order sensitivity
    - Run the same corpus with shuffled document order.
    - Measures whether extraction depends too much on first-seen evidence.

12. Chunk boundary stress
    - Split related evidence across distant documents or sections, such as name
      in one document, date of birth in another, and work authorization category
      in a third.
    - Measures cross-document synthesis.

13. Noisy OCR and formatting
    - Add spacing errors, broken lines, repeated headers, table extraction
      artifacts, date variants, and partial OCR mistakes.
    - Measures realistic ingestion resilience.

14. Value shape variants
    - Add facts that can naturally be scalar or array values, such as other last
      names, aliases, addresses, citizenship statuses, and prior employers.
    - Directly targets scorer issues like scalar `Santos` versus array
      `["Santos"]`.

15. Derived value checks
    - Store source facts like full middle name, then require a form value like
      middle initial.
    - Measures whether scoring and form fill handle derived values without
      pretending the database had the exact target field.

16. Direct Vertex comparison at every tier
    - For each larger corpus tier, run the no-storage direct Vertex baseline:
      all documents at once, extract open facts, then fill the form from those
      facts.
    - Measures whether storage is failing or whether the raw model also
      struggles with the larger context.

## Measurement Notes

Useful metrics:

- final form correctness;
- active-memory value recovery;
- recovered-but-derived values;
- recovered-but-different-shape values;
- intentionally missing abstention;
- overfill and hallucination counts;
- unscored active preferences;
- duplicate or low-quality schema definitions;
- runtime and model cost;
- document count and approximate token count.

The recent open-schema run suggests the form scorer can be correct while the
database scorer under-credits useful stored facts. Bigger-context evals should
therefore keep final form correctness as the headline while improving diagnostic
labels for derived values and value-shape equivalence.

## Suggested First Slice

Start with three variants of the existing `alex-i9-realistic` corpus:

1. `realistic-medium`
   - Roughly 2-3x the current document/token count.
   - Mostly benign distractors.
   - No intentional conflicts beyond current stale-contact style data.

2. `realistic-large`
   - Roughly 5-10x the current document/token count.
   - Includes stale facts, other-person facts, and a few low-risk conflicts.

3. `realistic-large-noisy`
   - Same target truth as `realistic-large`.
   - Adds OCR noise, table artifacts, awkward formatting, and phone-like
     distractors.

Each variant should preserve the same final I-9 expected output at first. That
keeps comparisons simple: if the final form score changes, the context increase
is the likely cause.

## Open Questions

- Should larger corpora be hand-authored first, generated from templates, or
  generated by a corpus-expansion script?
- Should context size be measured by document count, byte count, estimated token
  count, or all three?
- Should the medium and large variants share the same truth files, or should
  they introduce new facts that expand the benchmark truth?
- How much form-irrelevant durable memory should count as required for
  open-schema memory recovery?
- Should document-order sensitivity be a separate runner option or separate
  materialized corpora?
