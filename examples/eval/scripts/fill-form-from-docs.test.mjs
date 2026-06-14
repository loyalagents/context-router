import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { validateWithSchema } from './scoring/io.mjs';
import {
  buildDirectFormFillPrompt,
  buildPromptFieldMetadata,
  fillPdfFromActions,
  loadEvidenceDocuments,
  parseArgs,
  parseModelResponse,
  runFillFormFromDocs,
  validateDocFillActions,
} from './fill-form-from-docs.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');

test('fill-form-from-docs CLI prints help and reports invalid args clearly', async () => {
  const help = await runFillFormFromDocs({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:fill-form-from-docs/);

  const missing = await runFillFormFromDocs({ repoRoot, args: [] });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.lines.join('\n'), /Missing required --scenario/);

  const invalid = parseArgs([
    '--scenario',
    '../bad',
    '--out',
    '/tmp/filled-form.json',
  ]);
  assert.equal(invalid.kind, 'usage-error');
  assert.match(invalid.message, /fixture id/);
});

test('fill-form-from-docs parseArgs handles env model fallback and CLI override', () => {
  const envFallback = parseArgs(
    [
      '--scenario',
      'alex-i9-realistic',
      '--out',
      '/tmp/filled-form.json',
    ],
    { EVAL_DIRECT_FORM_FILL_MODEL: 'env-model' },
  );
  assert.equal(envFallback.kind, 'ok');
  assert.equal(envFallback.options.model, 'env-model');
  assert.equal(envFallback.options.temperature, 0.2);

  const cliOverride = parseArgs(
    [
      '--scenario',
      'alex-i9-realistic',
      '--out',
      '/tmp/filled-form.json',
      '--model',
      'cli-model',
      '--temperature',
      '0.6',
      '--backend',
      'vertex',
    ],
    { EVAL_DIRECT_FORM_FILL_MODEL: 'env-model' },
  );
  assert.equal(cliOverride.kind, 'ok');
  assert.equal(cliOverride.options.model, 'cli-model');
  assert.equal(cliOverride.options.temperature, 0.6);
});

test('fill-form-from-docs builds an evidence prompt without fixture truth', async () => {
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
  const prompt = buildDirectFormFillPrompt({ fieldMetadata, evidenceDocuments });

  assert.equal(evidenceDocuments.length, fixture.manifest.documents.length);
  assert.match(prompt, /doc:alex-i9-test-realistic-001/);
  assert.match(prompt, /First Name Given Name/);
  assert.match(prompt, /Driver License Upload OCR/);
  assert.doesNotMatch(prompt, /factContract/);
  assert.doesNotMatch(prompt, /seedPreferences/);
  assert.doesNotMatch(prompt, /validation-report/);
  assert.doesNotMatch(prompt, /expectedValue/);
  assert.doesNotMatch(prompt, /fieldMap/);
});

test('fill-form-from-docs parses plain and fenced JSON model responses', () => {
  assert.deepEqual(parseModelResponse('{"fillActions":[]}'), { fillActions: [] });
  assert.deepEqual(parseModelResponse('```json\n{"fillActions":[]}\n```'), {
    fillActions: [],
  });
  assert.throws(() => parseModelResponse('not json'), /not valid JSON/);
  assert.throws(() => parseModelResponse('{}'), /fillActions/);
});

test('fill-form-from-docs validates action edge cases', () => {
  const evidenceDocuments = [{ id: 'doc-1', ref: 'doc:doc-1' }];
  const fields = [
    {
      fieldName: 'Name',
      fieldType: 'text',
      options: [],
    },
    {
      fieldName: 'State',
      fieldType: 'dropdown',
      options: ['OR', 'WA'],
    },
    {
      fieldName: 'Agree',
      fieldType: 'checkbox',
      options: [],
    },
    {
      fieldName: 'Other',
      fieldType: 'text',
      options: [],
    },
  ];
  const result = validateDocFillActions({
    fields,
    evidenceDocuments,
    confidenceThreshold: 0.75,
    actions: [
      {
        fieldName: 'Unknown',
        action: 'SET_TEXT',
        value: 'ignored',
        sourceSlugs: ['doc:doc-1'],
        confidence: 1,
      },
      {
        fieldName: 'Name',
        action: 'SET_TEXT',
        value: 'Alex',
        sourceSlugs: [],
        confidence: 1,
      },
      {
        fieldName: 'Name',
        action: 'SET_TEXT',
        value: 'Duplicate',
        sourceSlugs: ['doc:doc-1'],
        confidence: 1,
      },
      {
        fieldName: 'State',
        action: 'SELECT_OPTION',
        value: 'CA',
        sourceSlugs: ['doc:doc-1'],
        confidence: 1,
      },
      {
        fieldName: 'Agree',
        action: 'CHECK',
        sourceSlugs: ['doc:missing'],
        confidence: 1,
      },
      {
        fieldName: 'Other',
        action: 'SET_TEXT',
        value: 'value',
        sourceSlugs: ['doc:doc-1'],
        confidence: 0.6,
      },
    ],
  });

  assert.equal(result.validActions.length, 0);
  assert.match(result.warnings.join('\n'), /unknown field/);
  assert.match(result.warnings.join('\n'), /duplicate action/);
  assert.match(
    result.skippedFields.map((field) => field.reason).join('\n'),
    /missing source document ref/,
  );
  assert.match(
    result.skippedFields.map((field) => field.reason).join('\n'),
    /selected option "CA" is not available/,
  );
  assert.match(
    result.skippedFields.map((field) => field.reason).join('\n'),
    /unknown source document ref "doc:missing"/,
  );
  assert.match(
    result.skippedFields.map((field) => field.reason).join('\n'),
    /confidence below threshold/,
  );
});

test('fill-form-from-docs writes filled-form, filled PDF, response, and form score report', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-from-docs-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  const filledPdfPath = path.join(tmp, 'filled-form.pdf');
  const responsePath = path.join(tmp, 'response.json');
  const scorePath = path.join(tmp, 'form-score-report.json');

  const result = await runFillFormFromDocs({
    repoRoot,
    args: [
      '--scenario',
      'alex-i9-realistic',
      '--out',
      filledFormPath,
      '--model',
      'test-model',
      '--filled-pdf-out',
      filledPdfPath,
      '--response-out',
      responsePath,
      '--form-score-report',
      scorePath,
    ],
    env: {},
    generateResponse: async (_prompt, { fieldMetadata, evidenceDocuments }) =>
      JSON.stringify({
        fillActions: fieldMetadata.map((field) =>
          fakeActionForField(field, evidenceDocuments[0].ref),
        ),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(
    result.evidenceDocuments[0].path,
    'documents/identity/001-driver-license-upload-ocr.txt',
  );

  const snapshot = JSON.parse(await readFile(filledFormPath, 'utf8'));
  await validateWithSchema(repoRoot, 'filled-form-snapshot.schema.json', snapshot, 'filled form');
  const firstName = snapshot.fields.find((field) => field.pdfFieldName === 'First Name Given Name');
  assert.equal(firstName.actual.value, 'Alex');
  assert.equal(firstName.actual.sourceSlugs[0], result.evidenceDocuments[0].ref);

  const response = JSON.parse(await readFile(responsePath, 'utf8'));
  assert.equal(response.artifactType, 'direct-doc-form-fill-response');
  assert.equal(response.model, 'test-model');
  assert.equal(response.evidenceDocuments.length, 10);
  assert.match(response.note, /sourceSlugAgreementRate/);

  const score = JSON.parse(await readFile(scorePath, 'utf8'));
  assert.equal(score.scoreType, 'form-fill');
  assert.equal(score.scenarioId, 'alex-i9-realistic');
});

test('fill-form-from-docs local PDF fill writes text and dropdown values', async () => {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId: 'alex-i9-realistic' });
  const pdfBytes = await readFile(fixture.formPdfPath);
  const filled = await fillPdfFromActions({
    repoRoot,
    pdfBytes,
    actions: [
      {
        fieldName: 'First Name Given Name',
        fieldType: 'text',
        action: 'SET_TEXT',
        value: 'Alex',
        sourceSlugs: ['doc:test'],
        confidence: 1,
      },
      {
        fieldName: 'State',
        fieldType: 'dropdown',
        action: 'SELECT_OPTION',
        value: 'OR',
        sourceSlugs: ['doc:test'],
        confidence: 1,
      },
    ],
  });
  assert.ok(Buffer.isBuffer(filled));
  assert.ok(filled.length > 1000);
});

function fakeActionForField(field, sourceRef) {
  if (field.fieldName === 'First Name Given Name') {
    return textAction(field.fieldName, 'Alex', sourceRef);
  }
  if (field.fieldName === 'Last Name (Family Name)') {
    return textAction(field.fieldName, 'Rivera', sourceRef);
  }
  if (field.fieldName === 'State') {
    return {
      fieldName: field.fieldName,
      action: 'SELECT_OPTION',
      value: 'OR',
      sourceSlugs: [sourceRef],
      confidence: 0.99,
    };
  }
  if (field.fieldName === 'US Social Security Number') {
    return textAction(field.fieldName, '123-45-6789', sourceRef);
  }
  return {
    fieldName: field.fieldName,
    action: 'SKIP',
    sourceSlugs: [],
    confidence: 0,
    skipReason: 'not needed for test',
  };
}

function textAction(fieldName, value, sourceRef) {
  return {
    fieldName,
    action: 'SET_TEXT',
    value,
    sourceSlugs: [sourceRef],
    confidence: 0.99,
  };
}
