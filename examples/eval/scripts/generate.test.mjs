import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDocumentPrompt,
  manifestFromCorpusPlan,
  normalizeGeneratedText,
  parseArgs,
  runGenerate,
} from './generate.mjs';
import { runManifest } from './manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('generate arg parser protects previews and concurrency', () => {
  assert.equal(
    parseArgs(['--user', 'samir-desai', '--corpus', 'realistic', '--limit', '5'])
      .kind,
    'usage-error',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--concurrency',
      '0',
    ]).kind,
    'usage-error',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--limit',
      '5',
      '--out',
      '/private/tmp/preview',
    ]).kind,
    'ok',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--ids',
      '001,017',
    ]).kind,
    'usage-error',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--ids',
      '001,017',
      '--out',
      '/private/tmp/preview',
    ]).kind,
    'ok',
  );
  assert.equal(
    parseArgs([
      '--user',
      'samir-desai',
      '--corpus',
      'realistic',
      '--overwrite',
      '--out',
      '/private/tmp/preview',
    ]).kind,
    'usage-error',
  );
});

test('document prompt includes only the requested profile slice', () => {
  const prompt = buildDocumentPrompt({
    profile: {
      facts: {
        identity: { legalName: 'Samir Arun Desai', ssn: '000-00-0389' },
        employment: { workEmail: 'samir.desai@northstarcivic.example.test' },
      },
    },
    corpusPlan: { intentionallyMissing: [] },
    doc: {
      id: '001',
      factKeys: ['identity.ssn'],
    },
  });

  assert.match(prompt, /000-00-0389/);
  assert.doesNotMatch(prompt, /northstarcivic/);
});

test('document prompt exposes only explicitly forbidden values', () => {
  const prompt = buildDocumentPrompt({
    profile: {
      facts: {
        identity: { legalName: 'Samir Arun Desai', ssn: '000-00-0389' },
        employment: { workEmail: 'samir.desai@northstarcivic.example.test' },
      },
    },
    corpusPlan: { intentionallyMissing: [] },
    doc: {
      id: '001',
      factKeys: ['identity.legalName'],
      forbiddenFactKeys: ['employment.workEmail'],
    },
  });

  assert.match(prompt, /Forbidden fact keys/);
  assert.match(prompt, /employment\.workEmail/);
  assert.match(prompt, /samir\.desai@northstarcivic\.example\.test/);
  assert.match(prompt, /Samir Arun Desai/);
  assert.doesNotMatch(prompt, /000-00-0389/);
});

test('document prompt includes effective default forbidden values only for the current document', () => {
  const prompt = buildDocumentPrompt({
    profile: {
      facts: {
        identity: { legalName: 'Samir Arun Desai', ssn: '000-00-0389' },
        employment: { workEmail: 'samir.desai@northstarcivic.example.test' },
      },
    },
    corpusPlan: {
      defaultForbiddenFactKeys: ['identity.ssn', 'employment.workEmail'],
      intentionallyMissing: [],
    },
    doc: {
      id: '001',
      factKeys: ['identity.ssn'],
    },
  });

  const forbiddenKeys = JSON.parse(
    prompt.match(/Forbidden fact keys:\n([\s\S]*?)\n\nForbidden profile values:/)[1],
  );
  const forbiddenValues = JSON.parse(
    prompt.match(/Forbidden profile values:\n([\s\S]*?)\n\nDocument plan entry:/)[1],
  );

  assert.deepEqual(forbiddenKeys, ['employment.workEmail']);
  assert.equal(
    forbiddenValues.employment.workEmail,
    'samir.desai@northstarcivic.example.test',
  );
  assert.equal(forbiddenValues.identity, undefined);
});

test('document prompt includes file type instructions and missing facts', () => {
  const prompt = buildDocumentPrompt({
    profile: {
      facts: {
        identity: { legalName: 'Samir Arun Desai' },
      },
    },
    corpusPlan: {
      intentionallyMissing: [
        {
          factKey: 'contact.phone',
          forms: ['i-9'],
          reason: 'Phone is missing.',
          expectedBehavior: 'Leave it blank.',
        },
      ],
    },
    doc: {
      id: '001',
      path: 'documents/identity/001-id.json',
      outputExtension: 'json',
      factKeys: ['identity.legalName'],
    },
  });

  assert.match(prompt, /Output format: valid JSON only/);
  assert.match(prompt, /Do not wrap JSON in markdown fences/);
  assert.match(prompt, /contact.phone/);
  assert.match(prompt, /Samir Arun Desai/);
});

test('structured generated text strips only wrapping fences', () => {
  assert.equal(
    normalizeGeneratedText('```json\n{"ok":true}\n```', { outputExtension: 'json' }),
    '{"ok":true}',
  );
  assert.equal(
    normalizeGeneratedText('```yaml\nok: true\n```', { outputExtension: 'yaml' }),
    'ok: true',
  );
  assert.equal(
    normalizeGeneratedText('```text\nplain export\n```', { outputExtension: 'txt' }),
    'plain export',
  );
  assert.equal(
    normalizeGeneratedText('```md\n# Keep me fenced\n```', { outputExtension: 'md' }),
    '```md\n# Keep me fenced\n```',
  );
});

test('manifest projection keeps plan-owned metadata out of manifest', () => {
  const manifest = manifestFromCorpusPlan({
    userId: 'samir-desai',
    corpusId: 'realistic',
    forms: ['i-9'],
    purpose: 'Generated test.',
    defaultForbiddenFactKeys: ['contact.phone'],
    intentionallyMissing: [],
    documents: [
      {
        id: '001',
        path: 'documents/identity/001-id.md',
        category: 'identity',
        title: 'Identity',
        outputExtension: 'md',
        factKeys: ['identity.ssn'],
        forbiddenFactKeys: ['employment.workEmail'],
        detailTier: 'brief',
        authority: 'medium',
        freshness: 'current',
        expectedUse: 'extract',
        challengeTags: ['current-fact'],
        brief: 'Plan-only brief.',
      },
    ],
  });

  assert.equal(manifest.seed, 'samir-desai__realistic');
  assert.equal(manifest.documents[0].template, undefined);
  assert.equal(manifest.documents[0].brief, undefined);
  assert.equal(manifest.documents[0].challengeTags, undefined);
  assert.equal(manifest.documents[0].forbiddenFactKeys, undefined);
  assert.equal(manifest.defaultForbiddenFactKeys, undefined);
});

test('runGenerate writes preview documents without touching corpus manifest', async (t) => {
  const root = await copyRepo(t);
  await writeGeneratedTestPlan(root);
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-generate-preview-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  const result = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'generated-test',
      '--model',
      'unit-model',
      '--limit',
      '1',
      '--out',
      previewRoot,
    ],
    generateDocument: async (prompt) => prompt,
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  assert.match(result.lines.join('\n'), /generated 1 document/);
  assert.equal(
    await fileExists(
      path.join(
        root,
        'examples/eval/users/samir-desai/corpora/generated-test/manifest.json',
      ),
    ),
    false,
  );
});

test('runManifest writes manifest from corpus plan without a model', async (t) => {
  const root = await copyRepo(t);
  await writeGeneratedTestPlan(root);
  const corpusPlanPath = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/generated-test/corpus-plan.json',
  );
  const corpusPlan = await readJson(corpusPlanPath);
  corpusPlan.defaultForbiddenFactKeys = ['identity.ssn'];
  corpusPlan.documents[0].forbiddenFactKeys = ['employment.workEmail'];
  await writeJson(corpusPlanPath, corpusPlan);

  const result = await runManifest({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'generated-test'],
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/generated-test/manifest.json',
    ),
  );
  assert.equal(manifest.seed, 'samir-desai__generated-test');
  assert.equal(manifest.documents.length, 6);
  assert.equal(manifest.defaultForbiddenFactKeys, undefined);
  assert.equal(manifest.documents[0].forbiddenFactKeys, undefined);
});

test('runGenerate resolves short ids for preview and overwrite regenerates existing docs', async (t) => {
  const root = await copyRepo(t);
  await writeGeneratedTestPlan(root);
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-generate-ids-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  const preview = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'generated-test',
      '--model',
      'unit-model',
      '--ids',
      '001,003',
      '--out',
      previewRoot,
    ],
    generateDocument: async (_prompt, { doc }) => `preview ${doc.id}`,
  });

  assert.equal(preview.exitCode, 0, preview.errorMessage);
  assert.match(preview.lines.join('\n'), /generated 2 document/);

  const full = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'generated-test',
      '--model',
      'unit-model',
    ],
    generateDocument: async (prompt, { doc }) => `first ${doc.id}\n${prompt}`,
  });
  assert.equal(full.exitCode, 0, full.errorMessage);

  const overwrite = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'generated-test',
      '--model',
      'unit-model',
      '--overwrite',
    ],
    generateDocument: async (prompt, { doc }) => `second ${doc.id}\n${prompt}`,
  });
  assert.equal(overwrite.exitCode, 0, overwrite.errorMessage);
  assert.match(overwrite.lines.join('\n'), /generated 6 document/);

  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/generated-test/manifest.json',
    ),
  );
  const firstDoc = await readFile(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/generated-test',
      manifest.documents[0].path,
    ),
    'utf8',
  );
  assert.match(firstDoc, /^second /);
});

test('runGenerate writes a full generated corpus and validation report', async (t) => {
  const root = await copyRepo(t);
  await writeGeneratedTestPlan(root);

  const result = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'generated-test',
      '--model',
      'unit-model',
    ],
    generateDocument: async (prompt) => prompt,
  });

  assert.equal(result.exitCode, 0, result.errorMessage);
  const manifest = await readJson(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/generated-test/manifest.json',
    ),
  );
  assert.equal(manifest.documents.length, 6);
  const report = await readJson(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/generated-test/validation-report.json',
    ),
  );
  assert.equal(report.status, 'pass');
});

async function writeGeneratedTestPlan(root) {
  const sourceManifest = await readJson(
    path.join(
      root,
      'examples/eval/users/samir-desai/corpora/template-smoke/manifest.json',
    ),
  );
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/generated-test',
  );
  await mkdir(corpusRoot, { recursive: true });
  const categoryCounts = {};
  for (const doc of sourceManifest.documents) {
    categoryCounts[doc.category] = (categoryCounts[doc.category] ?? 0) + 1;
  }
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), {
    schemaVersion: 1,
    userId: 'samir-desai',
    corpusId: 'generated-test',
    forms: sourceManifest.forms,
    purpose: sourceManifest.purpose,
    targetDocumentCount: sourceManifest.documents.length,
    categoryCounts,
    challengeTags: ['current-fact', 'missing-fact'],
    intentionallyMissing: sourceManifest.intentionallyMissing,
    documents: sourceManifest.documents.map(({ template: _template, ...doc }) => ({
      ...doc,
      outputExtension: path.posix.extname(doc.path).slice(1),
      challengeTags: ['current-fact'],
      brief: `Generate ${doc.title}.`,
    })),
  });
}

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-generator-'));
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

async function fileExists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
