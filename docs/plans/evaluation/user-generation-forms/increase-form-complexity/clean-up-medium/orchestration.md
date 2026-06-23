# Packet-Medium Cleanup Orchestration

- Status: cleanup implementation complete locally; live rerun still needed
- Last updated: 2026-06-22
- Scope: small fixes to scoring, form filling, and direct Vertex packet flow

## Goal

Make the `packet-medium` result easier to interpret without changing the core
evaluation design.

Keep the headline comparison open-to-open:

```text
stored-memory MCP:
  docs -> live open-schema storage in backend DB -> fill all packet forms

direct Vertex baseline:
  docs -> one shared open-schema extraction artifact -> fill all packet forms
```

The direct baseline should not use backend memory or MCP. The shared extraction
artifact is an intermediate synthetic memory-like artifact so the direct path
does not extract the same corpus three times.

## Implementation Status

Implemented locally:

- explicit open-schema scoring aliases for packet-medium equivalent facts;
- backend form-fill conditional normalization for citizenship and W-4 filing
  status aliases;
- backend prompt guidance to prefer personal/contact email for I-9 employee
  email;
- direct Vertex packet runner that extracts once and fills all packet forms from
  one synthetic no-DB extraction;
- compact direct extraction prompt and Vertex JSON MIME request.

Verified locally:

- `pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand`;
- `pnpm eval:test`;
- `pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --write-report`;
- all three packet-medium scenario validations.

Still needed:

- one live N=1 rerun of MCP packet and direct Vertex packet using local
  backend/Auth0/Claude/Vertex credentials.

## Starting Point

First live run:

```text
artifact root: /private/tmp/packet-medium-20260622T190349Z
MCP packet: passed
MCP memory: 22/25 known facts recovered, 2/2 missing facts absent
MCP forms: I-9 10/12, W-4 5/6, direct deposit 9/9
Direct Vertex: all three runs failed during extraction
```

Direct Vertex failure:

- the model returned fenced JSON;
- more importantly, the JSON was truncated before closing;
- the extraction prompt produced very large outputs on `packet-medium`;
- no direct form filling happened, so there are no direct form scores yet.

MCP failure themes:

- scoring alias gaps;
- strict value normalization for equivalent statuses;
- form filling choosing work email where the form expects personal email;
- conditional checkbox logic relying on exact slug/value matches.

## Principles

- Keep fixes small and testable.
- Do not introduce a new corpus schema.
- Do not make scoring complicated.
- Prefer alias/normalization tables over custom per-run logic.
- Preserve strict form scoring: wrong values should still fail.
- Preserve open-schema semantics: invented active slugs are allowed when their
  values are correct and supported.

## Checkpoint 1: Record And Reproduce The Medium Run

Capture the current failure modes before changing behavior.

Artifacts to inspect:

- `mcp-open-packet/open-schema-database-score-report.json`;
- per-scenario `form-score-report.json`;
- per-scenario `filled-form.json`;
- direct `open-schema-extraction-response.json`.

Exit criteria:

- current MCP failures are listed in a summary doc or implementation notes;
- direct failure is classified as output truncation, not merely markdown fences;
- no code changes yet.

## Checkpoint 2: Scoring Cleanup

Make the memory score reflect simple semantic recoveries already present in
active memory.

Small fixes:

- Treat `direct_deposit.account_type = Checking` as recovery for
  `banking.accountType = checking`.
- Derive `identity.middleInitial = L` from active `identity.middle_name = Lin`.
- Normalize `workAuthorization.citizenshipStatus` values so
  `A citizen of the United States` matches `U.S. citizen`.
- Ensure `tax.federal_filing_status` is accepted as an alias for
  `tax.filingStatus`.

Non-goals:

- do not reward stale/suggestion-only rows;
- do not add broad fuzzy matching;
- do not weaken form-fill scoring.

Exit criteria:

- memory scoring for the existing MCP artifact improves for alias-equivalent
  facts;
- truly absent facts still score missing;
- `pnpm eval:test` passes.

## Checkpoint 3: Form-Fill Cleanup

Fix the form-filling bridge where the needed memory exists but the backend does
not choose or activate the right form field.

Small fixes:

- I-9 employee email should prefer personal/contact email over work email.
- Citizenship checkbox conditions should understand the normalized citizenship
  aliases from Checkpoint 2.
- W-4 filing-status checkbox should accept the actual active slug
  `tax.federal_filing_status` when it supports the expected branch.
- When the model cites a non-active hint slug but an equivalent active slug
  exists, prefer making the prompt clearer first; only add deterministic
  remapping if the same error persists.

Exit criteria:

- I-9 uses `profile.email` / personal email for the employee email field;
- I-9 citizenship checkbox is checked for the current run;
- W-4 filing-status checkbox is checked for the current run;
- direct-deposit remains 9/9;
- backend form-fill tests pass:

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
```

## Checkpoint 4: Direct Vertex Shared Extraction

Add a packet-level direct baseline so direct extraction runs once per corpus and
the same extracted facts fill all packet forms.

Proposed command:

```bash
pnpm eval:direct-open-schema-packet \
  --user maya-chen-newhire \
  --corpus packet-medium \
  --scenarios maya-chen-newhire-i9-packet-medium,maya-chen-newhire-fw4-packet-medium,maya-chen-newhire-direct-deposit-packet-medium \
  --artifacts-root "$ART/direct-open-packet" \
  --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
```

Behavior:

- validate corpus and scenarios;
- build evidence once from the corpus;
- run one direct open-schema extraction;
- write one shared `open-schema-extraction.json`;
- score one synthetic memory snapshot from that extraction;
- fill each listed form from that same extraction;
- write one packet summary plus per-form artifacts.

Keep the existing single-scenario `pnpm eval:direct-open-schema` command for
debugging.

Exit criteria:

- direct packet command extracts once and fills three forms;
- artifact shape mirrors the MCP packet command where practical;
- tests prove extraction is called once and fill is called once per scenario.

## Checkpoint 5: Direct Vertex Extraction Hardening

Prevent the direct extraction output from exploding on medium-sized corpora.

Small fixes, in preferred order:

1. Request structured JSON output from Vertex if the SDK/model supports it.
2. Reduce extraction verbosity:
   - keep a hard fact cap;
   - use at most one short evidence quote per fact;
   - avoid unresolved/noise/stale explanatory rows unless they are essential.
3. Make the prompt explicitly packet-oriented but still form-neutral:
   - extract durable current user facts useful across a new-hire packet;
   - skip stale, sample, other-person, and operational noise;
   - do not enumerate every ticket id, timestamp, audit note, or sample value.
4. Keep parser tolerance for complete markdown fences, but do not try to salvage
   truncated JSON as a benchmark result.

Exit criteria:

- direct packet extraction produces valid JSON on `packet-medium`;
- extraction is compact enough to leave room for all required fields;
- direct form fills run and produce score reports.

## Checkpoint 6: Compare Medium Again

Rerun the live comparison after cleanup.

Commands:

```bash
export ART="/private/tmp/packet-medium-cleanup-$(date -u +%Y%m%dT%H%M%SZ)"

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

pnpm eval:direct-open-schema-packet \
  --user maya-chen-newhire \
  --corpus packet-medium \
  --scenarios maya-chen-newhire-i9-packet-medium,maya-chen-newhire-fw4-packet-medium,maya-chen-newhire-direct-deposit-packet-medium \
  --artifacts-root "$ART/direct-open-packet" \
  --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
```

Exit criteria:

- MCP has one shared memory score and three form scores;
- direct has one shared extraction/synthetic-memory score and three form scores;
- comparison table reports:
  - memory/extraction recovery;
  - per-form accuracy;
  - missed fields;
  - wrong fields;
  - overfills;
  - abstention correctness.

## Deferred Work

- Make stale and other-person docs subtler after the medium cleanup is stable.
- Add repeated-run variance after the N=1 path is reliable.
- Consider scoring split routing/account digit boxes on SF 1199A.
- Revisit whether direct extraction should have a larger corpus tier once the
  200K evidence cap becomes relevant.
