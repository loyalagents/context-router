import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { combineFailures, hasLiveProcessGroupMembers } from './gate-runner.mjs';
import {
  createGatedNodeChild,
  activateJournaledNodeChild,
  terminateAndReapJournaledNodeChild,
  countListeningSockets,
  buildListenerInspectionEnvironment,
} from './local-identity-smoke.mjs';
import {
  buildLocalDatabaseSmokeEnvironment,
  assertLocalDatabaseChildResult,
} from './local-database-smoke.mjs';
import {
  createSmokeModelCredentials,
  createSmokeModelPeer,
} from './local-model-smoke.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url)),
  fixture = path.join(directory, 'fixtures/local-mcp-smoke');
export const MCP_ROOT_RECOVERY =
  'Reap recorded MCP process groups and close owned fixture listeners before removing only this private root.';
const fail = () => new Error('Local MCP smoke failed');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function bounded(promise, ms = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function decodeMcpSmokeProbe(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw fail();
  }
  if (
    Object.keys(p).sort().join() !==
      'connections,controls,listeners,policyFailed,sqliteThreads,type' ||
    p.type !== 'local-mcp-smoke' ||
    p.policyFailed !== false ||
    p.controls !== 42 ||
    !Number.isSafeInteger(p.connections) ||
    p.connections < 1 ||
    p.connections > 64 ||
    !Array.isArray(p.listeners) ||
    p.listeners.length !== 1 ||
    Object.keys(p.listeners[0]).sort().join() !== 'closed,port' ||
    p.listeners[0].closed !== true ||
    !Number.isSafeInteger(p.listeners[0].port) ||
    p.listeners[0].port < 1 ||
    p.listeners[0].port > 65535 ||
    !Array.isArray(p.sqliteThreads) ||
    !p.sqliteThreads.length ||
    p.sqliteThreads.length > 8 ||
    p.sqliteThreads.some(
      (r) =>
        Object.keys(r).sort().join() !== 'code,controls,exited,threadId' ||
        r.controls !== 42 ||
        r.exited !== true ||
        r.code !== 0 ||
        !Number.isSafeInteger(r.threadId) ||
        r.threadId < 1,
    ) ||
    new Set(p.sqliteThreads.map((r) => r.threadId)).size !==
      p.sqliteThreads.length
  )
    throw fail();
  return p;
}
export async function requestMcpSmoke(
  port,
  token,
  body,
  extra = {},
  { timeoutMs = 10000 } = {},
) {
  return new Promise((resolve, reject) => {
    let response,
      settled = false,
      timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response?.destroy();
      req.destroy();
      if (error) reject(fail());
      else resolve(result);
    };
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...extra,
        },
      },
      (res) => {
        response = res;
        let text = '';
        res.on('data', (b) => {
          text += b;
          if (text.length > 256 * 1024) finish(true);
        });
        res.once('error', () => finish(true));
        res.once('aborted', () => finish(true));
        res.once('end', () => {
          try {
            finish(false, {
              status: res.statusCode,
              headers: res.headers,
              value: text ? JSON.parse(text) : null,
            });
          } catch {
            finish(true);
          }
        });
      },
    );
    req.once('error', () => finish(true));
    timer = setTimeout(() => finish(true), timeoutMs);
    try {
      req.end(JSON.stringify(body));
    } catch {
      finish(true);
    }
  });
}
const request = requestMcpSmoke;
async function client(port, token) {
  const initialized = await request(port, token, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'same-product', version: '1' },
    },
  });
  assert.equal(initialized.status, 200);
  const headers = {
    'mcp-session-id': initialized.headers['mcp-session-id'],
    'mcp-protocol-version': '2025-11-25',
  };
  assert.equal(
    (
      await request(
        port,
        token,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        headers,
      )
    ).status,
    202,
  );
  let id = 1;
  return async (name, args = {}) => {
    const response = await request(
      port,
      token,
      {
        jsonrpc: '2.0',
        id: id++,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      headers,
    );
    assert.equal(response.status, 200);
    return response.value.result;
  };
}
export async function runLocalMcpSmoke({
  entrypoint,
  cwd,
  home,
  temporaryDirectory,
  stateParent,
  journal,
  environment = process.env,
  signal,
  verifyArtifact = async () => {},
}) {
  const root = path.join(
      await realpath(stateParent),
      `local-mcp-${randomUUID()}`,
    ),
    dist = await realpath(path.dirname(entrypoint));
  const sourceBackend = await realpath(
    path.join(directory, '../../apps/backend'),
  );
  const dependencies =
    path.dirname(dist) === sourceBackend
      ? await realpath(path.join(directory, '../../node_modules'))
      : await realpath(path.join(dist, '../node_modules'));
  const env = {
    ...buildLocalDatabaseSmokeEnvironment(environment, {
      home,
      temporaryDirectory,
      databaseRoot: path.join(root, 'data'),
      stateRoot: path.join(root, 'identity'),
      runtimeDist: dist,
    }),
    LOCAL_MCP_SMOKE_ROOT: root,
    LOCAL_MCP_SMOKE_DEPENDENCIES: dependencies,
    LOCAL_MODEL_PORT: '1',
    LOCAL_MCP_SMOKE_PROVIDER: createRequire(path.join(dist, 'main.js')).resolve(
      'pg',
    ),
  };
  const children = [],
    peers = [];
  let primary,
    created = false;
  const cleanup = [];
  async function start(id, operation, extra = {}) {
    await journal.acquiring({
      id,
      type:
        operation === 'serve-model'
          ? 'local-mcp-server-process'
          : 'local-mcp-admin-process',
      owned: true,
      identity: { operation },
      recovery: 'Reap only the recorded owned process group.',
    });
    const handle = createGatedNodeChild({
      entrypoint: path.join(fixture, 'entry.cjs'),
      operation,
      cwd,
      env: { ...env, ...extra, LOCAL_MCP_SMOKE_OPERATION: operation },
      signal,
      preload: path.join(fixture, 'policy.cjs'),
    });
    const owned = { id, handle, reaped: false };
    children.push(owned);
    await activateJournaledNodeChild({
      handle,
      journal,
      resourceId: id,
      identity: { operation },
    });
    return owned;
  }
  async function finish(owned, code, extra = {}) {
    const result = await bounded(owned.handle.result);
    try {
      assertLocalDatabaseChildResult(result, code);
    } catch {
      // Fixed primitive evidence only; never dump unexpected application output.
      let probe;
      try {
        probe = JSON.parse(result.stdout.trim().split('\n').at(-1));
      } catch {
        /* no probe */
      }
      const summary =
        probe?.type === 'local-mcp-smoke'
          ? {
              policyFailed: probe.policyFailed === true,
              controls: Number.isSafeInteger(probe.controls)
                ? probe.controls
                : null,
              connections: Number.isSafeInteger(probe.connections)
                ? probe.connections
                : null,
              listeners: Array.isArray(probe.listeners)
                ? probe.listeners.map((r) => ({ closed: r.closed === true }))
                : null,
              threads: Array.isArray(probe.sqliteThreads)
                ? probe.sqliteThreads.map((r) => ({
                    exited: r.exited === true,
                    code: Number.isSafeInteger(r.code) ? r.code : null,
                    controls: Number.isSafeInteger(r.controls)
                      ? r.controls
                      : null,
                  }))
                : null,
            }
          : null;
      throw new Error(
        `Local MCP child result failed: code=${result.code}, signalled=${result.signal !== null}, stderr=${result.stderr !== ''}, overflow=${result.overflow}, probe=${JSON.stringify(summary)}`,
      );
    }
    await bounded(
      (async () => {
        while (await hasLiveProcessGroupMembers(owned.handle.child.pid))
          await delay(10);
      })(),
      5000,
    );
    owned.reaped = true;
    await journal.acquired(owned.id, {
      identity: {
        exitCode: code,
        childSignal: null,
        groupGone: true,
        ...extra,
      },
    });
    await journal.cleanupFinished(owned.id, { status: 'exited' });
    await verifyArtifact();
    return result;
  }
  try {
    await journal.acquiring({
      id: 'local-mcp-state',
      type: 'local-mcp-private-state',
      owned: true,
      identity: { root },
      recovery: { root, instruction: MCP_ROOT_RECOVERY },
    });
    await mkdir(root, { mode: 0o700 });
    created = true;
    await mkdir(home, { mode: 0o700 });
    await mkdir(temporaryDirectory, { mode: 0o700 });
    await writeFile(
      path.join(root, 'outside.cjs'),
      'module.exports = true;\n',
      { mode: 0o600, flag: 'wx' },
    );
    await journal.acquired('local-mcp-state', { identity: { root } });
    await finish(await start('local-mcp-initialize', 'initialize'), 0);
    await finish(await start('local-mcp-setup', 'setup'), 0);
    const identity = await readFile(path.join(root, 'identity/identity.json'));
    journal.addCanary(JSON.parse(identity).credential);
    const tokens = await Promise.all(
      ['a', 'b'].map(async (name) =>
        (await readFile(path.join(root, `${name}.token`), 'utf8')).trim(),
      ),
    );
    for (const token of tokens) journal.addCanary(token);
    const template = await readFile(
      path.join(
        directory,
        '../../apps/backend/test/local-model/fixtures/qwen35-template.txt',
      ),
      'utf8',
    );
    assert.equal(
      digest(template),
      '7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67',
    );
    for (const generation of [1, 2]) {
      const id = `local-mcp-peer-${generation}`,
        modelRoot = path.join(root, `session-${generation}`);
      await journal.acquiring({
        id,
        type: 'local-mcp-fixture-server',
        owned: true,
        identity: { generation },
        recovery: 'Close only this recorded owned fixture listener.',
      });
      const material = await createSmokeModelCredentials(modelRoot);
      journal.addCanary(material.apiKey);
      const peer = await createSmokeModelPeer(
        material,
        template,
        JSON.stringify({
          relevantSlugs: ['synthetic.shared'],
          queryInterpretation: 'Synthetic',
        }),
      );
      const ownedPeer = { id, peer, closed: false };
      peers.push(ownedPeer);
      await journal.acquired(id, {
        identity: {
          pid: process.pid,
          port: peer.port,
          generation,
          certificateSha256: digest(material.cert),
        },
      });
      const server = await start(
        `local-mcp-server-${generation}`,
        'serve-model',
        {
          LOCAL_MODEL_SESSION_ROOT: modelRoot,
          LOCAL_MODEL_PORT: String(peer.port),
        },
      );
      let readiness;
      await bounded(
        (async () => {
          for (;;) {
            const output = server.handle.output();
            if (
              output.stderr ||
              output.overflow ||
              server.handle.child.exitCode !== null ||
              server.handle.child.signalCode !== null
            )
              throw fail();
            if (output.stdout.endsWith('\n')) {
              readiness = JSON.parse(output.stdout);
              break;
            }
            await delay(10);
          }
        })(),
      );
      assert.deepEqual(Object.keys(readiness).sort(), [
        'host',
        'modelConfigured',
        'port',
        'type',
        'version',
      ]);
      assert.equal(readiness.type, 'context-router.local-mcp.ready');
      assert.equal(readiness.version, 1);
      assert.equal(readiness.host, '127.0.0.1');
      assert.equal(readiness.modelConfigured, true);
      assert.equal(
        await countListeningSockets(server.handle.child.pid, {
          cwd,
          env: buildListenerInspectionEnvironment(environment),
          signal,
        }),
        1,
      );
      const port = readiness.port,
        b = await client(port, tokens[1]);
      if (generation === 1) {
        const a = await client(port, tokens[0]);
        for (const [operation, payload] of [
          [
            'CREATE_DEFINITION',
            {
              definition: {
                slug: 'synthetic.shared',
                description: 'Synthetic',
                scope: 'GLOBAL',
                valueType: 'STRING',
              },
            },
          ],
          [
            'SET_PREFERENCE',
            { preference: { slug: 'synthetic.shared', value: '"persisted"' } },
          ],
        ])
          assert.equal(
            (await a('mutatePreferences', { operation, ...payload })).isError,
            false,
          );
        assert.equal(
          (
            await b('mutatePreferences', {
              operation: 'SET_PREFERENCE',
              preference: { slug: 'synthetic.shared', value: '"denied"' },
            })
          ).isError,
          true,
        );
        await finish(await start('local-mcp-revoke', 'revoke'), 0);
      }
      assert.equal(
        (
          await request(port, tokens[0], {
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/list',
          })
        ).status,
        401,
      );
      const data = (await b('searchPreferences')).structuredContent;
      assert.equal(data.active.preferences[0].value, 'persisted');
      assert.equal(
        (await b('smartSearchPreferences', { query: 'Synthetic' }))
          .structuredContent.matchedActivePreferences[0].value,
        'persisted',
      );
      assert.equal(peer.counters.completions, 1);
      process.kill(
        -server.handle.child.pid,
        generation === 1 ? 'SIGTERM' : 'SIGINT',
      );
      const result = await finish(server, generation === 1 ? 143 : 130);
      const lines = result.stdout.trim().split('\n');
      assert.equal(lines.length, 2);
      const probe = decodeMcpSmokeProbe(lines[1]);
      assert.equal(probe.listeners[0].port, port);
      await journal.acquired(server.id, {
        identity: {
          port,
          controls: probe.controls,
          connections: probe.connections,
          listenersClosed: true,
          sqliteThreads: probe.sqliteThreads,
        },
      });
      await bounded(peer.close(), 5000);
      ownedPeer.closed = true;
      await journal.acquired(id, {
        identity: { completions: 1, closed: true },
      });
      await journal.cleanupFinished(id, { status: 'closed' });
      assert.deepEqual(
        await readFile(path.join(root, 'identity/identity.json')),
        identity,
      );
    }
    const recovery = JSON.parse(
      (await finish(await start('local-mcp-recovery', 'recovery'), 0)).stdout
        .trim()
        .split('\n')
        .at(-1),
    );
    assert.deepEqual(Object.keys(recovery).sort(), [
      'authorityPreserved',
      'controls',
      'dataPreserved',
      'identityPreserved',
      'policyFailed',
      'sqliteThreads',
      'type',
      'v1Restored',
      'v2Restored',
    ]);
    assert.equal(recovery.type, 'local-mcp-recovery');
    assert.equal(recovery.policyFailed, false);
    const recoveryEvidence = { ...recovery };
    delete recoveryEvidence.type;
    delete recoveryEvidence.policyFailed;
    await journal.acquired('local-mcp-recovery', {
      identity: recoveryEvidence,
    });
    await journal.acquired('local-mcp-state', {
      identity: {
        generations: 2,
        identityStable: true,
        persisted: true,
        revocationDurable: true,
      },
    });
  } catch (error) {
    primary = error;
  }
  for (const owned of children)
    if (!owned.reaped) {
      const errors = await terminateAndReapJournaledNodeChild(
        owned.handle,
        owned.id,
      );
      cleanup.push(...errors);
      if (!errors.length)
        try {
          await journal.cleanupFinished(owned.id, { status: 'exited' });
        } catch (e) {
          cleanup.push(e);
        }
    }
  for (const owned of peers)
    if (!owned.closed)
      try {
        await bounded(owned.peer.close(), 5000);
        await journal.cleanupFinished(owned.id, { status: 'closed' });
      } catch (e) {
        cleanup.push(e);
      }
  if (created && !cleanup.length)
    try {
      await rm(root, { recursive: true });
    } catch (e) {
      cleanup.push(e);
    }
  try {
    await journal.cleanupFinished('local-mcp-state', {
      status: cleanup.length ? 'failed' : 'removed',
      error: cleanup.length ? fail() : undefined,
    });
  } catch (e) {
    cleanup.push(e);
  }
  const combined = combineFailures(primary, cleanup, 'local MCP smoke');
  if (combined) throw combined;
  return {
    generations: 2,
    identityStable: true,
    persisted: true,
    revocationDurable: true,
  };
}
