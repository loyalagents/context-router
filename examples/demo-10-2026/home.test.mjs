import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareHome, resolveHome, withHomeLock, syncDirectory } from './home.mjs';
import { readManifest, cleanEnvironment } from './runtime.mjs';
import { loadDemoPlan } from './records.mjs';

async function fixture(t) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-home-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const input = path.join(parent, 'input'); await fs.mkdir(input);
  const record = (await loadDemoPlan()).entries.find(e => e.definition.slug.startsWith('home.')).preference.evidence.sourceRecord;
  await fs.writeFile(path.join(input, 'home.jsonl'), JSON.stringify(record) + '\n');
  return { parent, input, home: path.join(parent, 'durable') };
}

test('durable home reuses selection, preserves old generations and stable profiles, and rejects explicit conflicts', async t => {
  const { home, input } = await fixture(t);
  const first = await prepareHome({ home, input });
  assert.equal(first.port, 3004); assert.equal(first.mcpPort, 8789);
  assert.equal((await readManifest(first.root)).format, 'context-router-portability-demo-v2');
  const marker = path.join(first.profileRoot, 'codex-a-config', 'synthetic-login');
  await fs.writeFile(marker, 'keep login', { mode: 0o600 });
  assert.deepEqual(await prepareHome({ home }), first);
  for (const options of [{ dataset: 'other' }, { port: 3005 }, { mcpPort: 8790 }, { input: path.dirname(input) }]) {
    await assert.rejects(prepareHome({ home, ...options }), /conflict/i);
  }
  const next = await prepareHome({ home, input, fresh: true, dataset: 'second', port: 3005, mcpPort: 8790 });
  assert.notEqual(next.root, first.root); assert.equal(next.profileRoot, first.profileRoot);
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep login');
  assert.equal((await readManifest(first.root)).dataset, 'demo001');
  assert.equal((await resolveHome({ home })).root, next.root);
  assert.equal(first.dataset, 'demo001'); // Previously resolved invocations stay pinned.
  const repeated = await prepareHome({ home, fresh: true });
  assert.equal(repeated.input, input); assert.equal(repeated.dataset, 'second');
  assert.equal(repeated.port, 3005); assert.equal(repeated.mcpPort, 8790);
  assert.equal(repeated.homeId, first.homeId);
  for (const command of ['prepare', 'status']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./demo.mjs', import.meta.url)), command, '--home', home], { env: cleanEnvironment(), encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.root, repeated.root); assert.equal(output.port, 3005); assert.equal(output.mcpPort, 8790);
    if (command === 'status') { assert.equal(output.status, 'descriptive'); assert.equal(output.baselineChecked, false); assert.equal(output.readinessChecked, false); }
  }
});

test('home serialization refuses concurrent/stale writers and never removes an unknown lock', async t => {
  const { home, input } = await fixture(t); await prepareHome({ home, input });
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = withHomeLock(home, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await started;
  await assert.rejects(prepareHome({ home, fresh: true }), /lock/i);
  release(); await held;
  const lock = path.join(home, 'writer.lock'); await fs.writeFile(lock, 'unknown stale owner', { mode: 0o600 });
  await assert.rejects(prepareHome({ home }), /lock/i);
  assert.equal(await fs.readFile(lock, 'utf8'), 'unknown stale owner');
  assert.equal((await resolveHome({ home, allowLocked: true })).locked, true);
});

test('failed import or selector publication keeps prior selection and uncertain artifacts without replay', async t => {
  for (const boundary of ['prepare', 'before-selector', 'after-selector']) {
    const { home, input } = await fixture(t); const first = await prepareHome({ home, input });
    let calls = 0;
    const hooks = boundary === 'prepare' ? { prepare: async ({ out }, { beforeCreate }) => { await beforeCreate(); calls++; await fs.mkdir(out, { mode: 0o700 }); throw new Error('uncertain'); } }
      : { checkpoint: async phase => { if (phase === boundary) throw new Error('interrupted'); } };
    await assert.rejects(prepareHome({ home, input, fresh: true }, hooks), /inspection|uncertain/i);
    if (boundary === 'prepare') assert.equal(calls, 1);
    assert.equal((await fs.readdir(path.join(home, 'generations'))).length, 2);
    await assert.rejects(prepareHome({ home }), /lock/i);
    const retained = await resolveHome({ home, allowLocked: true });
    assert.equal(retained.locked, true);
    if (boundary !== 'after-selector') assert.equal(retained.root, first.root);
    else { assert.notEqual(retained.root, first.root); await readManifest(retained.root); }
    await readManifest(first.root);
  }
});

test('real preparation prerequisite failures release the lock without publishing or importing', async t => {
  const { parent, home, input } = await fixture(t);
  const cli = fileURLToPath(new URL('./demo.mjs', import.meta.url));
  const missingTools = path.join(parent, 'empty-path'); await fs.mkdir(missingTools);
  const attempt = fresh => spawnSync(process.execPath, [cli, 'prepare', '--home', home, '--input', input, ...(fresh ? ['--fresh'] : [])], {
    env: { ...cleanEnvironment(), PATH: missingTools }, encoding: 'utf8', timeout: 20000,
  });
  let result = attempt(false);
  assert.equal(result.status, 1); assert.match(result.stderr, /pnpm 10\.25\.0/);
  assert.doesNotMatch(result.stderr, /uncertain/);
  assert.deepEqual(await fs.readdir(home), []);
  const first = await prepareHome({ home, input });
  result = attempt(true);
  assert.equal(result.status, 1); assert.match(result.stderr, /pnpm 10\.25\.0/);
  assert.doesNotMatch(result.stderr, /uncertain/);
  assert.deepEqual(await fs.readdir(path.join(home, 'generations')), [first.generation]);
  assert.equal((await resolveHome({ home })).root, first.root);
});

test('changed profile permissions fail before new state and do not lock the selected generation', async t => {
  const { home, input } = await fixture(t); const first = await prepareHome({ home, input });
  const config = path.join(first.profileRoot, 'claude-config'); await fs.chmod(config, 0o755);
  await assert.rejects(prepareHome({ home, fresh: true }), /permissions/);
  assert.equal((await resolveHome({ home })).root, first.root);
  assert.deepEqual(await fs.readdir(path.join(home, 'generations')), [first.generation]);
  await fs.chmod(config, 0o700);
});

test('uncertain home errors retain only explicitly safe causes', async t => {
  const { home, input } = await fixture(t); await prepareHome({ home, input });
  await assert.rejects(withHomeLock(home, mark => { mark(); throw Object.assign(new Error('private content'), { demoSafeMessage: 'Safe stage detail.' }); }), /Safe stage detail.*uncertain/);
  assert.equal((await resolveHome({ home, allowLocked: true })).locked, true);
});

test('durable home rejects unsafe aliases and forged selector paths', async t => {
  const { parent, home, input } = await fixture(t); const first = await prepareHome({ home, input });
  const alias = path.join(parent, 'alias'); await fs.symlink(home, alias);
  await assert.rejects(resolveHome({ home: alias }), /canonical|links/i);
  const file = path.join(home, 'current.json'), original = await fs.readFile(file);
  await fs.writeFile(file, JSON.stringify({ format: 'context-router-demo-selection-v1', generation: '../escape' }));
  await assert.rejects(resolveHome({ home }), /selection/i);
  await fs.writeFile(file, original); await fs.chmod(file, 0o644);
  await assert.rejects(resolveHome({ home }), /permissions/i);
  assert.equal(first.root.startsWith(home + '/generations/'), true);
});

test('initial home parent is synced before preparation, and a failed sync cannot publish or import', async t => {
  const { parent, home, input } = await fixture(t);
  let imports = 0, attempts = 0;
  const syncHomeParent = async directory => {
    attempts++; assert.equal(directory, parent);
    assert.deepEqual(await fs.readdir(home), []);
    throw new Error('injected parent sync failure');
  };
  await assert.rejects(prepareHome({ home, input }, { syncHomeParent, prepare: async () => { imports++; } }), /parent sync failure/);
  assert.equal(attempts, 1); assert.equal(imports, 0);
  assert.deepEqual(await fs.readdir(home), []);
  const prepared = await prepareHome({ home, input }, { syncHomeParent: async directory => {
    attempts++; assert.equal(directory, parent);
    assert.deepEqual(await fs.readdir(home), []);
    await syncDirectory(directory);
  } });
  assert.equal(attempts, 2);
  assert.equal((await resolveHome({ home })).root, prepared.root);
});
