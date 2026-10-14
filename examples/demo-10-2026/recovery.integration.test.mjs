import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareHome, resolveHome } from './home.mjs';
import { backend, configuration, cleanEnvironment, readManifest } from './runtime.mjs';
import { loadDemoPlan, defaultInput } from './records.mjs';

async function fixture(t, fresh) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-signal-')));
  const home = path.join(parent, 'home'); let child, exited;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited; await fs.rm(parent, { recursive: true, force: true });
  });
  let previous;
  if (fresh) {
    const input = path.join(parent, 'input'); await fs.mkdir(input);
    const record = (await loadDemoPlan()).entries.find(e => e.definition.slug.startsWith('home.')).preference.evidence.sourceRecord;
    await fs.writeFile(path.join(input, 'home.jsonl'), JSON.stringify(record) + '\n');
    previous = await prepareHome({ home, input });
  }
  function start(mode = 'import') {
    // The actual importer pauses after a settled write. IPC carries counts and
    // the owned root only; the parent never opens SQLite while this child lives.
    const script = `
      import { prepareHome } from ${JSON.stringify(new URL('./home.mjs', import.meta.url).href)};
      import { prepareDemo, writeJson } from ${JSON.stringify(new URL('./runtime.mjs', import.meta.url).href)};
      const pause = value => new Promise(resolve => { process.once('message', resolve); process.send(value); });
      try {
        await prepareHome(${JSON.stringify({ home, input: defaultInput, fresh })}, { prepare: (options, hooks) => prepareDemo(options, {
          ...hooks,
          onProgress: async progress => { if (${JSON.stringify(mode)} === 'import' && progress.completed === 1) await pause({ ...progress, root: options.out }); },
          writeManifest: async (file, manifest) => { await writeJson(file, manifest); if (${JSON.stringify(mode)} === 'manifest') await pause({ root: options.out, manifestWritten: true }); },
        }) });
      } catch (error) { console.error(error.demoSafeMessage ?? 'Preparation failed.'); process.exitCode = 1; }
      finally { process.disconnect(); }
    `;
    child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...cleanEnvironment(), PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '', progress;
    child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
    child.on('message', message => { progress = message; });
    exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    const waitFor = async condition => {
      const deadline = Date.now() + 20000;
      while (!condition()) {
        assert.ok(Date.now() < deadline && child.exitCode === null && child.signalCode === null, `Child exited or timed out before the checkpoint: ${stderr}`);
        await delay(5);
      }
    };
    return { child, exited, stderr: () => stderr,
      ready: async () => { await waitFor(() => progress); return progress; },
      interrupt: async signal => { assert.equal(child.kill(signal), true); await waitFor(() => /Stopping preparation/.test(stderr)); },
    };
  }
  return { home, previous, start };
}

function credentialsAt(root, principalId) {
  const b = backend(), config = configuration(root);
  return new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), principalId);
}

for (const [signal, fresh] of [['SIGINT', false], ['SIGTERM', true]]) {
  test(`${signal} during real import revokes the importer and preserves failure evidence${fresh ? ' and prior selection' : ''}`, { timeout: 30000 }, async t => {
    const f = await fixture(t, fresh), worker = f.start();
    const progress = await worker.ready(), root = progress.root;
    assert.equal(progress.completed, 1); assert.equal(progress.total, 189);
    await worker.interrupt(signal);
    worker.child.send('continue'); // Resume only after the child caught the signal.
    assert.deepEqual(await worker.exited, { code: 1, signal: null });
    assert.match(worker.stderr(), /uncertain/);
    assert.doesNotMatch(worker.stderr(), /new (output )?directory/i);
    const failure = JSON.parse(await fs.readFile(path.join(root, 'failed.json'), 'utf8'));
    assert.equal(failure.stage, 'import'); assert.equal(failure.interruptedBy, signal);
    assert.equal(failure.importerRevoked, true); assert.equal(failure.cleanupRequiresInspection, false);
    assert.match(failure.retry, /inspect.*writer.lock/i);
    await assert.rejects(fs.access(path.join(root, 'manifest.json')));
    await fs.access(path.join(f.home, 'writer.lock'));
    const identity = JSON.parse(await fs.readFile(path.join(root, 'identity/identity.json'), 'utf8'));
    const credentials = credentialsAt(root, identity.principalId);
    assert.equal(credentials.list().length, 1); assert.equal(credentials.list()[0].revoked, true);
    const database = new DatabaseSync(path.join(root, 'data/database.sqlite'), { readOnly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM preference_audit_events').get().count, 2); }
    finally { database.close(); }
    if (f.previous) {
      assert.equal((await resolveHome({ home: f.home, allowLocked: true })).root, f.previous.root);
      await assert.rejects(resolveHome({ home: f.home }), /lock/);
    } else await assert.rejects(fs.access(path.join(f.home, 'current.json')));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`a repeated ${signal} terminates a stalled preparation without claiming cleanup`, { timeout: 30000 }, async t => {
    const f = await fixture(t, false), worker = f.start();
    const { root } = await worker.ready();
    await worker.interrupt(signal);
    assert.equal(worker.child.kill(signal), true);
    assert.deepEqual(await worker.exited, { code: null, signal });
    await fs.access(path.join(f.home, 'writer.lock'));
    await assert.rejects(fs.access(path.join(root, 'manifest.json')));
    await assert.rejects(fs.access(path.join(root, 'failed.json')));
    await assert.rejects(fs.access(path.join(f.home, 'current.json')));
  });
}

test('a signal during manifest publication preserves the completed manifest and prior selection', { timeout: 30000 }, async t => {
  const f = await fixture(t, true), worker = f.start('manifest');
  const { root, manifestWritten } = await worker.ready(); assert.equal(manifestWritten, true);
  await worker.interrupt('SIGINT'); worker.child.send('continue');
  assert.deepEqual(await worker.exited, { code: 1, signal: null });
  assert.match(worker.stderr(), /manifest.*preserved/i);
  const manifest = await readManifest(root);
  assert.equal(credentialsAt(root, manifest.principalId).list().find(c => c.id === manifest.importerId).revoked, true);
  await assert.rejects(fs.access(path.join(root, 'failed.json')));
  await assert.rejects(fs.access(path.join(root, 'generation.json')));
  assert.equal((await resolveHome({ home: f.home, allowLocked: true })).root, f.previous.root);
  await fs.access(path.join(f.home, 'writer.lock'));
});
