const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const base = path.resolve(__dirname, '../../../backend/dist');
const managed = require(path.join(base, 'infrastructure/managed/managed-admission.js'));
const { SqliteDatabase } = require(path.join(base, 'infrastructure/storage/sqlite/sqlite-database.js'));
const [guardian, envelope, action] = process.argv.slice(2);
const paths = { databaseRoot: path.join(envelope, 'stores', 'a'.repeat(32), 'data'), identityRoot: path.join(envelope, 'stores', 'a'.repeat(32), 'identity') };
(async () => {
  if (action === 'pre-revoke') managed.revokeManagedAdmission();
  try { await managed.admitManagedProcess(guardian); }
  catch {
    let retry = false; try { await managed.admitManagedProcess(guardian); retry = true; } catch {}
    return console.log(JSON.stringify({ admitted: false, retry, exists: fs.existsSync(paths.databaseRoot) }));
  }
  if (action === 'admit') return console.log(JSON.stringify({ admitted: true }));
  if (action === 'prepare-occupied') {
    const file=path.join(paths.databaseRoot,'database.sqlite'),before=fs.readFileSync(file);
    let denied=false;try{await require(path.join(base,'infrastructure/managed/managed-prepare.js')).prepareManagedStore();}catch{denied=true;}
    await require(path.join(base,'infrastructure/storage/sqlite/sqlite-database.js')).waitForNativeOwners();
    return console.log(JSON.stringify({admitted:true,denied,unchanged:before.equals(fs.readFileSync(file)),empty:fs.readdirSync(paths.identityRoot).length===0}));
  }
  if (action === 'prepare-store' || action === 'prepare-recovered') {
    const target=action==='prepare-recovered'?SqliteDatabase.open(paths).targetId:null;
    const before = fs.existsSync(path.join(paths.identityRoot, 'identity.json')) ? fs.readFileSync(path.join(paths.identityRoot, 'identity.json')) : null;
    const { prepareManagedStore } = require(path.join(base, 'infrastructure/managed/managed-prepare.js'));
    const prepared = await prepareManagedStore();
    const c = SqliteDatabase.open(paths).connect();
    const schema = c.get('PRAGMA user_version').user_version; c.close();
    return console.log(JSON.stringify({ admitted: true, prepared: prepared.targetId.length === 43, schema,
      identityPreserved: !before || before.equals(fs.readFileSync(path.join(paths.identityRoot, 'identity.json'))),
      ...(target?{targetPreserved:target===prepared.targetId&&target===SqliteDatabase.open(paths).targetId&&target===JSON.parse(fs.readFileSync(path.join(paths.identityRoot,'identity.json'))).databaseTargetId}:{}) }));
  }
  if (action === 'app-readonly' || action === 'prepare-readonly') {
    const file = path.join(paths.databaseRoot, 'database.sqlite'), before = fs.readFileSync(file);
    if (action === 'prepare-readonly') await require(path.join(base, 'infrastructure/managed/managed-prepare.js')).prepareManagedStore();
    else {
      const { createLocalUiApplication } = require(path.join(base, 'bootstrap/local-ui.js'));
      const runtime = await createLocalUiApplication({ kind: 'sqlite', databaseRoot: paths.databaseRoot, stateRoot: paths.identityRoot }, {
        port: 0, mcpPort: 0, exportRoot: path.join(envelope, 'exports'), webHandler: (_req, res) => res.end('fixture'),
      });
      await runtime.close();
    }
    await require(path.join(base, 'infrastructure/storage/sqlite/sqlite-database.js')).waitForNativeOwners();
    return console.log(JSON.stringify({ admitted: true, unchanged: before.equals(fs.readFileSync(file)) }));
  }
  if (action === 'upgrade-denied') {
    const { SqliteMcpCredentials } = require(path.join(base, 'infrastructure/storage/sqlite/sqlite-mcp-credentials.js'));
    const principal = JSON.parse(fs.readFileSync(path.join(paths.identityRoot, 'identity.json'))).principalId;
    let denied = false; try { new SqliteMcpCredentials(SqliteDatabase.open(paths), principal).upgrade(); } catch { denied = true; }
    const c = SqliteDatabase.open(paths).connect(); const schema = c.get('PRAGMA user_version').user_version; c.close();
    return console.log(JSON.stringify({ admitted: true, denied, schema }));
  }
  if (action === 'pdf') {
    const { PdfProcess } = await import(path.join(base, 'infrastructure/local-model/engine/pdf-process.mjs'));
    const worker = path.join(__dirname, 'pdf-inherited.mjs');
    const parser = new PdfProcess({ workerPath: worker, lifetimeDescriptor: managed.managedLifetimeDescriptor });
    const result = await parser.parse(Buffer.from(JSON.stringify({ guardian, lock: path.join(envelope, 'owner.lock') })));
    await parser.drain();
    return console.log(JSON.stringify({ admitted: true, inherited: result.text === 'verified' }));
  }
  if (action === 'model-revoke' || action.startsWith('model-worker-revoke')) {
    const { fixture } = await import(path.resolve(__dirname, '../../../backend/test/local-model/fixtures/session-fixture.mjs'));
    const cleanup = [];
    fs.mkdirSync(path.join(envelope, 'sessions'), { mode: 0o700 });
    const root = path.join(envelope, 'sessions', 'a'.repeat(32));
    const f = await fixture({ after: fn => cleanup.push(fn) }, { ...paths, root });
    f.state.authBypass = (req, res) => { if (req.url !== '/health') return false; res.end('{"status":"ok"}'); return true; };
    const deadline = performance.now() + 3000;
    while ((await f.service.getStatus()).state !== 'available') {
      if (performance.now() >= deadline) throw new Error();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    let entered;
    const completion = new Promise(resolve => { entered = resolve; });
    f.state.hook = (req, res) => { if (req.url !== '/completion') return false; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); entered(); return true; };
    const result = f.service.generateText('synthetic').then(() => false, error => error.kind === 'cancelled');
    await completion;
    const authority = managed.managedModelAuthority(f.config);
    const workerAdmission = managed.managedWorkerAdmission();
    const connection = SqliteDatabase.open(paths).connect();
    const file = path.join(envelope, 'owner.json'), journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    journal.generation = 'c'.repeat(32);
    fs.writeFileSync(file + '.stage', JSON.stringify(journal), { mode: 0o600 }); fs.renameSync(file + '.stage', file);
    if (action.endsWith('-malformed')) fs.writeFileSync(file, '{', { mode: 0o600 });
    if (action.endsWith('-missing')) fs.unlinkSync(file);
    let denied = false;
    if (action.startsWith('model-worker-revoke')) {
      const worker = new Worker(`const {workerData,parentPort}=require('node:worker_threads');try {require(workerData.module).admitManagedWorker(workerData.admission);parentPort.postMessage(false);}catch{parentPort.postMessage(true);}`, {
        eval: true, env: {}, workerData: { module: path.join(base, 'infrastructure/managed/managed-admission.js'), admission: workerAdmission },
      });
      worker.on('message', value => { denied = value; });
      await new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
    } else try { managed.managedWorkerAdmission(); } catch { denied = true; }
    connection.close();
    const aborted = authority.signal.aborted;
    // Bound the assertion itself; always close the service and actual fixture sockets.
    const cancelled = await Promise.race([result, new Promise(resolve => { const timer = setTimeout(() => resolve(false), 1500); timer.unref(); })]);
    for (const close of cleanup) await close();
    return console.log(JSON.stringify({ admitted: true, denied, aborted, cancelled }));
  }
  if (action === 'identity-denied' || action === 'identity-revoke') {
    const { LocalIdentityFileStore } = require(path.join(base, 'modules/auth/local-identity-filesystem.js'));
    const { LocalIdentityStateService } = require(path.join(base, 'modules/auth/local-identity-state.service.js'));
    const { createRecoveryOperation } = require(path.join(base, 'modules/auth/local-identity-state.codec.js'));
    const file = path.join(paths.identityRoot, 'identity.json'), before = fs.readFileSync(file);
    const target = JSON.parse(before).databaseTargetId;
    const store = new LocalIdentityFileStore({ stateRoot: paths.identityRoot, databaseTargetId: target });
    const lease = await store.prepareRoot({ create: false });
    let acquired = 0, denied = 0;
    if (action === 'identity-denied') {
      const service = new LocalIdentityStateService({ fileStore: store, repository: { acquire: async () => { acquired++; throw new Error(); } } });
      for (const method of ['initialize', 'rotate', 'recoverInitialize', 'recoverRotation']) try { await service[method](); } catch { denied++; }
    } else managed.revokeManagedAdmission();
    try { await store.publishOperation(lease, createRecoveryOperation({ databaseTargetId: target, nonce: Buffer.alloc(32, 4).toString('base64url') })); } catch { denied++; }
    const unchanged = before.equals(fs.readFileSync(file)) && fs.readdirSync(paths.identityRoot).join() === 'identity.json';
    return console.log(JSON.stringify(action === 'identity-denied' ? { admitted: true, denied, acquired, unchanged } : { admitted: true, denied: denied === 1, unchanged }));
  }
  if (action === 'identity-recovery' || action === 'identity-candidate') {
    const {createSqliteIdentityRuntime}=require(path.join(base,'infrastructure/storage/sqlite/sqlite-local-runtime.js'));
    const {service}=createSqliteIdentityRuntime({kind:'sqlite',databaseRoot:paths.databaseRoot,stateRoot:paths.identityRoot});
    const result=await service.recoverInitialize();
    if(action==='identity-candidate') {
      const ready=await service.verifyReadyState();
      await require(path.join(base,'infrastructure/storage/sqlite/sqlite-database.js')).waitForNativeOwners();
      return console.log(JSON.stringify({admitted:true,recovered:result.state.generation===1,ready:ready.state.principalId===Buffer.alloc(32,1).toString('base64url')}));
    }
    const recovered=result===null;
    let denied=0;
    for (const operation of [()=>service.initialize(),()=>service.rotate(),()=>managed.assertManagedSchemaUpgrade()]) try {await operation();} catch {denied++;}
    await require(path.join(base,'infrastructure/storage/sqlite/sqlite-database.js')).waitForNativeOwners();
    return console.log(JSON.stringify({admitted:true,recovered,denied,empty:fs.readdirSync(paths.identityRoot).length===0}));
  }
  if (action === 'recovery') {
    const result = SqliteDatabase.recoverBootstrap(paths);
    return console.log(JSON.stringify({ admitted: true, recovered: result === 'recovered', scratchRemoved: fs.readdirSync(path.dirname(paths.databaseRoot)).every(name => !name.startsWith('database-bootstrap-check-')) }));
  }
  if (action === 'backup-escape') {
    const { SqliteBackup } = require(path.join(base, 'infrastructure/storage/sqlite/sqlite-backup.js'));
    const destination = path.join(envelope, 'exports', 'unapproved');
    let denied = false; try { await new SqliteBackup().create(SqliteDatabase.open(paths), destination); } catch { denied = true; }
    return console.log(JSON.stringify({ admitted: true, denied, exists: fs.existsSync(destination) }));
  }
  if (action === 'backup' || action === 'restore') {
    const { SqliteBackup } = require(path.join(base, 'infrastructure/storage/sqlite/sqlite-backup.js'));
    if (action === 'backup') {
      const destination = path.join(envelope, 'exports', 'a'.repeat(32));
      await new SqliteBackup().create(SqliteDatabase.open(paths), destination);
      return console.log(JSON.stringify({ admitted: true, backup: fs.existsSync(path.join(destination, 'complete.json')) }));
    }
    const restored = await new SqliteBackup().restore(path.join(path.dirname(envelope), 'bundle'), path.dirname(paths.databaseRoot));
    return console.log(JSON.stringify({ admitted: true, restored: restored.targetId.length === 43,
      selectedPreserved: JSON.parse(fs.readFileSync(path.join(envelope, 'installation.json'), 'utf8')).selectedStore === 'd'.repeat(32) }));
  }
  const database = SqliteDatabase.bootstrap(paths);
  const rowsAfterClose = () => {
    const checked = new DatabaseSync(path.join(paths.databaseRoot, 'database.sqlite'), { readOnly: true });
    try { return checked.prepare('SELECT count(*) AS n FROM users').get().n; } finally { checked.close(); }
  };
  if (action === 'live-worker-revoke') {
    const worker = new Worker(path.join(base, 'infrastructure/storage/sqlite/sqlite-coordination.worker.js'), {
      env: {}, workerData: { paths, managedAdmission: managed.managedWorkerAdmission() },
    });
    const exited = new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
    let id = 0;
    const call = (command, extra = {}) => new Promise(resolve => { worker.once('message', resolve); worker.postMessage({ id: ++id, command, ...extra }); });
    for (const command of ['acquire', 'begin']) if (!(await call(command)).ok) throw new Error();
    if (!(await call('insert-principal', { principalId: Buffer.alloc(32, 1).toString('base64url') })).ok) throw new Error();
    const witnessed = (await call('inspect')).value.users.length === 1;
    managed.revokeManagedAdmission();
    const denied = !(await call('commit')).ok;
    await exited;
    return console.log(JSON.stringify({ admitted: true, witnessed, denied, rolledBack: rowsAfterClose() === 0, exited: worker.threadId === -1 }));
  }
  if (action === 'database') return console.log(JSON.stringify({ admitted: true, database: SqliteDatabase.open(paths).targetId === database.targetId }));
  if (action === 'revoke' || action === 'journal' || action === 'revoke-commit') {
    const connection = database.connect();
    let witnessed;
    if (action === 'revoke-commit') {
      connection.exec('BEGIN IMMEDIATE');
      connection.run('INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?)', [Buffer.alloc(32, 1).toString('base64url'), 'fixture@example.test', 1, 1]);
      witnessed = connection.get('SELECT count(*) AS n FROM users').n === 1;
    }
    if (action === 'revoke' || action === 'revoke-commit') managed.revokeManagedAdmission();
    else {
      const file = path.join(envelope, 'owner.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.generation = 'c'.repeat(32);
      fs.writeFileSync(file + '.stage', JSON.stringify(data), { mode: 0o600 }); fs.renameSync(file + '.stage', file);
    }
    let revoked = false; try { connection.exec(action === 'revoke-commit' ? 'COMMIT' : 'BEGIN IMMEDIATE'); } catch { revoked = true; }
    connection.close();
    return console.log(JSON.stringify({ admitted: true, revoked, closed: true,
      ...(action === 'revoke-commit' ? { witnessed, rolledBack: rowsAfterClose() === 0 } : {}) }));
  }
  if (action === 'worker') {
    const { SqliteLocalIdentityCoordination } = require(path.join(base, 'infrastructure/storage/sqlite/sqlite-local-identity-coordination.js'));
    const session = await new SqliteLocalIdentityCoordination({ database }).acquire();
    await session.release();
    return console.log(JSON.stringify({ admitted: true, worker: true }));
  }
  const admission = managed.managedWorkerAdmission();
  managed.revokeManagedAdmission();
  const worker = new Worker(`const { workerData, parentPort } = require('node:worker_threads'); const m = require(workerData.module); try { m.admitManagedWorker(workerData.admission); parentPort.postMessage(false); } catch { parentPort.postMessage(true); }`, {
    eval: true, env: {}, workerData: { module: path.join(base, 'infrastructure/managed/managed-admission.js'), admission },
  });
  let denied;
  worker.on('message', value => { denied = value; });
  await new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
  console.log(JSON.stringify({ admitted: true, workerDenied: denied }));
})().catch(() => { console.error('fixture-failed'); process.exitCode = 1; });
