# Ownership Hardening Packet PR Plan

## Summary

Add one fixture-only packet, `packet-hard-ownership-v1`, to make Maya’s shared-dossier evaluation harder through ownership/admissibility cases. Keep one shared corpus and three independent one-form scenarios. Do not change runner, scorer, backend, MCP, form maps, schema, or Maya `profile.yaml`.

The difficulty comes from realistic records where useful-looking values are either owned by another person or appear near Maya-owned facts in a mixed document.

## Key Changes

1. Update `docs/plans/evaluation/user-generation-forms/increase-form-complexity/make-forms-harder/ownership-hardening/implementation-plan.md` first.
   - Incorporate this tightened plan.
   - State that `implementation-summary.md` and `orchestration.md` are updated only at the end.

2. Create `examples/eval/users/maya-chen-newhire/corpora/packet-hard-ownership-v1/` from `packet-medium`.
   - Update `corpusId`, top-level `seed`, `artifactWorld.seed`, and `purpose`.
   - Rename copied document IDs to `maya-chen-newhire-packet-hard-ownership-v1-NNN`.
   - Regenerate, do not preserve, the copied `validation-report.json`.
   - Search the new corpus for stale `packet-medium` / `maya-chen-newhire__packet-medium` metadata before validation.

3. Extend `artifactWorld` with explicit ownership decoy entities and timeline refs.
   - Noah Kim: non-Maya payment election, worker `PLC-20792`, Northstar Community Bank, routing `122105278`, account `663904228017`, savings.
   - Elena Chen: Maya emergency contact, phone `415-555-0182`, email `elena.chen.family.test`, non-Maya address.
   - Victor Alvarez: Maya-adjacent manager, work email `victor.alvarez@pacificledger.test`, phone `510-555-0276`.
   - Ari Patel: non-Maya employee in shared support case, worker `PLC-20631`, routing `071000013`, account `550019873244`, filing status `married filing jointly`.
   - Taylor Brooks: W-4 example person with head-of-household/dependent/withholding values distinct from Maya.

4. Add five new documents with source-native paths and titles.
   - `031-ledgerpay-payment-election-export.yaml`: pure non-Maya direct-deposit export for Noah Kim. `category: payroll-tax`, `expectedUse: ignore`, no Maya identifiers.
   - `032-harborhire-emergency-contact-export.yaml`: mixed/adjacent record for Maya’s emergency contact; Maya is the employee, Elena owns the phone/email/address. `category: hr-onboarding`, `expectedUse: corroborate`.
   - `033-team-directory-export.yaml`: mixed/adjacent directory record where Maya appears in team context and Victor owns manager contact fields. `category: employer-context`, `expectedUse: corroborate`.
   - `034-ledgerpay-support-case-export.txt`: mixed support thread with Maya-owned facts such as start date/email plus Ari’s bank/tax values. `category: payroll-tax`, `expectedUse: corroborate`.
   - `035-w4-example-article.txt`: the only intentionally sample/training document. `category: noise`, `expectedUse: ignore`.

5. Manifest rules for the new documents.
   - Use complete realistic-generated `sourceSpec` metadata for every new document.
   - Use `factContract.include` only for Maya-owned facts actually present in mixed docs.
   - Use `factContract.forbid` per document to prevent current Maya value leakage in the same fact family as each decoy.
   - Do not add new schema fields or scorable decoy metadata.
   - Do not use eval labels like trap, decoy, benchmark, ownership test, or not-Maya in document bodies.
   - Do not use sample/fictitious/training framing in `031`-`034`; `035` is the deliberate sample exception.

6. Add three scenarios.
   - `maya-chen-newhire-i9-packet-hard-ownership-v1`
   - `maya-chen-newhire-fw4-packet-hard-ownership-v1`
   - `maya-chen-newhire-direct-deposit-packet-hard-ownership-v1`
   - Match packet-medium scenario shape: `expectedSnapshots: []`, new `corpusId`, same form IDs, one prompt per form.

## Validation And Acceptance

Run:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-hard-ownership-v1 --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-hard-ownership-v1
pnpm eval:validate
pnpm eval:test
git diff --check
```

Acceptance criteria:

- zero validation errors;
- zero missing declared Maya facts;
- zero forbidden current Maya values in ownership decoy bodies;
- all decoy bank, tax, phone, email, address, and SSN-like values are distinct from Maya truth and existing packet-medium sample values;
- no `DOCUMENT_STALE_CUE_MISSING` warnings expected;
- expected `DOCUMENT_SOURCE_PHONE_PRESENT` warnings only for intentional phone distractors;
- no live MCP/direct artifacts committed in this PR.

## End-Of-PR Docs

At the very end, create `docs/plans/evaluation/user-generation-forms/increase-form-complexity/make-forms-harder/ownership-hardening/implementation-summary.md`.

Include:

- what was added;
- document count and scenario IDs;
- validation commands and results;
- reviewed warning codes;
- manual leakage checklist listing each decoy owner, exact decoy values, expected behavior, and what to search for in the follow-up live run;
- note that live MCP/direct runs are deferred.

Then update `docs/plans/evaluation/user-generation-forms/increase-form-complexity/make-forms-harder/orchestration.md`.

Include:

- links to the implementation plan and summary;
- ownership fixture PR marked implemented/validated;
- Checkpoint 5 live MCP/direct packet runs left as the next step;
- expected live-run signal: wrong facts, overfilled fields, or active-memory leakage of Noah/Elena/Victor/Ari/Taylor values compared with `packet-medium`.

## Assumptions

- This PR creates one packet, not three.
- The three scenarios remain independent one-form scenarios.
- `packet-medium` remains unchanged.
- `contact.phone` remains intentionally missing.
- Challenge tags are tracking-only and not ingestion hints.
