# Packet-Medium Implementation Summary

- Status: fixture implemented and validated; live MCP/direct runs not run
- Last updated: 2026-06-22
- Scope: `packet-medium` corpus and one-form scenarios for
  `maya-chen-newhire`

## What Changed

Created the harder shared-dossier packet for Maya Chen:

- added `examples/eval/users/maya-chen-newhire/corpora/packet-medium/`;
- authored 30 source documents, 68,803 bytes total source text;
- added a V2 `realistic-generated` corpus manifest;
- wrote `validation-report.json`;
- added one-form scenarios for I-9, W-4, and SF 1199A direct deposit;
- kept `contact.phone` intentionally missing with withheld value
  `415-555-0109`;
- added obvious stale docs for old address/email, old banking, and old
  employment data;
- added obvious other-person/sample docs using non-Maya sample people;
- kept all changes inside the existing manifest, runner, scorer, and form-map
  shapes.

## Final Corpus Shape

```text
user: maya-chen-newhire
corpus: packet-medium
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: 30
source bytes: 68,803
direct baseline cap: 200,000 characters, not reached
```

Scenarios:

- `maya-chen-newhire-i9-packet-medium`;
- `maya-chen-newhire-fw4-packet-medium`;
- `maya-chen-newhire-direct-deposit-packet-medium`.

## Document Review Table

| Doc | Category | Freshness | Expected use | Include facts | Forbid facts | Challenge tags |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | identity | current | extract | identity.legalName, identity.dateOfBirth, address.current.street, address.current.unit, address.current.city, address.current.state, address.current.postalCode | - | identity-evidence, address-evidence |
| 002 | identity | current | extract | identity.legalName, identity.ssn | - | identity-evidence, sensitive-identifier |
| 003 | identity | current | corroborate | identity.firstName, identity.middleInitial, identity.lastName, identity.dateOfBirth, identity.ssn | - | identity-evidence, split-name, sensitive-identifier |
| 004 | work-authorization | current | extract | identity.firstName, identity.lastName, identity.middleInitial, identity.dateOfBirth, identity.ssn, address.current.street, address.current.unit, address.current.city, address.current.state, address.current.postalCode, contact.email, workAuthorization.citizenshipStatus | - | i9-draft, work-authorization, shared-facts |
| 005 | work-authorization | current | corroborate | identity.legalName, workAuthorization.citizenshipStatus | - | work-authorization, citizenship-status |
| 006 | hr-onboarding | current | extract | identity.firstName, identity.lastName, identity.middleInitial, identity.legalName, contact.email, address.current.streetLine, address.current.cityStateZip, employment.company, employment.title, employment.startDate | - | hr-profile, shared-facts, address-evidence |
| 007 | hr-onboarding | current | corroborate | identity.legalName, contact.email, address.current.streetLine, address.current.cityStateZip | - | employee-profile, shared-facts |
| 008 | hr-onboarding | current | corroborate | employment.company, employment.title, employment.startDate, employment.workerId | - | employment-context, worker-id |
| 009 | employer-context | current | corroborate | identity.legalName, employment.company, employment.title, employment.startDate, employment.workEmail | - | offer-email, employment-context |
| 010 | employer-context | current | corroborate | identity.firstName, identity.lastName, employment.title, employment.company, employment.workEmail | - | company-directory, work-email-vs-personal-email |
| 011 | payroll-tax | current | extract | identity.firstName, identity.lastName, identity.ssn, address.current.streetLine, address.current.cityStateZip, tax.filingStatus | - | w4-setup, tax-election |
| 012 | payroll-tax | current | corroborate | tax.filingStatus, tax.multipleJobs, tax.dependentsUnder17, tax.otherDependents, tax.exemptionClaim | - | tax-profile, w4-flags |
| 013 | payroll-tax | current | corroborate | tax.filingStatus, identity.ssn | - | w4-review, sensitive-identifier |
| 014 | employer-context | current | ignore | - | - | instruction-noise, blank-form-guidance |
| 015 | noise | unknown | ignore | - | - | sample-form, instruction-noise |
| 016 | payroll-tax | current | extract | identity.legalName, address.current.streetLine, address.current.city, address.current.state, address.current.postalCode, banking.accountHolderName, banking.institutionName, banking.accountType, banking.routingNumber, banking.accountNumber | - | direct-deposit, banking-evidence |
| 017 | payroll-tax | current | corroborate | banking.accountHolderName, banking.institutionName, banking.routingNumber, banking.accountNumber, banking.accountType | - | bank-letter, banking-evidence |
| 018 | payroll-tax | current | corroborate | banking.accountHolderName, banking.routingNumber, banking.accountNumber | - | voided-check, banking-evidence |
| 019 | employer-context | current | ignore | - | - | instruction-noise, direct-deposit-guide |
| 020 | noise | unknown | ignore | - | - | other-person, sample-packet, direct-deposit-sample |
| 021 | employer-context | current | corroborate | identity.legalName, address.current.streetLine, address.current.cityStateZip, contact.email | - | benefits-profile, shared-facts |
| 022 | employer-context | current | corroborate | employment.workerId, employment.company, employment.title | - | payroll-preview, employment-context |
| 023 | hr-onboarding | current | corroborate | contact.email, address.current.streetLine, address.current.cityStateZip | - | support-ticket, address-evidence, phone-distractor |
| 024 | hr-onboarding | current | corroborate | contact.email, employment.workEmail | - | audit-log, work-email-vs-personal-email |
| 025 | partial-conflicting | stale | guardrail | - | contact.email, address.current.street, address.current.unit, address.current.city, address.current.postalCode | stale-address, stale-email |
| 026 | partial-conflicting | stale | guardrail | - | banking.institutionName, banking.accountNumber, banking.routingNumber | stale-banking |
| 027 | partial-conflicting | stale | guardrail | - | employment.title, employment.startDate | stale-employment |
| 028 | noise | unknown | ignore | - | - | other-person, sample-packet |
| 029 | noise | unknown | ignore | - | - | other-person, sample-form, w4-sample |
| 030 | noise | unknown | ignore | - | - | instruction-noise, phone-distractor |

## Verification

Passed:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --plan-only
pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-medium
pnpm eval:test
```

The committed packet-medium validation report has:

```text
errors: 0
warnings: 4
documentsChecked: 30
factsProvenPresent: 93
factsMissing: 0
forbiddenFactsPresent: 0
withheldValuesPresent: 0
hardFailures: 0
```

Expected warnings:

- document 020 contains a sample-person phone number;
- document 023 contains an HR support desk phone number;
- document 030 contains payroll and bank support phone numbers.

Those warnings are intentional. `contact.phone` remains null for Maya, and the
withheld Maya phone value does not appear in current Maya-owned evidence.

## Live-Run Status

Live MCP and direct Vertex open-schema runs were not run in this implementation
pass. They require local backend/Auth0/Claude/Vertex state.

Use the existing packet wrapper and direct baseline commands when the live
environment is ready:

```bash
pnpm eval:e2e-mcp-packet \
  --agent claude \
  --schema-mode open \
  --form-mode backend \
  --user maya-chen-newhire \
  --corpus packet-medium \
  --scenarios maya-chen-newhire-i9-packet-medium,maya-chen-newhire-fw4-packet-medium,maya-chen-newhire-direct-deposit-packet-medium \
  --artifacts-root "$ART/mcp-open-packet" \
  --mcp-server "$MCP_SERVER" \
  --mcp-config "$MCP_CONFIG" \
  --reset-demo-data \
  --model-label "$EVAL_MODEL_LABEL"
```

```bash
pnpm eval:direct-open-schema --scenario maya-chen-newhire-i9-packet-medium --artifacts-root "$ART/direct-open/i9" --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
pnpm eval:direct-open-schema --scenario maya-chen-newhire-fw4-packet-medium --artifacts-root "$ART/direct-open/fw4" --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
pnpm eval:direct-open-schema --scenario maya-chen-newhire-direct-deposit-packet-medium --artifacts-root "$ART/direct-open/direct-deposit" --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
```

## Known Limitations

- Stale and other-person docs are intentionally obvious in v1.
- Phone distractors are included and therefore produce reviewed validator
  warnings.
- `employment.workerId` and simple W-4 flag facts are declared but not
  high-confidence deterministic prose checks, so they appear as unsupported
  declared facts in the validation report diagnostics.
- SF 1199A split routing/account digit boxes remain skipped/not scored in the
  form map.
- Live results are still `N=1` when run and should be treated as directional.

## Next Step

Run the live packet-medium MCP stored-memory evaluation and direct Vertex
open-schema baselines, then compare against packet-small.

