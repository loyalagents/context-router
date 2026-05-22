import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDocumentPrompt,
  manifestFromCorpusPlan,
  parseArgs,
  runGenerate,
} from './generate.mjs';

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

test('manifest projection keeps plan-owned metadata out of manifest', () => {
  const manifest = manifestFromCorpusPlan({
    userId: 'samir-desai',
    corpusId: 'realistic',
    forms: ['i-9'],
    purpose: 'Generated test.',
    intentionallyMissing: [],
    documents: [
      {
        id: '001',
        path: 'documents/identity/001-id.md',
        category: 'identity',
        title: 'Identity',
        outputExtension: 'md',
        factKeys: ['identity.ssn'],
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
