# Increase Form Complexity TODO

- Status: live follow-up list
- Last updated: 2026-06-28
- Scope: follow-ups from the completed packet-small and packet-medium work

## Current Next Work

- Continue active hardening work in `make-forms-harder/`.
- Add a new labeled corpus rather than mutating `packet-medium` when testing
  harder ownership or conflict cases.
- Keep each hardening pass focused on one difficulty family so failures stay
  interpretable.

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
- Consider scoring SF 1199A split routing/account digit boxes only when the
  field-map and renderer work are explicitly in scope.
- Add repeat-run variance reporting after the single-run packet path is
  reliable.
- Revisit the direct baseline's corpus-size cap before adding tiers larger than
  the current direct evidence budget.
