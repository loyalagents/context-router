import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { backend } from '../../../../examples/demo-10-2026/runtime.mjs';
import { seedDemo } from '../../../backend/scripts/demo/domain.mjs';
import { preparePair, prepareEvidence, treeBytes, seed } from '../fixtures/real-demo-seed.mjs';

test('real closed seed receipts cannot bypass failed terminal or native selector durability failures', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-publication-faults-')));
  // Retain expected-uncertain journals and all associated bytes. Never reclaim
  // them merely because this fixture's directly awaited processes have exited.
  t.diagnostic(`Retained owned publication evidence: ${root}`);
  const driver = path.join(root, 'driver'), native = path.resolve(import.meta.dirname, '../../native');
  const built = spawnSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security', '-I', native,
    path.resolve(import.meta.dirname, '../fixtures/demo-publication.m'), path.join(native, 'package.m'), '-o', driver], { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.stderr);
  const run = args => { const r = spawnSync(driver, args, { env: {}, encoding: 'utf8', timeout: 5000 }); assert.equal(r.error, undefined); assert.equal(r.signal, null); return r; };
  const b = backend(), bundle = await seed();
  const personal = path.join(root, 'personal'); await preparePair(personal); await b.waitForNativeOwners();
  for (const fault of ['success', 'before-rename', 'directory-sync', 'failed-terminal']) {
    const dir = path.join(root, fault); await fs.mkdir(dir, { mode: 0o700 });
    const envelope = path.join(dir, 'managed-v1');
    const reserved = run([envelope, 'reserve', personal, bundle.sha256]); assert.equal(reserved.status, 0, reserved.stdout);
    const before = JSON.parse(reserved.stdout), storeId = before.pendingDemo.storeId;
    const oldPair = path.join(envelope, 'stores', before.personalStore), oldBytes = await treeBytes(oldPair);
    const source = path.join(dir, 'closed-source'), configuration = await preparePair(source), directory = await prepareEvidence(source);
    const options = { configuration, directory, seed: bundle, storeId, installationId: before.installationId };
    if (fault === 'failed-terminal') {
      let fired = 0;
      await assert.rejects(seedDemo(options, { checkpoint: async point => { if (point === 'after-receipt') { fired++; throw new Error('failed terminal after complete receipt'); } } }), /never be replayed/);
      assert.equal(fired, 1);
    } else await seedDemo(options);
    await b.waitForNativeOwners();
    const dataBytes = await treeBytes(path.join(source, 'data')), identityBytes = await treeBytes(path.join(source, 'identity')), evidenceBytes = await treeBytes(directory);
    const result = run([envelope, fault, source, directory]); assert.equal(result.status, fault === 'success' ? 0 : 1);
    assert.deepEqual(JSON.parse(result.stdout), { injected: ['failed-terminal', 'success'].includes(fault) ? 0 : 1, refused: fault !== 'success' });
    assert.deepEqual(await treeBytes(oldPair), oldBytes);
    assert.deepEqual(await treeBytes(path.join(envelope, 'stores', storeId, 'data')), dataBytes);
    assert.deepEqual(await treeBytes(path.join(envelope, 'stores', storeId, 'identity')), identityBytes);
    assert.deepEqual(await treeBytes(path.join(envelope, 'demo', storeId)), evidenceBytes);
    const state = JSON.parse(await fs.readFile(path.join(envelope, 'installation.json'))), journal = JSON.parse(await fs.readFile(path.join(envelope, 'owner.json')));
    assert.equal(state.selectedStore, ['directory-sync', 'success'].includes(fault) ? storeId : before.personalStore);
    assert.equal(state.demoStore, ['directory-sync', 'success'].includes(fault) ? storeId : null);
    assert.deepEqual(state.pendingDemo, ['directory-sync', 'success'].includes(fault) ? null : before.pendingDemo);
    assert.equal(journal.lifecycle, ['failed-terminal', 'success'].includes(fault) ? 'quiescent' : 'active');
    assert.equal(journal.outcome, fault === 'failed-terminal' ? 'failed' : fault === 'success' ? 'ok' : 'pending');
    assert.equal(journal.operation, fault === 'failed-terminal' ? 'initialize' : 'publish-demo');
    const retained = await treeBytes(envelope), admitted = run([envelope, 'admit']);
    assert.equal(admitted.status, ['failed-terminal', 'success'].includes(fault) ? 0 : 1);
    assert.deepEqual(await treeBytes(envelope), retained, 'relaunch admission neither repairs nor replays retained state');
    // Failed preparation remains selected personal and can expose the existing
    // failure UI; durability errors refuse admission regardless of selector.
  }
});
