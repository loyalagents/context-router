import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashHex, toPosixPath } from './shared.mjs';

export const DEFAULT_DOCUMENT_ORDER = 'canonical';
export const DEFAULT_DOCUMENT_ORDER_SEED = 'packet-document-order-v1';
export const DOCUMENT_ORDER_MODES = new Set([
  'canonical',
  'reverse',
  'seeded-random',
  'relevant-first',
  'relevant-last',
]);

export function validateDocumentOrder({ documentOrder }) {
  if (!DOCUMENT_ORDER_MODES.has(documentOrder)) {
    return `--document-order must be one of ${[...DOCUMENT_ORDER_MODES].join(', ')}.`;
  }
  return null;
}

export function orderPacketDocuments(
  documents,
  {
    documentOrder = DEFAULT_DOCUMENT_ORDER,
    documentOrderSeed = DEFAULT_DOCUMENT_ORDER_SEED,
  } = {},
) {
  const validationMessage = validateDocumentOrder({ documentOrder });
  if (validationMessage) throw new Error(validationMessage);

  const indexed = (documents ?? []).map((doc, index) => ({ doc, index }));
  if (documentOrder === 'canonical') return indexed.map(({ doc }) => doc);
  if (documentOrder === 'reverse') return indexed.reverse().map(({ doc }) => doc);
  if (documentOrder === 'seeded-random') {
    return indexed
      .sort((left, right) => {
        const leftKey = documentSortKey(left, documentOrderSeed);
        const rightKey = documentSortKey(right, documentOrderSeed);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.index - right.index;
      })
      .map(({ doc }) => doc);
  }

  const relevant = [];
  const other = [];
  for (const entry of indexed) {
    if (isRelevantDocument(entry.doc)) relevant.push(entry);
    else other.push(entry);
  }
  const ordered = documentOrder === 'relevant-first'
    ? [...relevant, ...other]
    : [...other, ...relevant];
  return ordered.map(({ doc }) => doc);
}

export async function loadPacketDocumentStats({ documentsRoot, documents }) {
  const root = path.resolve(documentsRoot);
  const perDocument = [];
  let sourceCharCount = 0;

  for (const doc of documents ?? []) {
    const relativeDocPath = doc.path;
    const absolutePath = path.resolve(root, relativeDocPath);
    if (!isInside(root, absolutePath)) {
      throw new Error(`Document path escapes documents root: ${relativeDocPath}`);
    }
    const content = await readFile(absolutePath, 'utf8');
    sourceCharCount += content.length;
    perDocument.push({
      id: doc.id ?? null,
      path: toPosixPath(relativeDocPath),
      charCount: content.length,
    });
  }

  return {
    documentCount: perDocument.length,
    sourceCharCount,
    documents: perDocument,
  };
}

export function buildPacketDocumentMetadata({
  documents,
  documentOrder = DEFAULT_DOCUMENT_ORDER,
  documentOrderSeed = null,
  sourceCharCount = null,
  evidenceCharCount = null,
  maxEvidenceChars = null,
}) {
  return {
    documentCount: documents?.length ?? 0,
    sourceCharCount,
    evidenceCharCount,
    maxEvidenceChars,
    order: {
      mode: documentOrder,
      seed: documentOrder === 'seeded-random' ? documentOrderSeed : null,
      orderedDocumentIds: (documents ?? []).map((doc) => doc.id ?? null),
    },
  };
}

export function evidenceCharCount(evidenceDocuments) {
  return (evidenceDocuments ?? []).reduce(
    (total, doc) => total + (typeof doc.content === 'string' ? doc.content.length : 0),
    0,
  );
}

function documentSortKey({ doc, index }, seed) {
  return hashHex(seed, doc.id ?? '', doc.path ?? '', String(index));
}

function isRelevantDocument(doc) {
  const expectedUse = doc?.evaluationRole?.expectedUse;
  return expectedUse === 'extract' || expectedUse === 'corroborate';
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
