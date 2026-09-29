import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertLocalMcpSmokeSuccessResources } from './local-mcp-lifecycle.mjs';
import { localMcpLifecycleResources } from './fixtures/local-mcp-lifecycle.mjs';
import {
  validateApprovedPhaseCommands,
  buildPhaseEnvironment,
} from './gate-runner.mjs';
import http from 'node:http';
import { once } from 'node:events';
import * as smoke from './local-mcp-smoke.mjs';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  chmod,
  realpath,
  rm,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

test('administrative smoke policy denies TLS even to its configured port without opening a socket', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mcp-admin-policy-')),
  );
  await chmod(root, 0o700);
  try {
    const dist = path.join(root, 'dist');
    await mkdir(path.join(dist, 'infrastructure/storage/sqlite'), {
      recursive: true,
    });
    await writeFile(
      path.join(
        dist,
        'infrastructure/storage/sqlite/sqlite-coordination.worker.js',
      ),
      'throw new Error("Worker must not run");\n',
    );
    await writeFile(path.join(root, 'outside.cjs'), 'module.exports = true;\n');
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const assert = require('node:assert/strict');
      require('node:net').Socket.prototype.connect = function () {
        const error = new Error('No socket opened'); error.code = 'SOCKET_STUB'; throw error;
      };
      require(process.argv[1]);
      globalThis.__localMcpSmoke.controls().then(() => {
        assert.throws(() => require('node:tls').connect({ host: '127.0.0.1', port: Number(process.env.LOCAL_MODEL_PORT) }), { code: 'LOCAL_MCP_SMOKE_DENIED' });
      });
    `,
        path.resolve(
          'scripts/local-migration/fixtures/local-mcp-smoke/policy.cjs',
        ),
      ],
      {
        env: {
          LOCAL_DATABASE_RUNTIME_DIST: dist,
          LOCAL_MCP_SMOKE_ROOT: root,
          LOCAL_MCP_SMOKE_DEPENDENCIES: await realpath('node_modules'),
          LOCAL_MCP_SMOKE_PROVIDER: createRequire(
            path.resolve('apps/backend/package.json'),
          ).resolve('pg'),
          LOCAL_MCP_SMOKE_OPERATION: 'recovery',
          LOCAL_MODEL_PORT: '59001',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true });
  }
});

for (const failure of ['malformed', 'truncated', 'timeout'])
  test(`MCP smoke ${failure} response rejects and releases its owned socket`, async () => {
    const sockets = new Set();
    const server = http.createServer((_req, res) => {
      if (failure === 'malformed') res.end('not-json');
      if (failure === 'truncated') {
        res.writeHead(200, { 'content-length': '1000' });
        res.write('{');
        setTimeout(() => res.destroy(), 5);
      }
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      await assert.rejects(
        smoke.requestMcpSmoke(
          server.address().port,
          'synthetic',
          {},
          {},
          { timeoutMs: 30 },
        ),
        /Local MCP smoke failed/,
      );
      const end = Date.now() + 1000;
      while (sockets.size) {
        assert.ok(Date.now() < end, 'owned request socket must close');
        await new Promise((r) => setTimeout(r, 5));
      }
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((r) => server.close(r));
    }
  });

test('MCP success requires two qualified generations, exact network controls and complete owned cleanup', () => {
  const state = { resources: localMcpLifecycleResources('/owned') };
  assertLocalMcpSmokeSuccessResources(state, 'fixture');
  for (const mutate of [
    (s) => s.resources.pop(),
    (s) => s.resources.push(s.resources[0]),
    (s) => (s.resources[0].identity.identityStable = false),
    (s) => (s.resources[0].identity.persisted = false),
    (s) => (s.resources[0].identity.revocationDurable = false),
    (s) =>
      s.resources.find((r) => r.id === 'local-mcp-server-1').identity
        .controls--,
    (s) =>
      (s.resources.find(
        (r) => r.id === 'local-mcp-server-1',
      ).identity.listenersClosed = false),
    (s) =>
      (s.resources.find(
        (r) => r.id === 'local-mcp-server-2',
      ).identity.groupGone = false),
    (s) =>
      s.resources.find((r) => r.id === 'local-mcp-server-2').identity
        .sqliteThreads[0].controls--,
    (s) =>
      (s.resources.find((r) => r.id === 'local-mcp-peer-2').cleanup.status =
        'failed'),
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    assert.throws(() => assertLocalMcpSmokeSuccessResources(copy, 'fixture'));
  }
  assert.throws(() =>
    assertLocalMcpSmokeSuccessResources({ resources: [] }, 'fixture'),
  );
});

test('authoritative gate and standard CI retain the local MCP suite', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('./gate-phases.json', import.meta.url)),
  );
  assert.ok(manifest.supportedModes.some((m) => m.id === 'local-mcp'));
  const phase = manifest.phases.find((p) => p.id === 'backend-unit-build');
  assert.ok(phase.commands.some((c) => c.argv.includes('test:local-mcp')));
  phase.commands = phase.commands.filter(
    (c) => !c.argv.includes('test:local-mcp'),
  );
  assert.ok(validateApprovedPhaseCommands(manifest).length > 0);
  assert.match(
    await readFile(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    ),
    /run: pnpm test:local-mcp/,
  );
});

test('MCP success rejects omitted recovery ownership and incomplete backup/restore evidence', () => {
  const old = { resources: localMcpLifecycleResources('/owned') };
  old.resources = old.resources.filter((r) => r.id !== 'local-mcp-recovery');
  assert.throws(() => assertLocalMcpSmokeSuccessResources(old, 'fixture'));
  for (const field of [
    'v1Restored',
    'v2Restored',
    'identityPreserved',
    'authorityPreserved',
    'dataPreserved',
  ]) {
    const state = { resources: localMcpLifecycleResources('/owned') };
    const recovery = state.resources.find((r) => r.id === 'local-mcp-recovery');
    assert.ok(recovery, 'recovery must be independently owned and reaped');
    recovery.identity[field] = false;
    assert.throws(() => assertLocalMcpSmokeSuccessResources(state, 'fixture'));
  }
});
