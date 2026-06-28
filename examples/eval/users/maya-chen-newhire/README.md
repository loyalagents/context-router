# Maya Chen New-Hire Eval Packets

Maya Chen is the shared new-hire profile used to exercise one dossier across
I-9, W-4, and direct deposit form filling.

## Packets

- `packet-small`: small smoke packet for the basic shared-dossier shape.
- `packet-medium`: main baseline packet with realistic source variety, obvious
  stale docs, and obvious other-person/sample noise.
- `packet-hard-ownership-v1`: fixture-only ownership/admissibility packet. It
  adds current-looking values that belong to people adjacent to Maya and checks
  whether those values leak into Maya memory or filled forms.
- `packet-hard-conflict-v1`: fixture-only conflict/temporal packet. It adds
  stale, draft, lower-authority, and before/after records that compete with
  current Maya truth.
- `packet-hard-required-v1`: combined required-evidence packet. It starts from
  the conflict packet, adds an ownership direct-deposit decoy, removes clean
  direct-deposit proof documents, and withholds clean employment title/start
  values so the current banking and employment facts require parsing the harder
  conflict/ownership-bearing documents.

## Required-Hard Evidence Paths

In `packet-hard-required-v1`, current banking facts are intended to come only
from `documents/payroll-tax/031-ledgerpay-deposit-change-audit.yaml`. Current
employment title and start date are intended to come only from
`documents/hr-onboarding/035-hr-support-correction-thread.txt`.

The packet is still a fixture-only eval change. Maya's `profile.yaml`, the form
maps, runners, backend, MCP behavior, and scorers are unchanged.
