# Local-Model Evaluation Plan

- Status: active plan
- Outcome owner: local-migration coordinator (`/root`) until Step 06 activates,
  then the Step 06 coordinator
- Owning roadmap step: `06-local-model`
- Outcome: a provider-neutral local-model acceptance suite with explicit,
  opt-in hosted comparisons
- Concrete next action: when Step 06 activates, select the first local runtime
  and approve a same-corpus direct-versus-MCP comparison matrix using
  `packet-hard-required-v4` and `packet-hard-volume-v2`
- Review date: 2026-10-14 or Step 06 activation, whichever comes first
- Source of truth: [`examples/eval/`](../../../../examples/eval/README.md), root
  `eval:*` scripts, and their tests
- Last updated: 2026-09-14

This plan retains only unfinished evaluation work needed to select and validate
the local model boundary. Runnable commands, fixture contracts, and contributor
guidance belong in the eval package documentation. Identity alignment belongs
to Step 03, and product behavior changes belong to their owning migration step.

## Scoring and comparison backlog

Current reporters already capture form correctness and abstention, expected-
value presence versus strict memory shape, withheld-value leakage, overwrite or
blocked-write diagnostics, field-policy outcomes, model/thinking labels,
document order and evidence windows, and heuristic failure attribution. The
remaining bounded work is:

- record the backend's actually loaded model/config instead of relying only on
  a manual label;
- define the minimum metadata contract that makes two artifacts comparable,
  including model, runtime, prompt/tool contract, document set/order/window,
  fill path, and scorer version;
- add repeat-run variance before interpreting small provider/path deltas; and
- improve attribution only when reviewed artifacts expose a recurring ambiguity
  between extraction, storage, normalization, authorization, and form-fill
  failure.

Do not revive conditional requests for curated bundles, broad authority policy,
smart-search scoring, alias/derivation metrics, or extra-slug taxonomies without
a concrete evaluation decision and owner.

## Corpus and extraction benchmark

Keep fixtures synthetic, versioned, immutable, and family-specific. A new
experiment creates a new corpus/version rather than modifying the baseline it
is compared against. Keep extraction, storage, and form-fill scores separate;
report false-positive or ownership/staleness leakage separately from omissions
and correct abstentions.

Broaden users, forms, document realism, and difficulty only to expose a named
model capability gap. Small deterministic fixtures remain the plumbing gate;
realistic and adversarial corpora measure extraction behavior. Any new file
format must deliberately update every relevant generator, schema, validator,
text extractor, upload/discovery surface, and MIME rule in the same scoped
change.

The next benchmark design should preserve profile-backed truth, document-level
fact/forbidden contracts, and artifact-first scoring. It should not turn one
large mixed corpus into an opaque overall quality number.

## Packet benchmark status and next experiments

The committed Maya fixtures and validation reports establish the current packet
shapes. The observations below are concise historical results from legacy
trackers; their temporary raw run roots are not checked in, so treat them as
directional rather than independently reproducible evidence.

| Family | Current role | Recorded lesson or gap |
| --- | --- | --- |
| `packet-hard-required-v4` | Current score-moving required-evidence packet | Separate direct Gemini 2.5 Flash-Lite and Gemini 2.5 Pro observations exposed code-to-label (`DDA` versus `checking`) and boolean-to-enum citizenship normalization gaps; a separate MCP/Claude observation resolved the intended multi-hop evidence. |
| `packet-hard-volume-v2` | Preferred realistic 100-document volume/noise packet | Separate Direct Vertex and MCP/Claude/backend observations kept form correctness and expected-value presence clean; a Direct Vertex reverse-order run changed strict storage shape through composite/alias address rows. |
| `packet-hard-ownership-v1` | Focused ownership/admissibility packet | Fixture and scenarios validate, but a matched live direct-versus-MCP comparison remains open. |

The recorded required-v4 and volume-v2 observations were not established with
matching model, thinking, and fill-path configuration. They are not controlled
direct-versus-MCP comparisons and do not establish model or path superiority.

Run the next work in this order:

1. After Step 06 selects a first local runtime, approve matched direct and MCP
   runs for required v4 and volume v2. Change one comparison dimension at a
   time.
2. Run the focused ownership comparison and classify leakage separately from
   ordinary extraction, storage, or fill errors.
3. Repeat any run before treating a delta as a provider or architecture result.
4. Consider a combined family only after both source families are interpretable;
   create a new label such as `packet-hard-volume-required-v1` rather than
   changing existing baselines.
5. Design an evidence-confidence/abstention family that asks whether evidence is
   sufficient to store or fill a fact.
6. Add exact scorable decoy metadata only if ownership or stale-value failures
   recur. This is a failure-triggered decision, not scheduled implementation.

## Local versus hosted model and agent comparisons

Remote comparisons are explicit opt-in evaluation runs, use synthetic fixtures,
and record provider/model/runtime metadata. They are not part of the default
local product path. Review the command before running it: a hosted CLI or model
provider transmits the selected fixture content outside the machine, and a
backend-fill mode mutates its dedicated eval user.

Use the same corpus, document order/window, model settings, tool/prompt contract,
fill path, and scorer when testing one variable. A direct-versus-MCP result is
an architecture/path comparison, not automatically a pure model comparison:
MCP changes retrieval, storage, authorization, and tool interaction.

For the Claude Code direct baseline, extraction must not receive MCP or backend
memory as an information source. If the canonical comparison materializes the
extracted synthetic snapshot into backend memory afterward, label that stage and
use the same backend form-fill path as the MCP arm. The restricted document
workspace, tools, settings, and empty MCP configuration are not an operating-
system sandbox.

The first Step 06 comparison plan should state what conclusion each arm can and
cannot support, name its mutation/cleanup boundary, and require repeated runs
before promoting an observation into an acceptance threshold.
