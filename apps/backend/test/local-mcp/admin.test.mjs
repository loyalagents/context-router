import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fixture as modelFixture } from '../local-model/fixtures/session-fixture.mjs';

const entry = path.resolve('dist/local-mcp.js');
function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'local-mcp-admin-')),
  );
  fs.chmodSync(root, 0o700);
  const env = {
    LOCAL_DATABASE_ROOT: path.join(root, 'data'),
    LOCAL_IDENTITY_STATE_ROOT: path.join(root, 'identity'),
  };
  const init = spawnSync(
    process.execPath,
    [path.resolve('dist/local-identity.js'), 'initialize'],
    { env, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(init.status, 0, init.stderr);
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  function cli(args, expected = 0, nodeArgs = []) {
    const result = spawnSync(process.execPath, [...nodeArgs, entry, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, expected, result.stderr);
    if (expected === 0) {
      assert.equal(result.stderr, '');
      return JSON.parse(result.stdout);
    }
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /^Local MCP (?:command failed|invalid command)\n$/,
    );
  }
  return { cleanups, root, env, cli };
}
test('compiled admin accepts issued client IDs beginning with one or two hyphens', (t) => {
  for (const id of ['-' + 'A'.repeat(21), '--' + 'A'.repeat(20)]) {
    const f = fixture(t);
    f.cli(['upgrade']);
    const preload = path.join(f.root, 'id-fixture.cjs');
    fs.writeFileSync(
      preload,
      `
      const crypto = require('node:crypto');
      const original = crypto.randomBytes;
      crypto.randomBytes = (size, ...args) => size === 16
        ? Buffer.from(${JSON.stringify(id)}, 'base64url')
        : original(size, ...args);
    `,
      { mode: 0o600 },
    );
    assert.equal(
      f.cli(
        [
          'provision',
          '--label',
          'synthetic',
          '--out',
          path.join(f.root, 'a.token'),
        ],
        0,
        ['--require', preload],
      ).result.id,
      id,
    );
    f.cli([
      'permissions',
      '--id',
      id,
      '--capabilities',
      'preferences:read',
      '--targets',
      'synthetic.*',
    ]);
    f.cli([
      'permissions',
      `--id=${id}`,
      '--capabilities',
      'preferences:read',
      '--targets',
      'synthetic.*',
    ]);
    f.cli([
      'grant',
      '--id',
      id,
      '--target',
      'synthetic.private',
      '--action',
      'READ',
      '--effect',
      'DENY',
    ]);
    assert.equal(
      f.cli(['rotate', '--id', id, '--out', path.join(f.root, 'b.token')])
        .result.generation,
      2,
    );
    assert.equal(f.cli(['revoke', '--id', id]).result.revoked, true);
    // Missing values and unrelated/unknown option syntax stay strict.
    f.cli(['revoke', '--id', '--allow-sensitive'], 2);
    f.cli(['revoke', '--id'], 2);
    f.cli(['revoke', '--id', '-bad'], 2);
    f.cli(['revoke', '--id', '--unknown'], 2);
    f.cli(['revoke', '--', '--id', id], 2);
    f.cli(['list', '--id', id], 2);
    f.cli(['revoke', '--id', id, '--unknown'], 2);
  }
});
test('compiled admin provides upgrade, private provisioning, permissions, grants, rotate/revoke and matching backup/restore', (t) => {
  const f = fixture(t);
  assert.equal(f.cli(['upgrade']).result, 'upgraded');
  const provisioned = f.cli([
    'provision',
    '--label',
    'codex',
    '--out',
    path.join(f.root, 'a.token'),
  ]).result;
  const id = provisioned.id;
  assert.equal(f.cli(['list']).result[0].id, id);
  f.cli([
    'permissions',
    '--id',
    id,
    '--capabilities',
    'preferences:write,preferences:define',
    '--targets',
    'synthetic.*',
  ]);
  f.cli([
    'grant',
    '--id',
    id,
    '--target',
    'synthetic.private',
    '--action',
    'READ',
    '--effect',
    'DENY',
  ]);
  assert.equal(
    f.cli(['rotate', '--id', id, '--out', path.join(f.root, 'b.token')]).result
      .generation,
    2,
  );
  f.cli(['backup', '--out', path.join(f.root, 'backup')]);
  f.cli(['revoke', '--id', id]);
  f.cli([
    'restore',
    '--from',
    path.join(f.root, 'backup'),
    '--out',
    path.join(f.root, 'restored'),
  ]);
  const restored = spawnSync(process.execPath, [entry, 'list'], {
    env: {
      LOCAL_DATABASE_ROOT: path.join(f.root, 'restored/data'),
      LOCAL_IDENTITY_STATE_ROOT: path.join(f.root, 'restored/identity'),
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).result[0].revoked, false);
  f.cli(['rotate', '--id', id, '--out', path.join(f.root, 'never.token')], 1);
  f.cli(['list', '--unknown', 'secret-canary'], 2);
});
test('compiled shared backend handles SIGINT/SIGTERM, port conflicts and durable restart without printing tokens', async (t) => {
  const f = fixture(t);
  f.cli(['upgrade']);
  const id = f.cli([
    'provision',
    '--label',
    'codex',
    '--out',
    path.join(f.root, 'a.token'),
  ]).result.id;
  const children = [];
  f.cleanups.push(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'close');
      }
  });
  async function start(port = 0) {
    const child = spawn(
      process.execPath,
      [entry, 'serve', '--port', String(port)],
      { cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(child);
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const done = once(child, 'close');
    const end = Date.now() + 10000;
    while (!stdout.includes('\n') && child.exitCode === null) {
      assert.ok(Date.now() < end);
      await new Promise((r) => setTimeout(r, 10));
    }
    return {
      child,
      done,
      record: stdout ? JSON.parse(stdout) : null,
      output: () => stdout + stderr,
    };
  }
  for (const [signal, code] of [
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ]) {
    const first = await start();
    assert.equal(first.record.type, 'context-router.local-mcp.ready');
    assert.ok(first.record.port > 0);
    const second = await start(first.record.port);
    assert.deepEqual(await second.done, [1, null]);
    assert.equal(second.record, null);
    first.child.kill(signal);
    assert.deepEqual(await first.done, [code, null]);
    assert.equal(first.output().includes('cr_mcp_'), false);
    assert.equal(f.cli(['list']).result[0].id, id);
  }
});

test(
  'actual CLI SIGTERM during admitted inference closes MCP and exits without stopping the manual model peer',
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      peer = await modelFixture(t);
    f.cli(['upgrade']);
    f.cli([
      'provision',
      '--label',
      'synthetic',
      '--out',
      path.join(f.root, 'a.token'),
    ]);
    const token = fs.readFileSync(path.join(f.root, 'a.token'), 'utf8').trim();
    const child = spawn(
      process.execPath,
      [entry, 'serve-model', '--port', '0'],
      {
        cwd: f.root,
        env: {
          ...f.env,
          LOCAL_MODEL_SESSION_ROOT: peer.config.root,
          LOCAL_MODEL_PORT: String(peer.config.port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const done = once(child, 'close');
    let output = '',
      errors = '';
    child.stdout.on('data', (b) => {
      output += b;
    });
    child.stderr.on('data', (b) => {
      errors += b;
    });
    f.cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
      await done;
    });
    const end = Date.now() + 10000;
    while (!output.includes('\n')) {
      assert.ok(
        child.exitCode === null && Date.now() < end,
        'CLI must become ready',
      );
      await new Promise((r) => setTimeout(r, 10));
    }
    const record = JSON.parse(output),
      url = `http://127.0.0.1:${record.port}/mcp`;
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const post = (body) =>
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    const init = await post({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'synthetic', version: '1' },
      },
    });
    headers['mcp-session-id'] = init.headers.get('mcp-session-id');
    headers['mcp-protocol-version'] = '2025-11-25';
    await init.text();
    const initialized = await post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    await initialized.text();
    let entered;
    const admitted = new Promise((r) => {
      entered = r;
    });
    peer.state.hook = (req) => {
      if (req.url === '/apply-template') {
        entered();
        return true;
      }
      return false;
    };
    const operation = post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'smartSearchPreferences',
        arguments: { query: 'Synthetic' },
      },
    });
    await admitted;
    child.kill('SIGTERM');
    const response = await operation;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.deepEqual(await done, [143, null]);
    assert.equal(errors, '');
    assert.equal(output.includes(token), false);
    assert.equal(peer.state.calls.includes('/completion'), false);
  },
);
