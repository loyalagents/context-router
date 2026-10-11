import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, link, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inventoryPayload, createPackageManifest, verifyPackage } from '../src/package-manifest.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Contents/Resources/lib'), { recursive: true });
  await mkdir(path.join(root, 'Contents/MacOS'), { recursive: true });
  await writeFile(path.join(root, 'Contents/MacOS/context-router'), 'fixture executable', { mode: 0o755 });
  await writeFile(path.join(root, 'Contents/Resources/lib/module.js'), 'module.exports = 1;');
  await symlink('lib/module.js', path.join(root, 'Contents/Resources/module.js'));
  return root;
}
test('inventory is deterministic, covers the real closure and permits only internal symlinks', async t => {
  const root = await fixture(t);
  const entries = await inventoryPayload(root);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries, await inventoryPayload(root));
  assert.equal(entries[0].executable, true);
  const manifest = createPackageManifest({ source: 'a'.repeat(64), files: entries });
  await verifyPackage(root, manifest);
  await writeFile(path.join(root, 'Contents/Resources/lib/module.js'), 'module.exports = 2;');
  await assert.rejects(verifyPackage(root, manifest));
});
for (const variant of ['extra', 'missing', 'external-link', 'hard-link', 'writable-code']) {
  test(`fails closed on ${variant}`, async t => {
    const root = await fixture(t);
    const manifest = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(root) });
    if (variant === 'extra') await writeFile(path.join(root, 'Contents/Resources/extra.js'), 'new');
    if (variant === 'missing') await rm(path.join(root, 'Contents/Resources/module.js'));
    if (variant === 'external-link') await symlink('/etc/passwd', path.join(root, 'Contents/Resources/escape'));
    if (variant === 'hard-link') await link(path.join(root, 'Contents/Resources/lib/module.js'), path.join(root, 'Contents/Resources/alias'));
    if (variant === 'writable-code') await chmod(path.join(root, 'Contents/MacOS/context-router'), 0o777);
    await assert.rejects(verifyPackage(root, manifest));
  });
}
test('manifest support, epoch, exact fields and canonical path grammar are enforced', async t => {
  const root = await fixture(t);
  const original = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(root) });
  for (const alter of [m => { m.securityEpoch = 0; }, m => { m.platform = 'linux'; }, m => { m.arch = 'x64'; },
    m => { m.distribution = 'signed'; }, m => { m.extra = true; }, m => { m.files[0].path = '../escape'; },
    m => { m.files.push(m.files[0]); }, m => { m.files[0].sha256 = 'bad'; }]) {
    const manifest = structuredClone(original); alter(manifest);
    await assert.rejects(verifyPackage(root, manifest));
  }
});
