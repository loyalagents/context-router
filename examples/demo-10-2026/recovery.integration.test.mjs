import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareHome, resolveHome } from './home.mjs';
import { backend, configuration, cleanEnvironment } from './runtime.mjs';
import { loadDemoPlan, defaultInput } from './records.mjs';

for (const [signal, fresh] of [['SIGINT', false], ['SIGTERM', true]]) {
  test(`${signal} during real import revokes the importer and preserves failure evidence${fresh ? ' and prior selection' : ''}`, { timeout: 30000 }, async t => {
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
    child = spawn(process.execPath, [fileURLToPath(new URL('./demo.mjs', import.meta.url)), 'prepare', '--home', home,
      '--input', defaultInput, ...(fresh ? ['--fresh'] : [])], { env: { ...cleanEnvironment(), PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
    exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal })); });
    let root, observed = 0;
    const deadline = Date.now() + 20000;
    while (!observed && Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
      const generations = await fs.readdir(path.join(home, 'generations')).catch(() => []);
      const generation = generations.find(name => name !== previous?.generation);
      if (generation) {
        root = path.join(home, 'generations', generation);
        let database;
        try {
          // Do not open SQLite while identity/schema initialization is still
          // publishing files. The importer exists only after that boundary.
          await fs.access(path.join(root, 'exports/importer.token'));
          database = new DatabaseSync(path.join(root, 'data/database.sqlite'), { readOnly: true });
          observed = database.prepare('SELECT COUNT(*) AS count FROM preference_audit_events').get().count;
        } catch { /* Wait until the owned database and schema are published. */ }
        finally { database?.close(); }
      }
      if (!observed) await delay(5);
    }
    assert.ok(observed > 0 && observed < 378, `Signal must interrupt an actual incomplete import (observed ${observed}, exit ${child.exitCode}): ${stderr}`);
    assert.equal(child.kill(signal), true);
    const result = await exited;
    assert.equal(result.signal, null); assert.equal(result.code, 1);
    assert.match(stderr, /uncertain/);
    const failure = JSON.parse(await fs.readFile(path.join(root, 'failed.json'), 'utf8'));
    assert.equal(failure.stage, 'import'); assert.equal(failure.interruptedBy, signal);
    assert.equal(failure.importerRevoked, true); assert.equal(failure.cleanupRequiresInspection, false);
    await assert.rejects(fs.access(path.join(root, 'manifest.json')));
    await fs.access(path.join(home, 'writer.lock'));
    const identity = JSON.parse(await fs.readFile(path.join(root, 'identity/identity.json'), 'utf8'));
    const b = backend(), config = configuration(root);
    const credentials = new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), identity.principalId);
    assert.equal(credentials.list().length, 1); assert.equal(credentials.list()[0].revoked, true);
    if (previous) {
      assert.equal((await resolveHome({ home, allowLocked: true })).root, previous.root);
      await assert.rejects(resolveHome({ home }), /lock/);
    } else await assert.rejects(fs.access(path.join(home, 'current.json')));
  });
}
