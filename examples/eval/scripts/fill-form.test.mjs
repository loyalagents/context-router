import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import {
  loadBackendPdfLib,
  readFilledPdfFields,
} from './eval-runner/pdf.mjs';
import {
  fetchFormFillResponse,
  parseArgs,
  runFillForm,
} from './fill-form.mjs';
import { runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

test('fill-form CLI prints help and reports invalid args clearly', async () => {
  const help = await runFillForm({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:fill-form/);

  const missing = await runFillForm({ repoRoot, args: [], env: {} });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.lines.join('\n'), /Missing required --scenario/);
  assert.doesNotMatch(missing.lines.join('\n'), /--scenario-id/);

  const noToken = parseArgs(
    ['--scenario', 'elena-marquez-i9-template-smoke', '--out', '/tmp/x.json'],
    {},
  );
  assert.equal(noToken.kind, 'usage-error');
  assert.match(noToken.message, /EVAL_AUTH_TOKEN/);
});

test('fill-form CLI uses env fallback and CLI override for backend URL and token', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-env-'));
  const calls = [];
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
  });

  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      path.join(tmp, 'filled-form.json'),
      '--backend-url',
      'https://hosted.example',
      '--auth-token',
      'cli-token',
    ],
    env: {
      EVAL_BACKEND_URL: 'http://localhost:3999',
      EVAL_AUTH_TOKEN: 'env-token',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(response);
    },
    pdfFieldReader: async () => filledPdfFields,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(calls[0].url, 'https://hosted.example/api/form-fill/pdf');
  assert.equal(calls[0].options.headers.authorization, 'Bearer cli-token');
});

test('fill-form validates scenario before backend call', async () => {
  let called = false;
  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'missing-scenario',
      '--out',
      '/private/tmp/missing-filled-form.json',
      '--auth-token',
      'token',
    ],
    env: {},
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(called, false);
  assert.match(result.lines.join('\n'), /SCENARIO_START_PROMPT_MISSING|ENOENT|missing-scenario/);
});

test('fetchFormFillResponse posts the PDF as multipart file with bearer auth', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const calls = [];
  const expectedPayload = {
    status: 'success',
    originalFilename: 'form.pdf',
    outputFilename: 'filled-form.pdf',
    outputMimeType: 'application/pdf',
    filledPdfBase64: Buffer.from('fake-pdf').toString('base64'),
    summary: {
      totalFields: 1,
      filledCount: 0,
      skippedCount: 1,
      filledFields: [],
      skippedFields: [],
      warnings: [],
    },
  };

  const payload = await fetchFormFillResponse({
    backendUrl: 'http://localhost:3000',
    authToken: 'secret-token',
    formPdfPath: fixture.formPdfPath,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(expectedPayload);
    },
  });

  assert.deepEqual(payload, expectedPayload);
  assert.equal(calls[0].url, 'http://localhost:3000/api/form-fill/pdf');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(Object.hasOwn(calls[0].options.headers, 'content-type'), false);
  const file = calls[0].options.body.get('file');
  assert.equal(file.name, 'form.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.ok((await file.arrayBuffer()).byteLength > 1000);
});

test('fill-form writes filled-form, filled PDF, redacted response, and form score report', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-output-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  const filledPdfPath = path.join(tmp, 'filled.pdf');
  const responsePath = path.join(tmp, 'response.json');
  const scorePath = path.join(tmp, 'form-score.json');
  const pdfBytes = Buffer.from('%PDF fake bytes for side artifact\n');
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
    status: 'partial',
    pdfBytes,
  });

  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      filledFormPath,
      '--filled-pdf-out',
      filledPdfPath,
      '--response-out',
      responsePath,
      '--form-score-report',
      scorePath,
    ],
    env: { EVAL_AUTH_TOKEN: 'secret-token' },
    fetchImpl: async () => jsonResponse(response),
    pdfFieldReader: async ({ pdfBytes: passedPdfBytes }) => {
      assert.deepEqual(passedPdfBytes, pdfBytes);
      return filledPdfFields;
    },
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const snapshot = JSON.parse(await readFile(filledFormPath, 'utf8'));
  assert.equal(snapshot.snapshotType, 'filled-form');
  assert.equal(snapshot.response.status, 'partial');
  assert.equal(JSON.stringify(snapshot).includes('filledPdfBase64'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret-token'), false);

  const firstFilled = snapshot.fields.find((field) => field.actual.filled);
  assert.deepEqual(firstFilled.actual.sourceSlugs, firstFilled.expected.sourceSlugs);

  assert.deepEqual(await readFile(filledPdfPath), pdfBytes);
  const responseArtifact = JSON.parse(await readFile(responsePath, 'utf8'));
  assert.equal(responseArtifact.artifactType, 'form-fill-response');
  assert.equal(responseArtifact.backendUrl, 'http://localhost:3000/');
  assert.deepEqual(responseArtifact.response.filledPdfBase64, {
    redacted: true,
    byteLength: pdfBytes.length,
  });
  assert.equal(JSON.stringify(responseArtifact).includes('secret-token'), false);

  const scoreReport = JSON.parse(await readFile(scorePath, 'utf8'));
  assert.equal(scoreReport.scoreType, 'form-fill');
  assert.ok(scoreReport.summary.sourceSlugAgreementRate > 0);
});

test('fill-form accepts success responses and terminal statuses fail clearly', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-status-'));
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
    status: 'success',
  });
  const success = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      path.join(tmp, 'success.json'),
      '--auth-token',
      'token',
    ],
    env: {},
    fetchImpl: async () => jsonResponse(response),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(success.exitCode, 0, success.lines.join('\n'));

  for (const status of ['failed', 'no_fillable_fields', 'unsupported_format']) {
    const terminal = await runFillForm({
      repoRoot,
      args: [
        '--scenario',
        'elena-marquez-i9-template-smoke',
        '--out',
        path.join(tmp, `${status}.json`),
        '--auth-token',
        'token',
      ],
      env: {},
      fetchImpl: async () =>
        jsonResponse({
          ...response,
          status,
          filledPdfBase64: null,
        }),
      pdfFieldReader: async () => filledPdfFields,
    });
    assert.equal(terminal.exitCode, 1);
    assert.match(terminal.lines.join('\n'), new RegExp(`status was ${status}`));
  }
});

test('fill-form writes redacted response artifact for terminal statuses without output artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-terminal-response-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  const filledPdfPath = path.join(tmp, 'filled.pdf');
  const responsePath = path.join(tmp, 'response.json');
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
    status: 'failed',
  });

  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      filledFormPath,
      '--filled-pdf-out',
      filledPdfPath,
      '--response-out',
      responsePath,
      '--auth-token',
      'secret-token',
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        ...response,
        status: 'failed',
        filledPdfBase64: null,
      }),
    pdfFieldReader: async () => filledPdfFields,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /status was failed/);
  const responseArtifact = JSON.parse(await readFile(responsePath, 'utf8'));
  assert.equal(responseArtifact.artifactType, 'form-fill-response');
  assert.equal(responseArtifact.response.status, 'failed');
  assert.equal(responseArtifact.response.filledPdfBase64, null);
  assert.equal(JSON.stringify(responseArtifact).includes('secret-token'), false);
  await assert.rejects(readFile(filledFormPath, 'utf8'), /ENOENT/);
  await assert.rejects(readFile(filledPdfPath), /ENOENT/);
});

test('fill-form builds a live snapshot for the Alex realistic scenario', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-alex-'));
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'alex-i9-realistic',
  });

  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'alex-i9-realistic',
      '--out',
      path.join(tmp, 'alex-filled-form.json'),
      '--auth-token',
      'token',
    ],
    env: {},
    fetchImpl: async () => jsonResponse(response),
    pdfFieldReader: async () => filledPdfFields,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(result.snapshot.scenarioId, 'alex-i9-realistic');
  assert.equal(result.snapshot.userId, 'alex-i9-test');
  assert.equal(result.snapshot.fields.length, 48);
  assert.equal(result.snapshot.summary.plannedActionCounts.SET_TEXT, 15);
  assert.equal(result.snapshot.summary.plannedActionCounts.CHECK, 1);
  assert.equal(result.snapshot.summary.plannedActionCounts.SELECT_OPTION, 1);
  assert.equal(result.snapshot.summary.plannedActionCounts.SKIP, 31);
});

test('fill-form redacts backend URL userinfo in response artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-url-redact-'));
  const responsePath = path.join(tmp, 'response.json');
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
  });

  const result = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      path.join(tmp, 'filled-form.json'),
      '--backend-url',
      'https://user:pass@example.test/base',
      '--auth-token',
      'token',
      '--response-out',
      responsePath,
    ],
    env: {},
    fetchImpl: async () => jsonResponse(response),
    pdfFieldReader: async () => filledPdfFields,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const responseArtifact = JSON.parse(await readFile(responsePath, 'utf8'));
  assert.equal(responseArtifact.backendUrl, 'https://example.test/base');
  assert.equal(JSON.stringify(responseArtifact).includes('user:pass'), false);
});

test('fill-form fails on missing base64, malformed JSON, HTTP failure, and invalid PDF', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-failures-'));
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
  });

  const missingBase64 = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'missing-base64.json')),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        ...response,
        filledPdfBase64: null,
      }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(missingBase64.exitCode, 1);
  assert.match(missingBase64.lines.join('\n'), /did not include filledPdfBase64/);

  const malformed = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'malformed.json')),
    env: {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '{not-json',
    }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(malformed.exitCode, 1);
  assert.match(malformed.lines.join('\n'), /not valid JSON/);

  const httpFailure = await runFillForm({
    repoRoot,
    args: [
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--out',
      path.join(tmp, 'http.json'),
      '--auth-token',
      'secret-token',
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({ message: 'bad token secret-token' }, { ok: false, status: 401 }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(httpFailure.exitCode, 1);
  assert.match(httpFailure.lines.join('\n'), /HTTP 401/);
  assert.doesNotMatch(httpFailure.lines.join('\n'), /secret-token/);

  const invalidPdf = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'invalid-pdf.json')),
    env: {},
    fetchImpl: async () => jsonResponse(response),
  });
  assert.equal(invalidPdf.exitCode, 1);
  assert.match(invalidPdf.lines.join('\n'), /PDF|parse|invalid/i);
});

test('fill-form fails on inconsistent response summary counts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fill-form-counts-'));
  const { response, filledPdfFields } = await fakeResponseForScenario({
    scenarioId: 'elena-marquez-i9-template-smoke',
  });

  const wrongFilledCount = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'wrong-filled-count.json')),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        ...response,
        summary: {
          ...response.summary,
          filledCount: response.summary.filledCount + 1,
        },
      }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(wrongFilledCount.exitCode, 1);
  assert.match(wrongFilledCount.lines.join('\n'), /filledCount .* does not match/);

  const wrongSkippedCount = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'wrong-skipped-count.json')),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        ...response,
        summary: {
          ...response.summary,
          skippedCount: response.summary.skippedCount + 1,
        },
      }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(wrongSkippedCount.exitCode, 1);
  assert.match(wrongSkippedCount.lines.join('\n'), /skippedCount .* does not match/);

  const tooSmallTotal = await runFillForm({
    repoRoot,
    args: baseArgs(path.join(tmp, 'too-small-total.json')),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        ...response,
        summary: {
          ...response.summary,
          totalFields: response.summary.filledCount + response.summary.skippedCount - 1,
        },
      }),
    pdfFieldReader: async () => filledPdfFields,
  });
  assert.equal(tooSmallTotal.exitCode, 1);
  assert.match(tooSmallTotal.lines.join('\n'), /less than filledCount \+ skippedCount/);
});

test('shared PDF helper reads fields in the snapshot-compatible shape', async () => {
  const pdfLib = loadBackendPdfLib(repoRoot);
  const { PDFDocument } = pdfLib;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  const text = form.createTextField('Full Name');
  text.addToPage(page, { x: 20, y: 240, width: 180, height: 20 });
  text.setText('Alex Rivera');
  const checkbox = form.createCheckBox('Attest');
  checkbox.addToPage(page, { x: 20, y: 200, width: 16, height: 16 });
  checkbox.check();
  const bytes = await pdfDoc.save();

  const fields = await readFilledPdfFields({ repoRoot, pdfBytes: bytes });
  assert.deepEqual(fields['Full Name'], { value: 'Alex Rivera' });
  assert.deepEqual(fields.Attest, { checked: true });
});

test('alex realistic scenario validates without an expected filled-form snapshot', async () => {
  const validation = await runValidation({
    repoRoot,
    args: ['--scenario', 'alex-i9-realistic'],
    writeReport: false,
  });
  assert.equal(validation.exitCode, 0);
});

function baseArgs(outPath) {
  return [
    '--scenario',
    'elena-marquez-i9-template-smoke',
    '--out',
    outPath,
    '--auth-token',
    'token',
  ];
}

async function fakeResponseForScenario({
  scenarioId,
  status = 'partial',
  pdfBytes = Buffer.from('not a parseable pdf'),
}) {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId });
  const runPlan = buildRunPlan(fixture);
  const filledActions = runPlan.actionPlans.filter(
    (plan) => plan.fillAction.action !== 'SKIP',
  );
  const skippedActions = runPlan.actionPlans.filter(
    (plan) => plan.fillAction.action === 'SKIP',
  );
  const filledPdfFields = {};
  for (const plan of filledActions) {
    if (plan.fillAction.action === 'SET_TEXT') {
      filledPdfFields[plan.pdfFieldName] = { value: plan.fillAction.value };
    } else if (plan.fillAction.action === 'SELECT_OPTION') {
      filledPdfFields[plan.pdfFieldName] = {
        selected: [plan.fillAction.value],
      };
    } else if (plan.fillAction.action === 'CHECK') {
      filledPdfFields[plan.pdfFieldName] = { checked: true };
    } else if (plan.fillAction.action === 'UNCHECK') {
      filledPdfFields[plan.pdfFieldName] = { checked: false };
    }
  }

  return {
    filledPdfFields,
    response: {
      status,
      originalFilename: 'form.pdf',
      outputFilename: 'filled-form.pdf',
      outputMimeType: 'application/pdf',
      filledPdfBase64: pdfBytes.toString('base64'),
      summary: {
        totalFields: runPlan.actionPlans.length,
        filledCount: filledActions.length,
        skippedCount: skippedActions.length,
        filledFields: filledActions.map((plan) => ({
          pdfFieldName: plan.pdfFieldName,
          fieldType: plan.fieldType,
          sourceSlugs: plan.fillAction.sourceSlugs,
          confidence: plan.fillAction.confidence,
        })),
        skippedFields: skippedActions.map((plan) => ({
          pdfFieldName: plan.pdfFieldName,
          fieldType: plan.fieldType,
          reason: plan.fillAction.skipReason,
          sourceSlugs: plan.fillAction.sourceSlugs,
          confidence: plan.fillAction.confidence,
        })),
        warnings: [],
      },
    },
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}
