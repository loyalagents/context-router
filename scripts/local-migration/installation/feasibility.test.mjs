import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from 'node:http';

// P1 probes only: no installed application, personal data, model weights or network downloads.
const here = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = await mkdtemp(path.join(os.tmpdir(), 'context-router-install-feasibility-'));
await chmod(suiteRoot, 0o700);
const executable = path.join(suiteRoot, 'guardian-probe');
const fixture = path.join(here, 'process-fixture.mjs');
const isDarwin = process.platform === 'darwin';
const compilation = isDarwin
  ? spawnSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
      path.join(here, 'guardian-probe.c'), '-o', executable],
    { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 })
  : undefined;
console.log(`P1 private evidence root: ${suiteRoot}`);

test('P1 native fixture guardian builds on the declared Mac', { skip: !isDarwin }, () => {
  assert.equal(compilation.status, 0, compilation.stderr);
});

async function rootFor(name) {
  const root = path.join(suiteRoot, name);
  await mkdir(root, { mode: 0o700 });
  return root;
}
function start(root, extra = {}) {
  assert.equal(compilation.status, 0, 'native probe must compile first');
  const child = spawn(executable, ['guardian', root, process.execPath, fixture], {
    env: { PATH: '/usr/bin:/bin', FIXTURE_LIFETIME_MS: '15000', ...extra },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const records = [];
  let buffered = '', stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffered += chunk;
    assert.ok(buffered.length < 16_384, 'fixture output is bounded');
    let index;
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      records.push(JSON.parse(line));
      child.emit('record');
    }
  });
  const ended = once(child, 'close').then(([code, signal]) => ({ code, signal, stderr }));
  async function wait(predicate, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (true) {
      const value = records.find(predicate);
      if (value) return value;
      assert.ok(Date.now() < deadline, `missing fixture event; ${JSON.stringify(records)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  return { child, records, ended, wait };
}
function lockResult(root) {
  const result = spawnSync(executable, ['check', root], { encoding: 'utf8', timeout: 2_000 });
  return { code: result.status, output: result.stdout.trim() };
}
async function ready(run, generation = 1) {
  await run.wait(r => r.event === 'spawned' && r.generation === generation);
  const application = await run.wait(r => r.event === 'fixture-ready' && r.role === 'application' && r.generation === generation);
  const model = await run.wait(r => r.event === 'fixture-ready' && r.role === 'model' && r.generation === generation);
  const parser = await run.wait(r => r.event === 'fixture-ready' && r.role === 'parser' && r.generation === generation);
  assert.equal(application.inode, model.inode);
  assert.equal(model.inode, parser.inode);
  return { application, model, parser };
}
async function quit(run) {
  run.child.stdin.write('quit\n');
  const result = await run.ended;
  assert.equal(result.code, 0, result.stderr);
  assert.ok(run.records.some(r => r.event === 'clean'));
}
const nativeOptions = { skip: !isDarwin, timeout: 60_000 };

test('inherited lock covers Node and parser; duplicate launch creates no children', nativeOptions, async () => {
  const root = await rootFor('duplicate');
  const run = start(root);
  await ready(run);
  assert.equal(lockResult(root).code, 2);
  const duplicate = start(root);
  assert.equal((await duplicate.ended).code, 2);
  assert.equal(duplicate.records.some(r => r.event === 'spawned'), false);
  await quit(run);
  assert.equal(lockResult(root).code, 0);
});

test('explicit restart observes both old owners and descriptor extinction before new generation', nativeOptions, async () => {
  const root = await rootFor('restart');
  const run = start(root);
  const old = await ready(run);
  run.child.stdin.write('restart\n');
  const next = await ready(run, 2);
  const exited = run.records.findIndex(r => r.event === 'reaped' && r.generation === 1 && r.owners === 2);
  const extinct = run.records.findIndex(r => r.event === 'cohort-extinct' && r.generation === 1);
  const spawned = run.records.findIndex(r => r.event === 'spawned' && r.generation === 2);
  assert.ok(exited >= 0 && extinct > exited && spawned > extinct);
  assert.notEqual(old.application.pid, next.application.pid);
  assert.notEqual(old.model.pid, next.model.pid);
  await quit(run);
});

test('launcher control EOF safely stops the exact owned cohort', nativeOptions, async () => {
  const root = await rootFor('launcher-loss');
  const run = start(root);
  await ready(run);
  run.child.stdin.end();
  assert.equal((await run.ended).code, 0);
  assert.equal(lockResult(root).code, 0);
});

test('owned model crash stops application without automatic restart', nativeOptions, async () => {
  const root = await rootFor('model-loss');
  const run = start(root);
  await ready(run);
  run.child.stdin.write('crash-model\n');
  assert.equal((await run.ended).code, 4);
  assert.equal(run.records.filter(r => r.event === 'spawned').length, 1);
  assert.ok(run.records.some(r => r.event === 'reaped' && r.owners === 2));
  assert.equal(lockResult(root).code, 0);
});

test('owned application crash stops model and preserves orphan-parser uncertainty', nativeOptions, async () => {
  const root = await rootFor('application-loss');
  const run = start(root);
  await ready(run);
  run.child.stdin.write('crash-application\n');
  assert.equal((await run.ended).code, 3);
  assert.ok(run.records.some(r => r.event === 'injected-owned-loss' && r.role === 'application'));
  assert.ok(run.records.some(r => r.event === 'reaped' && r.owners === 2));
  assert.equal(run.records.filter(r => r.event === 'spawned').length, 1);
  assert.equal(lockResult(root).code, 3);
});

test('occupied fixture listener refuses its cohort and leaves the existing owner untouched', nativeOptions, async () => {
  const server = createServer((_req, res) => res.end('existing fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = await rootFor('occupied-port');
    const run = start(root, { FIXTURE_PORT: String(server.address().port) });
    try {
      await run.wait(record => record.event === 'fixture-listen-refused', 2000);
      assert.equal((await run.ended).code, 4);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) { run.child.stdin.end(); await run.ended; }
    }
    assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}`)).text(), 'existing fixture');
    assert.equal(lockResult(root).code, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('unsettled parser after forced direct-owner cleanup preserves uncertainty', nativeOptions, async () => {
  const root = await rootFor('forced-cleanup');
  const run = start(root, { FIXTURE_IGNORE_TERM_ROLE: 'parser' });
  await ready(run);
  run.child.stdin.write('quit\n');
  assert.equal((await run.ended).code, 3);
  assert.ok(run.records.some(r => r.event === 'reaped' && r.owners === 2));
  assert.equal(run.records.some(r => r.event === 'clean'), false);
  assert.match(await readFile(path.join(root, 'generation'), 'utf8'), /^uncertain\n$/);
  assert.equal(lockResult(root).code, 3);
});

test('guardian loss keeps survivor exclusion and later uncertainty; no inferred-PID cleanup', nativeOptions, async () => {
  const root = await rootFor('guardian-loss');
  const run = start(root, { FIXTURE_LIFETIME_MS: '2500' });
  await ready(run);
  run.child.kill('SIGKILL'); // Exact directly owned guardian handle only.
  await once(run.child, 'exit');
  assert.equal(lockResult(root).code, 2, 'surviving children must retain the lock');
  await run.ended; // Fixtures self-expire; inherited stdout closes with the last fixture.
  assert.equal(lockResult(root).code, 3, 'available lock does not erase uncertain generation');
  const retry = start(root);
  assert.equal((await retry.ended).code, 3);
  assert.equal(retry.records.some(r => r.event === 'spawned'), false);
});

test('lock pathname replacement cannot authorize a second generation or clean old state', nativeOptions, async () => {
  const root = await rootFor('inode-replacement');
  const run = start(root);
  await ready(run);
  await rename(path.join(root, 'owner.lock'), path.join(root, 'original.lock'));
  await writeFile(path.join(root, 'owner.lock'), '', { mode: 0o600, flag: 'wx' });
  const retry = start(root);
  assert.equal((await retry.ended).code, 3);
  run.child.stdin.write('quit\n');
  assert.equal((await run.ended).code, 3);
  assert.match(await readFile(path.join(root, 'generation'), 'utf8'), /^uncertain\n$/);
});

test('partial, corrupt and unrecognized-boot metadata refuse startup', nativeOptions, async () => {
  for (const [name, contents] of [['partial', 'cle'], ['corrupt', ''], ['boot', 'old-boot-clean\n']]) {
    const root = await rootFor(name);
    await writeFile(path.join(root, 'generation'), contents, { mode: 0o600 });
    const run = start(root);
    assert.equal((await run.ended).code, 3);
    assert.equal(run.records.some(r => r.event === 'spawned'), false);
  }
});
