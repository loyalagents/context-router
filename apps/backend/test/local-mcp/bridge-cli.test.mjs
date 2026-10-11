import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(
  new URL('../../scripts/mcp-bridge/cli.mjs', import.meta.url),
);
const token = `cr_mcp_${'a'.repeat(22)}.${'b'.repeat(43)}`;
test('CLI accepts only private file path; no endpoint/env override or token argument', () => {
  for (const args of [
    [],
    ['--token', token],
    ['--credential-file', '/private/missing'],
    ['--port', '1234'],
    [
      '--credential-file',
      '/private/missing',
      '--url',
      'http://example.invalid',
    ],
  ]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.includes(token), false);
    assert.equal(r.stderr.includes('/private/missing'), false);
  }
});
test('CLI handles EOF and termination without connecting or starting an app', async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cli-')),
  );
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'token');
  fs.writeFileSync(file, token, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const signal of [null, 'SIGINT', 'SIGTERM', 'SIGHUP']) {
    const child = spawn(process.execPath, [cli, '--credential-file', file], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b;
    });
    child.stderr.on('data', (b) => {
      stderr += b;
    });
    const done = new Promise((r) =>
      child.once('exit', (code, sig) => r({ code, sig })),
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }) + '\n',
    );
    const readyDeadline = Date.now() + 5000;
    while (!stdout.includes('\n')) {
      assert.ok(Date.now() < readyDeadline, 'bridge startup readiness');
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.match(stdout, /Initialize the connection/);
    stdout = '';
    if (signal) child.kill(signal);
    else child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    const result = await done;
    clearTimeout(timer);
    assert.deepEqual(result, { code: 0, sig: null });
    assert.equal(stdout, '');
    assert.equal(stderr, '');
  }
});
test('CLI refuses inherited debug settings before credential access or any HTTP request', (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cli-debug-')),
  );
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'token');
  fs.writeFileSync(file, token, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const observer = fileURLToPath(
    new URL('./fixtures/bridge-cli-observer.mjs', import.meta.url),
  );
  for (const unsafe of [
    { NODE_DEBUG: 'net' },
    { NODE_DEBUG: '*' },
    { NODE_DEBUG_NATIVE: 'NET' },
    { NODE_OPTIONS: '--trace-sync-io' },
  ]) {
    const r = spawnSync(
      process.execPath,
      ['--import', observer, cli, '--credential-file', file],
      {
        env: { ...unsafe, CR_TEST_CREDENTIAL_FILE: file },
        encoding: 'utf8',
        timeout: 5000,
        input:
          JSON.stringify({
            jsonrpc: '2.0',
            id: 0,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'synthetic', version: '1' },
            },
          }) + '\n',
      },
    );
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.includes(token), false, 'no credential bytes');
    assert.equal(
      r.stderr.includes('TEST_CREDENTIAL_READ'),
      false,
      'no credential access',
    );
    assert.equal(
      r.stderr.includes('TEST_HTTP_ATTEMPT'),
      false,
      'no outbound request',
    );
  }
});
