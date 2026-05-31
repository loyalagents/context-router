import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCorpusPlan, parseArgs, runPlanCorpus } from './plan-corpus.mjs';
import { runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('plan-corpus parser supports only the v1 I-9 ten-doc flow', () => {
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '10',
    ]).kind,
    'ok',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'fw4',
      '--count',
      '10',
    ]).kind,
    'usage-error',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '9',
    ]).kind,
    'usage-error',
  );
});

test('plan-corpus writes a valid deterministic 10-document I-9 plan', async (t) => {
  const root = await copyRepo(t);

  const result = await runPlanCorpus({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '10',
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const planPath = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic/corpus-plan.json',
  );
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.equal(plan.targetDocumentCount, 10);
  assert.equal(plan.documents.length, 10);
  assert.equal(
    Object.values(plan.categoryCounts).reduce((sum, value) => sum + value, 0),
    10,
  );
  assert.ok(plan.defaultForbiddenFactKeys.includes('contact.phone'));
  assert.ok(plan.intentionallyMissing.some((entry) => entry.factKey === 'contact.phone'));
  assert.ok(
    plan.documents.some((doc) =>
      doc.factKeys.includes('workAuthorization.uscisANumber'),
    ),
  );
  assert.ok(
    plan.documents.every((doc) => !doc.factKeys.includes('contact.phone')),
  );

  const validation = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });
  assert.equal(validation.exitCode, 0);

  const duplicate = await runPlanCorpus({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '10',
    ],
  });
  assert.equal(duplicate.exitCode, 1);

  const forced = await runPlanCorpus({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '10',
      '--force',
    ],
  });
  assert.equal(forced.exitCode, 0, forced.errorMessage);
});

test('plan-corpus keeps citizen-only null work authorization facts intentionally missing', async (t) => {
  const root = await copyRepo(t);

  const result = await runPlanCorpus({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'realistic',
      '--form',
      'i-9',
      '--count',
      '10',
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const plan = JSON.parse(
    await readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/realistic/corpus-plan.json',
      ),
      'utf8',
    ),
  );
  const missingKeys = new Set(
    plan.intentionallyMissing.map((entry) => entry.factKey),
  );
  for (const factKey of [
    'workAuthorization.uscisANumber',
    'workAuthorization.workAuthorizationExpirationDate',
    'workAuthorization.i94AdmissionNumber',
    'workAuthorization.foreignPassportNumber',
  ]) {
    assert.ok(missingKeys.has(factKey), `${factKey} should be intentionally missing`);
    assert.ok(
      plan.documents.every((doc) => !doc.factKeys.includes(factKey)),
      `${factKey} should not appear in generated document factKeys`,
    );
  }
  assert.ok(
    plan.documents.some((doc) =>
      doc.factKeys.includes('workAuthorization.citizenshipStatus'),
    ),
  );
});

test('buildCorpusPlan filters null facts from document declarations', async () => {
  const profile = {
    facts: {
      identity: {
        legalName: 'Casey Example',
        firstName: 'Casey',
        lastName: 'Example',
        middleInitial: null,
        dateOfBirth: '1990-01-02',
        ssn: '000-00-0001',
      },
      contact: { email: 'casey@example.test', phone: null },
      address: {
        current: {
          street: '1 Main Street',
          unit: null,
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
        },
      },
      workAuthorization: {
        citizenshipStatus: 'U.S. citizen',
        uscisANumber: null,
        workAuthorizationExpirationDate: null,
        i94AdmissionNumber: null,
        foreignPassportNumber: null,
      },
    },
  };
  const fieldMap = {
    fields: [
      { mode: 'fact', factKey: 'contact.phone' },
      { mode: 'fact', factKey: 'address.current.unit' },
      { mode: 'fact', factKey: 'identity.firstName' },
    ],
  };

  const plan = buildCorpusPlan({
    userId: 'casey-example',
    corpusId: 'realistic',
    formId: 'i-9',
    profile,
    fieldMap,
  });

  assert.ok(
    plan.documents.every((doc) => !doc.factKeys.includes('contact.phone')),
  );
  assert.ok(
    plan.documents.every((doc) => !doc.factKeys.includes('address.current.unit')),
  );
  assert.ok(plan.intentionallyMissing.some((entry) => entry.factKey === 'contact.phone'));
  assert.ok(
    plan.intentionallyMissing.some((entry) => entry.factKey === 'address.current.unit'),
  );
});

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-plan-corpus-'));
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
