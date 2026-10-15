import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { backend } from '../../../examples/demo-10-2026/runtime.mjs';
import { seedDemo, readDemoGeneration } from '../../backend/scripts/demo/domain.mjs';
import { preparePair, prepareEvidence, seed } from './fixtures/real-demo-seed.mjs';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));

for (const fault of ['revoke-once', 'revoke-persistent', 'close-once', 'receipt-write', 'receipt-sync', 'receipt-directory-sync', 'after-receipt', 'after-receipt-abort']) {
  test(`real SQLite/MCP seed retains failure without success or replay: ${fault}`, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-seed-failure-')));
    const b = backend(), configuration = await preparePair(root), directory = await prepareEvidence(root);
    t.after(async () => { await b.waitForNativeOwners(); await fs.rm(root, { recursive: true, force: true }); });
    const controller = new AbortController();
    let fired = 0, revocations = 0, serviceCloses = 0, completed = 0;
    const realRevoke = b.SqliteMcpCredentials.prototype.revoke;
    if (fault.startsWith('revoke')) t.mock.method(b.SqliteMcpCredentials.prototype, 'revoke', function (...args) {
      revocations++;
      if (fault === 'revoke-persistent' || fired === 0) { fired++; throw new Error('owned injected revoke failure'); }
      return realRevoke.apply(this, args);
    });
    if (fault === 'close-once') {
      const module = require('./dist/bootstrap/local-mcp.js'), realCreate = module.createLocalMcpApplication;
      t.mock.method(module, 'createLocalMcpApplication', async (...args) => {
        const runtime = await realCreate(...args), realClose = runtime.close;
        runtime.close = async () => {
          serviceCloses++;
          if (fired === 0) { fired++; throw new Error('owned injected service close failure'); }
          return realClose();
        };
        return runtime;
      });
    }
    if (fault.startsWith('receipt-')) {
      const realOpen = fs.open;
      t.mock.method(fs, 'open', async (file, ...args) => {
        const handle = await realOpen(file, ...args);
        const receipt = file === path.join(directory, 'generation.json');
        const receiptDirectory = file === directory && fault === 'receipt-directory-sync' && completed === 189 && fired === 0;
        // Directory sync is armed only after the receipt itself has been written.
        if ((receipt && fault !== 'receipt-directory-sync') || (receiptDirectory && await fs.access(path.join(directory, 'generation.json')).then(() => true, () => false))) {
          const method = fault === 'receipt-write' ? 'writeFile' : 'sync', real = handle[method].bind(handle);
          handle[method] = async (...values) => { if (fired++ === 0) throw Object.assign(new Error('owned receipt I/O fault'), { code: 'EIO' }); return real(...values); };
        }
        return handle;
      });
    }
    const options = { configuration, directory, seed: await seed(), storeId: 'c'.repeat(32), installationId: 'a'.repeat(32) };
    await assert.rejects(seedDemo(options, {
      signal: controller.signal,
      onProgress: p => { completed = p.completed; },
      checkpoint: async point => { if (fault.startsWith('after-receipt') && point === 'after-receipt') { fired++; if (fault.endsWith('-abort')) controller.abort(); else throw new Error('owned failed terminal after receipt'); } },
    }), /never be replayed/);
    await b.waitForNativeOwners(); // No DB/receipt inspection until the exact seed owners have exited.
    assert.equal(completed, 189);
    assert.equal(fired, fault === 'revoke-persistent' ? 2 : 1, 'the intended fault must fire exactly');
    if (fault.startsWith('revoke')) assert.equal(revocations, 2, 'cleanup retries only the revocation, never the import');
    if (fault === 'close-once') assert.equal(serviceCloses, 2, 'finally settles the failed close');
    if (fault.startsWith('after-receipt')) {
      assert.equal((await readDemoGeneration(options)).status, 'complete');
      await assert.rejects(fs.access(path.join(directory, 'failed.json')));
    } else {
      const failed = JSON.parse(await fs.readFile(path.join(directory, 'failed.json')));
      assert.equal(failed.stage, fault.startsWith('revoke') ? 'revoke' : fault === 'close-once' ? 'close' : 'receipt');
      assert.equal(failed.importerRevoked, fault !== 'revoke-persistent');
      assert.equal(failed.partialStateRetained, true);
      if (!fault.startsWith('receipt-')) await assert.rejects(fs.access(path.join(directory, 'generation.json')));
      else if (fault === 'receipt-write') assert.equal((await fs.readFile(path.join(directory, 'generation.json'))).length, 0, 'failed write retains its empty exclusive file');
      else {
        const bytes = await fs.readFile(path.join(directory, 'generation.json'));
        assert.equal((await readDemoGeneration(options)).status, 'complete', 'receipt bytes alone do not prove successful durability/terminal outcome');
        assert.deepEqual(await fs.readFile(path.join(directory, 'generation.json')), bytes);
      }
    }
    const identity = b.createSqliteIdentityRuntime(configuration), ready = await identity.service.verifyReadyState();
    const clients = new b.SqliteMcpCredentials(identity.database, ready.state.principalId).list();
    const importer = clients.find(c => c.label === 'Demo historical sample importer');
    assert.ok(importer); assert.equal(importer.revoked, fault !== 'revoke-persistent');
    assert.equal(clients.length, fault.startsWith('revoke') ? 1 : 4);
    await b.waitForNativeOwners();
  });
}
