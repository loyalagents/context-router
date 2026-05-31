import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assertArtifactWorldHasNoProfileCollisions,
  buildArtifactWorld,
  buildCorpusManifest,
  buildI9SourceSpecs,
  parseArgs,
  runPlanCorpus,
} from './plan-corpus.mjs';
import { collectFactKeys } from './shared.mjs';
import { runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('plan-corpus parser supports only the V2 I-9 ten-doc flow', () => {
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
  const wrongCount = parseArgs([
    '--user',
    'samir-desai',
    '--corpus',
    'realistic',
    '--form',
    'i-9',
    '--count',
    '11',
  ]);
  assert.equal(wrongCount.kind, 'usage-error');
  assert.equal(wrongCount.message, '--count currently supports only 10.');
});

test('plan-corpus writes a valid deterministic 10-document I-9 manifest', async (t) => {
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
  const manifestPath = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic/manifest.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.corpusKind, 'realistic-generated');
  assert.equal(manifest.seed, 'samir-desai__realistic');
  assert.equal(manifest.documents.length, 10);
  assert.equal(manifest.artifactWorld.schemaVersion, 1);
  assert.ok(manifest.factContractDefaults.forbid.includes('contact.phone'));
  assert.ok(manifest.intentionallyMissing.some((entry) => entry.factKey === 'contact.phone'));
  assert.ok(
    manifest.documents.some((doc) =>
      doc.factContract.include.includes('workAuthorization.uscisANumber'),
    ),
  );
  assert.ok(
    manifest.documents.every((doc) => !doc.factContract.include.includes('contact.phone')),
  );
  assert.ok(manifest.documents.every((doc) => doc.sourceSpec));
  assert.ok(manifest.documents.every((doc) => doc.evaluationRole));
  await assert.rejects(
    readFile(
      path.join(
        root,
        'examples/eval/users/samir-desai/corpora/realistic/corpus-plan.json',
      ),
      'utf8',
    ),
    /ENOENT/,
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
  const manifest = JSON.parse(
    await readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
      ),
      'utf8',
    ),
  );
  const missingKeys = new Set(
    manifest.intentionallyMissing.map((entry) => entry.factKey),
  );
  for (const factKey of [
    'workAuthorization.uscisANumber',
    'workAuthorization.workAuthorizationExpirationDate',
    'workAuthorization.i94AdmissionNumber',
    'workAuthorization.foreignPassportNumber',
  ]) {
    assert.ok(missingKeys.has(factKey), `${factKey} should be intentionally missing`);
    assert.ok(
      manifest.documents.every((doc) => !doc.factContract.include.includes(factKey)),
      `${factKey} should not appear in generated document include paths`,
    );
  }
  assert.ok(
    manifest.documents.some((doc) =>
      doc.factContract.include.includes('workAuthorization.citizenshipStatus'),
    ),
  );
});

test('plan-corpus selects status-aware I-9 slot 003 artifacts', () => {
  const citizenSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'U.S. citizen' } },
  });
  assert.equal(citizenSpecs.find((doc) => doc.sequence === '003').slug, 'citizenship-evidence-upload');

  const noncitizenNationalSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'noncitizen national' } },
  });
  assert.equal(
    noncitizenNationalSpecs.find((doc) => doc.sequence === '003').slug,
    'noncitizen-national-evidence-upload',
  );

  const lprSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'lawful permanent resident' } },
  });
  assert.equal(lprSpecs.find((doc) => doc.sequence === '003').slug, 'permanent-resident-card-upload');

  const alienSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'alien authorized to work' } },
  });
  assert.equal(alienSpecs.find((doc) => doc.sequence === '003').slug, 'work-authorization-upload-receipt');

  const noncitizenAuthorizedSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'noncitizen authorized to work' } },
  });
  assert.equal(
    noncitizenAuthorizedSpecs.find((doc) => doc.sequence === '003').slug,
    'work-authorization-upload-receipt',
  );

  const articleNoncitizenAuthorizedSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'A noncitizen authorized to work' } },
  });
  assert.equal(
    articleNoncitizenAuthorizedSpecs.find((doc) => doc.sequence === '003').slug,
    'work-authorization-upload-receipt',
  );

  const fallbackSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'status pending review' } },
  });
  assert.equal(fallbackSpecs.find((doc) => doc.sequence === '003').slug, 'work-authorization-review-note');

  const negativeAuthorizedSpecs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'not authorized to work' } },
  });
  assert.equal(
    negativeAuthorizedSpecs.find((doc) => doc.sequence === '003').slug,
    'work-authorization-review-note',
  );

  for (const status of [
    'unauthorized to work',
    'no longer authorized to work',
    'authorization pending review',
  ]) {
    const specs = buildI9SourceSpecs({
      facts: { workAuthorization: { citizenshipStatus: status } },
    });
    assert.equal(
      specs.find((doc) => doc.sequence === '003').slug,
      'work-authorization-review-note',
      `${status} should not route to the category-4 evidence receipt`,
    );
  }
});

test('plan-corpus uses tuned length targets for verbose native source families', () => {
  const specs = buildI9SourceSpecs({
    facts: { workAuthorization: { citizenshipStatus: 'alien authorized to work' } },
  });
  const specsBySlug = new Map(specs.map((spec) => [spec.slug, spec]));

  assert.deepEqual(
    specsBySlug.get('ssn-card-upload-ocr').sourceSpec.lengthTarget,
    { minChars: 450, maxChars: 1300 },
  );
  assert.deepEqual(
    specsBySlug.get('work-authorization-upload-receipt').sourceSpec.lengthTarget,
    { minChars: 700, maxChars: 2300 },
  );
  assert.deepEqual(
    specsBySlug.get('onboarding-profile-export').sourceSpec.lengthTarget,
    { minChars: 800, maxChars: 3200 },
  );
  assert.deepEqual(
    specsBySlug.get('stale-contact-ticket').sourceSpec.lengthTarget,
    { minChars: 350, maxChars: 1400 },
  );
  assert.deepEqual(
    specsBySlug.get('community-newsletter-email').sourceSpec.lengthTarget,
    { minChars: 700, maxChars: 2600 },
  );
});

test('artifact world is deterministic and rejects profile collisions', () => {
  const profile = {
    facts: {
      employment: {
        company: 'Northstar Civic Labs',
        startDate: '2026-06-10',
      },
    },
  };
  assert.deepEqual(
    buildArtifactWorld({ userId: 'samir-desai', corpusId: 'realistic', profile }),
    buildArtifactWorld({ userId: 'samir-desai', corpusId: 'realistic', profile }),
  );
  const world = buildArtifactWorld({
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    profile: {
      facts: {
        employment: {
          company: 'Cascadia Hiring Cooperative',
          startDate: '2026-06-17',
        },
      },
    },
  });
  const providerPrefix = world.utility.provider
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('')
    .slice(0, 3);
  assert.equal(
    world.employer.recruitingInbox,
    'people-ops-cascadia-hiring-cooperative@example.test',
  );
  assert.ok(world.utility.exportId.startsWith(`${providerPrefix}-EXP-`));

  assert.throws(
    () =>
      assertArtifactWorldHasNoProfileCollisions({
        artifactWorld: {
          schemaVersion: 1,
          seed: 'unit',
          timeline: {},
          upload: { value: '000000389' },
        },
        profileFacts: collectFactKeys({
          identity: { ssn: '000-00-0389' },
        }),
      }),
    /collides with profile fact identity\.ssn/,
  );
});

test('buildCorpusManifest is byte-deterministic for committed I-9 profiles', async () => {
  const fieldMap = JSON.parse(
    await readFile(path.join(repoRoot, 'examples/eval/forms/i-9/field-map.json'), 'utf8'),
  );

  for (const userId of ['elena-marquez', 'samir-desai', 'alex-i9-test']) {
    const profile = parseYaml(
      await readFile(path.join(repoRoot, 'examples/eval/users', userId, 'profile.yaml'), 'utf8'),
    );
    const manifest = buildCorpusManifest({
      userId,
      corpusId: 'realistic',
      formId: 'i-9',
      profile,
      fieldMap,
    });
    const repeatedManifest = buildCorpusManifest({
      userId,
      corpusId: 'realistic',
      formId: 'i-9',
      profile,
      fieldMap,
    });
    assert.equal(JSON.stringify(repeatedManifest), JSON.stringify(manifest));

    const alternateManifest = buildCorpusManifest({
      userId,
      corpusId: 'realistic-alt',
      formId: 'i-9',
      profile,
      fieldMap,
    });
    assert.equal(alternateManifest.artifactWorld.seed, `${userId}__realistic-alt`);
    assert.notEqual(
      alternateManifest.artifactWorld.employer.workerId,
      manifest.artifactWorld.employer.workerId,
    );
  }
});

test('buildCorpusManifest filters null facts from document declarations', async () => {
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

  const manifest = buildCorpusManifest({
    userId: 'casey-example',
    corpusId: 'realistic',
    formId: 'i-9',
    profile,
    fieldMap,
  });

  assert.ok(
    manifest.documents.every((doc) => !doc.factContract.include.includes('contact.phone')),
  );
  assert.ok(
    manifest.documents.every((doc) => !doc.factContract.include.includes('address.current.unit')),
  );
  assert.ok(manifest.intentionallyMissing.some((entry) => entry.factKey === 'contact.phone'));
  assert.ok(
    manifest.intentionallyMissing.some((entry) => entry.factKey === 'address.current.unit'),
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
