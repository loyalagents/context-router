import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-native-')));
  t.after(() => fs.rm(top, { recursive: true, force: true }));
  const native = path.resolve(import.meta.dirname, '../../native'), exe = path.join(top, 'envelope');
  const result = spawnSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security', '-I', native,
    path.resolve(import.meta.dirname, '../fixtures/demo-envelope.m'), path.join(native, 'envelope.m'), path.join(native, 'package.m'), '-o', exe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const root = path.join(top, 'managed-v1');
  const run = command => spawnSync(exe, [command, root], { env: {}, encoding: 'utf8' });
  const first = run('fresh'); assert.equal(first.status, 0, first.stderr);
  return { top, root, run, first: JSON.parse(first.stdout) };
}
test('native fresh metadata has fixed personal/demo slots and matching security floor', async t => {
  const f = await fixture(t);
  assert.equal(f.first.version, 2); assert.equal(f.first.minimumEpoch, 2);
  assert.equal(f.first.mode, 'personal'); assert.equal(f.first.personalStore, f.first.selectedStore);
  assert.equal(f.first.demoStore, null); assert.equal(f.first.pendingDemo, null);
  assert.equal((await fs.stat(path.join(f.root, 'demo'))).mode & 0o777, 0o700);
});
test('quiescent v1 management upgrade preserves the selected personal pair byte for byte', async t => {
  const f = await fixture(t), file = path.join(f.root, 'installation.json');
  const old = { version: 1, minimumEpoch: 1, installationId: f.first.installationId,
    selectedStore: f.first.selectedStore, setup: 'ready', pendingRestore: null };
  await fs.writeFile(file, JSON.stringify(old));
  const journalFile = path.join(f.root, 'owner.json'), journal = JSON.parse(await fs.readFile(journalFile));
  delete journal.mode; journal.version = 1; await fs.writeFile(journalFile, JSON.stringify(journal));
  await fs.rm(path.join(f.root, 'demo'), { recursive: true, force: true });
  const sentinel = path.join(f.root, 'stores', old.selectedStore, 'sentinel'); await fs.writeFile(sentinel, 'personal bytes');
  const result = f.run('inspect'); assert.equal(result.status, 0);
  const upgraded = JSON.parse(result.stdout);
  assert.equal(upgraded.version, 2); assert.equal(upgraded.personalStore, old.selectedStore);
  assert.equal(upgraded.installationId, old.installationId); assert.equal(upgraded.selectedStore, old.selectedStore);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'personal bytes');
  assert.equal(await fs.readFile(journalFile, 'utf8'), JSON.stringify(journal));
});
test('native metadata rejects contradictory demo selection without touching it', async t => {
  const f = await fixture(t), file = path.join(f.root, 'installation.json');
  const corrupt = { ...f.first, mode: 'demo' }; await fs.writeFile(file, JSON.stringify(corrupt));
  assert.equal(f.run('inspect').status, 1);
  assert.equal(await fs.readFile(file, 'utf8'), JSON.stringify(corrupt));
});

test('native demo reservation is unique, blocks ordinary admission, and retains failed candidates explicitly', async t => {
  const f = await fixture(t), file = path.join(f.root, 'installation.json');
  const ready = { ...f.first, setup: 'ready' }; await fs.writeFile(file, JSON.stringify(ready));
  let result = f.run('reserve'); assert.equal(result.status, 0);
  const reserved = JSON.parse(result.stdout), candidate = reserved.pendingDemo.storeId;
  assert.notEqual(candidate, reserved.personalStore); assert.equal(reserved.selectedStore, ready.selectedStore);
  assert.equal(f.run('reserve').status, 1);
  result = f.run('candidate'); assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).pendingDemo.status, 'failed');
  assert.equal(f.run('candidate').status, 1);
  const marker = path.join(f.root, 'stores', candidate, 'retained'); await fs.writeFile(marker, 'partial evidence');
  result = f.run('retain'); assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).pendingDemo, null);
  assert.equal(await fs.readFile(marker, 'utf8'), 'partial evidence');
  result = f.run('reserve'); assert.equal(result.status, 0);
  assert.notEqual(JSON.parse(result.stdout).pendingDemo.storeId, candidate);
});
