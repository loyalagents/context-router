import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';

// P1 native menu/pipe fixture. No personal installation, clipboard or browser changes.
const root = await mkdtemp(path.join(os.tmpdir(), 'context-router-appkit-p1-'));
await chmod(root, 0o700);
const guardian = path.join(root, 'guardian'), launcher = path.join(root, 'launcher');
const run = args => spawnSync('/usr/bin/clang', args, { encoding: 'utf8', timeout: 20_000 });
const compiled = process.platform === 'darwin' ? [
  run(['-Wall', '-Wextra', '-Werror', '-O2', path.join(import.meta.dirname, 'guardian-probe.c'), '-o', guardian]),
  run(['-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'AppKit', path.join(import.meta.dirname, 'appkit-probe.m'), '-o', launcher]),
] : [];
console.log(`P1 AppKit fixture root: ${root}`);
test('minimal native menu compiles and routes explicit restart/quit through owned guardian', { skip: process.platform !== 'darwin', timeout: 60_000 }, async () => {
  for (const result of compiled) assert.equal(result.status, 0, result.stderr);
  const state = path.join(root, 'state'); await mkdir(state, { mode: 0o700 });
  const child = spawn(launcher, [guardian, state, process.execPath, path.join(import.meta.dirname, 'process-fixture.mjs')],
    { env: { PATH: '/usr/bin:/bin', FIXTURE_LIFETIME_MS: '15000' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', diagnostic = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { diagnostic += data; });
  const ended = once(child, 'close');
  const timeout = setTimeout(() => child.kill('SIGTERM'), 20_000);
  try { assert.equal((await ended)[0], 0, diagnostic); }
  finally { clearTimeout(timeout); }
  const records = output.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(records.some(r => r.event === 'native-menu-ready'));
  assert.equal(records.filter(r => r.event === 'spawned').length, 2);
  assert.equal(records.filter(r => r.event === 'reaped' && r.owners === 2).length, 2);
  assert.ok(records.some(r => r.event === 'clean'));
  assert.ok(records.some(r => r.event === 'native-guardian-reaped'));
});
