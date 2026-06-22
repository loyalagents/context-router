# Increase Form Complexity TODO

- Status: follow-up tracker
- Last updated: 2026-06-22
- Scope: deferred improvements for the form packet complexity work

## Packet-Medium Deferred On Purpose

- Make stale documents more subtle and realistic. For v1, stale docs should be
  intentionally obvious with language such as `old`, `superseded`, or `do not
  use` so failures are easy to diagnose.
- Make other-person documents more subtle. For v1, other-person/sample docs
  should be intentionally obvious, for example by naming a sample employee and
  stating that the record is not Maya Chen's onboarding record.
- Add stale-value false-positive metrics only if medium results show stale
  values are a real failure mode.
- Add same-user current conflict documents only after stale and other-person
  cases are working.
- Consider online-inspired document structures later if hand-authored medium
  documents feel repetitive or unrealistic.

## Implementation Note

If a medium-packet fixture-generation helper or authoring script is added, put a
short code comment near the stale and other-person fixture definitions
explaining that those cues are intentionally obvious for v1 and should become
more realistic later.

