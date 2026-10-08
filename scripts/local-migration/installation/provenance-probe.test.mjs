import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { verifyArchiveRecord } from './provenance-verifier.mjs';

// Copied to inspected P1-V temporary closure; host runtime is independently trusted.
const key = await readFile(new URL('./key.asc', import.meta.url), 'utf8');
const signed = await readFile(new URL('./checksums.asc', import.meta.url), 'utf8');
const fingerprint = '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356';
const basename = 'node-v24.21.0-darwin-arm64.tar.xz';
const checksum = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe';
const archive = '/Users/lucasnovak/.nvm/.cache/bin/node-v24.21.0-darwin-arm64/' + basename;

test('authentic official signature selects the sole fixed archive entry and matches cached bytes', { timeout: 10_000 }, async () => {
  assert.equal(process.execPath, '/Users/lucasnovak/.nvm/versions/node/v24.21.0/bin/node');
  assert.equal(process.version, 'v24.21.0');
  assert.equal(await verifyArchiveRecord(signed, key, fingerprint, basename), checksum);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), checksum);
});
test('tampered signed checksum is rejected', { timeout: 10_000 }, async () => {
  assert.ok(signed.includes(checksum));
  await assert.rejects(verifyArchiveRecord(signed.replace(checksum, '0'.repeat(64)), key, fingerprint, basename));
});
test('wrong key fingerprint is rejected before accepting signed content', { timeout: 10_000 }, async () => {
  await assert.rejects(verifyArchiveRecord(signed, key, '0'.repeat(40), basename), /untrusted signer/);
});
test('verifier cannot execute children or access remote network', { timeout: 3000 }, async () => {
  assert.ok(spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 500 }).error);
  assert.ok(spawnSync('/usr/bin/true', { timeout: 500 }).error);
  const socket = createConnection({ host: '192.0.2.1', port: 443 });
  try {
    socket.setTimeout(1000, () => socket.destroy(new Error('network denial unproved')));
    const [error] = await once(socket, 'error');
    assert.equal(error.code, 'EPERM');
  } finally { socket.destroy(); }
});
