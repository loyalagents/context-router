import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const uuid = /^urn:uuid:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateDataset(dataset) {
  if (typeof dataset !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(dataset)) throw new Error('Invalid dataset segment.');
  return dataset;
}

/** Pure parser: retain the complete source record, including unknown extension fields. */
export function parseJsonl(content, { file, sha256 }) {
  const category = file.replace(/\.jsonl$/, '');
  if (!/^[a-z][a-z0-9_]{0,31}\.jsonl$/.test(file) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid source metadata.');
  const rows = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`Invalid JSON in ${file}:${index + 1}.`); }
    if (!object(record) || !uuid.test(record.id) || record.category !== category ||
        !text(record.memory) || !['active', 'inactive'].includes(record.status) ||
        !Number.isSafeInteger(record.version) || record.version < 1 || !text(record.confidence) ||
        !text(record.declaration_type) || !object(record.provenance) ||
        !text(record.provenance.source) || !Array.isArray(record.provenance.conversation_ids) ||
        !record.provenance.conversation_ids.every(text) || !text(record.provenance.captured_at) ||
        !Number.isFinite(Date.parse(record.provenance.captured_at))) throw new Error(`Invalid memory record in ${file}:${index + 1}.`);
    rows.push({ file, line: index + 1, sha256, sourceRecord: record });
  }
  return rows;
}

/** Pure mapping, independent of transport, credentials, paths and database state. */
export function mapRecord(source, dataset = 'demo001') {
  validateDataset(dataset);
  const record = source.sourceRecord;
  if (record.status !== 'active') return null;
  const slug = `${record.category}.${dataset}.memory_${record.id.match(uuid)[1].replaceAll('-', '')}`;
  return {
    definition: {
      slug, displayName: `${record.category[0].toUpperCase() + record.category.slice(1)} memory ${source.line}`,
      description: `Imported ${record.category} context. Retrieve the stored value for details. Source ID: ${record.id}.`,
      valueType: 'STRING', scope: 'GLOBAL', isSensitive: true,
    },
    preference: { slug, value: JSON.stringify(record.memory), evidence: { importFormat: 'context-router-demo-jsonl-v1', ...source } },
  };
}

export async function loadDemoPlan(input, dataset = 'demo001') {
  validateDataset(dataset);
  input = path.resolve(input);
  if (await fs.realpath(input) !== input || !(await fs.lstat(input)).isDirectory()) throw new Error('Source directory must be canonical, without symlinks.');
  const names = (await fs.readdir(input)).filter(name => name.endsWith('.jsonl')).sort();
  if (!names.length || names.length > 64) throw new Error('Expected 1–64 JSONL files.');
  const entries = [], skipped = [], sources = [], seen = new Set();
  for (const file of names) {
    const filename = path.join(input, file), before = await fs.lstat(filename);
    if (!before.isFile() || before.nlink !== 1 || before.size > 5 * 1024 * 1024) throw new Error('Source must be a bounded regular file.');
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new Error('Source changed while reading.');
      bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length); if (!bytesRead) break; length += bytesRead; }
      const after = await handle.stat(), named = await fs.lstat(filename);
      if (length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino) throw new Error('Source changed while reading.');
      bytes = bytes.subarray(0, length);
    } finally { await handle.close(); }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`Invalid UTF-8 in ${file}.`); }
    const sha256 = hash(bytes);
    sources.push({ file, sha256, bytes: bytes.length });
    for (const source of parseJsonl(content, { file, sha256 })) {
      const id = source.sourceRecord.id;
      if (seen.has(id)) throw new Error(`Duplicate memory ID in ${file}:${source.line}.`);
      seen.add(id);
      if (seen.size > 10000) throw new Error('Too many memory records.');
      const entry = mapRecord(source, dataset);
      if (entry) entries.push(entry); else skipped.push({ id, ...source });
    }
  }
  return { dataset, total: seen.size, sources, entries, skipped };
}

export function summarize(plan) {
  return { dataset: plan.dataset, total: plan.total, active: plan.entries.length, inactiveSkipped: plan.skipped.length,
    categories: Object.fromEntries(plan.sources.map(s => [s.file.slice(0, -6), plan.entries.filter(e => e.definition.slug.startsWith(`${s.file.slice(0, -6)}.`)).length])), sources: plan.sources };
}
