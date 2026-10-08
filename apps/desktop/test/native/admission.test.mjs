import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, renameSync, statSync, rmdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'darwin', 'native suite requires Darwin');
assert.equal(process.arch, 'arm64', 'native suite requires arm64');
const top = realpathSync(mkdtempSync(path.join(tmpdir(), 'desktop-admission-')));
const guardian = path.resolve(import.meta.dirname, '../../build/context-router');
const holder = path.join(top, 'holder');
const build = spawnSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', path.join(import.meta.dirname, '../fixtures/admission-holder.c'), '-o', holder], { encoding: 'utf8', timeout: 20_000 });
assert.equal(build.status, 0, build.stderr);
const bootQuery = spawnSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 2000 });
assert.equal(bootQuery.status, 0, bootQuery.stderr);
const bootId = bootQuery.stdout.trim();
const inode = file => { const s = statSync(file); return { dev: s.dev, ino: s.ino }; };
const backend = path.resolve(import.meta.dirname, '../../../backend/dist');
let next = 0;
let ownershipUncertain = false;
function fixture(variant) {
  const parent = path.join(top, String(++next)); mkdirSync(parent, { mode: 0o700 });
  const envelope = path.join(parent, 'managed-v1'); mkdirSync(envelope, { mode: 0o700 });
  const id = 'a'.repeat(32);
  const store = path.join(envelope, 'stores', id); mkdirSync(store, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(envelope, 'owner.lock'), '', { mode: 0o600 });
  const cap = { version: 1, epoch: 1, envelope, installationId: id, storeId: id, generation: id, bootId,
    role: 'prepare', operation: 'initialize', nonce: 'b'.repeat(64), envelopePin: inode(envelope), lockPin: inode(path.join(envelope, 'owner.lock')),
    dataPin: null, identityPin: null, targetId: null };
  const installation = { version: 1, installationId: id, selectedStore: id, minimumEpoch: variant === 'floor' ? 2 : 1, setup: 'initializing', pendingRestore: null };
  if (['recovery','identity-recovery','identity-candidate','identity-operation','recovered-empty','recovered-occupied'].includes(variant)) {
    const data = path.join(parent, 'data'), identity = path.join(parent, 'identity');
    const seeded = spawnSync(process.execPath, ['-e', 'console.log(require(process.argv[1]).SqliteDatabase.bootstrap(JSON.parse(process.argv[2])).targetId)',
      path.join(backend, 'infrastructure/storage/sqlite/sqlite-database.js'), JSON.stringify({ databaseRoot: data, identityRoot: identity })], { env: {}, timeout: 5000 });
    assert.equal(seeded.status, 0);
    renameSync(data, path.join(store, 'data'));
    if (variant === 'recovery') renameSync(path.join(store, 'data/database.sqlite'), path.join(store, 'data', `bootstrap-${'e'.repeat(32)}.sqlite`));
    cap.role = 'maintenance'; cap.operation = 'recover-bootstrap'; cap.dataPin = inode(path.join(store, 'data')); installation.setup = 'failed';
    if (variant !== 'recovery') {
      mkdirSync(path.join(store,'identity'),{mode:0o700});cap.identityPin=inode(path.join(store,'identity'));
      cap.operation=variant.startsWith('identity-') ? 'recover-identity' : 'initialize-recovered';
      if(variant.startsWith('recovered-')) cap.role='prepare';
      if(variant==='recovered-occupied') {
        const inserted=spawnSync(process.execPath,['-e',`const d=new(require('node:sqlite').DatabaseSync)(process.argv[1]);d.prepare('INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?)').run('retained','fixture@example.test',1,1);d.close()`,path.join(store,'data/database.sqlite')],{env:{},timeout:5000});assert.equal(inserted.status,0);
      }
      if(['identity-candidate','identity-operation'].includes(variant)) {
        const codec=createRequire(import.meta.url)(path.join(backend,'modules/auth/local-identity-state.codec.js'));
        const state={schemaVersion:1,databaseTargetId:seeded.stdout.toString().trim(),principalId:Buffer.alloc(32,1).toString('base64url'),credential:Buffer.alloc(32,2).toString('base64url'),generation:1};
        const bytes=codec.encodeLocalIdentityState(state), operation=codec.createInitializeOperation({databaseTargetId:state.databaseTargetId,nonce:Buffer.alloc(32,3).toString('base64url'),proposedStateDigest:codec.digestLocalIdentityState(bytes)});
        writeFileSync(path.join(store,'identity',codec.LOCAL_IDENTITY_OPERATION_BASENAME),codec.encodeLocalIdentityOperation(operation),{mode:0o600});
        if(variant==='identity-candidate')writeFileSync(path.join(store,'identity',operation.candidateBasename),bytes,{mode:0o600});
      }
    }
  }
  if (['backup', 'restore', 'application', 'admin', 'resume', 'verify', 'application-ready'].includes(variant)) {
    const source = path.join(parent, 'source'); mkdirSync(source, { mode: 0o700 });
    const databaseRoot = path.join(source, 'data'), identityRoot = path.join(source, 'identity');
    const initialized = spawnSync(process.execPath, [path.join(backend, 'local-identity.js'), 'initialize'], {
      env: { LOCAL_DATABASE_ROOT: databaseRoot, LOCAL_IDENTITY_STATE_ROOT: identityRoot }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    if (variant === 'verify' || variant === 'application-ready') {
      const upgraded = spawnSync(process.execPath, [path.join(backend, 'local-mcp.js'), 'upgrade'], { env: { LOCAL_DATABASE_ROOT: databaseRoot, LOCAL_IDENTITY_STATE_ROOT: identityRoot }, timeout: 10_000 });
      assert.equal(upgraded.status, 0);
    }
    cap.role = variant.startsWith('application') ? 'application' : ['resume', 'verify'].includes(variant) ? 'prepare' : 'maintenance';
    cap.operation = variant.startsWith('application') ? 'serve' : variant === 'resume' ? 'resume-setup' : variant;
    installation.setup = 'ready';
    cap.targetId = JSON.parse(readFileSync(path.join(identityRoot, 'identity.json'), 'utf8')).databaseTargetId;
    if (variant !== 'restore') {
      renameSync(databaseRoot, path.join(store, 'data')); renameSync(identityRoot, path.join(store, 'identity'));
      cap.dataPin = inode(path.join(store, 'data')); cap.identityPin = inode(path.join(store, 'identity'));
      mkdirSync(path.join(envelope, 'exports'), { mode: 0o700 });
    } else {
      const bundle = path.join(parent, 'bundle');
      const created = spawnSync(process.execPath, ['-e', `const {SqliteDatabase}=require(process.argv[1]);const {SqliteBackup}=require(process.argv[2]);new SqliteBackup().create(SqliteDatabase.open(JSON.parse(process.argv[3])),process.argv[4]).catch(()=>process.exitCode=1)`,
        path.join(backend, 'infrastructure/storage/sqlite/sqlite-database.js'), path.join(backend, 'infrastructure/storage/sqlite/sqlite-backup.js'), JSON.stringify({ databaseRoot, identityRoot }), bundle],
        { env: {}, encoding: 'utf8', timeout: 10_000 });
      assert.equal(created.status, 0, created.stderr);
      rmdirSync(store);
      installation.selectedStore = 'd'.repeat(32);
      installation.pendingRestore = { storeId: id, sourceDigest: createHash('sha256').update(readFileSync(path.join(bundle, 'complete.json'))).digest('hex'), expectedSelection: installation.selectedStore, status: 'reserved' };
    }
  }
  const journal = { version: 1, lifecycle: 'active', outcome: 'pending', generation: id, bootId, installationId: id, storeId: id, role: 'prepare', operation: 'initialize', nonceHash: createHash('sha256').update(cap.nonce).digest('hex') };
  journal.role = cap.role; journal.operation = cap.operation;
  if (variant === 'nonce') cap.nonce = 'c'.repeat(64);
  if (variant === 'generation') cap.generation = 'c'.repeat(32);
  if (variant === 'pin') cap.lockPin = { dev: 1, ino: 1 };
  for (const [name, value] of [['installation.json', installation], ['owner.json', journal]]) writeFileSync(path.join(envelope, name), JSON.stringify(value), { mode: 0o600 });
  const message = path.join(parent, 'capability');
  writeFileSync(message, variant === 'oversize' ? 'x'.repeat(17000) : variant === 'partial' ? '{' : JSON.stringify(cap), { mode: 0o600 });
  return { envelope, message };
}
function run(variant, action = 'admit') {
  const f = fixture(variant);
  const result = spawnSync(holder, [f.envelope, variant, process.execPath, path.join(import.meta.dirname, '../fixtures/admission-child.cjs'), guardian, f.message, action], {
    env: {}, encoding: 'utf8', timeout: 20_000, maxBuffer: 16_384,
  });
  if (result.error || !result.stderr.includes('fixture-owned-child-reaped\n')) ownershipUncertain = true;
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('actual inherited descriptor admits, bootstraps and holds the selected SQLite pair', () => {
  assert.deepEqual(run('inherited', 'database'), { admitted: true, database: true });
});
for (const variant of ['reopened', 'wrong-mode', 'regular-pipe', 'nonce', 'generation', 'pin', 'floor', 'oversize', 'partial', 'stall']) {
  test(`denies ${variant} without creating database state or allowing retry`, () => {
    assert.deepEqual(run(variant), { admitted: false, retry: false, exists: false });
  });
}
test('rechecks revocation on already-open native connections while allowing close', () => {
  assert.deepEqual(run('inherited', 'revoke'), { admitted: true, revoked: true, closed: true });
});
test('rechecks journal replacement before an already-open connection can mutate', () => {
  assert.deepEqual(run('inherited', 'journal'), { admitted: true, revoked: true, closed: true });
});
test('a real SQLite coordination worker explicitly inherits admission and exits on release', () => {
  assert.deepEqual(run('inherited', 'worker'), { admitted: true, worker: true });
});
test('a worker cannot replace an already revoked shared flag', () => {
  assert.deepEqual(run('inherited', 'revoked-worker'), { admitted: true, workerDenied: true });
});
test('maintenance backup uses exactly the generation export and releases the worker', () => {
  assert.deepEqual(run('backup', 'backup'), { admitted: true, backup: true });
});
test('pending restore creates its absent pair without changing the selected pointer', () => {
  assert.deepEqual(run('restore', 'restore'), { admitted: true, restored: true, selectedPreserved: true });
});
test('named bootstrap recovery scopes its private scratch validation to the same identity', () => {
  assert.deepEqual(run('recovery', 'recovery'), { admitted: true, recovered: true, scratchRemoved: true });
});
test('backup authority does not allow an arbitrary export destination', () => {
  assert.deepEqual(run('backup', 'backup-escape'), { admitted: true, denied: true, exists: false });
});
test('revocation before admission cannot be cleared by a valid capability', () => {
  assert.deepEqual(run('inherited', 'pre-revoke'), { admitted: false, retry: false, exists: false });
});
test('revocation before COMMIT rolls back through native close and cannot be reused', () => {
  assert.deepEqual(run('inherited', 'revoke-commit'), { admitted: true, revoked: true, closed: true, witnessed: true, rolledBack: true });
});
for (const role of ['application', 'backup', 'resume']) test(`${role} cannot initialize or mutate human identity authority`, () => {
  assert.deepEqual(run(role, 'identity-denied'), { admitted: true, denied: 5, acquired: 0, unchanged: true });
});
test('revocation fences an already acquired identity mutation lease', () => {
  assert.deepEqual(run('admin', 'identity-revoke'), { admitted: true, denied: true, unchanged: true });
});
test('a live admitted worker rolls back a witnessed write and reports its actual exit after revocation', () => {
  assert.deepEqual(run('inherited', 'live-worker-revoke'), { admitted: true, witnessed: true, denied: true, rolledBack: true, exited: true });
});
after(() => {
  if (ownershipUncertain) throw new Error(`Fixture ownership uncertain; preserve ${top}`);
  rmSync(top, { recursive: true, force: true });
});

test('a real PDF child inherits only lifetime authority and proves the original open-file description', () => {
  assert.deepEqual(run('inherited', 'pdf'), { admitted: true, inherited: true });
});
test('storage admission revocation immediately aborts an in-flight real model completion', () => {
  assert.deepEqual(run('application', 'model-revoke'), { admitted: true, denied: true, aborted: true, cancelled: true });
});
test('worker-side authority loss propagates through the shared flag to an active parent completion', () => {
  assert.deepEqual(run('application', 'model-worker-revoke'), { admitted: true, denied: true, aborted: true, cancelled: true });
});
for (const failure of ['malformed', 'missing']) test(`worker admission ${failure} journal aborts parent inference before establishment`, () => {
  assert.deepEqual(run('application', `model-worker-revoke-${failure}`), { admitted: true, denied: true, aborted: true, cancelled: true });
});
test('finite fresh prepare initializes, seeds and explicitly upgrades the selected pair', () => {
  assert.deepEqual(run('inherited', 'prepare-store'), { admitted: true, prepared: true, schema: 2, identityPreserved: true });
});
test('explicit resume seeds and upgrades while preserving the original identity', () => {
  assert.deepEqual(run('resume', 'prepare-store'), { admitted: true, prepared: true, schema: 2, identityPreserved: true });
});
test('application authority cannot invoke even the explicit schema upgrade', () => {
  assert.deepEqual(run('application', 'upgrade-denied'), { admitted: true, denied: true, schema: 1 });
});
test('ordinary ready preparation verifies without changing the database', () => {
  assert.deepEqual(run('verify', 'prepare-readonly'), { admitted: true, unchanged: true });
});
test('managed application startup keeps catalog mutation in finite preparation', () => {
  assert.deepEqual(run('application-ready', 'app-readonly'), { admitted: true, unchanged: true });
});

test('named identity recovery works with an empty canonical identity and denies ordinary mutation',()=>{
  assert.deepEqual(run('identity-recovery','identity-recovery'),{admitted:true,recovered:true,denied:3,empty:true});
});
test('explicit initialization after empty recovery preserves the existing database target',()=>{
  assert.deepEqual(run('recovered-empty','prepare-recovered'),{admitted:true,prepared:true,schema:2,identityPreserved:true,targetPreserved:true});
});

test('named recovery reconciles a valid operation and candidate without a canonical identity',()=>{
  assert.deepEqual(run('identity-candidate','identity-candidate'),{admitted:true,recovered:true,ready:true});
});
test('named recovery removes pre-mutation operation residue and reports an empty pair',()=>{
  assert.deepEqual(run('identity-operation','identity-recovery'),{admitted:true,recovered:true,denied:3,empty:true});
});

test('initialization after recovery refuses existing principals before any identity or schema mutation',()=>{
  assert.deepEqual(run('recovered-occupied','prepare-occupied'),{admitted:true,denied:true,unchanged:true,empty:true});
});
