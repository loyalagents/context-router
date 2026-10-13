# Document attribution investigation

- Status: bounded correction and historical validation recorded below; [draft PR #177](https://github.com/loyalagents/context-router/pull/177) is the source for the latest candidate and checks. This is not installed-app or invitation qualification.
- Original experiment base: `f31021234fe3eac347261466b9c708231f0f2841`. The review-follow-up round integrates approved main `583277a7b08f11084ea63cb879225543c348ea85` without rebasing the measured commits.
- Branch: `codex/document-attribution-stability`, isolated worktree
- Ownership: coordinator `/root` and reviewers are read-only; `/root/writer` owns all files, fixtures, documentation, staging and commits in this worktree. The pilot owner remains the main-checkout integrator.
- Settings: user requested Astra Extra High (`xhigh`) for coordinator, sensitive writing and independent review; Astra High for factual inventory. Explicit writer/reviewer/inventory spawn settings were accepted by the API; runtime settings have no independent attestation. Coordinator model/effort is not independently observable.
- Scope: new attribution fixtures/tests under document analysis, test-only runner under `apps/backend/test/document-attribution/`, and evidence-supported document-analysis changes. Shared parser/model/quality infrastructure, historical evidence, pilot plan, personal state and running pilot application are outside this writer's scope.

The unavailable original private document cannot be diagnosed from a synthetic
reproduction. This task can establish a defect class only. The pilot owner has
confirmed no path conflict and keeps attribution triage as an invitation dependency.

## Expectations and trace

The synthetic account owner is Maya Lin Chen. The fixture metadata is an oracle,
never extra identity supplied to the model. The first three cases supply only
the stored global `profile.full_name`; `profile.email` is initially absent.
Definitions use the actual catalog descriptions through
`PreferenceSchemaSnapshotService` for full name, contact email and title.
Every attribution-fixture filename is the neutral `synthetic-note.txt`; those
semantic case IDs remain receipt metadata. The historical extraction slice keeps
its original case-ID filenames, which can reveal conditions such as decoy or
injection; its negative results are not independent attribution proof.

| Fixture | Identity available to extraction | Expected proposed facts |
| --- | --- | --- |
| `known-owner-email` | Saved full name matches the named email owner | Maya's email |
| `colleague-email-with-owner-facts` | Saved full name matches the named employee; Jordan owns the email | Maya's title; no email |
| `mixed-owner-and-colleague-emails` | Saved full name; both email owners explicitly named | Maya's email and title; never Jordan's email |
| `ambiguous-two-person-directory` | No saved profile; neutral directory identifies neither person as account owner | No person-specific facts |
| `self-identifying-no-saved-profile` | No saved profile; first-person self-identification | Maya's full name and email |

The user explicitly agreed: **omit only ambiguous person-specific facts** when
multiple people appear and neither saved profile nor document identifies the
account owner. Clear single-person/self-identifying documents remain eligible.
This remains the product requirement; it is broader than the model-tested v1
scenarios. No blanket email suppression or multi-person rejection is acceptable.
The two [preparation-only v2 additions](../../../../apps/backend/src/modules/preferences/document-analysis/__fixtures__/attribution-cases-v2.json)
require a clear self-title beside an ambiguous directory, and explicit named
self-identification beside another person with no saved profile. Scripted
consumer/review tests cover these additions; neither has actual-model evidence.
The live runner still uses only the unchanged five v1 cases.

The checked path is:

1. `DocumentAnalysisController` passes authenticated `userId`, file bytes, MIME
   type and filename. Authentication scopes storage access, not document subjects.
2. `PreferenceExtractionService` fetches global active preferences and the visible
   schema. Its prompt supplies those values, filename and extraction/evidence
   instructions. It receives no separate authentication name/email. The local
   compatibility `User.email` is not profile truth, and profile rows can be absent
   ([profile contract](../../../current/PREFERENCE_SCHEMA.md#profile-memory)).
3. `LocalModelService` strictly decodes text as UTF-8, wraps the decoded document
   as JSON-quoted untrusted content, and uses the supplied Zod schema. PDF text
   would first pass through its existing parser; no PDF work is needed initially.
4. Extraction validates known slugs, canonicalizes values, corrects operation and
   prior value, filters no-ops and consolidates exact-slug duplicates. It does
   not independently prove that a value or snippet belongs to the account owner.
   Duplicate consolidation receives candidate evidence and one current value;
   it returns one representative snippet and retains original duplicate items.
5. `DocumentAnalysisService` prefixes stable IDs and
   `ReviewedSuggestionService.prepare` adds exact saved-state descriptors.
   This is a conflict/ownership boundary, not semantic attribution validation.
6. `SuggestionItem.tsx` displays proposed value, quoted snippet and optional page.
   `SuggestionsList.tsx` carries selected values and evidence to the separate
   explicit apply request. A wrong proposal matters before any persistence.

The historical `extraction-other-person-decoy` in
`scripts/local-migration/fixtures/local-model-feasibility/cases.mjs` reads a
Jordan Avery sample packet explicitly unrelated to Maya. It contains **no email
address**. `consumers.mjs` runs the actual extraction consumer with synthetic
storage. `fixtureReply` tests wiring only. Production quality runs use the actual
local model and compare initial proposal units with final validated units across
three repetitions. Critical unexpected values fail; omission exception E permits
only the frozen instruction-injection email omission. It does not permit foreign
facts. Historical manifests/receipts and recovery exception H remain unchanged.

## Checkpoints

1. **Reviewed preparation.** Add the five separate JSON fixtures and a dedicated
   deterministic suite. The independent reviewer approved the plan, resolved
   ambiguity policy and extra positive control. Fake AI replies call the actual
   supplied Zod parser; actual extraction, analysis and review preparation run
   with synthetic storage. Assert file/context flow, values, evidence, stable IDs,
   filtered duplicate evidence and absence of writes. These tests are not model
   reproduction, browser evidence or persistence qualification.
2. **Bounded reproduction.** Prepare and independently review a separate live
   harness/run proposal before requesting final approval. Use actual
   `LocalModelService` with extraction and review preparation; retain initial
   responses, every consolidation response, actionable and filtered suggestions,
   source evidence and review descriptors. Record failures and every repetition.
   Evaluate expected slug/value facts separately from evidence completeness. The
   current snippet contract requires a quote containing the value; an otherwise
   correct email-only quote is not a wrong-person fact merely because it omits
   the owner's name. Foreign values or contradictory snippets remain failures.
3. **Conditional correction.** Only after actual reproduction: independently
   review diagnosis and smallest correction, add a failing regression first,
   make the change and run affected checks. Preserve useful positives, evidence
   and review-before-apply. No reproduction means an unresolved disposition and
   no speculative production patch.
4. **Qualification.** Agree finalization milestone with the coordinator/user,
   freeze the candidate, obtain complete-diff review and complete applicable
   final gates/quality coverage/exact-head CI. Existing quality evidence carries
   forward only for unchanged relevant inputs. A prompt/model-path change needs
   affected existing quality assessment, not just new fixtures. No automatic
   merge, publication or installed-app/Claude acceptance rerun.

## Initial experiment — completed on the frozen preparation

- Five fixtures above, **two repetitions each, at most ten analyses**, one at a
  time. Maximum **45 minutes inclusive of startup and cleanup**; record native
  completion count including schema correction and duplicate calls, with an
  additional **60-completion maximum**. Work is stopped at 44 minutes to reserve
  cleanup time. Runtime stop/reap proceeds independently of adapter close.
  Unsettled work/adapter or failed reap preserves private roots and reports
  incomplete cleanup; it cannot receive a successful receipt. Do not add
  retries, changed limits or favorable resampling. Unstarted/incomplete attempts
  remain visible. A later third repetition or post-fix qualification needs its
  own bounded scope.
- Qwen3.5-9B Q4_K_M, 5,680,522,464 bytes, SHA-256
  `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`;
  llama.cpp b11146, source `7fe450e19305b828c199d602c23a8337aaa1f03b`.
  Runtime archive SHA-256
  `1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711`.
  Narrow user-authorized installed-manifest inspection located the retained model.
  Read-only SHA-256 verification matched the pin above with unchanged open-file
  identity and metadata. Its exact canonical path belongs in the private approved
  run configuration, not repository source. A live run would reverify that input
  within its own approved window. Read-only reuse needs no 5.68 GB copy; no copy,
  model modification or download occurred.
- Preserve production configuration: 16,384 context, one slot, GPU layers all,
  flash attention on, fit off, batch/ubatch 512, mmap/offline, thinking disabled,
  no context shift or prompt/idle caches; production client temperature 0,
  seed 42 and output maximum 2,048. Keep existing workflow/adapter/correction
  caps. Bind source, fixture, catalog, prompt/schema, runtime/model/config and
  actual returned evidence to the receipt.
  The reviewed private configuration's SHA-256 is required on the run command;
  that configuration also pins the exact build-binding file's SHA-256.
  Recheck source/build/helper/runtime closure and model metadata after use; drift
  prevents success while retaining all observations. Initial/consolidation
  subject violations remain separate from final actionable utility and evidence.
- Fresh private owned state/credential roots, ephemeral loopback port, dedicated
  exact child handles, read-only approved assets and isolated worktree output.
  The writer owns cancellation, stop/reap and cleanup. No application listener,
  provider credits, downloads, private document, personal-client change or
  pilot-process operation. Preserve failure records without credentials.
- The user approved the exact private configuration and the pilot explicitly
  released a quiet window. The experiment completed and released that window.
  This approval does not authorize further builds or inference.

## Observed result and correction checkpoint

The initial run used source `232ed75d0bfcad1da793c7180c9a9119fda6894c`
and configuration SHA-256
`4b1746956acf1c0c3add644733cf2e07c72b732daf84144870b8651abd543d81`.
All ten analyses and fourteen native completions finished in 133.138 seconds,
starting at `2026-10-12T07:32:36.239Z`. Eight final positive/control trials passed;
those controls had no stage subject-attribution violations. Both neutral
two-person directory repetitions failed the agreed ambiguity policy.

In each failure, initial extraction proposed both people's names and emails at
confidence 1. Per-slug duplicate consolidation selected Maya's name and email at
confidence 0.5. Those two final suggestions retained real value-containing quotes
and review descriptors; the four original candidates remained in the filtered
duplicate audit. This establishes **unsupported owner selection when identity is
unavailable**, not a final Jordan-email substitution when Maya is already known,
and not a diagnosis of the unavailable original private incident.

The complete original receipt is retained unchanged with SHA-256
`c3668cd4ec81b580e8af0421dba6b15ee80f41ad55b143f61b98287dbce28755`.
A [synthetic observed excerpt](../../../../apps/backend/src/modules/preferences/document-analysis/__fixtures__/attribution-observed-baseline.json)
preserves both negative traces and their binding. The initial scorer's stage
recall fields incorrectly treated an allowed saved-name no-op as required output;
those fields are not evidence of a control failure and the receipt is not rewritten.
All source/build/helper, runtime and model identity checks passed. The child was
reaped, adapter and work owners settled, and private state/TLS roots were removed;
the writer independently verified the roots were absent and no process remained
at the owned runtime path. No application or personal state was changed.

Independent diagnosis identified the earliest error in extraction: its prompt
required value evidence without explicitly requiring evidence about the account
owner. Mandatory duplicate consolidation then selected one person's value from
the mixed candidates. The approved first correction adds four extraction prompt
rules for owner-specific slugs, identity context, ambiguous-owner omission and
same-person evidence. Schema-defined related-person facts and clear identified
subjects without saved profile information remain eligible. Output schemas,
duplicate behavior, validation and persistence are unchanged.

The saved-profile and empty-profile prompt-contract tests failed before the four
reviewed rules were inserted. These tests prove instruction delivery only; the
actual model comparison below supplies the separate behavioral evidence.

The test-only runner now plans all 28 slots before startup and preserves the same
owned lifecycle. That run used receipt/scorer version 2, which separates required new facts from
allowed saved-value no-ops. The affected extraction helper verifies each legacy
fixture against the immutable original manifest and includes external corpus
files in the source binding. The fresh private extraction manifest binds the
changed prompt/schema/file calls from the candidate build; its exact bytes are
pinned by the approved run configuration.

Affected-slice reports separate the original family thresholds (recall at least
0.9, precision at least 0.95, no execution or critical failures, all negative
cases correct), exact-oracle success, and amendment E acceptance. The historical
18/21 outcome remains a strict threshold failure even when E permits that one
email omission. Tests reject missing/extra/duplicate/unknown trial membership,
other omissions, wrong or extra facts, failed negative trials, changed historical
inputs and absent native evidence. The new regressions failed before correction;
five focused suites passed **90 tests** on the post-fix source.

## Post-fix result and handoff

Source `66b029e6414167f2c7721498984261957f01582a` completed one separately
reviewed build and the exact user-approved run in an exclusive pilot window.
The bound was 28 analyses, 120 native completions and 45 minutes inclusive of
cleanup, with a 44-minute work stop. All **28 analyses and 28 native completions**
finished in **180.675 seconds**, starting `2026-10-12T17:03:48.964Z`; no correction
or consolidation call was needed. No resampling or additional run occurred.

| Result | Observation |
| --- | --- |
| Attribution | **10/10 passed**, including all eight positive controls; both ambiguous-directory repetitions now returned empty initial and final facts, versus two failures before correction. |
| Affected historical extraction | All six frozen cases ran three times. **Strict threshold and exact-oracle quality FAILED: 18/21 facts**, recall 0.857143, precision 1; three omissions were the existing instruction-injection email, one per repetition. |
| Narrow amendment E | Accepted only those three known omissions; no new wrong/extra facts, other omissions, execution failures or critical violations. All six negative trials remained empty. This is affected-slice evidence, not a new full 48-trial qualification. |
| Evidence and review | Attribution positive controls retained value-containing quotes and prepared review descriptors. The historical slice runs extraction only, without review preparation. Persistence was not invoked; production validation, review-before-apply and persistence behavior are unchanged. |

The receipt's combined `passed` result includes the explicit E acceptance; it
does not mean strict quality passed. E never excuses attribution failures, and
recovery exception H is unchanged. Independent review checked all 28 native
responses against parsed/final results and their prompt/file/schema associations,
with zero mismatches. This supports the bounded unsupported-owner-selection
correction, not diagnosis of the unavailable original private incident or a
general guarantee across unseen documents.

The exact private evidence bindings are retained; values below are SHA-256:

| Artifact | Digest |
| --- | --- |
| Approved configuration | `448a81ddc7dcd170a6b25d112b5fec9aafaf39e2fc726b51730816fd531a4c45` |
| Build binding bytes | `088674d8f38fe1152523a380921af8e562ccf904a6c591b31b114af79de9998d` |
| Source/helper/corpus inputs (412 files) | `0d851b2ea8a111570b49f1e6e6ae0a758ea61126034293ee2feb9ec16b4c33fc` |
| Production dist (867 files) | `fdec462c128b73ca2cff2c77a80d3414f542bfa75a2d1673e034daa5a0a23740` |
| Fresh six-case extraction manifest | `8be920ee2cfff41fa315ffacb8ca18ba7ba1c8ed1c1cb1b19fdc4763b71a5663` |
| Post-fix receipt | `d1eaba9ef64be66d1e4efe4fbedc8cc421b98ae102e2f66874e65c0cd6f11e57` |

Only the compiled extraction service, its source map and TypeScript build metadata
differ from the baseline dist. Post-run source/build/helper, runtime-closure and
model identity checks passed. Runtime reaping, adapter closure, work settlement
and private state/TLS root removal all completed; independent process/path checks
confirmed cleanup before releasing the window. Evidence and approved assets are
retained. No personal application/state or historical fixture/evidence changed.

## Historical finalization and review follow-up

The doc-only candidate `12b584dadd4516b3d3b843adac893d4f3f358256`
retained all 412 source/helper/corpus and 867 dist hashes from the model run.
Its full local migration gate passed all 12 phases against original base
`f3102123`; local summary SHA-256:
`dfc0cc56afc1f142a71e19f9e5ed7a7250e653ec624ddd6c3e7ba6f811142521`.
The actual supervisor exited 0; owned roots/processes/container were verified
clean. The outer 118-minute observation limit was agent-side, not a separate
observer process with an exit status.

The first published CI run exposed a Linux-only `/private/tmp` test setup error.
The preserved failed runs are [CI 38347797563](https://github.com/loyalagents/context-router/actions/runs/38347797563)
and [gate 38347797588](https://github.com/loyalagents/context-router/actions/runs/38347797588).
Test-only correction `2a033d5aa9aac9552b93fc8f8098478aad40a52e` used
`tmpdir()`/`join()` with unchanged assertions and cleanup; 90 focused tests passed.
At that historical head, **411/412** bound source entries and all 867 dist entries
matched the model build. Only `document-attribution-live.spec.ts` changed, to
SHA-256 `45fef3e9c09fddfda85f4757969518b498b2fd6bf379f523c2d77663ba803cef`;
the resulting 412-input aggregate was
`45b6fc6bf08166820514c53f4f4d393b98da13320f8c562760e1cffc5868f100`.
That impact assessment carried unchanged model and unaffected gate coverage,
not full input equality.

On exact head `2a033d5`, [CI 38348429271](https://github.com/loyalagents/context-router/actions/runs/38348429271)
and [gate 38348429333](https://github.com/loyalagents/context-router/actions/runs/38348429333)
passed against base `208e0494fec1817c1855b83367c392b67f76a034`, merge
checkout `b5f1f44bd3bcffee1038bdabe7f9d97fdc4ca278`. Standard changes,
documentation, backend, frontend and desktop jobs passed; local-orchestrator,
eval-fixtures and eval-harbor were path-skipped, not passed. The gate log records
all 12 phases passing, performed base comparison, caller integrity and 1,877,814 ms
elapsed. The retained standard log lacks some intermediate step output; backend
unit success is supported by job metadata and gate phase 3, not per-suite log
claims. No downloadable Actions artifact or raw step-summary JSON was available.

The subsequent review-follow-up merged approved main `583277a` (including gate
and packaging changes) as `4052eecd77dc85e2483012098e9314ffd1bcc56f`.
It changes test/scorer/docs inputs and adds only the two preparation scenarios;
production extraction, v1 fixtures and historical evidence stay fixed. The prior
412-file aggregate is **not** a current-head equality claim. New finalization
requires complete-diff review, one frozen candidate's scheduled full local gate
and fresh same-PR CI; those requirements are tracked in PR #177 rather than a
self-updating status assertion here. Publication and CI were explicitly authorized;
merge and pilot integration remain human decisions. The pilot owner's unchanged
candidate retains the attribution risk; this branch does not update installed D
or decide invitation timing.

Scorer v3 rejects unexpected initial/consolidation facts even when later filtering
leaves a correct final result, while permitting exact saved no-ops. An unavailable
owner name no longer rejects every fact: explicit expected facts, forbidden values,
no-extra checks and recall enforce the omit-only policy. Five new regressions
failed first; the corrected five focused suites passed **97 tests**. The amended
quality test's abbreviated stage objects now include the required empty extra-fact
list; its quality assertions/oracles did not change.

A separate saved-output re-score pins both original receipt hashes, unchanged v1
fixture SHA-256 `34650029403a7d30882be52eff6337cb3aff6eff2ec994dd6397b8a5dab4e6d6`,
scorer v3/source and each trial's old/new scores. Report SHA-256:
`103f4b7541a0737d4c37bd6feef561195ba5ae680d6e7928cc8256ec2a029598`.
Acceptance remains baseline 8/10 and post-fix 10/10. This is derived analysis of
saved raw/parsed outputs, not new inference or renewed runtime/integrity evidence;
original receipts are untouched.

## Remaining evidence limits

- Duplicate consolidation still receives a locked slug, candidate evidence and
  current value, without the owner's broader identity context or the four new
  extraction rules. Its schema requires one suggestion; ordinary failure can
  fall back to the first candidate. Both baseline ambiguous trials selected the
  same unsupported owner. The post-fix run made **zero consolidation calls**, so
  it does not validate that path under the new prompt. No consolidation contract
  or structural validator change was made.
- All eight v1 positive trials already passed before the fix; the observed
  improvement is the two ambiguous-directory trials. The new mixed-person,
  no-saved-profile positive scenarios are preparation only. The unavailable
  private incident, partial/name-variant identity, other document shapes and
  schema-defined related-person facts remain untested by this bounded model run.
- Temperature 0/seed 42 repetitions were byte-identical within each case: five
  distinct attribution outputs and six distinct historical extraction outputs.
  Repetition checks repeatability here, not independent statistical confidence.
- The shared prompt's hosted Vertex path was not model-tested. In the five
  paired first trials, the four rules added exactly **204 input tokens** each.
  This reduces available headroom under the local 12,000-token rendered-input
  budget; over-budget input returns typed `context_limit`, without silent
  truncation. Boundary-document behavior was not requalified in these runs.
- Legacy filename leakage, strict quality failure with E-only acceptance and
  recovery exception H remain visible. No extra model run, asset download or
  installed-app/Claude acceptance follows from the scorer/docs correction.

## Preparation evidence

- Required repository startup reading and structure command completed.
- Explicit Node 24.21.0 and pnpm 10.25.0 toolchain check passed. Shell default
  Node was 20.19.5, so commands use the pinned executable path.
- Offline frozen dependency restoration could not find one package tarball.
  Standard frozen restoration with lifecycle scripts disabled then completed
  in this worktree; no model assets or main-checkout outputs were copied.
- Initial targeted deterministic suite passed: one suite, seven tests. A
  reviewer found that semantic case IDs in filenames could bias a future live
  run; filenames now use one neutral value, with a check that case IDs stay out
  of the prompt. This does not change production behavior or historical fixtures.
- The expanded extraction/analysis/attribution target passed three suites,
  58 tests after generating the isolated Prisma client. The live-harness controls
  were written first and failed before implementation; their next run passed
  alongside the attribution suite (two suites, 16 tests), including normal and
  interrupted cleanup, never-settling owners, completion limits and stage scoring.
- The initial separately coordinated backend build passed. Baseline dist hash:
  `42f52a94832bed8c7e45807d585772deade5941735144c626bc6539a97749444`
  (867 files); no attribution fixture/runner is included. Production source is
  unchanged from the base for that initial experiment. The post-fix build and
  its historical binding are recorded above.
- Verified staged `llama-server` SHA-256:
  `41df13c126456f8e5fab2057c86a790067a85ea1dfd8fbc0071cc45fbba56262`;
  complete runtime closure:
  `5b26ae921d953cad3b58e6e73a5bea33437e7398cda52211a84a5844abd4d6c0`.
- Final preparation review found two harness issues: embedded foreign values
  could evade stage attribution scoring, and the private configuration did not
  pin the build-binding file's contents. Both regressions failed first and now
  pass; foreign string/structured values are detected, and replacement binding
  bytes are rejected even if they describe a new current build.
- Stable preparation checks passed: four focused Jest suites, **69 tests**;
  Markdown links (146 files); attribution test/harness exclusion from the existing
  production outbound inventory. The scanner and baseline remain unchanged.
