// P1-V only. Copied beside the inspected temporary package; never shipped.
import assert from 'node:assert/strict';
import * as openpgp from './package/dist/node/openpgp.mjs';

export async function verifyArchiveRecord(cleartextMessage, armoredKey, fingerprint, basename) {
  const key = await openpgp.readKey({ armoredKey });
  if (key.getFingerprint().toUpperCase() !== fingerprint) throw new Error('untrusted signer');
  const message = await openpgp.readCleartextMessage({ cleartextMessage });
  const verified = await openpgp.verify({ message, verificationKeys: key, expectSigned: true });
  assert.equal(verified.signatures.length, 1);
  await verified.signatures[0].verified;
  assert.equal(typeof verified.data, 'string');
  const records = verified.data.split(/\r?\n/).filter(line => line.includes(basename));
  assert.equal(records.length, 1);
  assert.equal(basename, 'node-v24.21.0-darwin-arm64.tar.xz');
  assert.match(records[0], /^[a-f0-9]{64}  node-v24\.21\.0-darwin-arm64\.tar\.xz$/);
  return records[0].slice(0, 64);
}
