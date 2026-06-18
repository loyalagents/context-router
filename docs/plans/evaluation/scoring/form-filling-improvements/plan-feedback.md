# Form Filling Improvements Plan Feedback

- Status: feedback
- Reviewed input: `agent-feedback-1.md` pasted into the thread
- Last updated: 2026-06-17

## Overall Take

I agree with the plan's core diagnosis and recommended direction.

The live open-schema run did not mainly expose a memory extraction problem. It
exposed that backend form fill still relies on raw active preference slugs in
places where open-schema memory can reasonably produce different slugs. The
backend has the right values for the work-authorization fields, but conditional
activation is checked against `policy.when.sourceSlugs` and a raw
`Map<slug,value>`. The middle-initial case is similar: memory has enough
information (`profile.middle_name = "Jordan"`), but the form layer lacks a
small derived-fact path for `identity.middleInitial`.

The plan is practical and appropriately scoped if we keep the first
implementation deterministic and narrow.

## What I Agree With

- The root cause is correctly located in backend form fill, not eval scoring.
  `FormFillValidatorService.conditionIsActive` checks raw condition slugs
  against active preferences and fails closed when none of those exact slugs are
  present.
- The eval-generated field policies are still known-schema-oriented. They
  include storage-map aliases and eval canonical slugs, but not novel slugs like
  `work_auth.citizenship_status`.
- The middle-initial miss should be handled as a derived value, not by asking
  the agent to store every possible form projection.
- The work-authorization misses should be fixed by resolving open-schema memory
  to canonical form facts before policy activation and source-policy validation.
- The fix should live primarily in backend form fill. Eval diagnostics can help,
  but product behavior should not depend on eval-only post-processing.
- Adding failing backend tests first is the right next step. This touches
  guardrail logic, so tests should define the allowed behavior before changing
  it.
- We should avoid making `fact-storage-map.v1.json` the primary fix. Adding
  aliases there might make this one run pass, but it would not solve open-schema
  form filling generally.
- Keeping off-policy source slugs as diagnostics for now is a good call. Turning
  those warnings into hard blocks is a separate behavior decision.

## Refinements I Recommend

### Keep The Design Simple And Form-General

The right abstraction is not "fix the I-9 run." The right abstraction is a
small bridge between open-schema memory and form-declared canonical facts:

1. Forms declare canonical `factKey`s.
2. Active preferences may have known-schema or open-schema slugs.
3. Backend form fill builds a resolved fact map before prompting/validation.
4. Field policy and conditional logic use that resolved fact map instead of
   relying only on exact raw slugs.

That shape can support more forms as long as each form has a field map with
canonical fact keys. The resolver should be shared form-fill infrastructure, not
hidden per-form special cases.

The specific aliases from this live run are useful test cases, but they should
not become the whole design:

- `work_auth.uscis_number` -> `workAuthorization.uscisANumber`
- `profile.middle_name` -> derived `identity.middleInitial`

Those examples should prove the resolver contract. Future forms should be able
to benefit by adding field-map facts and deterministic aliases/derivations, not
by adding bespoke code paths for each PDF.

### Start With Two Narrow Backend Behaviors

I would not begin with a broad resolver service that tries to solve arbitrary
open-schema matching. Start with the two concrete failure classes from the live
run:

1. Derived middle initial from middle name.
2. Canonical fact resolution for I-9 work-authorization status and dependent
   fields.

That gives us direct before/after evidence without introducing a generalized
semantic matcher too early.

### Keep Resolution Rule-Based For PR1

The first pass should be explicit and deterministic:

- `work_auth.citizenship_status` can resolve to
  `workAuthorization.citizenshipStatus`.
- `work_auth.expiration_date` can resolve to
  `workAuthorization.workAuthorizationExpirationDate`.
- `work_auth.uscis_number` can resolve to `workAuthorization.uscisANumber`.
- `work_auth.i94_admission_number` can resolve to
  `workAuthorization.i94AdmissionNumber`.
- `work_auth.foreign_passport_number` can resolve to
  `workAuthorization.foreignPassportNumber`.
- `profile.middle_name` can support derived `identity.middleInitial`.

Later work can generalize from definition display names/descriptions, but the
first implementation should prove the integration point safely.

The first pass can still be general in architecture even if the supported rules
are narrow. In other words: build a resolver that works for any canonical
`factKey`, but seed it with only the few explicit mappings and derivations that
we trust today.

### Avoid Per-Form Hidden Hacks

Do not bury logic like "if this is the I-9 form, accept `work_auth.*` slugs" in
the filler. That will improve one benchmark but will not scale to new forms.

Prefer one of these explicit data-driven paths:

- form field maps declare canonical `factKey`s;
- a shared alias table maps known/open slugs to canonical facts;
- a shared derived-fact registry maps canonical source facts to derived target
  facts;
- resolver diagnostics explain exactly which source slug satisfied which
  canonical fact.

That keeps future form additions straightforward: add fields and canonical facts
to the form map, add deterministic aliases only when needed, and rerun the same
resolver.

### Decide Whether To Augment Policies Or Active Preferences

The feedback proposes "augmented policies whose `sourceSlugs` /
`when.sourceSlugs` include only deterministic, resolved active slugs." That is
reasonable, but there is another possible implementation: build a canonical
fact map and have the validator evaluate `policy.factKey` / `policy.when.factKey`
against that map.

The latter may be cleaner long term because policies stay canonical and do not
mutate based on runtime memory. It also makes diagnostics clearer:

- raw source slug: `work_auth.citizenship_status`
- resolved fact key: `workAuthorization.citizenshipStatus`
- resolution kind: `deterministic_alias`

Either approach can work. Before implementation, choose one contract and test it
directly.

### Preserve Fail-Closed Semantics For Unknown Slugs

The most important guardrail: unknown or conflicting open-schema slugs should
not activate conditional branches just because their value looks plausible.

Tests should cover:

- `work_auth.citizenship_status = "alien authorized to work"` activates the
  alien-authorized branch.
- `profile.unexpected_status = "alien authorized to work"` does not activate it.
- Conflicting resolved citizenship values do not silently pick one.
- Missing status still blocks dependent fields.

This is where "simple" matters. A deterministic resolver that returns "no
confident match" is better than a broad matcher that makes the form look better
by guessing.

### Add Prompt Context Only After Resolver Semantics Are Clear

The plan says to pass resolved facts to the prompt builder. I agree, but that
should come after the resolver contract is clear. The prompt should not be the
only place where resolution exists; validation must enforce the same resolved
facts deterministically.

If resolved facts are added to the prompt, they should be framed as allowed
canonical facts with provenance, not as extra hidden truth.

### Diagnostics Should Be Useful But Not Required For The First Fix

Resolution diagnostics are worth adding, but I would keep them modest in the
first PR:

- include resolution events in backend `validationEvents`;
- include skipped-field reason and source slugs in existing eval artifacts;
- defer schema-wide reporting changes unless needed to understand the rerun.

The core behavior fix is more important than building a large diagnostic report
surface immediately.

## Suggested Checkpoint Order

1. Backend tests proving current failures:
   - condition inactive with raw novel slug today;
   - middle initial missing from middle name today;
   - unknown slugs and conflicting values fail closed.

2. Add a narrow deterministic form-fact resolver:
   - active preferences in;
   - canonical fact records out;
   - provenance includes raw source slug and resolution kind.
   - resolver API is form-general even if initial alias coverage is small.

3. Use resolved facts for validator policy activation:
   - `policy.when.factKey` can evaluate through resolved canonical facts;
   - raw source-slug behavior still works for known-schema paths.

4. Add derived middle initial:
   - only when direct middle initial is absent;
   - only from a non-empty middle-name value;
   - uppercase first alphabetic character;
   - provenance marks it as derived.

5. Pass resolved/derived facts into prompt context:
   - prompt can choose canonical values;
   - validation enforces the same resolver output.

6. Add targeted eval coverage:
   - mocked form fill or backend harness run showing the six current misses now
     fill or produce better diagnostics;
   - keep known-schema form-fill tests green.

7. Rerun the live Claude open-schema eval and compare:
   - memory recovery should remain stable;
   - form score should improve from `11 / 17`;
   - no new hallucinated or overfilled fields.

## Things I Would Avoid

- Do not fix this by asking Claude to create exact known-schema slugs. That
  undermines the point of open-schema evaluation.
- Do not fix this with I-9-only code hidden in the filler. Use I-9 as the first
  regression case for a form-general resolver contract.
- Do not make slug correctness a headline metric for open schema.
- Do not move this primarily into eval scoring. Scoring should reveal the
  backend behavior, not hide it.
- Do not add broad fuzzy matching in the first implementation.
- Do not weaken conditional blocking for mutually exclusive checkbox groups.
- Do not bundle stricter off-policy source-slug blocking into the same PR.

## Open Questions Before Implementation

- Should the resolver live as a new backend service, or as a helper owned by
  `FormFillService` until it grows?
- Should field policies eventually declare canonical facts only, with raw slugs
  as backward-compatible aliases?
- Where should shared alias data live so future forms can reuse it without
  coupling backend behavior to eval-only `fact-storage-map.v1.json`?
- What is the minimum field-map contract a new form must provide to benefit
  from open-schema resolution?
- How should conflicts be represented in `validationEvents` and the response
  summary?
- Should derived facts be visible in user-facing form-fill summaries, eval
  artifacts, or both?
- How much definition metadata is available in `getActivePreferences`, and is
  it enough for later generalization beyond explicit alias rules?

## Recommendation

Proceed with this plan, but implement it as a small backend-first checkpoint:
narrow deterministic resolver, derived middle initial, policy activation through
resolved canonical facts, and focused tests. Treat broader canonicalization,
LLM-assisted matching, and richer eval reporting as follow-up work after the
live run shows that the six observed misses are fixed without weakening
guardrails.

The intended long-term shape is simple: new forms declare canonical fact keys;
open-schema memory can choose useful slugs; the backend resolver connects the
two through deterministic, auditable rules. That is the part worth preserving as
we keep the first implementation small.
