import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, chmod, realpath, lstat, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateReceipt, copyVerified, releaseMetadata } from '../../../scripts/local-migration/installation/assisted-alpha-kit.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40);
const receipt = () => ({
  version: 1, status: 'packaged', distribution: 'local-candidate', callerIntegrity: true,
  source: { headSha: source, dirty: false, copiedInputsSha256: 'b'.repeat(64) },
  archive: { path: '/private/build/Context Router.local-candidate.zip', bytes: 100, sha256: 'c'.repeat(64) },
  bundle: { path: '/private/build/Context Router.app', bytes: 200, manifestSha256: 'd'.repeat(64),
    sealedPayload: { path: '/private/build/sealed-payload.json', sha256: 'e'.repeat(64) } },
  buildWorkspace: '/private/operator/workspace', privateCanary: 'never-share-this',
});

test('kit refuses dirty, mismatched, failed or incomplete package evidence', () => {
  assert.doesNotThrow(() => validateReceipt(receipt(), source));
  for (const alter of [
    r => { r.source.headSha = 'f'.repeat(40); },
    r => { r.source.dirty = true; },
    r => { r.status = 'failed'; },
    r => { r.callerIntegrity = false; },
    r => { delete r.bundle.sealedPayload; },
    r => { r.archive.sha256 = 'wrong'; },
    r => { r.source.copiedInputsSha256 = null; },
    r => { r.archive.bytes = -1; },
  ]) {
    const value = receipt(); alter(value);
    assert.throws(() => validateReceipt(value, source));
  }
});

test('shareable release metadata uses an allowlist and makes no qualification claim', () => {
  const result = releaseMetadata(receipt(), '1'.repeat(64));
  const text = JSON.stringify(result);
  assert.equal(text.includes('/private/'), false);
  assert.equal(text.includes('never-share-this'), false);
  assert.equal(result.source.headSha, source);
  assert.equal(result.buildReceiptSha256, '1'.repeat(64));
  assert.equal(result.acceptance, 'pending; see operator handoff');
  assert.equal(result.resetRelease, false);
  assert.equal(result.node.version, '24.21.0');
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'alpha-kit-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input');
  await writeFile(input, 'synthetic-public-artifact', { mode: 0o600 });
  return { root, input, output: path.join(root, 'copy'), expected: sha('synthetic-public-artifact') };
}
test('verified copies retain exact bytes, become read-only, and never replace destinations', async t => {
  const f = await fixture(t);
  await copyVerified(f.input, f.output, f.expected);
  assert.equal(await readFile(f.output, 'utf8'), 'synthetic-public-artifact');
  assert.equal((await lstat(f.output)).mode & 0o777, 0o400);
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  assert.equal(await readFile(f.output, 'utf8'), 'synthetic-public-artifact');
});
test('tampered input never becomes a verified output', async t => {
  const f = await fixture(t);
  await writeFile(f.input, 'tampered');
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});
test('input aliases, writable files and non-files are refused', async t => {
  const f = await fixture(t);
  await symlink(f.input, path.join(f.root, 'alias'));
  await assert.rejects(copyVerified(path.join(f.root, 'alias'), f.output, f.expected));
  await chmod(f.input, 0o666);
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  await mkdir(path.join(f.root, 'directory'));
  await assert.rejects(copyVerified(path.join(f.root, 'directory'), f.output, f.expected));
});
test('multiply linked inputs are refused', async t => {
  const f = await fixture(t);
  await link(f.input, path.join(f.root, 'hardlink'));
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
});
