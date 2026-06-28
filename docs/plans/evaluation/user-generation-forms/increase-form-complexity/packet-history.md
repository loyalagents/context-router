# Packet History

- Status: compact historical summary
- Last updated: 2026-06-28
- Scope: first shared-dossier packet work for Maya Chen

## First Fixture Slice

The first slice prepared the form and profile groundwork before any shared
packet corpus existed.

Implemented:

- chose the first packet forms: I-9, W-4, and SF 1199A direct deposit;
- added `examples/eval/forms/direct-deposit-sf1199a-24/`;
- added minimal W-4 and SF 1199A field maps;
- created `maya-chen-newhire` as the packet subject;
- added tax, banking, employment, identity, contact, work-authorization, and
  form-ready address facts;
- kept Maya truth-only for open-schema work by omitting `seedPreferences[]`.

Form-map shape:

- I-9 reuses the existing Section 1 map.
- W-4 maps 8 fact fields and skips 40 fields.
- SF 1199A maps 11 fact fields and skips 202 fields.
- SF 1199A routing/account split digit boxes remain skipped in v1.

Important profile choices:

- `contact.phone` is `null`, making phone fields abstention tests.
- `address.current.streetLine` and `address.current.cityStateZip` are explicit
  form-ready facts for simple W-4 and direct-deposit mapping.
- W-4 computed worksheet values are skipped.

## Packet Small

`packet-small` was the first complete shared-dossier vertical slice.

```text
user: maya-chen-newhire
corpus: packet-small
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: 8
source bytes: 6,464
```

Documents:

- driver license OCR;
- SSN card OCR;
- HR onboarding profile export;
- I-9 Section 1 draft export;
- W-4 withholding setup export;
- direct-deposit portal confirmation;
- payroll/direct-deposit instructions;
- other-employee sample packet.

Validation summary:

```text
errors: 0
warnings: 0
documentsChecked: 8
factsProvenPresent: 47
factsMissing: 0
unsupportedDeclaredFacts: 0
```

Live result:

```text
artifact root: /private/tmp/packet-small-clear-email-domains-20260622T010738Z
MCP shared memory: 24/24 known facts recovered, 2/2 missing facts absent
MCP forms:         I-9 12/12, W-4 6/6, direct deposit 9/9
Direct forms:      I-9 12/12, W-4 6/6, direct deposit 9/9
```

Direct extraction recovered all known packet facts for I-9 and direct deposit.
The W-4 direct extraction missed `banking.accountNumber` and
`identity.middleInitial`, but those facts did not affect W-4 form scoring.

Interpretation: packet-small proved the live open-schema packet plumbing. On the
small corpus, stored MCP memory and direct no-memory form filling were tied on
form accuracy.

## Packet Medium

`packet-medium` expanded the same Maya packet into the first harder
context-size tier.

```text
user: maya-chen-newhire
corpus: packet-medium
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: 30
source bytes: 68,803
direct baseline cap: 200,000 characters, not reached
```

Corpus shape:

- 6 extract documents;
- 14 corroborating documents;
- 3 stale guardrail documents;
- 7 ignore/noise documents.

The corpus added obvious stale docs for old address/email, old banking, and old
employment data. It also added obvious other-person/sample docs using non-Maya
sample people. These cues were intentionally easy in v1 so failures would be
diagnosable.

Important caveats:

- `contact.phone` remains intentionally missing with withheld value
  `415-555-0109`.
- Phone distractors are present and can produce validator warnings.
- Current validator warning counts may change as realism checks evolve; use the
  committed `validation-report.json` for current details. The durable readiness
  signal is zero hard corpus-truth failures, no missing declared current facts,
  no current forbidden facts present, and no withheld value leakage.

First live result before cleanup:

```text
artifact root: /private/tmp/packet-medium-20260622T190349Z
MCP packet: passed
MCP memory: 22/25 known facts recovered, 2/2 missing facts absent
MCP forms: I-9 10/12, W-4 5/6, direct deposit 9/9
Direct Vertex: all three single-scenario direct runs failed during extraction
```

Failure themes:

- scoring alias gaps for semantically equivalent facts;
- strict value normalization for equivalent statuses;
- form filling choosing work email where I-9 expects personal/contact email;
- conditional checkbox logic relying on exact slug/value matches;
- direct extraction output too large and truncated before valid JSON closed.

Cleanup implemented after that run:

- open-schema scoring aliases for packet-medium equivalent facts;
- backend form-fill conditional normalization for citizenship and W-4 filing
  status aliases;
- backend prompt guidance to prefer personal/contact email for I-9 employee
  email;
- direct packet runner that extracts once and fills all packet forms from one
  synthetic no-DB extraction;
- compact direct extraction prompt and Vertex JSON MIME request.

Verified locally during cleanup:

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
pnpm eval:test
pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-medium
```

Still useful to run when live credentials are available:

```bash
pnpm eval:e2e-mcp-packet
pnpm eval:direct-open-schema-packet
```

Use fresh artifact roots and compare the stored-memory path against the direct
packet baseline, not against deterministic `eval:run`.
