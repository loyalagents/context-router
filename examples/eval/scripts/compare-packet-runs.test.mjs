import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runComparePacketRuns,
} from './compare-packet-runs.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

test('compare-packet-runs CLI prints help and validates args', async () => {
  const help = await runComparePacketRuns({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:compare-packet-runs/);

  const missingRoot = parseArgs([]);
  assert.equal(missingRoot.kind, 'usage-error');
  assert.equal(missingRoot.message, 'Missing at least one artifact root');

  const badFormat = parseArgs(['/tmp/run', '--format', 'xml']);
  assert.equal(badFormat.kind, 'usage-error');
  assert.equal(badFormat.message, '--format must be markdown or json');

  const parsed = parseArgs([
    '/tmp/run-a',
    '/tmp/run-b',
    '--format',
    'json',
    '--show-passed',
  ]);
  assert.equal(parsed.kind, 'ok');
  assert.deepEqual(parsed.options.artifactRoots, ['/tmp/run-a', '/tmp/run-b']);
  assert.equal(parsed.options.format, 'json');
  assert.equal(parsed.options.showPassed, true);
});

test('compare-packet-runs analyzes one clean direct root in markdown', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-clean-'));
  const root = path.join(tmp, 'direct-clean');
  await writePacketRoot({
    root,
    runType: 'direct',
    corpusId: 'packet-clean',
    knownRows: [
      knownRow({
        factKey: 'banking.accountType',
        expectedValue: 'checking',
        recovered: true,
        activeRows: [storedRow('banking.account_type', 'checking')],
      }),
    ],
    preferences: [storedRow('banking.account_type', 'checking')],
    extractionFacts: [extractionFact('banking.account_type', 'checking')],
    scenarios: [
      scenario({
        scenarioId: 'direct-deposit',
        fields: [
          formField({
            pdfFieldName: 'xcheck[0]',
            factKey: 'banking.accountType',
            classification: 'form_known_correct',
            expectedValue: true,
            actualValue: true,
          }),
        ],
      }),
    ],
  });

  const result = await runComparePacketRuns({ repoRoot, args: [root] });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const output = result.lines.join('\n');
  assert.match(output, /Packet Run Comparison/);
  assert.match(output, /direct/);
  assert.match(output, /packet-clean/);
  assert.match(output, /No memory or ownership issues found/);
  assert.match(output, /No form issues found/);
});

test('compare-packet-runs emits JSON and detects MCP roots', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-json-'));
  const root = path.join(tmp, 'mcp-clean');
  await writePacketRoot({
    root,
    runType: 'mcp',
    corpusId: 'packet-clean',
    agent: 'claude',
    knownRows: [
      knownRow({
        factKey: 'tax.filingStatus',
        expectedValue: 'single or married filing separately',
        recovered: true,
        activeRows: [
          storedRow(
            'tax.filing_status',
            'single or married filing separately',
          ),
        ],
      }),
    ],
    preferences: [
      storedRow('tax.filing_status', 'single or married filing separately'),
    ],
    scenarios: [
      scenario({
        scenarioId: 'fw4',
        fields: [
          formField({
            pdfFieldName: 'filing_single',
            factKey: 'tax.filingStatus',
            classification: 'form_known_correct',
            expectedValue: true,
            actualValue: true,
          }),
        ],
        fillResponse: {
          response: {
            summary: {
              filledFields: [{ pdfFieldName: 'filing_single' }],
              skippedFields: [],
            },
          },
        },
      }),
    ],
  });

  const result = await runComparePacketRuns({
    repoRoot,
    args: [root, '--format', 'json', '--show-passed'],
  });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const report = JSON.parse(result.outputText);
  assert.equal(report.runs[0].runType, 'mcp');
  assert.equal(report.runs[0].modelOrAgent, 'claude agent');
  assert.equal(report.runs[0].memoryPassed.length, 1);
});

test('compare-packet-runs flags missing artifacts clearly', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-missing-'));
  const root = path.join(tmp, 'broken');
  await mkdir(root, { recursive: true });
  await writeJson(path.join(root, 'packet-evaluation-run.json'), {
    runId: 'broken',
  });

  const result = await runComparePacketRuns({ repoRoot, args: [root] });
  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /missing required artifact/);
  assert.match(result.lines.join('\n'), /open-schema-database-score-report/);
});

test('compare-packet-runs classifies code-label normalization and memory-backed form miss', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-code-'));
  const baseline = path.join(tmp, 'v3');
  const run = path.join(tmp, 'v4');

  await writePacketRoot({
    root: baseline,
    runType: 'direct',
    corpusId: 'packet-hard-required-v3',
    knownRows: [
      knownRow({
        factKey: 'banking.accountType',
        expectedValue: 'checking',
        recovered: true,
        activeRows: [storedRow('banking.account_type', 'checking')],
      }),
    ],
    preferences: [storedRow('banking.account_type', 'checking')],
    extractionFacts: [extractionFact('banking.account_type', 'checking')],
    scenarios: [
      scenario({
        scenarioId: 'direct-deposit-v3',
        fields: [
          formField({
            pdfFieldName: 'xcheck[0]',
            factKey: 'banking.accountType',
            classification: 'form_known_correct',
            expectedValue: true,
            actualValue: true,
          }),
        ],
      }),
    ],
  });

  await writePacketRoot({
    root: run,
    runType: 'direct',
    corpusId: 'packet-hard-required-v4',
    knownRows: [
      knownRow({
        factKey: 'banking.accountType',
        expectedValue: 'checking',
        recovered: false,
      }),
    ],
    preferences: [storedRow('payroll.direct_deposit.account_type', 'DDA')],
    extractionFacts: [
      extractionFact('payroll.direct_deposit.account_type', 'DDA'),
    ],
    scenarios: [
      scenario({
        scenarioId: 'direct-deposit-v4',
        fields: [
          formField({
            pdfFieldName: 'xcheck[0]',
            factKey: 'banking.accountType',
            classification: 'form_known_missing',
            expectedValue: true,
            actualValue: false,
          }),
        ],
        combinedFacts: [
          combinedFact({
            factKey: 'banking.accountType',
            expectedValue: 'checking',
            memoryStatus: 'missing',
            formStatus: 'missing',
          }),
        ],
      }),
    ],
  });

  const result = await runComparePacketRuns({ repoRoot, args: [baseline, run] });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const output = result.lines.join('\n');
  assert.match(output, /normalization_code_label/);
  assert.match(output, /DDA/);
  assert.match(output, /form_missing_due_memory/);
  assert.match(output, /packet-hard-required-v3 -> packet-hard-required-v4/);
});

test('compare-packet-runs classifies boolean-enum memory and form application issues', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-bool-'));
  const root = path.join(tmp, 'direct-bool');
  await writePacketRoot({
    root,
    runType: 'direct',
    corpusId: 'packet-bool',
    knownRows: [
      knownRow({
        factKey: 'workAuthorization.citizenshipStatus',
        expectedValue: 'U.S. citizen',
        recovered: false,
      }),
    ],
    preferences: [storedRow('person.citizenship.is_citizen', true)],
    extractionFacts: [
      extractionFact('person.citizenship.is_citizen', true, {
        valueType: 'BOOLEAN',
      }),
    ],
    scenarios: [
      scenario({
        scenarioId: 'i9',
        fields: [
          formField({
            pdfFieldName: 'CB_1',
            factKey: 'workAuthorization.citizenshipStatus',
            classification: 'form_known_missing',
            expectedAction: 'CHECK',
            expectedValue: true,
            actualValue: false,
          }),
        ],
        combinedFacts: [
          combinedFact({
            factKey: 'workAuthorization.citizenshipStatus',
            expectedValue: 'U.S. citizen',
            memoryStatus: 'missing',
            formStatus: 'missing',
          }),
        ],
        fillResponse: {
          parsed: {
            fillActions: [
              {
                fieldName: 'CB_1',
                action: 'CHECK',
                sourceFactIds: ['fact-0013'],
              },
            ],
          },
        },
      }),
    ],
  });

  const result = await runComparePacketRuns({ repoRoot, args: [root] });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const output = result.lines.join('\n');
  assert.match(output, /normalization_boolean_enum/);
  assert.match(output, /form_condition_or_application/);
  assert.match(output, /person\.citizenship\.is_citizen=true/);
});

test('compare-packet-runs classifies extracted-but-not-stored', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-extracted-'));
  const root = path.join(tmp, 'direct-extracted');
  await writePacketRoot({
    root,
    runType: 'direct',
    corpusId: 'packet-extracted',
    knownRows: [
      knownRow({
        factKey: 'employment.title',
        expectedValue: 'Client Operations Associate',
        recovered: false,
      }),
    ],
    preferences: [],
    extractionFacts: [
      extractionFact('employment.title', 'Client Operations Associate'),
    ],
  });

  const result = await runComparePacketRuns({ repoRoot, args: [root] });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.match(result.lines.join('\n'), /extracted_not_stored/);
});

test('compare-packet-runs warns on truncation and changed document settings', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-packet-docs-'));
  const baseline = path.join(tmp, 'baseline');
  const run = path.join(tmp, 'changed');

  await writePacketRoot({
    root: baseline,
    runType: 'direct',
    corpusId: 'packet-docs-a',
    documentCount: 8,
    sourceCharCount: 1000,
    evidenceCharCount: 1000,
    maxEvidenceChars: 2000,
    documentOrder: 'canonical',
    documentOrderSeed: 'packet-document-order-v1',
  });
  await writePacketRoot({
    root: run,
    runType: 'direct',
    corpusId: 'packet-docs-b',
    documentCount: 10,
    sourceCharCount: 5000,
    evidenceCharCount: 2000,
    maxEvidenceChars: 3000,
    documentOrder: 'relevant-last',
    documentOrderSeed: 'seed-1',
  });

  const result = await runComparePacketRuns({ repoRoot, args: [baseline, run] });
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const output = result.lines.join('\n');
  assert.match(output, /document_coverage_or_truncation/);
  assert.match(output, /Evidence chars 2000 are lower than source chars 5000/);
  assert.match(output, /documentCount changed from 8 to 10/);
  assert.match(output, /documentOrderMode changed from canonical to relevant-last/);
  assert.match(output, /maxEvidenceChars changed from 2000 to 3000/);
});

async function writePacketRoot({
  root,
  runType = 'direct',
  corpusId = 'packet-test',
  userId = 'maya-chen-newhire',
  modelLabel = 'gemini-test',
  agent = null,
  knownRows = [],
  ownershipRows = [],
  preferences = [],
  suggestions = [],
  extractionFacts = [],
  scenarios = [],
  documentCount = 3,
  sourceCharCount = 1000,
  evidenceCharCount = 1000,
  maxEvidenceChars = 2000,
  documentOrder = 'canonical',
  documentOrderSeed = 'packet-document-order-v1',
} = {}) {
  await mkdir(root, { recursive: true });
  const orderedDocumentIds = Array.from(
    { length: documentCount },
    (_, index) => `doc-${String(index + 1).padStart(3, '0')}`,
  );
  const formSummary = aggregateScenarioSummaries(scenarios);
  const recovered = knownRows.filter((row) => row.valueRecoveredInActiveMemory).length;
  const ownershipClean = ownershipRows.filter(
    (row) => row.classification === 'clean',
  ).length;

  await writeJson(path.join(root, 'packet-evaluation-run.json'), {
    schemaVersion: 1,
    artifactType: 'packet-evaluation-run',
    evaluationMode: runType === 'direct' ? 'direct-open-schema-packet' : 'mcp-open-schema',
    status: 'passed',
    runId: `${runType}-${corpusId}`,
    userId,
    corpusId,
    scenarioIds: scenarios.map((entry) => entry.scenarioId),
    model:
      runType === 'direct'
        ? {
            label: modelLabel,
            source: 'test',
          }
        : null,
    settings: {
      agent: runType === 'mcp' ? agent ?? 'claude' : undefined,
      documentOrder,
      documentOrderSeed,
      maxEvidenceChars,
    },
    documents: {
      documentCount,
      sourceCharCount,
      evidenceCharCount,
      maxEvidenceChars,
      order: {
        mode: documentOrder,
        seed: documentOrder === 'canonical' ? null : documentOrderSeed,
        orderedDocumentIds,
      },
    },
    qualitySummary: {
      memoryKnownRecovered: `${recovered}/${knownRows.length}`,
      memoryOwnershipClean: `${ownershipClean}/${ownershipRows.length}`,
      memoryOwnershipForbiddenLeaks: ownershipRows.length - ownershipClean,
      knownFieldCorrect: `${formSummary.knownFieldCorrect}/${formSummary.knownFieldTotal}`,
      knownFieldWrong: formSummary.knownFieldWrong,
      knownFieldMissing: formSummary.knownFieldMissing,
      overfillCount: formSummary.overfillCount,
      perScenario: Object.fromEntries(
        scenarios.map((entry) => [
          entry.scenarioId,
          {
            knownFieldCorrect: `${entry.summary.knownFieldCorrect}/${entry.summary.knownFieldTotal}`,
            knownFieldWrong: entry.summary.knownFieldWrong,
            knownFieldMissing: entry.summary.knownFieldMissing,
            knownFieldAccuracy:
              entry.summary.knownFieldTotal === 0
                ? null
                : entry.summary.knownFieldCorrect / entry.summary.knownFieldTotal,
            overfillCount: entry.summary.overfillCount,
          },
        ]),
      ),
    },
  });

  await writeJson(path.join(root, 'open-schema-database-score-report.json'), {
    schemaVersion: 1,
    scoreType: 'open-schema-database',
    userId,
    corpusId,
    summary: {
      knownPresentTotal: knownRows.length,
      knownPresentRecoveredActive: recovered,
      knownPresentSuggestionOnly: knownRows.filter((row) => row.suggestionOnly).length,
      knownPresentWrongValue: knownRows.filter((row) => row.acceptedSlugHasWrongValue)
        .length,
      knownPresentMissing: knownRows.filter(
        (row) => !row.valueRecoveredInActiveMemory,
      ).length,
      knownPresentConflict: knownRows.filter((row) => row.conflict).length,
      ownershipDecoyTotal: ownershipRows.length,
      ownershipDecoyClean: ownershipClean,
      ownershipDecoyForbiddenActiveLeak: ownershipRows.length - ownershipClean,
      ownershipDecoyForbiddenSuggestionLeak: 0,
    },
    knownPresent: knownRows,
    intentionallyMissing: [],
    ownershipDecoyAudit: ownershipRows,
  });

  await writeJson(
    path.join(
      root,
      runType === 'direct' ? 'synthetic-memory-snapshot.json' : 'memory-snapshot.json',
    ),
    {
      schemaVersion: 1,
      artifactType: 'memory-snapshot',
      runId: `${runType}-${corpusId}`,
      evaluationMode: runType,
      userId,
      corpusId,
      preferences,
      suggestions,
      definitions: [],
    },
  );

  if (extractionFacts.length > 0) {
    await writeJson(path.join(root, 'open-schema-extraction.json'), {
      schemaVersion: 1,
      artifactType: 'open-schema-extraction',
      runId: `${runType}-${corpusId}`,
      evaluationMode: runType,
      userId,
      corpusId,
      facts: extractionFacts,
      unresolved: [],
    });
  }

  for (const entry of scenarios) {
    const scenarioRoot = path.join(root, 'scenarios', entry.scenarioId);
    await mkdir(scenarioRoot, { recursive: true });
    await writeJson(path.join(scenarioRoot, 'form-score-report.json'), {
      schemaVersion: 1,
      scoreType: 'form-fill',
      scenarioId: entry.scenarioId,
      userId,
      corpusId,
      formId: entry.formId,
      summary: entry.summary,
      fields: entry.fields,
    });
    await writeJson(
      path.join(scenarioRoot, 'open-schema-combined-score-report.json'),
      {
        schemaVersion: 1,
        scoreType: 'open-schema-combined',
        scenarioId: entry.scenarioId,
        userId,
        corpusId,
        formId: entry.formId,
        summary: {
          factTotal: entry.combinedFacts.length,
        },
        facts: entry.combinedFacts,
      },
    );
    if (entry.fillResponse) {
      await writeJson(
        path.join(
          scenarioRoot,
          runType === 'direct'
            ? 'direct-open-schema-fill-response.json'
            : 'form-fill-response.json',
        ),
        {
          schemaVersion: 1,
          artifactType: 'fill-response',
          scenarioId: entry.scenarioId,
          ...entry.fillResponse,
        },
      );
    }
    await writeJson(path.join(scenarioRoot, 'filled-form.json'), {
      schemaVersion: 1,
      scenarioId: entry.scenarioId,
      fields: [],
    });
  }
}

function knownRow({
  factKey,
  expectedValue,
  recovered,
  activeRows = [],
  acceptedWrongRows = [],
  suggestionRows = [],
  classification = recovered
    ? 'open_known_present_recovered_accepted_slug'
    : 'open_known_present_missing',
}) {
  return {
    factKey,
    expectedValue,
    canonicalSlugs: [factKey],
    acceptedAliasSlugs: [factKey],
    valueRecoveredInActiveMemory: recovered,
    recoveredUnderAcceptedSlug: recovered,
    recoveredUnderNovelSlug: false,
    suggestionOnly: suggestionRows.length > 0,
    acceptedSlugPopulated: recovered,
    acceptedSlugHasWrongValue: acceptedWrongRows.length > 0,
    conflict: false,
    matchingActiveRows: activeRows,
    matchingAcceptedRows: activeRows,
    matchingNovelRows: [],
    acceptedSlugRows: activeRows,
    acceptedWrongRows,
    matchingSuggestionRows: suggestionRows,
    classification,
  };
}

function storedRow(slug, value) {
  return {
    id: `pref-${slug}`,
    slug,
    definitionId: `def-${slug}`,
    value,
    status: 'ACTIVE',
    sourceType: 'TEST',
    confidence: 0.99,
  };
}

function extractionFact(slug, value, overrides = {}) {
  return {
    factId: `fact-${slug}`,
    slug,
    label: slug,
    valueType: typeof value === 'boolean' ? 'BOOLEAN' : 'STRING',
    value,
    confidence: 0.99,
    evidence: [],
    ...overrides,
  };
}

function scenario({
  scenarioId,
  formId = 'form-test',
  fields = [],
  combinedFacts = [],
  fillResponse = null,
}) {
  const summary = {
    knownFieldTotal: fields.filter((field) => field.fieldClass !== 'abstention-test')
      .length,
    knownFieldCorrect: fields.filter(
      (field) => field.classification === 'form_known_correct',
    ).length,
    knownFieldMissing: fields.filter(
      (field) => field.classification === 'form_known_missing',
    ).length,
    knownFieldWrong: fields.filter(
      (field) => field.classification === 'form_known_wrong',
    ).length,
    abstentionFieldTotal: 0,
    abstentionFieldAbsentCorrect: 0,
    abstentionFieldHallucinated: 0,
    structuralSkipCount: 0,
    structuralOverfillCount: fields.filter((field) => field.overfill).length,
    manualAttestationOverfillCount: 0,
    outOfScopeOverfillCount: 0,
    unmappedOverfillCount: 0,
    unsupportedFieldCount: 0,
    overfillCount: fields.filter((field) => field.overfill).length,
  };
  return {
    scenarioId,
    formId,
    fields,
    combinedFacts,
    fillResponse,
    summary,
  };
}

function formField({
  pdfFieldName,
  factKey,
  classification,
  expectedAction = 'CHECK',
  expectedValue,
  actualValue,
}) {
  return {
    fieldIndex: 0,
    pdfFieldName,
    factKey,
    fieldClass: 'should-fill',
    expectedAction,
    expectedValue,
    actualValue,
    sourceSlugs: [],
    sourceSlugAgrees: false,
    snapshotClassification: classification === 'form_known_correct' ? 'correct' : 'missing',
    classification,
    exactTextMatch: null,
    renderVariant: null,
    overfill: false,
    overfillSeverity: null,
    overfillReason: null,
  };
}

function combinedFact({ factKey, expectedValue, memoryStatus, formStatus }) {
  return {
    factKey,
    expectedValue,
    memory: {
      classification:
        memoryStatus === 'missing'
          ? 'open_known_present_missing'
          : 'open_known_present_recovered_accepted_slug',
      valueRecoveredInActiveMemory: memoryStatus !== 'missing',
      suggestionOnly: false,
    },
    form: {
      fields: [],
    },
    memoryClass:
      memoryStatus === 'missing'
        ? 'open_known_present_missing'
        : 'open_known_present_recovered_accepted_slug',
    memoryStatus,
    formStatus,
    stageAttribution: `open_memory_${memoryStatus}_form_${formStatus}`,
  };
}

function aggregateScenarioSummaries(scenarios) {
  return scenarios.reduce(
    (summary, entry) => ({
      knownFieldTotal: summary.knownFieldTotal + entry.summary.knownFieldTotal,
      knownFieldCorrect: summary.knownFieldCorrect + entry.summary.knownFieldCorrect,
      knownFieldMissing: summary.knownFieldMissing + entry.summary.knownFieldMissing,
      knownFieldWrong: summary.knownFieldWrong + entry.summary.knownFieldWrong,
      overfillCount: summary.overfillCount + entry.summary.overfillCount,
    }),
    {
      knownFieldTotal: 0,
      knownFieldCorrect: 0,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      overfillCount: 0,
    },
  );
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonText(value));
}
