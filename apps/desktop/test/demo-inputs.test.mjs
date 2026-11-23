import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const corpus = fileURLToPath(new URL('../../../examples/demo-10-2026/001_user_001', import.meta.url));
function assertNoSsn(plan) {
  const records = [...plan.entries.map(e => e.preference.evidence.sourceRecord), ...plan.skipped.map(e => e.sourceRecord)];
  const text = records.flatMap(record => [record.memory, record.provenance.note ?? '']).join('\n');
  assert.doesNotMatch(text, /\bSSN\b|social security|(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)/i);
}
test('SSN guard covers active and inactive memories and provenance notes, with or without separators', () => {
  for (const status of ['active', 'inactive']) for (const field of ['memory', 'note']) for (const ssn of ['123-45-6789', '123456789', '123 45 6789']) {
    const record = { memory: 'Synthetic context', provenance: { note: 'Fictional detail' } };
    if (field === 'memory') record.memory = ssn; else record.provenance.note = ssn;
    const plan = status === 'active' ? { entries: [{ preference: { evidence: { sourceRecord: record } } }], skipped: [] } : { entries: [], skipped: [{ sourceRecord: record }] };
    assert.throws(() => assertNoSsn(plan), assert.AssertionError, `${status} ${field}: ${ssn}`);
  }
});
test('packaged seed uses the pinned canonical corpus and rejects tampering', async () => {
  const { loadBundledSeed } = await import('../../backend/scripts/demo/seed.mjs');
  const { loadDemoPlan } = await import('../../../examples/demo-10-2026/records.mjs');
  const seed = await loadBundledSeed(corpus);
  assert.deepEqual(seed.plan, await loadDemoPlan());
  assert.equal(seed.plan.total, 201);
  assert.equal(seed.plan.entries.length, 192);
  assert.equal(seed.plan.skipped.length, 9);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-seed-')));
  try {
    await fs.cp(corpus, path.join(root, 'corpus'), { recursive: true });
    const file = path.join(root, 'corpus', seed.plan.sources[0].file);
    await fs.appendFile(file, '\n');
    await assert.rejects(loadBundledSeed(path.join(root, 'corpus')), /seed.*mismatch/i);
    await fs.unlink(file); await fs.symlink(path.join(corpus, seed.plan.sources[0].file), file);
    await assert.rejects(loadBundledSeed(path.join(root, 'corpus')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('I-9 supplement contains the approved fictional facts, stable updates and no SSN', async () => {
  const { loadBundledSeed } = await import('../../backend/scripts/demo/seed.mjs');
  const { plan } = await loadBundledSeed(corpus);
  const supplemented = plan.entries.filter(e => e.preference.evidence.sourceRecord.provenance.source === 'synthetic-i9-demo');
  const expected = new Map([
    ['career.demo001.memory_bf484cfa88424c9e87352424704ad19d', 'My full legal name is Richard James Miller. I have never used another last name.'],
    ['home.demo001.memory_1519761cd72343c8ab2bdc7a99c8ac22', 'My current home address is 104 Village Dr, Wexford, PA 15090. My address has no apartment or unit number. This is also my food delivery address.'],
    ['work.demo001.memory_9923db9cdc2e4e18aab3e27a84f4d0b8', 'I drive from my home in Wexford, PA to 1 PPG Place, Pittsburgh for work.'],
    ['family.demo001.memory_25b96b7ef85d49a290ed1c855f83ce84', 'My date of birth is April 16, 1978.'],
    ['home.demo001.memory_0ecbd5713f08498fae7b928096c776cf', 'My personal email address is richard.miller@example.com, and my mobile phone number is 412-555-0147.'],
    ['career.demo001.memory_22dd22dc468040ab90e1dd2fac08ae05', 'I am a citizen of the United States.'],
  ]);
  assert.deepEqual(new Map(supplemented.map(e => [e.definition.slug, JSON.parse(e.preference.value)])), expected);
  for (const entry of supplemented) {
    const record = entry.preference.evidence.sourceRecord;
    assert.equal(record.declaration_type, 'synthetic-authored');
    assert.deepEqual(record.provenance.conversation_ids, []);
    assert.match(record.provenance.note, /fictional/i);
    assert.equal(entry.definition.isSensitive, true);
    assert.equal(record.version, ['bf484cfa', '1519761c', '9923db9c'].some(id => record.id.includes(id)) ? 2 : 1);
  }
  const memories = plan.entries.map(e => JSON.parse(e.preference.value)).join('\n');
  assert.doesNotMatch(memories, /Upper St\. Clair/);
  assertNoSsn(plan);
});
test('backend deployment explicitly includes shared importer, clients and bridge', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../../backend/package.json', import.meta.url)));
  for (const entry of ['scripts/demo', 'scripts/mcp-bridge']) assert.ok(pkg.files.includes(entry), entry);
  const original = await import('../../../examples/demo-10-2026/mcp-import.mjs');
  const shared = await import('../../backend/scripts/demo/mcp-import.mjs');
  for (const key of ['connect', 'call', 'importEntries']) assert.equal(original[key], shared[key]);
  const clients = await import('../../../examples/demo-10-2026/clients.mjs');
  const sharedClients = await import('../../backend/scripts/demo/clients.mjs');
  assert.equal(clients.clientLaunchSpec, sharedClients.clientLaunchSpec);
  assert.equal(clients.preflightClient, sharedClients.preflightClient);
});
test('packager copies exactly the verified versioned seed and verifies its copy', async () => {
  const { copyDemoSeed } = await import('../src/demo-seed.mjs');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-copy-')));
  try {
    const destination = path.join(root, 'seed');
    const receipt = await copyDemoSeed(corpus, destination);
    assert.equal(receipt.version, 'historical-2024-2025-v1');
    const expected = (await fs.readdir(corpus)).filter(n => n.endsWith('.jsonl')).sort();
    assert.deepEqual((await fs.readdir(destination)).sort(), expected);
    for (const name of expected) assert.deepEqual(await fs.readFile(path.join(destination, name)), await fs.readFile(path.join(corpus, name)));
    await assert.rejects(copyDemoSeed(corpus, destination));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
