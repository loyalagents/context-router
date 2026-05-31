import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runGenerate } from './generate.mjs';
import { runManifest } from './manifest.mjs';
import { runPlanCorpus } from './plan-corpus.mjs';
import { runPromotePreview } from './promote-preview.mjs';
import { getFactValue, planDocumentFactKeys } from './shared.mjs';
import { runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('ten-document user corpus workflow plans, previews, validates, and promotes without Vertex', async (t) => {
  const root = await copyRepo(t);
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-workflow-preview-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  const plan = await runPlanCorpus({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'workflow-test',
      '--form',
      'i-9',
      '--count',
      '10',
    ],
  });
  assert.equal(plan.exitCode, 0, plan.errorMessage);

  const manifest = await runManifest({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'workflow-test'],
  });
  assert.equal(manifest.exitCode, 0, manifest.errorMessage);

  const generated = await runGenerate({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'workflow-test',
      '--model',
      'unit-model',
      '--out',
      previewRoot,
    ],
    generateDocument: generateDeterministicBody,
  });
  assert.equal(generated.exitCode, 0, generated.errorMessage);
  assert.match(generated.lines.join('\n'), /generated 10 document/);

  const previewValidation = await runValidation({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'workflow-test',
      '--documents-root',
      previewRoot,
      '--report-out',
      path.join(previewRoot, 'validation-report.json'),
    ],
  });
  assert.equal(previewValidation.exitCode, 0, formatIssueCodes(previewValidation));

  const promoted = await runPromotePreview({
    repoRoot: root,
    args: [
      '--user',
      'samir-desai',
      '--corpus',
      'workflow-test',
      '--from',
      previewRoot,
    ],
  });
  assert.equal(promoted.exitCode, 0, promoted.errorMessage);

  const committedCorpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/workflow-test',
  );
  const committedReport = JSON.parse(
    await readFile(path.join(committedCorpusRoot, 'validation-report.json'), 'utf8'),
  );
  assert.equal(committedReport.status, 'pass');
  assert.equal(
    await countFiles(path.join(committedCorpusRoot, 'documents')),
    10,
  );
});

function generateDeterministicBody(_prompt, { doc, profile }) {
  const facts = Object.fromEntries(
    planDocumentFactKeys(doc).map((factKey) => [
      factKey,
      getFactValue(profile.facts ?? {}, factKey),
    ]),
  );

  if (doc.outputExtension === 'json') {
    return JSON.stringify(
      {
        recordType: doc.title,
        status: doc.evaluationRole.freshness,
        generatedFor: doc.category,
        facts,
        notes: [
          'Synthetic unit-test preview document.',
          'The start date, address, and contact values are copied only from declared fact keys.',
        ],
      },
      null,
      2,
    );
  }

  if (doc.outputExtension === 'yaml') {
    return [
      `recordType: ${JSON.stringify(doc.title)}`,
      `status: ${JSON.stringify(doc.evaluationRole.freshness)}`,
      `generatedFor: ${JSON.stringify(doc.category)}`,
      'facts:',
      ...Object.entries(facts).map(
        ([factKey, value]) => `  ${JSON.stringify(factKey)}: ${JSON.stringify(value)}`,
      ),
      'notes:',
      '  - "Synthetic unit-test preview document."',
      '  - "The employment start date and contact values are copied only from declared fact keys."',
    ].join('\n');
  }

  if (planDocumentFactKeys(doc).length === 0) {
    return [
      doc.title,
      `Document id: ${doc.id}.`,
      doc.category === 'noise'
        ? 'Community bulletin covering parking reminders, library hours, and facility notices.'
        : 'Archived note marked stale for guardrail coverage, with no current canonical profile values.',
      'This body is intentionally long enough for the declared detail tier and avoids user identifiers.',
    ].join('\n');
  }

  return [
    doc.title,
    `Document id: ${doc.id}.`,
    'Status: current synthetic unit-test record.',
    ...Object.entries(facts).map(([factKey, value]) => `${factKey}: ${formatFactValue(value)}.`),
    'Administrative context: this document includes only the declared profile facts needed by the eval and omits intentionally missing or forbidden values.',
  ].join('\n');
}

function formatFactValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

async function countFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(absolute);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      count += 1;
    }
  }
  return count;
}

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-workflow-'));
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

function formatIssueCodes(result) {
  return result.issues.map((issue) => issue.code).join(', ');
}
