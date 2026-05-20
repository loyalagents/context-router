import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatResult, parseArgs, runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('loads the backend preference catalog JSON used by the validator', async () => {
  const catalog = await readJson(
    path.join(repoRoot, 'apps/backend/src/config/preferences.catalog.json'),
  );

  assert.equal(catalog['profile.email'].valueType, 'string');
  assert.equal(catalog['profile.email'].isSensitive, true);
  assert.equal(catalog['communication.preferred_channels'].valueType, 'array');
});

test('passes the canonical Elena corpus', async () => {
  const result = await runValidation({
    repoRoot,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.errors, 0);
});

test('validates template metadata schema and manifest template references', async (t) => {
  const root = await copyRepo(t);
  const templatePath = path.join(
    root,
    'examples/eval/templates/identity/name-history-note.mjs',
  );
  const templateText = await readFile(templatePath, 'utf8');
  await writeFile(
    templatePath,
    templateText.replace("outputExtension: 'md'", "outputExtension: 'pdf'"),
  );

  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].template = 'identity/not-real';
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
  assertHasCode(result, 'DOCUMENT_TEMPLATE_MISSING');
});

test('validates template id and category path parity', async (t) => {
  const root = await copyRepo(t);
  const templatePath = path.join(
    root,
    'examples/eval/templates/identity/name-history-note.mjs',
  );
  const templateText = await readFile(templatePath, 'utf8');
  await writeFile(
    templatePath,
    templateText
      .replace(
        "templateId: 'identity/name-history-note'",
        "templateId: 'identity/wrong-note'",
      )
      .replace("category: 'identity'", "category: 'address-contact'"),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'TEMPLATE_ID_PATH_MISMATCH');
  assertHasCode(result, 'TEMPLATE_CATEGORY_PATH_MISMATCH');
});

test('rejects stale generated seed preferences', async (t) => {
  const root = await copyRepo(t);
  await writeFile(
    path.join(
      root,
      'examples/eval/users/elena-marquez/seed-preferences.generated.json',
    ),
    '[]\n',
  );

  const result = await validateElena(root);
  assert.equal(result.exitCode, 1);
  assertHasCode(result, 'SEED_GENERATED_STALE');
  assert.match(formatResult(result), /\nprofiles:\n/);
});

test('validates seed slugs and catalog value types', async (t) => {
  const root = await copyRepo(t);
  const profilePath = path.join(
    root,
    'examples/eval/users/elena-marquez/profile.yaml',
  );
  const profile = await readFile(profilePath, 'utf8');
  await writeFile(
    profilePath,
    `${profile}
  - slug: profile.not_real
    factKey: identity.firstName
  - slug: profile.full_name
    factKey: communication.preferredChannels
`,
  );

  const result = await validateElena(root);
  assertHasCode(result, 'SEED_UNKNOWN_SLUG');
  assertHasCode(result, 'SEED_VALUE_TYPE_MISMATCH');
});

test('rejects missing and unlisted document paths', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].path = 'documents/identity/missing.md';
  await writeJson(manifestPath, manifest);

  await writeFile(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/realistic/documents/identity/unlisted.md',
    ),
    'unlisted fixture file\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_PATH_MISSING');
  assertHasCode(result, 'DOCUMENT_UNLISTED_FILE');
});

test('rejects area document facts and legacy noise detail tiers', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factKeys = ['address.current'];
  manifest.documents[0].detailTier = 'noise';
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FACT_AREA');
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('reports field-map pre-pass and exhaustiveness errors', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[0].mode = 'mystery';
  fieldMap.fields[1].pdfFieldName = 'Wrong Field Name';
  await writeJson(fieldMapPath, fieldMap);

  const result = await validateElena(root);
  assertHasCode(result, 'FIELD_MAP_INVALID_MODE');
  assertHasCode(result, 'FIELD_MAP_NAME_MISMATCH');
});

test('rejects invalid intentionally missing form references', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.intentionallyMissing[0].forms = ['fw4'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'MISSING_FORM_NOT_IN_MANIFEST');
});

test('rejects noise and ignore metadata violations', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents.find((doc) => doc.id === '081').expectedUse = 'extract';
  const ignored = manifest.documents.find((doc) => doc.id === '082');
  ignored.expectedUse = 'ignore';
  ignored.factKeys = ['identity.firstName'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_NOISE_EXPECTED_USE');
  assertHasCode(result, 'DOCUMENT_IGNORE_FACT_KEYS');
});

test('scenario scope performs transitive validation', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[2].factKey = 'identity.notReal';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-section1'],
  });
  assertHasCode(result, 'FIELD_MAP_FACT_MISSING');
});

test('scenario scope reports structural field-map errors once', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[1].pdfFieldName = 'Wrong Field Name';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-section1'],
  });
  assert.equal(countIssueCode(result, 'FIELD_MAP_NAME_MISMATCH'), 1);
});

test('form-only scope skips profile fact resolution', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[2].factKey = 'identity.notReal';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--form', 'i-9'],
  });
  assert.equal(result.exitCode, 0);
  assertNoCode(result, 'FIELD_MAP_FACT_MISSING');
});

test('write-report is limited to single-corpus scope and writes corpus report', async (t) => {
  const parsed = parseArgs(['--user', 'elena-marquez', '--write-report']);
  assert.equal(parsed.kind, 'usage-error');
  assert.equal(
    parseArgs([
      '--scenario',
      'elena-marquez-i9-section1',
      '--write-report',
    ]).kind,
    'usage-error',
  );

  const root = await copyRepo(t);
  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--write-report'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.reportPath,
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/realistic/validation-report.json',
    ),
  );
  const report = await readJson(result.reportPath);
  assert.equal(report.status, 'pass');
  assert.match(
    formatResult(result),
    /report=examples\/eval\/users\/elena-marquez\/corpora\/realistic\/validation-report\.json/,
  );
});

test('validation reports are byte-deterministic across repeated runs', async (t) => {
  const root = await copyRepo(t);
  const args = [
    '--user',
    'elena-marquez',
    '--corpus',
    'realistic',
    '--write-report',
  ];
  const first = await runValidation({ repoRoot: root, args });
  const firstReport = await readFile(first.reportPath, 'utf8');
  const second = await runValidation({ repoRoot: root, args });
  const secondReport = await readFile(second.reportPath, 'utf8');

  assert.equal(firstReport, secondReport);
});

test('committed validation report matches a fresh single-corpus report', async () => {
  const result = await runValidation({
    repoRoot,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--write-report'],
    writeReport: false,
  });
  const committedReport = await readFile(
    path.join(
      repoRoot,
      'examples/eval/users/elena-marquez/corpora/realistic/validation-report.json',
    ),
    'utf8',
  );

  assert.equal(result.reportPath, null);
  assert.equal(committedReport, `${JSON.stringify(result.report, null, 2)}\n`);
});

test('reports every document that declares an intentionally missing fact', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factKeys.push('contact.phone');
  manifest.documents[1].factKeys.push('contact.phone');
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assert.equal(countIssueCode(result, 'MISSING_FACT_DECLARED_BY_DOCUMENT'), 2);
});

test('missing profile does not flood profile-dependent semantic errors', async (t) => {
  const root = await copyRepo(t);
  await rm(
    path.join(root, 'examples/eval/users/elena-marquez/profile.yaml'),
    { force: true },
  );

  const result = await validateElena(root);
  assertHasCode(result, 'FILE_READ_FAILED');
  assertNoCode(result, 'DOCUMENT_FACT_MISSING');
  assertNoCode(result, 'FIELD_MAP_FACT_MISSING');
  assertNoCode(result, 'MISSING_FACT_NOT_IN_PROFILE');
});

test('unsupported CLI combinations return usage errors', async () => {
  assert.equal(parseArgs(['--corpus', 'realistic']).kind, 'usage-error');
  assert.equal(parseArgs(['--user', '../outside']).kind, 'usage-error');
  assert.equal(
    parseArgs(['--scenario', 'elena-marquez-i9-section1', '--form', 'i-9'])
      .kind,
    'usage-error',
  );

  const result = await runValidation({
    repoRoot,
    args: ['--corpus', 'realistic'],
  });
  assert.equal(result.exitCode, 2);
});

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-validator-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await copyFixtureRepoForTest(repoRoot, root);
  return root;
}

async function copyFixtureRepoForTest(sourceRoot, targetRoot) {
  await mkdir(path.join(targetRoot, 'apps/backend/src/config'), {
    recursive: true,
  });
  await cp(
    path.join(sourceRoot, 'examples/eval'),
    path.join(targetRoot, 'examples/eval'),
    { recursive: true },
  );
  await cp(
    path.join(sourceRoot, 'apps/backend/src/config/preferences.catalog.json'),
    path.join(targetRoot, 'apps/backend/src/config/preferences.catalog.json'),
  );
}

async function validateElena(root) {
  return runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic'],
  });
}

function elenaManifestPath(root) {
  return path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertHasCode(result, code) {
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    `Expected issue code ${code}. Got ${result.issues
      .map((issue) => issue.code)
      .join(', ')}`,
  );
}

function assertNoCode(result, code) {
  assert.ok(
    !result.issues.some((issue) => issue.code === code),
    `Did not expect issue code ${code}.`,
  );
}

function countIssueCode(result, code) {
  return result.issues.filter((issue) => issue.code === code).length;
}
