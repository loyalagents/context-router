import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import {
  buildDirectOpenSchemaFieldMetadata,
  buildExtractionPrompt,
  buildFactOnlyFillPrompt,
  buildSyntheticMemorySnapshot,
  parseArgs,
  parseJsonObjectResponse,
  runDirectOpenSchema,
  validateExtractionPayload,
  validateFactFillActions,
} from './direct-open-schema.mjs';
import {
  buildPromptFieldMetadata,
  loadEvidenceDocuments,
} from './fill-form-from-docs.mjs';
import { validateWithSchema } from './scoring/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-17T12:00:00.000Z');

test('direct-open-schema CLI parses defaults and reports invalid args', async () => {
  const help = await runDirectOpenSchema({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:direct-open-schema/);

  const missing = parseArgs([], {}, fixedNow);
  assert.equal(missing.kind, 'usage-error');
  assert.match(missing.message, /Missing required --scenario/);

  const parsed = parseArgs(
    [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      '/tmp/direct-open-schema',
      '--provider',
      'vertex',
      '--temperature',
      '0.4',
    ],
    { EVAL_DIRECT_OPEN_SCHEMA_MODEL: 'env-model' },
    fixedNow,
  );
  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.options.model, 'env-model');
  assert.equal(parsed.options.temperature, 0.4);
  assert.equal(parsed.options.runId, 'direct-open-schema-alex-i9-realistic-20260617120000');

  const badProvider = parseArgs(
    [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      '/tmp/direct-open-schema',
      '--provider',
      'backend',
    ],
    {},
    fixedNow,
  );
  assert.equal(badProvider.kind, 'usage-error');
  assert.match(badProvider.message, /provider/);

  const missingModel = parseArgs(
    [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      '/tmp/direct-open-schema',
    ],
    {},
    fixedNow,
  );
  assert.equal(missingModel.kind, 'usage-error');
  assert.match(missingModel.message, /EVAL_DIRECT_OPEN_SCHEMA_MODEL/);
});

test('direct-open-schema builds hidden-truth-safe extraction and fact-only fill prompts', async () => {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId: 'alex-i9-realistic' });
  const documentsRoot = path.join(
    repoRoot,
    'examples/eval/users/alex-i9-test/corpora/realistic',
  );
  const evidenceDocuments = await loadEvidenceDocuments({
    manifest: fixture.manifest,
    documentsRoot,
  });
  const fieldMetadata = buildPromptFieldMetadata(fixture);
  const extractionPrompt = buildExtractionPrompt({
    fixture,
    fieldMetadata,
    evidenceDocuments,
  });

  assert.match(extractionPrompt, /durable, document-supported user facts and preferences/);
  assert.match(extractionPrompt, /You are not filling a form in this stage/);
  assert.match(extractionPrompt, /Return no more than 40 facts/);
  assert.match(extractionPrompt, /at most two evidence entries/);
  assert.match(extractionPrompt, /JSON-safe substring/);
  assert.match(extractionPrompt, /"slug": "category\.fact_name"/);
  assert.match(extractionPrompt, /"label": "Human readable fact label"/);
  assert.match(extractionPrompt, /"quote": "short exact supporting substring"/);
  assert.match(extractionPrompt, /documentId: alex-i9-test-realistic-001/);
  assert.doesNotMatch(extractionPrompt, /Use concise model-authored slugs/);
  assert.doesNotMatch(extractionPrompt, /Slug exactness is diagnostic/);
  assert.doesNotMatch(extractionPrompt, /"slug": "identity\.legal_name"/);
  assert.doesNotMatch(extractionPrompt, /"value": "Alex Rivera"/);
  assert.doesNotMatch(extractionPrompt, /"label": "Phone number"/);
  assert.doesNotMatch(extractionPrompt, /Scenario prompt/);
  assert.doesNotMatch(extractionPrompt, /Safe target form context/);
  assert.doesNotMatch(extractionPrompt, /Fill i-9/);
  assert.doesNotMatch(extractionPrompt, /First Name Given Name/);
  assert.doesNotMatch(extractionPrompt, /"maxLength": 1/);
  assert.doesNotMatch(extractionPrompt, /factKey/);
  assert.doesNotMatch(extractionPrompt, /inferredDataKey/);
  assert.doesNotMatch(extractionPrompt, /seedPreferences/);
  assert.doesNotMatch(extractionPrompt, /validation-report/);
  assert.doesNotMatch(extractionPrompt, /stored-preferences/);
  assert.doesNotMatch(extractionPrompt, /open-schema-extraction\.json/);
  assert.doesNotMatch(extractionPrompt, /filled-form\.json/);
  assert.doesNotMatch(extractionPrompt, /expectedValue/);
  assert.doesNotMatch(extractionPrompt, /profile\.yaml/);
  assert.doesNotMatch(extractionPrompt, /intentionally missing/);
  assert.doesNotMatch(extractionPrompt, /Elena declares this fact/);
  assert.doesNotMatch(extractionPrompt, /corpus manifest marks/);

  const extraction = validExtractionArtifact({
    fixture,
    facts: [
      {
        factId: 'fact-0001',
        slug: 'identity.legal_name',
        label: 'Legal name',
        valueType: 'STRING',
        value: 'Alex Jordan Rivera',
        confidence: 0.9,
        evidence: [
          {
            documentId: evidenceDocuments[0].id,
            quote: 'Alex Jordan Rivera',
          },
        ],
      },
      {
        factId: 'fact-0002',
        slug: 'work-authorization.foreign_passport_number',
        label: 'Foreign Passport Number',
        valueType: 'STRING',
        value: 'XK1234567',
        confidence: 0.95,
        evidence: [
          {
            documentId: evidenceDocuments[0].id,
            quote: 'XK1234567',
          },
        ],
      },
    ],
    unresolved: [
      {
        label: 'Passport Country of Issuance',
        reason: 'The documents do not establish the country of issuance.',
      },
    ],
  });
  const fillPrompt = buildFactOnlyFillPrompt({ fieldMetadata, extraction });
  assert.match(fillPrompt, /Extracted facts/);
  assert.match(fillPrompt, /fact-0001/);
  assert.match(fillPrompt, /fact-0002/);
  assert.match(fillPrompt, /XK1234567/);
  assert.match(fillPrompt, /Foreign Passport Number and Country of IssuanceRow1/);
  assert.match(fillPrompt, /compound or noisy/);
  assert.match(fillPrompt, /clearly matches part of the field name/);
  assert.match(fillPrompt, /targetFactKey/);
  assert.match(fillPrompt, /semanticNote/);
  assert.match(fillPrompt, /strongest field-meaning hints/);
  assert.match(fillPrompt, /render dates as MMDDYYYY/);
  assert.match(fillPrompt, /combine street plus unit\/apartment/);
  assert.match(fillPrompt, /render as City, ST ZIP/);
  assert.match(fillPrompt, /component sourceFactIds/);
  assert.match(fillPrompt, /Treat inferredLabel as a weak fallback hint/);
  assert.match(fillPrompt, /sourceFactIds/);
  assert.match(fillPrompt, /"maxLength": 1/);
  assert.doesNotMatch(fillPrompt, /Evidence documents/);
  assert.doesNotMatch(fillPrompt, /Driver License Upload OCR/);
  assert.doesNotMatch(fillPrompt, /Unresolved facts/);
  assert.doesNotMatch(fillPrompt, /Passport Country of Issuance/);
  assert.doesNotMatch(fillPrompt, /validation-report/);
  assert.doesNotMatch(fillPrompt, /inferredDataKey/);
  assert.doesNotMatch(fillPrompt, /profile\.yaml/);
  assert.doesNotMatch(fillPrompt, /intentionally missing/);
  assert.doesNotMatch(fillPrompt, /Elena declares this fact/);
  assert.doesNotMatch(fillPrompt, /corpus manifest marks/);
  assert.doesNotMatch(fillPrompt, /expectedValue/);

  const safeMetadata = buildDirectOpenSchemaFieldMetadata(fieldMetadata);
  assert.ok(safeMetadata.every((field) => !Object.hasOwn(field, 'inferredDataKey')));
  assert.ok(safeMetadata.some((field) => Object.hasOwn(field, 'targetFactKey')));
  assert.ok(safeMetadata.some((field) => Object.hasOwn(field, 'semanticNote')));
  assert.ok(safeMetadata.every((field) => !Object.hasOwn(field, 'expectedValue')));
  assert.equal(
    safeMetadata.find((field) => field.fieldName === 'Employee Middle Initial (if any)')
      ?.maxLength,
    1,
  );
});

test('direct-open-schema exposes safe W-4 semantic field metadata for opaque fields', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'maya-chen-newhire-fw4-packet-small',
  });
  const safeMetadata = buildDirectOpenSchemaFieldMetadata(
    buildPromptFieldMetadata(fixture),
  );
  const fields = new Map(safeMetadata.map((field) => [field.fieldName, field]));

  assert.equal(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_02[0]')?.targetFactKey,
    'identity.lastName',
  );
  assert.match(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_02[0]')?.semanticNote,
    /last name/i,
  );
  assert.equal(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_03[0]')?.targetFactKey,
    'address.current.streetLine',
  );
  assert.match(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_03[0]')?.semanticNote,
    /address line/i,
  );
  assert.equal(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_04[0]')?.targetFactKey,
    'address.current.cityStateZip',
  );
  assert.match(
    fields.get('topmostSubform[0].Page1[0].Step1a[0].f1_04[0]')?.semanticNote,
    /city, state, and ZIP/i,
  );
  assert.deepEqual(
    fields.get('topmostSubform[0].Page1[0].c1_1[0]')?.condition,
    {
      factKey: 'tax.filingStatus',
      equals: 'single or married filing separately',
    },
  );
  assert.deepEqual(
    fields.get('topmostSubform[0].Page1[0].c1_2[0]')?.fieldPolicy,
    {
      action: 'skip',
      reason: 'out_of_scope',
    },
  );
  assert.equal(
    fields.get('topmostSubform[0].Page1[0].c1_2[0]')?.skipReason,
    'out_of_scope',
  );
  assert.match(
    fields.get('topmostSubform[0].Page1[0].c1_2[0]')?.semanticNote,
    /skipped in v1/i,
  );
  assert.ok(safeMetadata.every((field) => !Object.hasOwn(field, 'expectedValue')));
  assert.ok(safeMetadata.every((field) => !Object.hasOwn(field, 'inferredDataKey')));
});

test('direct-open-schema parser and extraction validation assign stable fact ids and preserve duplicate slugs', async () => {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId: 'alex-i9-realistic' });
  const evidenceDocuments = await loadEvidenceDocuments({
    manifest: fixture.manifest,
    documentsRoot: path.join(repoRoot, 'examples/eval/users/alex-i9-test/corpora/realistic'),
  });
  const parsed = parseJsonObjectResponse(
    '```json\n' +
      JSON.stringify({
        facts: [
          fact('identity.name', 'Legal name', 'Alex Jordan Rivera', evidenceDocuments[0].id),
          fact('identity.name', 'Alternate legal name', 'Alex Jordan Rivera', evidenceDocuments[1].id),
        ],
        unresolved: [{ label: 'Phone number', reason: 'No current source.' }],
      }) +
      '\n```',
  );
  assert.deepEqual(parsed.parseDiagnostics, []);

  const result = validateExtractionPayload({
    parsed: parsed.parsed,
    fixture,
    evidenceDocuments,
    runId: 'test-run',
    model: 'test-model',
    provider: 'vertex',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.extraction.facts.map((candidate) => candidate.factId),
    ['fact-0001', 'fact-0002'],
  );
  assert.deepEqual(result.extraction.diagnostics.duplicateSlugGroups, [
    {
      slug: 'identity.name',
      factIds: ['fact-0001', 'fact-0002'],
    },
  ]);
  await validateWithSchema(
    repoRoot,
    'open-schema-extraction.schema.json',
    result.extraction,
    'open-schema extraction',
  );

  const trailingSlug = validateExtractionPayload({
    parsed: {
      facts: [
        fact('identity.name ', 'Legal name ', 'Alex Jordan Rivera', evidenceDocuments[0].id),
      ],
    },
    fixture,
    evidenceDocuments,
    runId: 'test-run',
    model: 'test-model',
    provider: 'vertex',
  });
  assert.equal(trailingSlug.ok, true);
  assert.equal(trailingSlug.extraction.facts[0].slug, 'identity.name ');
  assert.equal(trailingSlug.extraction.facts[0].label, 'Legal name ');

  const invalidFact = validateExtractionPayload({
    parsed: {
      facts: [
        {
          slug: 'identity.bad',
          label: 'Bad',
          valueType: 'DATE',
          value: '2026-01-01',
          evidence: [{ documentId: 'missing-doc', quote: 'x' }],
        },
      ],
    },
    fixture,
    evidenceDocuments,
    runId: 'test-run',
    model: 'test-model',
    provider: 'vertex',
  });
  assert.equal(invalidFact.ok, true);
  assert.equal(invalidFact.droppedFactCount, 1);
  assert.equal(invalidFact.extraction.diagnostics.droppedFactCount, 1);
  assert.deepEqual(invalidFact.extraction.facts, []);
  assert.match(invalidFact.validationDiagnostics.join('\n'), /valueType/);
  assert.match(invalidFact.validationDiagnostics.join('\n'), /not in the declared corpus/);

  const invalidEnvelope = validateExtractionPayload({
    parsed: { facts: 'not-an-array' },
    fixture,
    evidenceDocuments,
    runId: 'test-run',
    model: 'test-model',
    provider: 'vertex',
  });
  assert.equal(invalidEnvelope.ok, false);
  assert.match(invalidEnvelope.validationDiagnostics.join('\n'), /facts must be an array/);
});

test('direct-open-schema validates fact-only fill actions and derives source slugs', () => {
  const fields = [
    { fieldName: 'Name', fieldType: 'text', options: [] },
    { fieldName: 'Middle', fieldType: 'text', maxLength: 1, options: [] },
    { fieldName: 'State', fieldType: 'dropdown', options: ['OR'] },
    { fieldName: 'Missing', fieldType: 'text', options: [] },
    {
      fieldName: 'Routing Check Digit',
      fieldType: 'text',
      fieldPolicy: { action: 'skip', reason: 'out_of_scope' },
      options: [],
    },
  ];
  const facts = [
    {
      factId: 'fact-0001',
      slug: 'identity.legal_name',
      label: 'Legal name',
      valueType: 'STRING',
      value: 'Alex Jordan Rivera',
      confidence: 0.9,
      evidence: [{ documentId: 'doc-1', quote: 'Alex Jordan Rivera' }],
    },
  ];
  const result = validateFactFillActions({
    fields,
    facts,
    actions: [
      {
        fieldName: 'Name',
        action: 'SET_TEXT',
        value: 'Alex',
        sourceFactIds: ['fact-0001'],
        confidence: 0.7,
      },
      {
        fieldName: 'Middle',
        action: 'SET_TEXT',
        value: 'Jordan',
        sourceFactIds: ['fact-0001'],
        confidence: 0.9,
      },
      {
        fieldName: 'State',
        action: 'SELECT_OPTION',
        value: 'WA',
        sourceFactIds: ['fact-0001'],
        confidence: 0.9,
      },
      {
        fieldName: 'Missing',
        action: 'SET_TEXT',
        value: 'x',
        sourceFactIds: ['missing-fact'],
        confidence: 0.9,
      },
      {
        fieldName: 'Routing Check Digit',
        action: 'SET_TEXT',
        value: '1',
        sourceFactIds: ['fact-0001'],
        confidence: 0.9,
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.validActions, [
    {
      fieldName: 'Name',
      fieldType: 'text',
      action: 'SET_TEXT',
      value: 'Alex',
      sourceSlugs: ['identity.legal_name'],
      confidence: 0.7,
    },
  ]);
  assert.equal(result.diagnostics.lowConfidenceCount, 1);
  assert.equal(
    result.diagnostics.invalidActionReasonCounts[
      'text length 6 exceeds PDF field maxLength 1'
    ],
    1,
  );
  assert.equal(
    result.diagnostics.invalidActionReasonCounts['selected option "WA" is not available'],
    1,
  );
  assert.equal(
    result.diagnostics.invalidActionReasonCounts['field policy skip: out_of_scope'],
    1,
  );
  assert.equal(result.provenanceDiagnostics.unknownSourceFactIdCount, 1);
});

test('direct-open-schema writes form artifacts and skips diagnostic extraction scoring when requested', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-form-only-'));
  const result = await runDirectOpenSchema({
    repoRoot,
    args: [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      tmp,
      '--model',
      'test-model',
      '--skip-extraction-scoring',
    ],
    env: {},
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) =>
      JSON.stringify({
        facts: fakeFacts(evidenceDocuments[0].id),
        unresolved: [{ label: 'Phone number', reason: 'No source document contains it.' }],
      }),
    generateFillResponse: async (_prompt, { fieldMetadata, extraction }) =>
      JSON.stringify({
        fillActions: fieldMetadata.map((field) => fakeActionForField(field, extraction.facts)),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.match(result.lines.join('\n'), /eval direct-open-schema passed/);
  await assertFile(path.join(tmp, 'open-schema-extraction-response.json'));
  await assertFile(path.join(tmp, 'open-schema-extraction.json'));
  await assertFile(path.join(tmp, 'direct-open-schema-fill-response.json'));
  await assertFile(path.join(tmp, 'filled-form.json'));
  await assertFile(path.join(tmp, 'filled-form.pdf'));
  await assertFile(path.join(tmp, 'form-score-report.json'));
  await assert.rejects(access(path.join(tmp, 'synthetic-memory-snapshot.json')));

  const extraction = JSON.parse(await readFile(path.join(tmp, 'open-schema-extraction.json'), 'utf8'));
  assert.equal(extraction.facts[0].factId, 'fact-0001');
  assert.equal(extraction.diagnostics.factCount, 4);

  const fillResponse = JSON.parse(await readFile(path.join(tmp, 'direct-open-schema-fill-response.json'), 'utf8'));
  assert.equal(fillResponse.artifactType, 'direct-open-schema-fill-response');
  assert.equal(fillResponse.promptVersion, 'direct-open-schema-fill-v3');
  assert.equal(fillResponse.validActionCount, 4);
  const firstNameAction = fillResponse.parsed.fillActions.find(
    (action) => action.fieldName === 'First Name Given Name',
  );
  assert.equal(firstNameAction.sourceFactIds[0], 'fact-0002');
});

test('direct-open-schema drops invalid extracted facts and still scores usable facts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-dropped-fact-'));
  const result = await runDirectOpenSchema({
    repoRoot,
    args: [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      tmp,
      '--model',
      'test-model',
      '--skip-extraction-scoring',
    ],
    env: {},
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) =>
      JSON.stringify({
        facts: [
          {
            slug: 'identity.bad',
            label: 'Bad',
            valueType: 'STRING',
            value: 'not usable',
            evidence: [{ documentId: 'not-a-declared-doc', quote: 'not usable' }],
          },
          ...fakeFacts(evidenceDocuments[0].id),
        ],
        unresolved: [],
      }),
    generateFillResponse: async (_prompt, { fieldMetadata, extraction }) =>
      JSON.stringify({
        fillActions: fieldMetadata.map((field) => fakeActionForField(field, extraction.facts)),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  await assertFile(path.join(tmp, 'filled-form.json'));
  await assertFile(path.join(tmp, 'form-score-report.json'));

  const response = JSON.parse(await readFile(path.join(tmp, 'open-schema-extraction-response.json'), 'utf8'));
  assert.equal(response.droppedFactCount, 1);
  assert.match(response.validationDiagnostics.join('\n'), /not in the declared corpus/);

  const extraction = JSON.parse(await readFile(path.join(tmp, 'open-schema-extraction.json'), 'utf8'));
  assert.equal(extraction.diagnostics.droppedFactCount, 1);
  assert.equal(extraction.facts[0].factId, 'fact-0002');
  assert.equal(extraction.facts.length, 4);
});

test('direct-open-schema emits synthetic memory snapshot and PR2 diagnostic reports', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-scored-'));
  const result = await runDirectOpenSchema({
    repoRoot,
    args: [
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      tmp,
      '--model',
      'test-model',
    ],
    env: {},
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) =>
      JSON.stringify({
        facts: fakeFacts(evidenceDocuments[0].id),
        unresolved: [],
      }),
    generateFillResponse: async (_prompt, { fieldMetadata, extraction }) =>
      JSON.stringify({
        fillActions: fieldMetadata.map((field) => fakeActionForField(field, extraction.facts)),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  await assertFile(path.join(tmp, 'synthetic-memory-snapshot.json'));
  await assertFile(path.join(tmp, 'open-schema-database-score-report.json'));
  await assertFile(path.join(tmp, 'open-schema-combined-score-report.json'));

  const snapshot = JSON.parse(await readFile(path.join(tmp, 'synthetic-memory-snapshot.json'), 'utf8'));
  assert.equal(snapshot.diagnostics.queryName, 'SyntheticDirectOpenSchemaSnapshot');
  assert.equal(snapshot.diagnostics.backendUserId, null);
  assert.equal(snapshot.definitionBaseline.strategy, 'synthetic-no-backend');
  assert.equal(snapshot.storageInput.producer, 'direct-open-schema-vertex');
  await validateWithSchema(repoRoot, 'memory-snapshot.schema.json', snapshot, 'synthetic memory snapshot');

  const backendLabeledSnapshot = JSON.parse(JSON.stringify(snapshot));
  backendLabeledSnapshot.diagnostics.queryName = 'EvalMemorySnapshotExport';
  backendLabeledSnapshot.diagnostics.schemaResetMode = 'baseline-only';
  backendLabeledSnapshot.definitionBaseline.strategy = 'baseline-only';
  await assert.rejects(
    validateWithSchema(repoRoot, 'memory-snapshot.schema.json', backendLabeledSnapshot, 'backend memory snapshot'),
  );

  const dbReport = JSON.parse(await readFile(path.join(tmp, 'open-schema-database-score-report.json'), 'utf8'));
  assert.equal(dbReport.scoreType, 'open-schema-database-storage');
  assert.equal(dbReport.memorySnapshot.evaluationMode, 'direct-vertex-open-schema');

  const combined = JSON.parse(await readFile(path.join(tmp, 'open-schema-combined-score-report.json'), 'utf8'));
  assert.equal(combined.scoreType, 'open-schema-combined');
});

test('direct-open-schema synthetic snapshot preserves duplicate slugs as duplicate definitions', async () => {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId: 'alex-i9-realistic' });
  const extraction = validExtractionArtifact({
    fixture,
    facts: [
      {
        factId: 'fact-0001',
        slug: 'duplicate.slug',
        label: 'One',
        valueType: 'STRING',
        value: 'one',
        confidence: 0.9,
        evidence: [{ documentId: 'doc-1', quote: 'one' }],
      },
      {
        factId: 'fact-0002',
        slug: 'duplicate.slug',
        label: 'Two',
        valueType: 'STRING',
        value: 'two',
        confidence: 0.8,
        evidence: [{ documentId: 'doc-2', quote: 'two' }],
      },
    ],
  });
  const snapshot = buildSyntheticMemorySnapshot({
    fixture,
    extraction,
    runId: 'duplicate-test',
    exportedAt: '2026-06-17T12:00:00.000Z',
  });
  assert.equal(snapshot.definitions.length, 2);
  assert.equal(snapshot.preferences.length, 2);
  assert.equal(snapshot.definitions[0].slug, 'duplicate.slug');
  assert.equal(snapshot.definitions[1].slug, 'duplicate.slug');
  assert.notEqual(snapshot.definitions[0].id, snapshot.definitions[1].id);
  await validateWithSchema(repoRoot, 'memory-snapshot.schema.json', snapshot, 'synthetic memory snapshot');
});

function fakeFacts(documentId) {
  return [
    fact('identity.legal_name', 'Legal name', 'Alex Jordan Rivera', documentId),
    fact('identity.first_name', 'First name', 'Alex', documentId),
    fact('identity.last_name', 'Last name', 'Rivera', documentId),
    fact('identity.ssn', 'SSN', '123-45-6789', documentId),
  ];
}

function fact(slug, label, value, documentId) {
  return {
    slug,
    label,
    valueType: 'STRING',
    value,
    confidence: 0.9,
    evidence: [{ documentId, quote: String(value) }],
  };
}

function fakeActionForField(field, facts) {
  const legalName = facts.find((candidate) => candidate.slug === 'identity.legal_name');
  const firstName = facts.find((candidate) => candidate.slug === 'identity.first_name');
  const lastName = facts.find((candidate) => candidate.slug === 'identity.last_name');
  const ssn = facts.find((candidate) => candidate.slug === 'identity.ssn');
  if (field.fieldName === 'First Name Given Name') {
    return textAction(field.fieldName, 'Alex', firstName.factId);
  }
  if (field.fieldName === 'Last Name (Family Name)') {
    return textAction(field.fieldName, 'Rivera', lastName.factId);
  }
  if (field.fieldName === 'US Social Security Number') {
    return textAction(field.fieldName, '123-45-6789', ssn.factId);
  }
  if (field.fieldName === 'Employee Other Last Names Used (if any)') {
    return textAction(field.fieldName, 'Jordan', legalName.factId);
  }
  return {
    fieldName: field.fieldName,
    action: 'SKIP',
    sourceFactIds: [],
    confidence: 0,
    skipReason: 'not needed for test',
  };
}

function textAction(fieldName, value, factId) {
  return {
    fieldName,
    action: 'SET_TEXT',
    value,
    sourceFactIds: [factId],
    confidence: 0.99,
  };
}

function validExtractionArtifact({ fixture, facts, unresolved = [] }) {
  return {
    schemaVersion: 1,
    artifactType: 'direct-open-schema-extraction',
    runId: 'test-run',
    evaluationMode: 'direct-vertex-open-schema',
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    provider: 'vertex',
    model: 'test-model',
    promptVersion: 'direct-open-schema-extraction-v4',
    facts,
    unresolved,
    diagnostics: {
      factCount: facts.length,
      unresolvedCount: unresolved.length,
      droppedFactCount: 0,
      duplicateSlugGroups: [],
    },
  };
}

async function assertFile(filePath) {
  const stat = await access(filePath).then(() => true);
  assert.equal(stat, true);
}
