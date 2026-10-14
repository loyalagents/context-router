import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDemoPlan, parseJsonl, mapRecord, validateDataset } from './records.mjs';
import { createFreshRoot, buildEvidence } from './runtime.mjs';
import { parseOptions } from './demo.mjs';

const source = fileURLToPath(new URL('./001_user_001/', import.meta.url));
const record = {
  id: 'urn:uuid:11111111-1111-4111-8111-111111111111', category: 'home',
  memory: 'I have a woodworking shop.', status: 'active', version: 2,
  confidence: 'medium', declaration_type: 'model-inferred',
  provenance: { source: 'dynamicmem', conversation_ids: ['log_1'], captured_at: '2026-10-07T08:33:43.229Z' },
};
async function temporary(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t, rows) {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'home.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return root;
}

test('all supplied records parse; only active memories become values, preserving original evidence', async () => {
  const plan = await loadDemoPlan(source);
  assert.equal(plan.total, 198);
  assert.equal(plan.entries.length, 189);
  assert.equal(plan.skipped.length, 9);
  assert.equal(plan.sources.length, 11);
  assert.equal(new Set(plan.entries.map(e => e.definition.slug)).size, 189);
  for (const entry of plan.entries) {
    assert.equal(entry.preference.value, JSON.stringify(entry.preference.evidence.sourceRecord.memory));
    assert.equal(entry.definition.slug.split('.')[0], entry.preference.evidence.sourceRecord.category);
    assert.equal(entry.definition.isSensitive, true);
    assert.equal(entry.definition.valueType, 'STRING');
    assert.equal(entry.definition.scope, 'GLOBAL');
    assert.equal(entry.preference.confidence, undefined);
    assert.equal(entry.preference.evidence.sourceRecord.confidence, 'medium');
    assert.equal(entry.preference.evidence.sourceRecord.status, 'active');
  }
  for (const item of plan.sources) {
    assert.equal(item.sha256, createHash('sha256').update(await fs.readFile(path.join(source, item.file))).digest('hex'));
  }
});

test('stable memory identity survives ordering and edited text without changing the source', async t => {
  const firstRoot = await fixture(t, [record]);
  const secondRoot = await fixture(t, [{ ...record, memory: 'My workshop has changed.' }]);
  const a = await loadDemoPlan(firstRoot), b = await loadDemoPlan(secondRoot);
  assert.equal(a.entries[0].definition.slug, b.entries[0].definition.slug);
  assert.deepEqual(a.entries[0].preference.evidence.sourceRecord, record);
  assert.equal(a.entries[0].definition.description.includes(record.memory), false);
  assert.deepEqual(JSON.parse((await fs.readFile(path.join(firstRoot, 'home.jsonl'), 'utf8')).trim()), record);
});

test('inactive memories remain in the manifest but cannot become active preferences', async t => {
  const root = await fixture(t, [{ ...record, status: 'inactive' }]);
  const plan = await loadDemoPlan(root);
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.skipped[0].id, record.id);
});

test('reject malformed JSON, unknown status, mismatched category, duplicate IDs and absent provenance', async t => {
  for (const rows of [
    [record, record], [{ ...record, status: 'unknown' }],
    [{ ...record, category: 'finance' }], [{ ...record, provenance: null }],
    [{ ...record, id: '../escape' }], [{ ...record, memory: '' }],
  ]) {
    await assert.rejects(loadDemoPlan(await fixture(t, rows)), /Invalid|Duplicate/);
  }
  const root = await fixture(t, [record]);
  await fs.writeFile(path.join(root, 'home.jsonl'), '{invalid');
  await assert.rejects(loadDemoPlan(root), /Invalid/);
});

test('reject symlink inputs instead of importing an unrelated file', async t => {
  const root = await temporary(t);
  await fs.symlink(path.join(source, 'home.jsonl'), path.join(root, 'home.jsonl'));
  await assert.rejects(loadDemoPlan(root), /regular/);
});

test('fresh preparation refuses existing state and aliases, never modifying either', async t => {
  const parent = await temporary(t);
  const root = path.join(parent, 'demo');
  await createFreshRoot(root);
  assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
  await fs.writeFile(path.join(root, 'keep'), 'existing data');
  await assert.rejects(createFreshRoot(root));
  assert.equal(await fs.readFile(path.join(root, 'keep'), 'utf8'), 'existing data');
  await fs.symlink(root, path.join(parent, 'alias'));
  await assert.rejects(createFreshRoot(path.join(parent, 'alias', 'new')), /canonical/);
  await assert.rejects(createFreshRoot('relative'), /absolute/);
});

test('default command inspects; durable commands and explicit legacy destinations cannot be mixed', () => {
  assert.equal(parseOptions([]).command, 'inspect');
  assert.equal(parseOptions(['prepare']).command, 'prepare');
  assert.equal(parseOptions(['prepare', '--fresh']).fresh, true);
  assert.equal(parseOptions(['prepare', '--port', '8788']).port, 8788);
  assert.equal(parseOptions(['prepare', '--mcp-port', '3003']).mcpPort, 3003);
  assert.throws(() => parseOptions(['prepare', '--out', '/private/tmp/demo', '--home', '/private/tmp/home']), /mix|combined/);
  assert.throws(() => parseOptions(['prepare', '--out', '/private/tmp/demo', '--fresh']), /fresh/);
  assert.throws(() => parseOptions(['claude', '--login']), /login/);
  assert.equal(parseOptions(['codex', '--agent', 'a', '--login']).login, true);
  assert.throws(() => parseOptions(['prepare', '--out', '/private/tmp/demo', '--reset']), /Unknown/);
  assert.throws(() => parseOptions(['serve', '--root', '/private/tmp/demo', '--mcp-port', '0']), /port/);
  assert.throws(() => parseOptions(['serve', '--root', '/private/tmp/demo', '--mcp-port', '3003']), /distinct/);
  assert.equal(parseOptions(['serve', '--root', '/private/tmp/demo']).mcpPort, 8788);
});

 test('dataset is a bounded single slug segment and mapping is reusable without I/O', () => {
  for (const value of ['', 'a.b', '../x', '*', 'UPPER', 'x'.repeat(33)]) assert.throws(() => validateDataset(value));
  const parsed = parseJsonl(JSON.stringify(record), { file: 'home.jsonl', sha256: 'a'.repeat(64) });
  const mapped = mapRecord(parsed[0], 'another');
  assert.match(mapped.definition.slug, /^home\.another\.memory_/);
  assert.deepEqual(mapped.preference.evidence.sourceRecord, record);
 });
 test('reject oversized and directory source files and source-directory aliases', async t => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'home.jsonl'));
  await assert.rejects(loadDemoPlan(root));
  await fs.rm(path.join(root, 'home.jsonl'), { recursive: true });
  await fs.writeFile(path.join(root, 'home.jsonl'), Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(loadDemoPlan(root));
  await fs.symlink(source, path.join(root, 'alias'));
  await assert.rejects(loadDemoPlan(path.join(root, 'alias')));
 });

test('preparation refuses repository-local state before creating artifacts', async () => {
  const { prepareDemo, repoRoot } = await import('./runtime.mjs');
  await assert.rejects(prepareDemo({ out: path.join(repoRoot, 'examples/demo-10-2026/private-state') }), /outside the repository/);
});

test('build preflight discovers pnpm on the user PATH but does not inherit shell secrets', async t => {
  const root = await temporary(t), marker = path.join(root, 'pnpm-ran');
  await fs.writeFile(path.join(root, 'pnpm'), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({secret:process.env.DEMO_TEST_SECRET,nodeOptions:process.env.NODE_OPTIONS,path:process.env.PATH}));\nconsole.log('10.25.0');\n`, { mode: 0o700 });
  const original = process.env.PATH;
  process.env.PATH = root; process.env.DEMO_TEST_SECRET = 'must-not-inherit';
  try {
    assert.equal((await buildEvidence()).pnpm, '10.25.0');
    const observed = JSON.parse(await fs.readFile(marker, 'utf8'));
    assert.equal(observed.secret, undefined); assert.equal(observed.nodeOptions, undefined);
    assert.notEqual(observed.path, root);
  } finally {
    if (original === undefined) delete process.env.PATH; else process.env.PATH = original;
    delete process.env.DEMO_TEST_SECRET;
  }
});

test('an older pnpm on PATH is rejected with a toolchain and PATH correction hint', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'pnpm'), '#!/bin/sh\necho 10.24.0\n', { mode: 0o700 });
  const original = process.env.PATH; process.env.PATH = root;
  try { await assert.rejects(buildEvidence(), error => {
    assert.match(error.demoSafeMessage, /pnpm 10\.25\.0/);
    assert.match(error.demoSafeMessage, /corepack prepare pnpm@10\.25\.0 --activate/);
    assert.match(error.demoSafeMessage, /Node.*bin.*PATH/);
    return true;
  }); } finally { if (original === undefined) delete process.env.PATH; else process.env.PATH = original; }
});
