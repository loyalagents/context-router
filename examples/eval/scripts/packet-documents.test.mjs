import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildPacketDocumentMetadata,
  loadPacketDocumentStats,
  orderPacketDocuments,
  validateDocumentOrder,
} from './packet-documents.mjs';

const documents = [
  { id: 'doc-001', path: 'documents/a.txt', evaluationRole: { expectedUse: 'extract' } },
  { id: 'doc-002', path: 'documents/b.txt', evaluationRole: { expectedUse: 'ignore' } },
  { id: 'doc-003', path: 'documents/c.txt', evaluationRole: { expectedUse: 'corroborate' } },
  { id: 'doc-004', path: 'documents/d.txt', evaluationRole: { expectedUse: 'guardrail' } },
];

test('packet document ordering preserves stable modes', () => {
  assert.deepEqual(ids(orderPacketDocuments(documents)), [
    'doc-001',
    'doc-002',
    'doc-003',
    'doc-004',
  ]);
  assert.deepEqual(ids(orderPacketDocuments(documents, { documentOrder: 'reverse' })), [
    'doc-004',
    'doc-003',
    'doc-002',
    'doc-001',
  ]);
  assert.deepEqual(ids(orderPacketDocuments(documents, { documentOrder: 'relevant-first' })), [
    'doc-001',
    'doc-003',
    'doc-002',
    'doc-004',
  ]);
  assert.deepEqual(ids(orderPacketDocuments(documents, { documentOrder: 'relevant-last' })), [
    'doc-002',
    'doc-004',
    'doc-001',
    'doc-003',
  ]);

  const seeded = ids(orderPacketDocuments(documents, {
    documentOrder: 'seeded-random',
    documentOrderSeed: 'seed-a',
  }));
  assert.deepEqual(
    ids(orderPacketDocuments(documents, {
      documentOrder: 'seeded-random',
      documentOrderSeed: 'seed-a',
    })),
    seeded,
  );
});

test('packet document ordering validates modes and records metadata', () => {
  assert.match(
    validateDocumentOrder({ documentOrder: 'bad-mode' }),
    /--document-order must be one of/,
  );
  const metadata = buildPacketDocumentMetadata({
    documents,
    documentOrder: 'seeded-random',
    documentOrderSeed: 'seed-a',
    sourceCharCount: 42,
    evidenceCharCount: 40,
    maxEvidenceChars: 1000,
  });

  assert.equal(metadata.documentCount, 4);
  assert.equal(metadata.sourceCharCount, 42);
  assert.equal(metadata.evidenceCharCount, 40);
  assert.equal(metadata.maxEvidenceChars, 1000);
  assert.equal(metadata.order.mode, 'seeded-random');
  assert.equal(metadata.order.seed, 'seed-a');
  assert.deepEqual(metadata.order.orderedDocumentIds, ids(documents));
});

test('packet document stats count source document characters', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'packet-docs-'));
  await writeFile(path.join(root, 'a.txt'), 'alpha');
  await writeFile(path.join(root, 'b.txt'), 'bravo!');

  const stats = await loadPacketDocumentStats({
    documentsRoot: root,
    documents: [
      { id: 'a', path: 'a.txt' },
      { id: 'b', path: 'b.txt' },
    ],
  });

  assert.equal(stats.documentCount, 2);
  assert.equal(stats.sourceCharCount, 11);
  assert.deepEqual(stats.documents.map(({ id, charCount }) => [id, charCount]), [
    ['a', 5],
    ['b', 6],
  ]);
  await assert.rejects(
    () => loadPacketDocumentStats({
      documentsRoot: root,
      documents: [{ id: 'escape', path: '../escape.txt' }],
    }),
    /escapes documents root/,
  );

  await readFile(path.join(root, 'a.txt'), 'utf8');
});

function ids(entries) {
  return entries.map((entry) => entry.id);
}
