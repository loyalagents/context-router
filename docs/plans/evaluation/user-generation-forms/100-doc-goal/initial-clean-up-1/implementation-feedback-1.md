# Initial Clean-Up 1 Implementation Feedback 1

- Status: feedback
- Date: 2026-05-22
- Read when: reviewing `initial-clean-up-1/implementation-plan.md` before executing the mixed-file-type cleanup

## Overall Verdict

The plan is well-structured and the intent is right: the first 100-document
Nina corpus is real but Markdown-monotone, and mixing `md`/`txt`/`json`/`yaml`
plus stronger per-document briefs is the correct next step.

It is **not ready to execute as written**. The checkpoint ordering has a
genuine contradiction that will make the plan's own verification commands fail,
and two operations the plan depends on ("regenerate `manifest.json`", "full
regeneration without manual deletion") are not backed by tooling that exists
today. Fix the three critical issues below and the plan becomes executable.

I verified the plan against the actual repo state, not just the prose. Findings
are grouped by severity.

## What The Plan Gets Right

- The target file-type distribution math is internally consistent. md 45 +
  txt 25 + json 20 + yaml 10 = 100, and every per-category row sums to its
  category total (15/15/12/12/8/18/20). The column totals also reconcile
  (45/25/20/10). No arithmetic fix needed.
- The category distribution it promises to "keep" matches the committed
  `corpus-plan.json` exactly (identity 15, address-contact 15,
  work-authorization 12, hr-onboarding 12, employer-context 8,
  partial-conflicting 18, noise 20).
- Only using `md`/`txt`/`json`/`yaml` is correct: those are the four values
  `corpus-plan.schema.json` already permits for `outputExtension`. No schema
  change is needed, which the plan correctly assumes.
- The stronger-brief requirements (genre, source, style, facts present, facts
  absent, freshness, realism cues) are the right shape. The current briefs are
  genuinely generic — every identity doc literally reads "Identity document N
  for Nina with current legal-name and I-9 matching details."
- Keeping `factKeys[]` authoritative and `brief` plan-only is consistent with
  the existing `manifestFromCorpusPlan` projection, which deliberately drops
  `brief`, `challengeTags`, and `outputExtension` from the manifest.

## Critical Issues (must fix before executing)

### C1. Checkpoint 6 ordering contradicts "keep validation green after each checkpoint"

This is the headline problem.

Checkpoint 2 renames body files to new extensions and explicitly says **"do not
change document contents yet."** So after Checkpoint 2 the corpus contains
`.json`, `.yaml`, and `.txt` files whose bodies are still Markdown prose. The
real document contents are not corrected until Checkpoint 8 (full Vertex
regeneration).

Checkpoint 6 then adds validator rules that open those bodies:

- "JSON body must parse when `outputExtension` is `json`"
- "YAML body must parse when `outputExtension` is `yaml`"
- "JSON/YAML bodies must not contain Markdown fences"
- "`.txt` bodies should warn on Markdown headings or tables"

Run against the Checkpoint-2 output, these checks fail. Many `.json`-destined
docs currently hold prose (e.g. `043-offer-letter.md` is a paragraph), so a
JSON-parse error fires; every renamed `.txt` still has Markdown headings, so the
txt warning fires. Checkpoint 6's own verification block runs `pnpm eval:verify`
and `pnpm eval:validate ... --write-report`, both of which would go red. That
also retroactively breaks Checkpoint 2's acceptance ("focused validation passes
with 0 errors and 0 warnings") and the plan's primary goal "keep validation
green after each checkpoint."

Note: some bodies *are* already valid JSON/YAML in a `.md` file (e.g.
`044-onboarding-profile.md` is a JSON object, `046-payroll-precheck.md` is
YAML). So whether a given rename is content-safe is accidental, not designed.

**Fix:** Body-content-vs-extension validation must run *after* the bodies are
regenerated. Reorder so validator tightening is the last checkpoint, after full
Vertex regeneration. Concretely: `1 -> 2 -> 3 -> 4 -> 5 -> 7 (mixed preview)
-> 8 (full regen) -> 6 (validator tightening)`. Alternatively, land the
JSON/YAML/txt body checks as **warnings only** during the cleanup and add a
final checkpoint that promotes them to errors once real bodies exist — but a
straight reorder is cleaner.

### C2. "Regenerate `manifest.json`" has no command, and is not executable at Checkpoint 1

Checkpoints 1 and 2 both say "regenerate `manifest.json` from the updated plan."
There is no `eval:` command that does only that. `manifestFromCorpusPlan()`
lives inside `generate.mjs` and is only ever called by `generateCorpus()`, which
writes the manifest at the very end of a generation run.

Worse, that path has a guard: `generateCorpus()` refuses to write the manifest
unless **every** planned body file already exists (`generate.mjs:203-209`,
"Cannot write manifest until all planned document bodies exist"). At
Checkpoint 1 the plan has new extensions but body files still have the old
`.md` extensions, so all 100 planned bodies count as missing and manifest
regeneration is impossible there. It only becomes mechanically possible at
Checkpoint 2, after the rename.

Even at Checkpoint 2 the only way to trigger it is to run
`pnpm eval:generate --backend vertex --model <something>` with all files
present so zero documents are selected — a non-obvious side effect that still
demands a model value for a run that calls Vertex zero times.

**Fix:** Pick one and write it into the plan explicitly:

- Add a `--manifest-only` mode to `eval:generate` (or a small `eval:manifest`
  script) that projects `corpus-plan.json` to `manifest.json` with no AI call
  and no all-bodies-exist guard.
- Or drop "regenerate manifest" from Checkpoint 1 entirely (it cannot run and
  is pointless while bodies are missing) and, in Checkpoint 2, name the exact
  command used to regenerate it.

Either way the plan must stop treating manifest regeneration as a free,
unspecified step.

### C3. Checkpoint 8 full regeneration depends on a replacement path that does not exist

`generate.mjs` skips any document whose body file already exists
(`selectDocuments`, `generate.mjs:299`). After Checkpoint 2 all 100 bodies
exist, so a plain `pnpm eval:generate ... --backend vertex` regenerates
**zero** documents. `--regenerate` works but takes an explicit id list and
matches `doc.id` exactly — and `doc.id` is the full
`nina-meera-patel-realistic-001` form, not `001`.

The plan acknowledges this in one sentence ("If the generator still skips
existing files, add an explicit supported replacement path... Do not rely on
manual deletion") but leaves it as a conditional aside. It is on the critical
path for Checkpoint 8 and needs to be a concrete, owned task.

**Fix:** Make "add a supported full-replacement path" an explicit checkpoint
deliverable — e.g. a `--force` / `--overwrite` flag, or `--regenerate all` —
implemented and tested in the same checkpoint as the generator prompt work
(Checkpoint 4), so Checkpoint 8 has a real command instead of a TBD.

## Moderate Issues

### M1. `--ids` and `--regenerate` overlap; short-id resolution is undefined

Checkpoint 5 proposes adding `--ids` *and* updating `--regenerate` to accept
short ids. These two flags then do nearly the same thing: select a subset of
documents by id. `--regenerate <ids> --out <dir>` already works today for a
cross-category preview — the existence filter is skipped when `regenerateIds`
is set, and `--out` redirects output. The only real gap is short-id support.

Adding a second flag with overlapping semantics will confuse future readers.
Prefer one mechanism: make the existing `--regenerate` resolve short ids and,
if a preview-only alias is wanted, make `--ids` a thin alias rather than a
parallel code path. Also specify the resolution rule precisely — e.g. a token
matches `doc.id` exactly, or `doc.id` ends with `-<token>` — and decide whether
`--ids` requires `--out` the way `--limit` does (`generate.mjs:122-124`).

### M2. Checkpoint 1's "expected failure" list is incomplete

Checkpoint 1 says the only expected failure before bodies are renamed is
"missing document files." Full validation will also emit `MANIFEST_PLAN_MISMATCH`
because the plan's paths/extensions no longer match the still-old `manifest.json`
(validator drift check). The instruction "Do not proceed until the failure list
matches only expected renamed paths" is therefore unreachable as written.
List both expected failure classes, or scope Checkpoint 1 verification to
`--plan-only` plus a documented "full validation is expected red here."

### M3. The "path-extension check" is mischaracterized

Checkpoint 1 says to rely on "the existing validator path-extension check to
catch drift." That check is `CORPUS_PLAN_EXTENSION_MISMATCH`
(`validate.mjs:727-734`); it compares a document's `path` extension against its
own `outputExtension` *within the plan*. If Checkpoint 1 updates `path` and
`outputExtension` in lockstep (which the plan instructs), this check never
fires. It is a "did you update both fields consistently" guard, not a
plan-vs-body drift detector. Reword so reviewers do not expect it to catch the
wrong thing.

### M4. Missing Risks/Rollback section and closeout checkpoint

`orchestration-plan.md` requires every batch implementation plan to include
"risks or rollback notes," "a final checkpoint to write
`implementation-summary.md`," and "a final checkpoint to update
`orchestration-plan.md`." The `initial-try-0` plan followed this (it had a
Risks section and a Checkpoint 9 closeout). This plan has neither.

This matters most for Checkpoint 8: full Vertex regeneration destructively
replaces 100 committed deterministic bodies, is non-deterministic
(temperature 0.75), and a failed run leaves a half-replaced corpus. The
rollback story is simple (the deterministic bodies are in git history; revert
restores them) but it should be stated. Add:

- a Risks/Rollback section, and
- a closeout checkpoint that writes
  `initial-clean-up-1/implementation-summary.md` and records the generation
  model, call count, and validation status — mirroring
  `initial-try-0/implementation-summary.md`.

### M5. Checkpoint 6 should add validator tests and name its files

Checkpoint 4 correctly says to add prompt-construction tests to
`generate.test.mjs`. Checkpoint 6 adds new validator behavior (JSON/YAML parse,
fence detection, txt-Markdown warnings) but only says to run `pnpm eval:test` —
it never says to *add* tests. New validator issue codes need coverage in
`examples/eval/scripts/validate.test.mjs`, consistent with the rest of the
suite. Checkpoint 6 should also name `examples/eval/scripts/validate.mjs` and
`validate.test.mjs` as the files it touches.

### M6. Generator should defensively strip code fences, not only ask the model not to add them

Checkpoint 4 relies entirely on prompt instructions to stop Vertex from
wrapping JSON/YAML/txt output in Markdown fences. `gemini-2.5-pro` frequently
ignores that instruction for structured output. Since the generator already
post-processes output (trailing-newline handling, `generate.mjs:192`), add a
defensive fence-strip for `json`/`yaml`/`txt` outputs. That makes regeneration
far less flaky than depending on prompt compliance plus a validator rejection
loop.

## Minor / Housekeeping

- **Which `TODO.md`?** The acceptance criterion "`TODO.md` is updated" is
  ambiguous — there is `100-doc-goal/TODO.md` and
  `user-generation-forms/TODO.md`. Name the file.
- **`COMMANDS.MD` will go stale.** After this cleanup, the "Vertex Preview"
  (`--limit 5`) and "Full Vertex Generation" sections and the `rg` searches
  that assume `.md`-only bodies are outdated. Add updating `COMMANDS.MD` to the
  closeout, or note it explicitly as deferred.
- **Committed intermediate state.** The post-Checkpoint-2 corpus is `.json`/
  `.yaml` files containing Markdown prose — a semantically dishonest state. It
  is harmless if Checkpoints 1-8 land as one branch and merge once, but the
  plan should say that intermediate checkpoints are working-tree progress
  points and the branch must not merge to `main` between Checkpoint 2 and
  Checkpoint 8.
- **Structured formats raise false-positive risk.** The intentionally-missing
  `contact.phone` check (`DOCUMENT_MISSING_FACT_PRESENT`) scans for
  phone-shaped text. JSON/YAML noise docs with numeric ids or codes can trip a
  digit-pattern matcher. Checkpoint 6 should keep that class of check as a
  warning for structured bodies, which the plan's general "keep fuzzy checks as
  warnings" stance covers — but call it out for json/yaml specifically.
- **Checkpoint 3 / manifest coupling.** Checkpoint 3 is described as briefs-only,
  which is safe (the manifest does not carry `brief`). Add an explicit note: if
  Checkpoint 3 also touches any manifest-projected field
  (`factKeys`, `expectedUse`, `authority`, `freshness`, `title`), the manifest
  must be regenerated — otherwise `MANIFEST_PLAN_MISMATCH` fires.

## Forward-Looking Note (not blocking)

The plan frames mixed file types as making the corpus "more realistic." For
realism that is true. But for a future *extraction* benchmark, structured
`json`/`yaml` exports are usually **easier** to extract from than prose, not
harder — facts sit in labeled key/value pairs. 30 of 100 docs becoming
structured may lower average extraction difficulty even as it raises realism.
That is fine for this cleanup (the plan correctly defers the extraction
benchmark), but the extraction-tier work in `TODO.md` should not assume "more
file types" equals "harder benchmark."

## Recommended Checkpoint Reordering

A minimal restructuring that resolves C1 and clarifies the rest:

1. Plan extension update (`corpus-plan.json` paths + `outputExtension`).
2. Rename body files; regenerate manifest via the command chosen for C2.
3. Stronger per-document briefs.
4. Generator prompt improvements **+ defensive fence-strip + supported
   full-replacement flag** (resolves M6 and C3); add `generate.test.mjs`
   coverage.
5. Better preview selection (single id mechanism, resolves M1).
6. Mixed Vertex preview (formerly Checkpoint 7).
7. Full Vertex regeneration (formerly Checkpoint 8).
8. Validator tightening for body-vs-extension checks **+ `validate.test.mjs`
   coverage** (formerly Checkpoint 6 — now last, resolves C1 and M5).
9. Closeout: `implementation-summary.md`, `COMMANDS.MD` refresh, `TODO.md`
   update, `orchestration-plan.md` status (resolves M4).

Add a Risks/Rollback section covering the destructive regeneration in step 7.

## Bottom Line

Good direction, sound distribution math, correct scope boundaries. Three things
block execution: the Checkpoint 6 ordering contradiction (C1), the missing
manifest-regeneration command (C2), and the unspecified full-replacement path
(C3). Resolve those, add the Risks and closeout sections the orchestration
workflow requires, and the plan is ready.
