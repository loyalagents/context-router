import assert from 'node:assert/strict';
import test from 'node:test';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse } from 'yaml';
import { generateModelCertificate } from '../runtime/certificate.mjs';

test('product session certificate is fresh one-day P-256 CA with only literal loopback SAN', async () => {
  const a = await generateModelCertificate(), b = await generateModelCertificate();
  assert.notEqual(a.apiKey, b.apiKey); assert.notEqual(a.privateKey, b.privateKey);
  for (const value of [a,b]) {
    assert.match(value.apiKey, /^[a-f0-9]{64}$/);
    const cert = new X509Certificate(value.certificate), key = createPrivateKey(value.privateKey);
    assert.equal(cert.ca, true); assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal(cert.subjectAltName, 'IP Address:127.0.0.1'); assert.equal(cert.verify(cert.publicKey), true);
    assert.equal(Date.parse(cert.validTo) - Date.parse(cert.validFrom), 86_400_000);
    assert.ok(Date.parse(cert.validFrom) <= Date.now()); assert.ok(Date.parse(cert.validFrom) > Date.now() - 5000);
    assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
    assert.deepEqual(createPublicKey(key).export({ type: 'spki', format: 'der' }), cert.publicKey.export({ type: 'spki', format: 'der' }));
  }
});
test('installed certificate dependency graph and lock integrities match the inspected exact closure', () => {
  const expected = JSON.parse(readFileSync(new URL('../certificate-closure.json', import.meta.url))).packages;
  const lock = parse(readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  const found = new Map();
  function visit(name, from) {
    const require = createRequire(from);
    let dir = path.dirname(realpathSync(require.resolve(name)));
    while (dir !== path.dirname(dir)) {
      const file = path.join(dir, 'package.json');
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file));
        if (pkg.name === name) {
          const id = `${pkg.name}@${pkg.version}`;
          if (found.has(id)) return;
          found.set(id, dir);
          for (const child of Object.keys(pkg.dependencies ?? {})) visit(child, file);
          return;
        }
      }
      dir = path.dirname(dir);
    }
    assert.fail('package root missing');
  }
  for (const name of ['@peculiar/x509', 'reflect-metadata']) visit(name, new URL('../package.json', import.meta.url));
  assert.deepEqual([...found.keys()].sort(), expected.map(p => `${p.name}@${p.version}`).sort());
  for (const p of expected) {
    const id = `${p.name}@${p.version}`;
    assert.equal(lock.packages[id].resolution.integrity, p.integrity);
    for (const license of p.licenseFiles) assert.ok(existsSync(path.join(found.get(id), license)));
  }
});
