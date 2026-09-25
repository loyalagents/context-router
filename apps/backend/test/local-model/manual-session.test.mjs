// Qualified boundary suite applied to the actual compiled production modules.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createTlsFixture } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/tls-fixture.mjs';
import { spawnOwned } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/process.mjs';
import { claimManualSession } from '../../dist/infrastructure/local-model/engine/manual-session.mjs';

async function fixture(t, options) {
  const credentials = await createTlsFixture(options);
  const state = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'step06-manual-state-')));
  await fs.mkdir(join(state, 'identity')); await fs.mkdir(join(state, 'database'));
  const root = await fs.realpath(credentials.root);
  let preserve = false;
  t.after(async () => { if (!preserve) { await credentials.remove(); await fs.rm(state, { recursive: true, force: true }); } });
  return { credentials, preserve: () => { preserve = true; },
    config: { root, identityRoot: join(state, 'identity'), databaseRoot: join(state, 'database'), port: 12345 } };
}
const unavailable = /^Error: MODEL_UNAVAILABLE$/;

test('one immutable manual session consumes a fixed claim and reconstruction cannot reuse it', async (t) => {
  const { credentials, config } = await fixture(t);
  const pending = claimManualSession(config); config.port = 23456;
  const session = await pending;
  assert.equal(session.port, 12345); assert.ok(typeof session.certificate === 'string');
  assert.ok(session.apiKey === credentials.apiKey);
  config.port = 23456;
  assert.equal(session.port, 12345);
  assert.throws(() => { session.port = 23456; }, TypeError);
  const claim = join(config.root, 'backend-session.claim');
  assert.equal(await fs.readFile(claim, 'utf8'), 'context-router/local-model-session/v1\n');
  const info = await fs.lstat(claim); assert.equal(info.mode & 0o777, 0o600); assert.equal(info.nlink, 1);
  await assert.rejects(claimManualSession(config), unavailable);
  assert.equal(await fs.readFile(claim, 'utf8'), 'context-router/local-model-session/v1\n');
});

test('concurrent attempts establish at most one durable session', async (t) => {
  const { config } = await fixture(t);
  const results = await Promise.allSettled([claimManualSession(config), claimManualSession(config)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.message === 'MODEL_UNAVAILABLE').length, 1);
  await assert.rejects(claimManualSession(config), unavailable);
});

test('missing, unsafe and oversized credential files reject before creating a claim', async (t) => {
  for (const mode of ['missing-key', 'key-mode', 'root-mode', 'key-link', 'key-hardlink', 'oversized-key', 'bad-key', 'certificate-chain', 'expired']) {
    const { credentials, config } = await fixture(t); const key = join(config.root, 'api-key.txt');
    if (mode === 'missing-key') await fs.rm(key);
    if (mode === 'key-mode') await fs.chmod(key, 0o644);
    if (mode === 'root-mode') await fs.chmod(config.root, 0o755);
    if (mode === 'key-link') { await fs.rm(key); await fs.symlink(join(config.root, 'server-cert.pem'), key); }
    if (mode === 'key-hardlink') await fs.link(key, join(config.root, 'linked-key'));
    if (mode === 'oversized-key') await fs.writeFile(key, 'a'.repeat(10000));
    if (mode === 'bad-key') await fs.writeFile(key, 'not-a-random-key');
    if (mode === 'certificate-chain') await fs.writeFile(join(config.root, 'server-cert.pem'), Buffer.concat([credentials.cert, credentials.cert]));
    await assert.rejects(claimManualSession(config, mode === 'expired' ? { now: Date.now() + 2 * 86400000 } : {}), unavailable);
    await assert.rejects(fs.lstat(join(config.root, 'backend-session.claim')), (error) => error.code === 'ENOENT');
  }
});

test('invalid root overlap, alias, owner and endpoint inputs never establish a session', async (t) => {
  const { config } = await fixture(t);
  const alias = `${config.root}-alias`; await fs.symlink(config.root, alias); t.after(() => fs.rm(alias, { force: true }));
  for (const changed of [{ port: 0 }, { port: '12345' }, { root: alias }, { identityRoot: config.root }, { databaseRoot: config.root }, { root: '/' }]) {
    await assert.rejects(claimManualSession({ ...config, ...changed }), unavailable);
  }
  await assert.rejects(claimManualSession(config, { uid: process.getuid() + 1 }), unavailable);
  await assert.rejects(fs.lstat(join(config.root, 'backend-session.claim')), (error) => error.code === 'ENOENT');
});

test('claim write, file sync, directory sync and recheck failures remain consumed and expose fixed errors', async (t) => {
  for (const phase of ['write', 'file-sync', 'directory-sync', 'recheck']) {
    const { config } = await fixture(t); let created = false;
    const fileSystem = {
      ...fs,
      async open(path, flags, mode) {
        const handle = await fs.open(path, flags, mode);
        if (basename(path) === 'backend-session.claim') created = true;
        return new Proxy(handle, { get(target, key) {
          if ((phase === 'write' && key === 'writeFile' && basename(path) === 'backend-session.claim') ||
              (phase === 'file-sync' && key === 'sync' && basename(path) === 'backend-session.claim') ||
              (phase === 'directory-sync' && key === 'sync' && path === config.root)) return async () => { throw new Error('PRIVATE_FAILURE_PATH'); };
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
      async lstat(path, options) {
        if (phase === 'recheck' && created && basename(path) === 'backend-session.claim') throw new Error('PRIVATE_RECHECK_PATH');
        return fs.lstat(path, options);
      },
    };
    await assert.rejects(claimManualSession(config, { fileSystem }), (error) => {
      assert.equal(error.message, 'MODEL_UNAVAILABLE'); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(created, true); assert.ok((await fs.lstat(join(config.root, 'backend-session.claim'))).isFile());
    await assert.rejects(claimManualSession(config), unavailable);
  }
});

test('every existing claim entry blocks reuse without reading or removing its contents', async (t) => {
  for (const kind of ['empty', 'directory', 'symlink']) {
    const { config } = await fixture(t); const path = join(config.root, 'backend-session.claim');
    if (kind === 'empty') await fs.writeFile(path, '', { mode: 0o600 });
    if (kind === 'directory') await fs.mkdir(path);
    if (kind === 'symlink') await fs.symlink(join(config.root, 'api-key.txt'), path);
    const before = await fs.lstat(path);
    await assert.rejects(claimManualSession(config), unavailable);
    assert.equal((await fs.lstat(path)).ino, before.ino);
  }
});

test('credential growth is bounded and replacement between path check and open is rejected', async (t) => {
  for (const kind of ['growth', 'replacement']) {
    const { config } = await fixture(t); let changed = false; let maximumBuffer = 0;
    const fileSystem = { ...fs, async open(path, flags, mode) {
      if (kind === 'replacement' && basename(path) === 'api-key.txt' && !changed) {
        changed = true; await fs.rename(path, `${path}.old`); await fs.writeFile(path, `${'b'.repeat(64)}\n`, { mode: 0o600 });
      }
      const handle = await fs.open(path, flags, mode);
      return new Proxy(handle, { get(target, key) {
        if (key === 'read' && basename(path) === 'api-key.txt') return async (...args) => {
          maximumBuffer = Math.max(maximumBuffer, args[0].length);
          const result = await target.read(...args);
          if (kind === 'growth' && !changed) { changed = true; await fs.appendFile(path, 'x'.repeat(10000)); }
          return result;
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    await assert.rejects(claimManualSession(config, { fileSystem }), unavailable);
    assert.equal(changed, true); assert.ok(maximumBuffer <= 66);
    await assert.rejects(fs.lstat(join(config.root, 'backend-session.claim')), (error) => error.code === 'ENOENT');
  }
});

test('root-owned sticky temporary ancestry works while writable user-owned ancestry and wrong IP do not', async (t) => {
  const { credentials, config } = await fixture(t);
  const parent = await fs.mkdtemp(join(await fs.realpath(process.platform === 'darwin' ? '/private/tmp' : '/tmp'), 'step06-manual-ancestry-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  for (const name of ['safe', 'unsafe']) {
    const root = join(parent, name); await fs.mkdir(root, { mode: 0o700 });
    await fs.copyFile(join(config.root, 'api-key.txt'), join(root, 'api-key.txt'));
    await fs.copyFile(join(config.root, 'server-cert.pem'), join(root, 'server-cert.pem'));
  }
  assert.ok((await claimManualSession({ ...config, root: join(parent, 'safe') })).apiKey === credentials.apiKey);
  await fs.chmod(parent, 0o777);
  await assert.rejects(claimManualSession({ ...config, root: join(parent, 'unsafe') }), unavailable);
  const wrong = await fixture(t, { ip: '127.0.0.2' });
  await assert.rejects(claimManualSession(wrong.config), unavailable);
});

test('claim remains consumed after the exact owning process crashes', async (t) => {
  const owned = await fixture(t); const { config } = owned; let child;
  const module = new URL('../../dist/infrastructure/local-model/engine/manual-session.mjs', import.meta.url).href;
  const script = `const {claimManualSession}=await import(${JSON.stringify(module)});await claimManualSession(JSON.parse(process.argv[1]));process.on('SIGTERM',()=>{});process.stdout.write('claimed\\n');setInterval(()=>{},1000);`;
  try {
    child = await spawnOwned({ command: process.execPath, args: ['--input-type=module', '-e', script, JSON.stringify(config)],
      cwd: config.databaseRoot, logPath: join(config.databaseRoot, 'claim-child.log'), logLimit: 4096 });
    await child.waitForLog('claimed', 1000);
    assert.equal((await child.stop({ graceMs: 10 })).signal, 'SIGKILL');
    await assert.rejects(claimManualSession(config), unavailable);
    assert.ok((await fs.lstat(join(config.root, 'backend-session.claim'))).isFile());
  } finally {
    try { await child?.stop({ graceMs: 10 }); } catch { owned.preserve(); throw new Error('Claim child cleanup unconfirmed'); }
  }
});
