import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, chmod, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';

// Deterministic fixture only; never starts the real model.
const root = await mkdtemp(path.join(os.tmpdir(), 'context-router-native-owner-'));
await chmod(root, 0o700);
const binary = path.join(root, 'native-owner');
const compilation = process.platform === 'darwin' ? spawnSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2',
  path.join(import.meta.dirname, 'native-owner-probe.c'), '-o', binary], { encoding: 'utf8', timeout: 20_000 }) : undefined;
console.log(`P1 native-owner fixture root: ${root}`);
const options = { skip: process.platform !== 'darwin', timeout: 30_000 };
test('bounded native-owner fixture builds', options, () => assert.equal(compilation.status, 0, compilation.stderr));

test('release proves child descriptor retention; EOF reaps exact owner within fixture bounds', options, async () => {
  assert.equal(compilation.status, 0);
  const owned = path.join(root, 'owned');
  await mkdir(owned, { mode: 0o700 });
  const fixture = path.join(root, 'fixture.cjs');
  await writeFile(fixture, "require('node:fs').fstatSync(3); console.log('descriptor-ready');process.on('SIGTERM',()=>process.exit(0));setTimeout(()=>process.exit(0),15000);", { mode: 0o600 });
  const child = spawn(binary, ['own', owned, '20', process.execPath, fixture], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
  const ended = once(child, 'close');
  let output = '';
  child.stdout.on('data', data => { output += data; });
  const wait = async text => {
    const end = Date.now() + 5000;
    while (!output.includes(text)) { assert.ok(Date.now() < end, output); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    await wait('owned-start');
    const fixtureDeadline = Date.now() + 5000;
    while (!(await readFile(path.join(owned, 'native.log'), 'utf8')).includes('descriptor-ready')) {
      assert.ok(Date.now() < fixtureDeadline, 'fixture failed to retain descriptor through Node exec');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    child.stdin.write('release-lock\n');
    await wait('lock-released');
    const busy = spawnSync(binary, ['check', owned], { timeout: 1000 });
    assert.equal(busy.status, 2);
    child.stdin.end();
    assert.equal((await ended)[0], 0);
    assert.match(output, /reaped/);
    assert.equal(spawnSync(binary, ['check', owned], { timeout: 1000 }).status, 0);
    assert.equal(await readFile(path.join(owned, 'native.log'), 'utf8'), 'descriptor-ready\n');
  } finally { if (child.exitCode === null && child.signalCode === null) { child.stdin.end(); await ended; } }
});
