import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalUiSmokeSuccessResources } from './local-ui-lifecycle.mjs';
import { localUiLifecycleResources } from './fixtures/local-ui-lifecycle.mjs';
import { localUiBrowserPrerequisite } from './local-ui-browser.mjs';
import {
  createGatedNodeChild,
  activateJournaledNodeChild,
  terminateAndReapJournaledNodeChild,
} from './local-identity-smoke.mjs';

test(
  'browser startup failures emit only fixed diagnostics and reap their owned process group',
  { timeout: 30000 },
  async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const root = await mkdtemp(path.join(tmpdir(), 'ui-browser-failure-'));
    const canary = 'synthetic-browser-stderr-private-canary';
    try {
      for (const [reason, source] of [
        [
          'socket-path',
          `process.stderr.write('${canary}'.repeat(1000)); process.stderr.write('Socket path too'); setTimeout(() => { process.stderr.write(' long: ${canary}'); process.exitCode = 23; }, 20);`,
        ],
        ['exit', `process.stderr.write('${canary}'); process.exitCode = 23;`],
        ['signal', `process.kill(process.pid, 'SIGTERM');`],
        ['spawn', null],
        ['deadline', `setInterval(() => {}, 1000);`],
      ]) {
        const profile = path.join(root, reason);
        await mkdir(profile, { mode: 0o700 });
        const executable = path.join(profile, 'browser');
        if (source !== null)
          await writeFile(executable, `#!${process.execPath}\n${source}\n`, {
            mode: 0o700,
          });
        const handle = createGatedNodeChild({
          entrypoint: path.join(
            import.meta.dirname,
            'fixtures/local-ui-smoke/browser.cjs',
          ),
          operation: 'browser',
          cwd: root,
          env: {
            PATH: process.env.PATH,
            HOME: root,
            TMPDIR: root,
            LOCAL_UI_BROWSER_PROFILE: profile,
            LOCAL_UI_BROWSER_EXECUTABLE: executable,
          },
        });
        try {
          await activateJournaledNodeChild({
            handle,
            journal: { acquired: async () => {} },
            resourceId: 'browser',
            identity: {},
          });
          const result = await handle.result;
          assert.equal(result.code, 70);
          assert.deepEqual(handle.output(), {
            stdout: '',
            stderr: `local-ui-browser-startup:${reason}\n`,
            overflow: false,
          });
        } finally {
          assert.deepEqual(
            await terminateAndReapJournaledNodeChild(handle, 'browser fixture'),
            [],
          );
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('UI lifecycle requires Chromium authentication and semantic proofs in both owned generations', () => {
  const state = { resources: localUiLifecycleResources('/owned') };
  assertLocalUiSmokeSuccessResources(state, 'fixture');
  for (const mutate of [
    (s) => s.resources.pop(),
    (s) => s.resources.push(s.resources[0]),
    ...[
      'authenticated',
      'authoritySeparated',
      'sharedState',
      'smartSearch',
      'rawProtocolsClosed',
      'pageRequestsConfined',
      'nonceCsp',
      'groupGone',
    ].map((key) => (s) => {
      s.resources.find((r) => r.id === 'local-ui-browser-1').identity[key] =
        false;
    }),
    (s) => {
      s.resources.find(
        (r) => r.id === 'local-ui-browser-2',
      ).identity.restartSessionRejected = false;
    },
    (s) => {
      s.resources.find(
        (r) => r.id === 'local-ui-browser-1',
      ).identity.historyClear = false;
    },
    (s) => {
      s.resources
        .find((r) => r.id === 'local-ui-server-1')
        .identity.listeners.pop();
    },
    (s) => {
      s.resources.find(
        (r) => r.id === 'local-ui-server-1',
      ).identity.listeners[1].closed = false;
    },
    (s) => {
      s.resources.find((r) => r.id === 'local-ui-browser-1').cleanup.status =
        'failed';
    },
    (s) => {
      s.resources.find((r) => r.id === 'local-ui-browser-1').identity.version =
        'system';
    },
    (s) => {
      s.resources.find((r) => r.id === 'local-ui-browser-1').recovery
        .processGroupId++;
    },
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    assert.throws(() => assertLocalUiSmokeSuccessResources(copy, 'fixture'));
  }
});

test('missing Chromium fails as an explicit prerequisite, without installation fallback', () => {
  assert.throws(
    () =>
      localUiBrowserPrerequisite(process.cwd(), {
        LOCAL_UI_BROWSER_EXECUTABLE: '/missing/pinned-chromium',
      }),
    /Pinned Chromium prerequisite missing/,
  );
  assert.throws(
    () =>
      localUiBrowserPrerequisite(process.cwd(), {
        LOCAL_UI_BROWSER_EXECUTABLE: 'relative',
      }),
    /must be absolute/,
  );
});

test('unreaped browser cleanup retains its private root even when other smoke owners have exited', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { removeMcpSmokeStateAfterCleanup } = await import(
    './local-mcp-smoke.mjs'
  );
  const root = await mkdtemp(path.join(tmpdir(), 'ui-cleanup-retention-'));
  const cleanup = [];
  try {
    await writeFile(path.join(root, 'profile'), 'owned browser profile');
    await removeMcpSmokeStateAfterCleanup({
      root,
      created: true,
      cleanup,
      cleanupExtension: async () => {
        throw new Error('browser group still live');
      },
    });
    assert.equal(cleanup.length, 1);
    assert.equal(
      await readFile(path.join(root, 'profile'), 'utf8'),
      'owned browser profile',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('both enclosing smoke cleanups preserve recovery state until every local UI owner settles', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import(
    'node:fs/promises'
  );
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createPackagingPrivateRoot, removePackagingPrivateRootAfterCleanup } =
    await import('./packaging-smoke.mjs');
  const { removeRestartSmokeSecretsAfterCleanup } = await import(
    './restart-smoke.mjs'
  );
  const parent = await mkdtemp(path.join(tmpdir(), 'ui-parent-retention-'));
  try {
    for (const kind of ['packaging', 'restart']) {
      const ownership =
        kind === 'packaging'
          ? await createPackagingPrivateRoot(
              path.join(parent, 'packaging-'),
              () => {},
            )
          : null;
      const root = ownership?.directory ?? path.join(parent, 'restart');
      await mkdir(path.join(root, 'local-ui/browser-profile'), {
        recursive: true,
      });
      const profile = path.join(root, 'local-ui/browser-profile/recovery');
      await writeFile(profile, 'retained private state');
      const remove = (state) =>
        kind === 'packaging'
          ? removePackagingPrivateRootAfterCleanup(ownership, state)
          : removeRestartSmokeSecretsAfterCleanup(root, state);
      for (const cleanup of [
        undefined,
        { status: 'pending' },
        { status: 'failed' },
      ]) {
        await assert.rejects(
          remove({
            resources: [
              {
                id: 'local-ui-browser-1',
                type: 'local-ui-browser-process',
                owned: true,
                cleanup,
              },
            ],
          }),
          /retain/i,
        );
        assert.equal(await readFile(profile, 'utf8'), 'retained private state');
      }
      await assert.rejects(
        remove({
          resources: [
            {
              id: 'local-ui-state',
              type: 'local-ui-private-state',
              owned: true,
              cleanup: { status: 'failed' },
            },
          ],
        }),
        /retain/i,
      );
      assert.equal(await readFile(profile, 'utf8'), 'retained private state');
      await remove({
        resources: [
          {
            id: 'local-ui-browser-1',
            type: 'local-ui-browser-process',
            owned: true,
            cleanup: { status: 'exited' },
          },
        ],
      });
      await assert.rejects(readFile(profile), { code: 'ENOENT' });
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
