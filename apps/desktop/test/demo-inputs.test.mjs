import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const corpus = fileURLToPath(new URL('../../../examples/demo-10-2026/001_user_001', import.meta.url));
test('packaged seed uses the unchanged canonical corpus and rejects tampering', async () => {
  const { loadBundledSeed } = await import('../../backend/scripts/demo/seed.mjs');
  const { loadDemoPlan } = await import('../../../examples/demo-10-2026/records.mjs');
  const seed = await loadBundledSeed(corpus);
  assert.deepEqual(seed.plan, await loadDemoPlan());
  assert.equal(seed.plan.total, 198);
  assert.equal(seed.plan.entries.length, 189);
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
