# 10-Automatic Eval Generation TODO

## Making Generated Documents More Realistic

- Define a realism rubric before changing generation prompts.
  - Each document should have a believable origin, date, issuer or source
    system, purpose, formatting artifacts, and plausible surrounding detail.
  - Call out anti-patterns explicitly: generic wording, perfect form labels,
    missing metadata, identical document voice, no incidental detail, and
    summaries that read like they were written only for the evaluator.

- Improve corpus archetype briefs into richer source-document specs.
  - For each archetype, describe the source system or institution, document
    lifecycle, expected sections, tone, formatting quirks, and allowed
    non-canonical filler.
  - Keep the canonical facts deterministic and validator-owned; use realism
    content only around those facts.

- Separate correctness requirements from realism requirements.
  - Correctness stays enforced by deterministic validation: declared facts must
    appear, forbidden facts must stay absent, and intentionally missing facts
    must not be invented.
  - Realism should be scored separately so a document can be fact-correct but
    still flagged as too synthetic or too thin.

- Add a realism review step after deterministic validation.
  - V1 can be a human or agent checklist over the preview root.
  - Later this can become an `eval:review-realism` command that emits scores,
    issues, and repair guidance without weakening deterministic validation.

- Build better I-9 source-document families.
  - Prioritize onboarding portal exports, HR email threads, document upload
    receipts, payroll profile exports, ID or license transcripts, SSN card
    transcripts, offer letters, address proof, stale notes, and unrelated noise.
  - Avoid making every file a clean Markdown summary. Use messy plaintext,
    copied email bodies, JSON/YAML exports, portal records, partial documents,
    and mixed formatting where appropriate.

- Add realism-focused repair later.
  - Keep the current repair loop focused on deterministic correctness for v1.
  - Once a rubric exists, add repair prompts that preserve validated facts while
    improving document genre, source voice, density, and incidental context.
