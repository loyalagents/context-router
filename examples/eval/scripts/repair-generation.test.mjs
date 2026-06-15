import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runRepairGeneration } from './repair-generation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('repair-generation regenerates only documents with validation failures', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, corpusRoot, doc } = await writeRepairFixture(t, root);
  const calls = [];
  const manifestPath = path.join(corpusRoot, 'manifest.json');
  const originalManifestText = await readFile(manifestPath, 'utf8');

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async (prompt, context) => {
      calls.push({ prompt, docId: context.doc.id });
      return [
        'Repair export for Samir Desai.',
        'First name: Samir.',
        'Last name: Desai.',
        'Middle initial: A.',
        'Other last names: Mehta.',
        'Date of birth: 1989-11-04.',
        'SSN: 000-00-0389.',
        'Address: 1268 Lakeview Terrace, Unit 4C, Madison, WI 53703.',
        'Personal email: samir.desai@example.test.',
        'Citizenship status: lawful permanent resident.',
        'USCIS A-number: 123456789.',
      ].join('\n');
    },
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.equal(await readFile(manifestPath, 'utf8'), originalManifestText);
  assert.deepEqual(calls.map((call) => call.docId), [doc.id]);
  assert.match(calls[0].prompt, /DOCUMENT_FACT_VALUE_MISSING/);
  assert.match(await readFile(path.join(previewRoot, doc.path), 'utf8'), /123456789/);
  const report = JSON.parse(
    await readFile(path.join(previewRoot, 'repair-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'pass');
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.phase),
    ['pre-repair-validation', 'post-repair-validation'],
  );
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.status),
    ['fail', 'pass'],
  );
  assert.deepEqual(report.repairedDocumentIds, [doc.id]);
});

test('repair-generation builds repair prompts from plan docs with per-doc forbidden facts', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, doc } = await writeRepairFixture(t, root, {
    forbid: ['employment.workEmail'],
  });
  const calls = [];

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async (prompt, context) => {
      calls.push({ prompt, doc: context.doc });
      return [
        'Repair export for Samir Desai.',
        'First name: Samir.',
        'Last name: Desai.',
        'Middle initial: A.',
        'Other last names: Mehta.',
        'Date of birth: 1989-11-04.',
        'SSN: 000-00-0389.',
        'Address: 1268 Lakeview Terrace, Unit 4C, Madison, WI 53703.',
        'Personal email: samir.desai@example.test.',
        'Citizenship status: lawful permanent resident.',
        'USCIS A-number: 123456789.',
      ].join('\n');
    },
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].doc.id, doc.id);
  assert.deepEqual(calls[0].doc.factContract.forbid, ['employment.workEmail']);
  assert.match(calls[0].prompt, /employment\.workEmail/);
  assert.match(calls[0].prompt, /samir\.desai@northstarcivic\.example\.test/);
});

test('repair-generation reports warning documents separately from failures', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, doc } = await writeRepairFixture(t, root, {
    validPreview: true,
  });
  await writeFile(
    path.join(previewRoot, doc.path),
    [
      'Repair export for Samir Desai.',
      'First name: Samir.',
      'Last name: Desai.',
      'Middle initial: A.',
      'Other last names: Mehta.',
      'Date of birth: 1989-11-04.',
      'SSN: 000-00-0389.',
      'Address: 1268 Lakeview Terrace, Unit 4C, Madison, WI 53703.',
      'Personal email: samir.desai@example.test.',
      'Citizenship status: lawful permanent resident.',
      'USCIS A-number: 123456789.',
      'Temporary callback: 555-123-4567.',
    ].join('\n'),
  );
  let calls = 0;

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async () => {
      calls += 1;
      return 'should not be used\n';
    },
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.equal(calls, 0);
  const report = JSON.parse(
    await readFile(path.join(previewRoot, 'repair-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.attempts[0].failedDocumentIds, []);
  assert.deepEqual(report.attempts[0].warningDocumentIds, [doc.id]);
  assert.deepEqual(report.remainingIssues, []);
  assert.deepEqual(
    report.remainingWarnings.map((issue) => issue.code).sort(),
    [
      'DOCUMENT_MISSING_FACT_PRESENT',
      'DOCUMENT_NATIVE_SIGNAL_MISSING',
      'DOCUMENT_SOURCE_PHONE_PRESENT',
    ],
  );
});

test('repair-generation does not regenerate realism-only warnings', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, doc } = await writeRepairFixture(t, root, {
    validPreview: true,
  });
  let calls = 0;

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async () => {
      calls += 1;
      return 'should not be used\n';
    },
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.equal(calls, 0);
  const report = JSON.parse(
    await readFile(path.join(previewRoot, 'repair-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.repairedDocumentIds, []);
  assert.deepEqual(report.attempts[0].failedDocumentIds, []);
  assert.deepEqual(report.attempts[0].warningDocumentIds, []);
  assert.deepEqual(
    report.remainingWarnings.map((issue) => issue.code),
    ['DOCUMENT_NATIVE_SIGNAL_MISSING'],
  );
});

test('repair-generation refuses non-document validation failures without calling the generator', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot } = await writeRepairFixture(t, root, { validPreview: true });
  let calls = 0;
  await writeFile(
    path.join(root, 'examples/eval/users/samir-desai/seed-preferences.generated.json'),
    '[]\n',
  );

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async () => {
      calls += 1;
      return 'should not be used\n';
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(calls, 0);
  assert.match(result.errorMessage, /non-repairable issues/);
  assert.match(result.errorMessage, /SEED_GENERATED_STALE/);
});

test('repair-generation refuses mixed document and non-document failures before generation', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot } = await writeRepairFixture(t, root);
  let calls = 0;
  await writeFile(
    path.join(root, 'examples/eval/users/samir-desai/seed-preferences.generated.json'),
    '[]\n',
  );

  const result = await runRepairGeneration({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'repair-test',
      '--from',
      previewRoot,
      '--model',
      'unit-model',
      '--max-attempts',
      '1',
    ],
    generateDocument: async () => {
      calls += 1;
      return 'should not be used\n';
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(calls, 0);
  assert.match(result.errorMessage, /non-repairable issues/);
  assert.match(result.errorMessage, /DOCUMENT_FACT_VALUE_MISSING/);
  assert.match(result.errorMessage, /SEED_GENERATED_STALE/);
});

async function writeRepairFixture(
  t,
  root,
  { validPreview = false, forbid = [] } = {},
) {
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-repair-preview-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/repair-test',
  );
  const doc = {
    id: 'samir-desai-repair-test-001',
    path: 'documents/identity/001-i9-profile.md',
    category: 'identity',
    title: 'I-9 Profile',
    outputExtension: 'md',
    sourceSpec: sourceSpec(),
    factContract: {
      include: [
        'identity.firstName',
        'identity.middleInitial',
        'identity.otherLastNames',
        'identity.dateOfBirth',
        'identity.ssn',
        'identity.lastName',
        'address.current.street',
        'address.current.unit',
        'address.current.city',
        'address.current.state',
        'address.current.postalCode',
        'contact.email',
        'workAuthorization.citizenshipStatus',
        'workAuthorization.uscisANumber',
      ],
      forbid,
    },
    evaluationRole: evaluationRole({
      detailTier: 'hero',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['i9-draft'],
    }),
  };
  const manifest = {
    schemaVersion: 2,
    userId: 'samir-desai',
    corpusId: 'repair-test',
    seed: 'samir-desai__repair-test',
    corpusKind: 'realistic-generated',
    forms: ['i-9'],
    purpose: 'Repair generation unit test.',
    artifactWorld: {
      schemaVersion: 1,
      seed: 'samir-desai__repair-test',
      timeline: {
        generatedAt: '2026-06-01T10:00:00-07:00',
      },
      source: {
        system: 'Repair Unit Test',
      },
    },
    factContractDefaults: { forbid: [] },
    intentionallyMissing: [
      {
        factKey: 'contact.phone',
        forms: ['i-9'],
        reason: 'Phone is intentionally missing.',
        expectedBehavior: 'Leave telephone blank.',
      },
    ],
    documents: [doc],
  };

  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'manifest.json'), manifest);
  await mkdir(path.join(previewRoot, path.dirname(doc.path)), { recursive: true });
  await writeFile(
    path.join(previewRoot, doc.path),
    validPreview
      ? [
          'Repair export for Samir Desai.',
          'First name: Samir.',
          'Last name: Desai.',
          'Middle initial: A.',
          'Other last names: Mehta.',
          'Date of birth: 1989-11-04.',
          'SSN: 000-00-0389.',
          'Address: 1268 Lakeview Terrace, Unit 4C, Madison, WI 53703.',
          'Personal email: samir.desai@example.test.',
          'Citizenship status: lawful permanent resident.',
          'USCIS A-number: 123456789.',
        ].join('\n')
      : 'This preview is intentionally missing most declared facts.\n',
  );
  return { previewRoot, corpusRoot, doc };
}

function sourceSpec(overrides = {}) {
  return {
    artifactType: 'repair-unit-artifact',
    sourceFamily: 'repair-unit',
    captureMode: 'plain-text-export',
    timelineRefs: [],
    worldRefs: [],
    nativeSignals: ['approval watermark'],
    safeDetailMenu: ['unit test metadata'],
    riskyDetailMenu: ['new phone number'],
    lengthTarget: { minChars: 20, maxChars: 8000 },
    ...overrides,
  };
}

function evaluationRole(overrides = {}) {
  return {
    detailTier: 'brief',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['current-fact'],
    ...overrides,
  };
}

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-repair-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'apps/backend/src/config'), { recursive: true });
  await cp(
    path.join(repoRoot, 'examples/eval'),
    path.join(root, 'examples/eval'),
    { recursive: true },
  );
  await cp(
    path.join(repoRoot, 'apps/backend/src/config/preferences.catalog.json'),
    path.join(root, 'apps/backend/src/config/preferences.catalog.json'),
  );
  return root;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
