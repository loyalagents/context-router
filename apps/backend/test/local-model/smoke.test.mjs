import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalModelSmoke } from '../../../../scripts/local-migration/local-model-smoke.mjs';
import { assertLocalModelSmokeSuccessResources } from '../../../../scripts/local-migration/local-model-lifecycle.mjs';
test('actual source model smoke runs two independent sessions and reaps every owned application/parser', { timeout: 60000 }, async () => {
  const { mkdtemp, rm, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { createResourceLifecycleJournal } = await import('../../../../scripts/local-migration/gate-runner.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-model-smoke-test-')));
  const journal = await createResourceLifecycleJournal(root);
  try {
    const result = await runLocalModelSmoke({ entrypoint: new URL('../../dist/local-identity.js', import.meta.url).pathname, cwd: root,
      home: join(root, 'home'), temporaryDirectory: join(root, 'tmp'), stateParent: root, journal });
    assert.equal(result.generations, 2); assert.equal(result.parserChildren, 4);
    for (const probe of journal.state.resources.filter((r) => r.type === 'local-model-probe-process')) {
      assert.ok(probe.identity.sqliteThreads.length > 0);
      for (const thread of probe.identity.sqliteThreads) assert.deepEqual(thread, { threadId: thread.threadId, controls: 46, code: 0, exited: true });
    }
    assertLocalModelSmokeSuccessResources(journal.state, 'fixture');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('journal failure during failed-child cleanup still closes the owned listener and cannot report success', { timeout: 60000 }, async () => {
  const { mkdtemp, rm, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { once } = await import('node:events');
  const net = await import('node:net');
  const { createResourceLifecycleJournal, hasLiveProcessGroupMembers } = await import('../../../../scripts/local-migration/gate-runner.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-model-smoke-fault-')));
  const journal = await createResourceLifecycleJournal(root); let failed = false;
  const faulty = { ...journal,
    async acquired(id, value) { await journal.acquired(id, value); if (id === 'local-model-probe-1' && !failed) { failed = true; throw new Error('Injected acquisition journal failure'); } },
    async cleanupFinished(id, value) { await journal.cleanupFinished(id, value); if (id === 'local-model-probe-1') throw new Error('Injected cleanup journal failure'); },
  };
  try {
    await assert.rejects(runLocalModelSmoke({ entrypoint: new URL('../../dist/local-identity.js', import.meta.url).pathname,
      cwd: root, home: join(root, 'home'), temporaryDirectory: join(root, 'tmp'), stateParent: root, journal: faulty }));
    assert.equal(failed, true);
    const server = journal.state.resources.find((r) => r.id === 'local-model-fixture-1');
    assert.equal(server.cleanup.status, 'closed');
    const socket = net.connect({ host: '127.0.0.1', port: server.identity.port });
    try { assert.equal((await once(socket, 'error'))[0].code, 'ECONNREFUSED'); } finally { socket.destroy(); }
    assert.equal(journal.state.resources.find((r) => r.id === 'local-model-state').cleanup.status, 'failed');
    assert.throws(() => assertLocalModelSmokeSuccessResources(journal.state, 'incomplete'));
  } finally {
    for (const item of journal.state.resources.filter((r) => r.type.endsWith('-process') && r.identity?.pid)) {
      assert.equal(await hasLiveProcessGroupMembers(item.identity.pid), false);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('missing-worker negative closure is removable when its installed source is sealed and stays unchanged', async () => {
  const fs = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { createRequire } = await import('node:module'); const { createHash } = await import('node:crypto');
  const { copyParserWithoutWorker } = createRequire(import.meta.url)('../../../../scripts/local-migration/fixtures/local-model-smoke/probe.cjs');
  const root = await fs.mkdtemp(join(tmpdir(), 'model-sealed-negative-')); const source = join(root, 'source'), target = join(root, 'missing');
  const modes = async (directory, mode) => {
    await fs.chmod(directory, mode);
    for (const name of await fs.readdir(directory)) { const file = join(directory, name); if ((await fs.lstat(file)).isDirectory()) await modes(file, mode); }
  };
  try {
    await fs.cp(new URL('../../dist/infrastructure/local-model/engine', import.meta.url), source, { recursive: true });
    const file = join(source, 'pdfjs/pdf.mjs');
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const before = digest(await fs.readFile(file)); await modes(source, 0o555);
    await copyParserWithoutWorker(source, target);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(join(target, 'pdfjs'))).mode & 0o777, 0o700);
    await assert.rejects(fs.access(join(target, 'pdfjs/pdf.worker.mjs')));
    assert.equal(digest(await fs.readFile(file)), before);
    assert.equal((await fs.stat(source)).mode & 0o777, 0o555);
    await fs.rm(target, { recursive: true });
  } finally { await modes(source, 0o700); await fs.rm(root, { recursive: true, force: true }); }
});

test('thread evidence rejects a zero exit before controls, failed controls, termination and incomplete exit', async () => {
  const { createRequire } = await import('node:module');
  const { threadResult } = createRequire(import.meta.url)('../../../../scripts/local-migration/fixtures/local-model-smoke/thread-evidence.cjs');
  const cell = new Int32Array(new SharedArrayBuffer(4));
  assert.throws(() => threadResult(1, 0, cell));
  Atomics.store(cell, 0, 41); assert.throws(() => threadResult(1, 0, cell));
  Atomics.store(cell, 0, 46);
  for (const code of [1, null, undefined]) assert.throws(() => threadResult(1, code, cell));
  assert.deepEqual(threadResult(1, 0, cell), { threadId: 1, controls: 46, code: 0, exited: true });
});
