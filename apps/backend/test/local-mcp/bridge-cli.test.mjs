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
