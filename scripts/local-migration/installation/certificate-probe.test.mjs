import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, writeFile, chmod, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { createServer, get } from 'node:https';
import { createSecureContext } from 'node:tls';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { generateCertificateFixture } from './certificate-generator.mjs';
import { claimManualSession } from './manual-session.mjs';

// Historical P1 snapshot: copied with the then self-contained claim validator into
// the inspected temporary closure. The retained measured snapshot is immutable.
// New product certificate tests use the current complete compiled backend closure;
// copying only today's manual-session.mjs is not a supported executable probe.
const suite = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cert-proof-')));
await chmod(suite, 0o700);
const now = Math.floor(Date.now() / 1000) * 1000;
async function session(name, options = {}) {
  const parent = path.join(suite, name);
  await mkdir(parent, { mode: 0o700 });
  const [root, identityRoot, databaseRoot] = ['session', 'identity', 'data'].map(p => path.join(parent, p));
  for (const p of [root, identityRoot, databaseRoot]) await mkdir(p, { mode: 0o700 });
  const value = await generateCertificateFixture({ now, ...options });
  for (const [name, contents] of [['server-cert.pem', value.certificate], ['server-key.pem', value.privateKey], ['api-key.txt', value.apiKey + '\n']]) {
    const p = path.join(root, name);
    await writeFile(p, contents, { mode: 0o600, flag: 'wx' });
    assert.equal((await lstat(p)).mode & 0o777, 0o600);
  }
  return { ...value, configuration: { root, identityRoot, databaseRoot, port: 1 } };
}

test('P1 local WebCrypto certificate matches existing claim contract and fresh-key boundaries', { timeout: 5000 }, async () => {
  const a = await session('first'), b = await session('second');
  assert.notEqual(a.apiKey, b.apiKey);
  assert.notEqual(a.privateKey, b.privateKey);
  for (const fixture of [a, b]) {
    const cert = new X509Certificate(fixture.certificate);
    assert.equal(cert.ca, true);
    assert.equal(cert.subject, 'CN=ContextRouterLocal');
    assert.equal(cert.issuer, cert.subject);
    assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
    assert.ok(cert.verify(cert.publicKey));
    assert.equal(Date.parse(cert.validFrom), now);
    assert.equal(Date.parse(cert.validTo) - now, 86_400_000);
    const key = createPrivateKey(fixture.privateKey);
    assert.equal(key.asymmetricKeyType, 'ec');
    assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
    assert.deepEqual(createPublicKey(key).export({ type: 'spki', format: 'der' }), cert.publicKey.export({ type: 'spki', format: 'der' }));
    assert.equal((await claimManualSession(fixture.configuration, { now })).apiKey, fixture.apiKey);
    await assert.rejects(claimManualSession(fixture.configuration, { now }), { message: 'MODEL_UNAVAILABLE' });
  }
  assert.throws(() => createSecureContext({ key: a.privateKey, cert: b.certificate }));
});

test('P1 actual validator rejects wrong SAN, expired/future dates, missing CA and loose modes', { timeout: 5000 }, async () => {
  for (const [name, options] of [['san', { ip: '127.0.0.2' }], ['expired', { now: now - 86_400_000 }],
    ['future', { now: now + 60_000 }], ['ca', { ca: false }], ['mode', {}]]) {
    const fixture = await session(name, options);
    if (name === 'mode') await chmod(path.join(fixture.configuration.root, 'server-cert.pem'), 0o644);
    await assert.rejects(claimManualSession(fixture.configuration, { now }), { message: 'MODEL_UNAVAILABLE' });
    await assert.rejects(lstat(path.join(fixture.configuration.root, 'backend-session.claim')), { code: 'ENOENT' });
  }
});

test('P1 Node TLS serves the generated certificate over a pinned loopback connection', { timeout: 5000 }, async () => {
  const fixture = await session('tls');
  const server = createServer({ key: fixture.privateKey, cert: fixture.certificate }, (_req, res) => { res.end('synthetic-ready'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const result = await new Promise((resolve, reject) => {
      const req = get({ hostname: '127.0.0.1', port: server.address().port, path: '/health', ca: fixture.certificate,
        rejectUnauthorized: true, agent: false, timeout: 1000 }, res => {
        let text = ''; res.on('data', data => { text += data; }); res.on('end', () => resolve({ status: res.statusCode, text }));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('TLS probe timeout')));
    });
    assert.deepEqual(result, { status: 200, text: 'synthetic-ready' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('P1 certificate generation runs with external execution and remote network denied', { timeout: 3000 }, async () => {
  assert.ok(spawnSync('/usr/bin/true', { timeout: 500 }).error);
  const socket = createConnection({ host: '192.0.2.1', port: 443 });
  try {
    socket.setTimeout(1000, () => socket.destroy(new Error('network denial unproven')));
    const [error] = await once(socket, 'error');
    assert.equal(error.code, 'EPERM');
  } finally { socket.destroy(); }
});
