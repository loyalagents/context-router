import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { collectFactKeys, hashInt } from './shared.mjs';
import { discoverTemplates, renderTemplate } from './template-renderer.mjs';
import { runScaffold, parseArgs } from './scaffold.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('hashInt is stable for seeded template ordering and choices', () => {
  assert.equal(
    hashInt('elena-marquez__template-smoke', 'identity/name-history-note'),
    hashInt('elena-marquez__template-smoke', 'identity/name-history-note'),
  );
  assert.notEqual(
    hashInt('elena-marquez__template-smoke', 'identity/name-history-note'),
    hashInt('elena-marquez__template-smoke', 'identity/ssn-card-transcript'),
  );
});

test('renderer rejects undeclared fact access and array fact()', async () => {
  const profile = await readElenaProfile(repoRoot);
  const profileFacts = collectFactKeys(profile.facts);

  assert.throws(
    () =>
      renderTemplate({
        template: fakeTemplate({
          requiredFactKeys: ['identity.legalName'],
          render: ({ fact }) => fact('identity.ssn'),
        }),
        profileFacts,
        seed: 'unit',
      }),
    /accessed undeclared fact identity\.ssn/,
  );

  assert.throws(
    () =>
      renderTemplate({
        template: fakeTemplate({
          requiredFactKeys: ['identity.otherLastNames'],
          render: ({ fact }) => fact('identity.otherLastNames'),
        }),
        profileFacts,
        seed: 'unit',
      }),
    /use joinFact/,
  );
});

test('renderer preserves array order through joinFact and rejects unknown date formats', async () => {
  const profile = await readElenaProfile(repoRoot);
  const profileFacts = collectFactKeys(profile.facts);
  const rendered = renderTemplate({
    template: fakeTemplate({
      requiredFactKeys: ['identity.otherLastNames'],
      render: ({ joinFact }) => joinFact('identity.otherLastNames', ', '),
    }),
    profileFacts,
    seed: 'unit',
  });

  assert.equal(rendered.content, 'Ruiz');
  assert.deepEqual(rendered.factKeys, ['identity.otherLastNames']);

  assert.throws(
    () =>
      renderTemplate({
        template: fakeTemplate({
          requiredFactKeys: ['identity.dateOfBirth'],
          render: ({ dateFact }) => dateFact('identity.dateOfBirth', 'weekday'),
        }),
        profileFacts,
        seed: 'unit',
      }),
    /Unsupported date format/,
  );
});

test('renderer formats dates, chooses deterministically, and omits null optional facts', async () => {
  const profile = await readElenaProfile(repoRoot);
  const profileFacts = collectFactKeys(profile.facts);
  const values = ['first', 'second', 'third', 'fourth'];
  const rendered = renderTemplate({
    template: fakeTemplate({
      requiredFactKeys: ['identity.dateOfBirth'],
      optionalFactKeys: ['contact.phone', 'identity.notReal'],
      render: ({ dateFact, maybeFact, choose }) =>
        [
          dateFact('identity.dateOfBirth', 'iso'),
          dateFact('identity.dateOfBirth', 'us'),
          dateFact('identity.dateOfBirth', 'long'),
          choose('phrase', values),
          maybeFact('contact.phone'),
          maybeFact('identity.notReal'),
        ].join('|'),
    }),
    profileFacts,
    seed: 'unit',
  });

  assert.equal(
    rendered.content,
    `1994-07-18|07/18/1994|July 18, 1994|${values[hashInt('unit', 'identity/fake', 'phrase') % values.length]}||`,
  );
  assert.deepEqual(rendered.factKeys, ['identity.dateOfBirth']);
});

test('renderer rejects declared area refs before rendering', async () => {
  const profile = await readElenaProfile(repoRoot);
  const profileFacts = collectFactKeys(profile.facts);

  assert.throws(
    () =>
      renderTemplate({
        template: fakeTemplate({
          requiredFactKeys: ['address.current'],
          render: () => 'not reached',
        }),
        profileFacts,
        seed: 'unit',
      }),
    /address\.current is an area ref/,
  );
});

test('renderer rejects declared required facts that are not accessed', async () => {
  const profile = await readElenaProfile(repoRoot);
  const profileFacts = collectFactKeys(profile.facts);

  assert.throws(
    () =>
      renderTemplate({
        template: fakeTemplate({
          requiredFactKeys: ['identity.legalName'],
          render: () => 'Legal name intentionally not read',
        }),
        profileFacts,
        seed: 'unit',
      }),
    /declares required fact identity\.legalName but did not access it/,
  );
});

test('every discovered template renders against at least one committed profile', async () => {
  const profiles = await Promise.all(
    ['elena-marquez', 'samir-desai'].map(async (userId) => ({
      userId,
      profile: await readProfile(repoRoot, userId),
    })),
  );
  const templates = await discoverTemplates({
    evalRoot: path.join(repoRoot, 'examples/eval'),
  });

  assert.ok(templates.length > 0);
  for (const template of templates) {
    const errors = [];
    let rendered = null;
    for (const { userId, profile } of profiles) {
      try {
        rendered = renderTemplate({
          template,
          profileFacts: collectFactKeys(profile.facts),
          seed: `${userId}__template-smoke`,
        });
        break;
      } catch (error) {
        errors.push(`${userId}: ${error.message}`);
      }
    }

    assert.ok(
      rendered?.content.length > 0,
      `${template.meta.templateId} did not render against any committed profile: ${errors.join('; ')}`,
    );
  }
});

test('scaffold without count renders exactly the required coverage set', async (t) => {
  const root = await copyRepo(t);
  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-smoke',
      '--form',
      'i-9',
      '--scenario',
      'elena-marquez-i9-template-smoke',
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.equal(
    result.lines.filter((line) => line.startsWith('eval validation passed')).length,
    2,
  );
  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/template-smoke/manifest.json',
    ),
  );
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.corpusKind, 'template-smoke');
  assert.equal(manifest.documents.length, 5);
  assert.deepEqual(
    manifest.documents.map((doc) => doc.id),
    ['001', '002', '003', '004', '005'],
  );
  assert.deepEqual(manifest.intentionallyMissing, []);

  const scenario = await readJson(
    path.join(root, 'examples/eval/scenarios/elena-marquez-i9-template-smoke/scenario.json'),
  );
  assert.equal(
    scenario.description,
    'Generated template-scaffold scenario for Elena Marquez using i-9.',
  );
  assert.deepEqual(scenario.expectedSnapshots, []);
  assert.equal(
    await readFile(
      path.join(root, 'examples/eval/scenarios/elena-marquez-i9-template-smoke/start/prompt.md'),
      'utf8',
    ),
    'Fill i-9 for Elena Marquez using the seeded memory and corpus documents. Leave fields blank when the available facts do not support a value.\n',
  );

  assert.match(
    await readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/template-smoke/manifest.json',
      ),
      'utf8',
    ),
    /\n}\n$/,
  );
});

test('scaffold writes deterministic missing metadata for null mapped facts', async (t) => {
  const root = await copyRepo(t);
  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-missing',
      '--form',
      'i-9',
      '--missing',
      'contact.phone',
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/template-missing/manifest.json',
    ),
  );
  assert.deepEqual(manifest.intentionallyMissing, [
    {
      factKey: 'contact.phone',
      forms: ['i-9'],
      reason:
        'This profile fact is explicitly null and intentionally absent from rendered documents.',
      expectedBehavior: 'Leave the field blank; do not guess or synthesize a value.',
    },
  ]);
});

test('scaffold rejects missing metadata for area, absent, and unreferenced facts', async (t) => {
  const root = await copyRepo(t);
  const areaRef = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'bad-missing-area',
      '--form',
      'i-9',
      '--missing',
      'address.current',
    ],
  });
  assert.equal(areaRef.exitCode, 1);
  assert.match(areaRef.errorMessage, /must resolve to a profile leaf/);

  const absentFact = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'bad-missing-absent',
      '--form',
      'i-9',
      '--missing',
      'identity.notReal',
    ],
  });
  assert.equal(absentFact.exitCode, 1);
  assert.match(absentFact.errorMessage, /must resolve to a profile leaf/);

  const unreferencedNullFact = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'bad-missing-unreferenced',
      '--form',
      'i-9',
      '--missing',
      'workAuthorization.foreignPassportCountry',
    ],
  });
  assert.equal(unreferencedNullFact.exitCode, 1);
  assert.match(unreferencedNullFact.errorMessage, /not referenced by selected forms/);
});

test('scaffold rejects invalid missing facts and too-small counts', async (t) => {
  const root = await copyRepo(t);
  const nonNullMissing = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'bad-missing',
      '--form',
      'i-9',
      '--missing',
      'identity.ssn',
    ],
  });
  assert.equal(nonNullMissing.exitCode, 1);
  assert.match(nonNullMissing.errorMessage, /must be null/);

  const tooSmall = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'too-small',
      '--form',
      'i-9',
      '--count',
      '1',
    ],
  });
  assert.equal(tooSmall.exitCode, 1);
  assert.match(tooSmall.errorMessage, /smaller than required template count/);

  const tooLarge = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'too-large',
      '--form',
      'i-9',
      '--count',
      '99',
    ],
  });
  assert.equal(tooLarge.exitCode, 1);
  assert.match(tooLarge.errorMessage, /exceeds eligible template count/);
});

test('scaffold persists seed override and requires force for existing corpora', async (t) => {
  const root = await copyRepo(t);
  const args = [
    '--user',
    'elena-marquez',
    '--corpus',
    'template-seeded',
    '--form',
    'i-9',
    '--seed',
    'custom_seed',
    '--count',
    '6',
  ];
  const first = await runScaffold({ repoRoot: root, args });
  assert.equal(first.exitCode, 0, first.errorMessage);

  const manifestPath = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/template-seeded/manifest.json',
  );
  const firstText = await readFile(manifestPath, 'utf8');
  const firstManifest = JSON.parse(firstText);
  assert.equal(firstManifest.seed, 'custom_seed');
  assert.equal(firstManifest.documents.length, 6);
  assert.equal(firstManifest.documents[5].id, '006');
  assert.equal(
    firstManifest.documents[5].path,
    'documents/identity/006-birth-record-summary.txt',
  );

  const blocked = await runScaffold({ repoRoot: root, args });
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.errorMessage, /Use --force to overwrite/);

  const forced = await runScaffold({ repoRoot: root, args: [...args, '--force'] });
  assert.equal(forced.exitCode, 0, forced.errorMessage);
  assert.equal(await readFile(manifestPath, 'utf8'), firstText);
});

test('scaffold seed changes deterministic template choices and remains stable', async (t) => {
  const root = await copyRepo(t);
  const seedAArgs = [
    '--user',
    'elena-marquez',
    '--corpus',
    'seed-a',
    '--form',
    'i-9',
    '--seed',
    'seed_a',
  ];
  const seedBArgs = [
    '--user',
    'elena-marquez',
    '--corpus',
    'seed-b',
    '--form',
    'i-9',
    '--seed',
    'seed_b',
  ];

  const firstA = await runScaffold({ repoRoot: root, args: seedAArgs });
  const firstB = await runScaffold({ repoRoot: root, args: seedBArgs });
  assert.equal(firstA.exitCode, 0, firstA.errorMessage);
  assert.equal(firstB.exitCode, 0, firstB.errorMessage);

  const seedAPath = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/seed-a/documents/address-contact/003-current-lease-summary.md',
  );
  const seedBPath = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/seed-b/documents/address-contact/003-current-lease-summary.md',
  );
  const firstAText = await readFile(seedAPath, 'utf8');
  const firstBText = await readFile(seedBPath, 'utf8');
  assert.notEqual(firstAText, firstBText);

  const secondA = await runScaffold({
    repoRoot: root,
    args: [...seedAArgs, '--force'],
  });
  assert.equal(secondA.exitCode, 0, secondA.errorMessage);
  assert.equal(await readFile(seedAPath, 'utf8'), firstAText);
});

test('scaffold does not write a partial corpus when template rendering fails', async (t) => {
  const root = await copyRepo(t);
  const templatePath = path.join(
    root,
    'examples/eval/templates/identity/name-history-note.mjs',
  );
  const templateText = await readFile(templatePath, 'utf8');
  await writeFile(
    templatePath,
    templateText.replace(
      "Middle initial used on abbreviated forms: ${fact('identity.middleInitial')}",
      "Middle initial used on abbreviated forms: ${fact('identity.middleInitial')}\nUndeclared value: ${fact('identity.ssn')}",
    ),
  );

  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-render-failure',
      '--form',
      'i-9',
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.errorMessage, /accessed undeclared fact identity\.ssn/);
  await assert.rejects(
    readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/template-render-failure/manifest.json',
      ),
      'utf8',
    ),
    /ENOENT/,
  );
  await assert.rejects(
    readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/template-render-failure/documents/address-contact/001-usps-address-confirmation.txt',
      ),
      'utf8',
    ),
    /ENOENT/,
  );
});

test('scaffold fails clearly when no eligible template covers a required fact', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(root, 'examples/eval/forms/i-9/field-map.json');
  const fieldMap = await readJson(fieldMapPath);
  const firstFactField = fieldMap.fields.find(
    (field) => field.pdfFieldName === 'First Name Given Name',
  );
  firstFactField.factKey = 'employment.startDate';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-uncovered',
      '--form',
      'i-9',
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.errorMessage, /No eligible template covers required facts: employment\.startDate/);
});

test('scaffold excludes skip fields from required template coverage', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(root, 'examples/eval/forms/i-9/field-map.json');
  const fieldMap = await readJson(fieldMapPath);
  const ssnField = fieldMap.fields.find(
    (field) => field.pdfFieldName === 'US Social Security Number',
  );
  delete ssnField.factKey;
  delete ssnField.render;
  delete ssnField.note;
  ssnField.mode = 'skip';
  ssnField.reason = 'out_of_scope';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-skip-ssn',
      '--form',
      'i-9',
    ],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/template-skip-ssn/manifest.json',
    ),
  );
  assert.equal(
    manifest.documents.some((doc) => doc.template === 'identity/ssn-card-transcript'),
    false,
  );
});

test('scaffold leaves generated files when validation fails', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(root, 'examples/eval/forms/i-9/field-map.json');
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[1].pdfFieldName = 'Wrong Field Name';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'template-invalid',
      '--form',
      'i-9',
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.errorMessage, /FIELD_MAP_NAME_MISMATCH/);
  assert.ok(
    await readFile(
      path.join(
        root,
        'examples/eval/users/elena-marquez/corpora/template-invalid/manifest.json',
      ),
      'utf8',
    ),
  );
});

test('init user writes nested null facts and refuses existing profile', async (t) => {
  const root = await copyRepo(t);
  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--init-user',
      '--user',
      'nina-patel',
      '--display-name',
      'Nina Patel',
      '--form',
      'i-9',
    ],
  });
  assert.equal(result.exitCode, 0, result.errorMessage);

  const profile = parseYaml(
    await readFile(
      path.join(root, 'examples/eval/users/nina-patel/profile.yaml'),
      'utf8',
    ),
  );
  assert.equal(profile.facts.identity.firstName, null);
  assert.equal(profile.facts.address.current.postalCode, null);
  assert.deepEqual(profile.seedPreferences, []);
  assert.equal(
    await readFile(
      path.join(root, 'examples/eval/users/nina-patel/seed-preferences.generated.json'),
      'utf8',
    ),
    '[]\n',
  );

  const existing = await runScaffold({
    repoRoot: root,
    args: [
      '--init-user',
      '--user',
      'elena-marquez',
      '--display-name',
      'Elena Marquez',
      '--form',
      'i-9',
      '--force',
    ],
  });
  assert.equal(existing.exitCode, 1);
  assert.match(existing.errorMessage, /Refusing to overwrite existing profile/);
});

test('init user refuses orphaned generated seed file', async (t) => {
  const root = await copyRepo(t);
  const userRoot = path.join(root, 'examples/eval/users/orphan-seed');
  await mkdir(userRoot, { recursive: true });
  await writeFile(
    path.join(userRoot, 'seed-preferences.generated.json'),
    '[]\n',
  );

  const result = await runScaffold({
    repoRoot: root,
    args: [
      '--init-user',
      '--user',
      'orphan-seed',
      '--display-name',
      'Orphan Seed',
      '--form',
      'i-9',
      '--force',
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.errorMessage, /Refusing to overwrite existing generated seeds/);
});

test('scaffold refuses to overwrite existing scenarios even with force', async (t) => {
  const root = await copyRepo(t);
  const args = [
    '--user',
    'elena-marquez',
    '--corpus',
    'template-smoke',
    '--form',
    'i-9',
    '--scenario',
    'elena-marquez-i9-template-smoke',
  ];
  const first = await runScaffold({ repoRoot: root, args });
  assert.equal(first.exitCode, 0, first.errorMessage);

  const forced = await runScaffold({ repoRoot: root, args: [...args, '--force'] });
  assert.equal(forced.exitCode, 1);
  assert.match(forced.errorMessage, /Existing scenarios are runner-owned/);
});

test('scenario skeleton rejects multiple forms', () => {
  const parsed = parseArgs([
    '--user',
    'elena-marquez',
    '--corpus',
    'template-smoke',
    '--form',
    'i-9',
    '--form',
    'fw4',
    '--scenario',
    'bad-scenario',
  ]);
  assert.equal(parsed.kind, 'usage-error');
});

test('template discovery is sorted by template id', async () => {
  const templates = await discoverTemplates({
    evalRoot: path.join(repoRoot, 'examples/eval'),
  });
  const ids = templates.map((template) => template.meta.templateId);
  assert.deepEqual(ids, [...ids].sort());
});

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-scaffold-'));
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
  await rm(
    path.join(root, 'examples/eval/users/elena-marquez/corpora/template-smoke'),
    { recursive: true, force: true },
  );
  await rm(
    path.join(root, 'examples/eval/scenarios/elena-marquez-i9-template-smoke'),
    { recursive: true, force: true },
  );
  return root;
}

async function readElenaProfile(root) {
  return readProfile(root, 'elena-marquez');
}

async function readProfile(root, userId) {
  return parseYaml(
    await readFile(
      path.join(root, 'examples/eval/users', userId, 'profile.yaml'),
      'utf8',
    ),
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeTemplate({ requiredFactKeys, optionalFactKeys = [], render }) {
  return {
    expectedTemplateId: 'identity/fake',
    meta: {
      schemaVersion: 1,
      templateId: 'identity/fake',
      category: 'identity',
      title: 'Fake',
      outputExtension: 'txt',
      requiredFactKeys,
      optionalFactKeys,
      detailTier: 'brief',
      authority: 'none',
      freshness: 'unknown',
      expectedUse: 'extract',
      defaultOrder: 1,
    },
    render,
  };
}
