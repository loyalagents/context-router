# Document attribution investigation

- Status: synthetic preparation; actual model reproduction pending; no production fix or readiness claim
- Base: remote `main` verified at `f31021234fe3eac347261466b9c708231f0f2841`
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
Every model-visible filename is the neutral `synthetic-note.txt`; semantic case
IDs remain receipt metadata so they cannot reveal the expected result.

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
This is the fixture oracle, not authorization to change production behavior
without reproduction and reviewed diagnosis. No blanket email suppression or
multi-person rejection is acceptable.

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

## Live proposal prerequisites — prepared, not approved to run

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
  model modification, download or inference has occurred.
- Preserve production configuration: 16,384 context, one slot, GPU layers all,
  flash attention on, fit off, batch/ubatch 512, mmap/offline, thinking disabled,
  no context shift or prompt/idle caches; production client temperature 0,
  seed 42 and output maximum 2,048. Keep existing workflow/adapter/correction
  caps. Bind source, fixture, catalog, prompt/schema, runtime/model/config and
  actual returned evidence to the receipt.
  The reviewed private configuration's SHA-256 is required on the run command.
  Recheck source/build/helper/runtime closure and model metadata after use; drift
  prevents success while retaining all observations. Initial/consolidation
  subject violations remain separate from final actionable utility and evidence.
- Fresh private owned state/credential roots, ephemeral loopback port, dedicated
  exact child handles, read-only approved assets and isolated worktree output.
  The writer owns cancellation, stop/reap and cleanup. No application listener,
  provider credits, downloads, private document, personal-client change or
  pilot-process operation. Preserve failure records without credentials.
- A live quiet window is **pending** after the pilot's current packaging/browser/
  gate work. No live inference is authorized by the preparation review. Runtime
  staging contains only the verified archive's binaries/libraries/license; no
  binary has been executed. The runner stays outside production output.

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
- One separately coordinated backend build passed. Production dist hash:
  `42f52a94832bed8c7e45807d585772deade5941735144c626bc6539a97749444`
  (867 files); no attribution fixture/runner is included. Production source is
  unchanged from the base. Later test-only harness edits do not invalidate that
  production output; the final run binding includes the final tests and helpers.
- Verified staged `llama-server` SHA-256:
  `41df13c126456f8e5fab2057c86a790067a85ea1dfd8fbc0071cc45fbba56262`;
  complete runtime closure:
  `5b26ae921d953cad3b58e6e73a5bea33437e7398cda52211a84a5844abd4d6c0`.
- Stable preparation checks passed: four focused Jest suites, **67 tests**;
  Markdown links (146 files); attribution test/harness exclusion from the existing
  production outbound inventory. The scanner and baseline remain unchanged.
- Targeted checks passed; final validation pending. Actual reproduction and
  final readiness remain pending. Independent complete-diff review is requested
  for the preparation snapshot before any live-run approval request.
