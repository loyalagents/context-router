# Increase Form Complexity TODO

- Status: live follow-up list
- Last updated: 2026-06-29
- Scope: follow-ups from the completed packet-small and packet-medium work

## Current Next Work

- Continue active hardening work in `make-forms-harder/`.
- Add a new labeled corpus rather than mutating `packet-medium` when testing
  harder ownership or conflict cases.
- Keep each hardening pass focused on one difficulty family so failures stay
  interpretable.
- Track the volume/noise hardening stream in `volume-noise-hardening/`.
- Use `packet-hard-volume-v1` for 100-document length/noise experiments.
- Treat `packet-hard-volume-v1` as a long-context/order smoke test, not as the
  final hard distractor corpus.
- Use `packet-hard-volume-v2` for the next realistic volume/noise baseline with
  subtler near-miss and operational distractors.

## Packet-Medium Follow-Ups

- Run a fresh live `packet-medium` MCP packet and direct packet comparison after
  the cleanup changes to scoring, backend form-fill normalization, and direct
  packet extraction.
- Record fresh artifact roots, model labels, memory/extraction score, per-form
  scores, and notable failure modes in `packet-history.md` if the result is
  useful durable context.
- Treat current packet-medium results as `N=1` and directional until repeat-run
  variance is added.

## Deferred Evaluation Work

- Make stale and other-person documents subtler after the obvious cases are
  stable.
- Add stale-value and other-person false-positive metrics once those failure
  modes show up in live artifacts.
- Add same-user current conflict documents after ownership and stale cases are
  separately understood.
- Run canonical, relevant-last, and seeded-random order variants for
  `packet-hard-volume-v1` once live direct/MCP packet runs are available.
- Compare `packet-hard-volume-v1` against `packet-medium` using the artifact
  document-count, char-count, and order metadata now recorded by packet runs.
- Add packet-aware comparison tooling for direct/MCP packet artifact roots.
  Existing `eval:compare-runs` expects single-scenario known-schema artifacts
  such as `evaluation-run.json`; packet runs write `packet-evaluation-run.json`
  plus per-scenario reports.
- Run canonical, relevant-last, and seeded-random direct/MCP variants for
  `packet-hard-volume-v2` and compare against `packet-hard-volume-v1`.
- Continue improving volume/noise realism after v2 by reducing repeated
  augmentation blocks and adding more document-family-specific source formats.
- Keep the same forms for pure evidence-packet experiments, but do not interpret
  same-form success as form-surface hardening. If the goal is harder forms, plan
  a separate field-map/form-surface pass.
- Consider scoring SF 1199A split routing/account digit boxes only when the
  field-map and renderer work are explicitly in scope.
- Add repeat-run variance reporting after the single-run packet path is
  reliable.
- Revisit the direct baseline's default corpus-size cap only if explicit
  `--max-evidence-chars` overrides become the common case.
