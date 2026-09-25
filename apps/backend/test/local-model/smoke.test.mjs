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
