import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPromotePreview } from './promote-preview.mjs';
import { runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('promote-preview validates and copies preview documents into the corpus', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, corpusRoot, doc } = await writePromoteFixture(t, root, {
    validPreview: true,
  });

  const result = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.match(await readFile(path.join(corpusRoot, doc.path), 'utf8'), /Samir/);
  const manifest = JSON.parse(
    await readFile(path.join(corpusRoot, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest.documents.map((entry) => entry.id), [doc.id]);
  const report = JSON.parse(
    await readFile(path.join(corpusRoot, 'validation-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'pass');

  const duplicate = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
    ],
  });
  assert.equal(duplicate.exitCode, 1);

  const forced = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
      '--force',
    ],
  });
  assert.equal(forced.exitCode, 0, forced.errorMessage);
});

test('promote-preview refuses invalid previews before copying documents', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, corpusRoot, doc } = await writePromoteFixture(t, root, {
    validPreview: false,
  });

  const result = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
    ],
  });

  assert.equal(result.exitCode, 1);
  await assert.rejects(readFile(path.join(corpusRoot, doc.path), 'utf8'), /ENOENT/);
  await assert.rejects(readFile(path.join(corpusRoot, 'manifest.json'), 'utf8'), /ENOENT/);
});

test('promote-preview restores prior corpus files if committed validation fails', async (t) => {
  const root = await copyRepo(t);
  const { previewRoot, corpusRoot, doc } = await writePromoteFixture(t, root, {
    validPreview: true,
  });

  const original = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
    ],
  });
  assert.equal(original.exitCode, 0, original.errorMessage);
  const originalBody = await readFile(path.join(corpusRoot, doc.path), 'utf8');
  const originalReport = await readFile(
    path.join(corpusRoot, 'validation-report.json'),
    'utf8',
  );

  await writeFile(
    path.join(previewRoot, doc.path),
    [
      'Replacement marker that should be rolled back.',
      validPromoteBody(),
    ].join('\n'),
  );

  let validationCalls = 0;
  const failed = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'promote-test',
      '--from',
      previewRoot,
      '--force',
    ],
    validate: async (input) => {
      validationCalls += 1;
      if (validationCalls === 1) return runValidation(input);
      return {
        exitCode: 1,
        repoRoot: input.repoRoot,
        reportPath: null,
        summary: {
          profiles: 1,
          corpora: 1,
          forms: 1,
          scenarios: 0,
          templates: 0,
          errors: 1,
          warnings: 0,
        },
        issues: [
          {
            level: 'error',
            code: 'UNIT_COMMITTED_FAILURE',
            file: 'examples/eval/users/samir-desai/corpora/promote-test/manifest.json',
            pointer: '',
            message: 'Injected committed validation failure.',
          },
        ],
      };
    },
  });

  assert.equal(failed.exitCode, 1);
  assert.match(failed.errorMessage, /UNIT_COMMITTED_FAILURE/);
  assert.equal(await readFile(path.join(corpusRoot, doc.path), 'utf8'), originalBody);
  assert.equal(
    await readFile(path.join(corpusRoot, 'validation-report.json'), 'utf8'),
    originalReport,
  );
});

async function writePromoteFixture(t, root, { validPreview }) {
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-promote-preview-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/promote-test',
  );
  const doc = {
    id: 'samir-desai-promote-test-001',
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
        'workAuthorization.uscisANumber',
      ],
      forbid: [],
    },
    evaluationRole: evaluationRole({
      detailTier: 'hero',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['identity-evidence'],
    }),
  };
  const corpusPlan = {
    schemaVersion: 2,
    userId: 'samir-desai',
    corpusId: 'promote-test',
    forms: ['i-9'],
    purpose: 'Promote preview unit test.',
    artifactWorld: {
      schemaVersion: 1,
      seed: 'samir-desai__promote-test',
      timeline: {
        generatedAt: '2026-06-01T10:00:00-07:00',
      },
      source: {
        system: 'Promote Unit Test',
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
      {
        factKey: 'workAuthorization.workAuthorizationExpirationDate',
        forms: ['i-9'],
        reason: 'No expiration date is provided in this unit test.',
        expectedBehavior: 'Leave expiration blank.',
      },
      {
        factKey: 'workAuthorization.i94AdmissionNumber',
        forms: ['i-9'],
        reason: 'No I-94 admission number is provided in this unit test.',
        expectedBehavior: 'Leave I-94 blank.',
      },
      {
        factKey: 'workAuthorization.foreignPassportNumber',
        forms: ['i-9'],
        reason: 'No foreign passport number is provided in this unit test.',
        expectedBehavior: 'Leave foreign passport blank.',
      },
    ],
    documents: [doc],
  };

  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
  await mkdir(path.join(previewRoot, path.dirname(doc.path)), { recursive: true });
  await writeFile(
    path.join(previewRoot, doc.path),
    validPreview ? validPromoteBody() : 'This body does not include the declared I-9 facts.\n',
  );
  return { previewRoot, corpusRoot, doc };
}

function sourceSpec(overrides = {}) {
  return {
    artifactType: 'promote-unit-artifact',
    sourceFamily: 'promote-unit',
    captureMode: 'plain-text-export',
    timelineRefs: [],
    worldRefs: [],
    nativeSignals: ['status'],
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

function validPromoteBody() {
  return [
    'I-9 profile note for Samir Desai.',
    'First name: Samir.',
    'Last name: Desai.',
    'Middle initial: A.',
    'Other last names: Mehta.',
    'Date of birth: 1989-11-04.',
    'SSN: 000-00-0389.',
    'Address: 1268 Lakeview Terrace, Unit 4C, Madison, WI 53703.',
    'Personal email: samir.desai@example.test.',
    'USCIS A-number: 123456789.',
  ].join('\n');
}

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-promote-'));
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
