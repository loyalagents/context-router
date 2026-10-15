import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, link, chmod, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { inventoryPayload, createPackageManifest, verifyPackage, validatePackageManifest } from '../src/package-manifest.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Contents/Resources/lib'), { recursive: true });
  await mkdir(path.join(root, 'Contents/MacOS'), { recursive: true });
  await mkdir(path.join(root, 'Contents/_CodeSignature'));
  await writeFile(path.join(root, 'Contents/_CodeSignature/CodeResources'), 'synthetic unsigned envelope');
  await writeFile(path.join(root, 'Contents/MacOS/context-router'), 'fixture executable', { mode: 0o755 });
  await writeFile(path.join(root, 'Contents/Resources/lib/module.js'), 'module.exports = 1;');
  await symlink('lib/module.js', path.join(root, 'Contents/Resources/module.js'));
  return root;
}
test('inventory is deterministic, covers the real closure and permits only internal symlinks', async t => {
  const root = await fixture(t);
  const entries = await inventoryPayload(root);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries, await inventoryPayload(root));
  assert.equal(entries[0].executable, true);
  const manifest = createPackageManifest({ source: 'a'.repeat(64), files: entries });
  assert.equal(manifest.version, 2);
  assert.deepEqual(entries.filter(e => e.kind === 'signature'), [
    { path: 'Contents/MacOS/context-router', kind: 'signature', executable: true },
    { path: 'Contents/_CodeSignature/CodeResources', kind: 'signature', executable: false },
  ]);
  validatePackageManifest(manifest);
  await writeFile(path.join(root, 'Contents/Resources/package-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyPackage(root, manifest), 'matching markers do not establish a valid platform seal');
  await writeFile(path.join(root, 'Contents/Resources/lib/module.js'), 'module.exports = 2;');
  assert.notDeepEqual(await inventoryPayload(root), manifest.files);
});
test('only two fixed signature markers are allowed, both are mandatory and have exact roles', async t => {
  const root = await fixture(t);
  const original = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(root) });
  for (const alter of [
    m => { m.version = 1; },
    m => { m.files = m.files.filter(f => f.path !== 'Contents/_CodeSignature/CodeResources'); },
    m => { m.files.find(f => f.kind === 'signature').sha256 = 'b'.repeat(64); },
    m => { m.files.find(f => f.kind === 'signature').executable = false; },
    m => { m.files.find(f => f.path.endsWith('module.js')).kind = 'signature'; },
    m => { m.files.find(f => f.path.endsWith('CodeResources')).path = 'Contents/_CodeSignature/Other'; },
  ]) {
    const manifest = structuredClone(original); alter(manifest);
    assert.throws(() => validatePackageManifest(manifest));
  }
});
test('only explicit pre-signing inventory permits a not-yet-created resource envelope', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'Contents/_CodeSignature/CodeResources'));
  await assert.rejects(inventoryPayload(root));
  const entries = await inventoryPayload(root, { forSigning: true });
  assert.equal(entries.filter(e => e.kind === 'signature').length, 2);
});
for (const variant of ['missing', 'directory', 'link', 'hardlink', 'writable', 'executable', 'empty', 'extra']) {
  test(`signature envelope fails closed on ${variant}`, async t => {
    const root = await fixture(t), file = path.join(root, 'Contents/_CodeSignature/CodeResources');
    if (['missing', 'directory', 'link'].includes(variant)) await rm(file);
    if (variant === 'directory') await mkdir(file);
    if (variant === 'link') await symlink('../Resources/lib/module.js', file);
    if (variant === 'hardlink') await link(file, path.join(root, 'Contents/Resources/alias'));
    if (variant === 'writable') await chmod(file, 0o666);
    if (variant === 'executable') await chmod(file, 0o755);
    if (variant === 'empty') await writeFile(file, '');
    if (variant === 'extra') await writeFile(path.join(root, 'Contents/_CodeSignature/extra'), 'unlisted');
    await assert.rejects(inventoryPayload(root));
  });
}
test('legacy verification is explicit and binds raw manifest bytes to its independent pin', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'Contents/_CodeSignature'), { recursive: true });
  const files = [];
  for (const name of ['Contents/MacOS/context-router', 'Contents/Resources/lib/module.js']) {
    const bytes = await readFile(path.join(root, name));
    files.push({ path: name, kind: 'file', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), executable: name.includes('/MacOS/') });
  }
  files.push({ path: 'Contents/Resources/module.js', kind: 'symlink', target: 'lib/module.js' });
  const current = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(root, { forSigning: true }) });
  const legacy = { ...current, version: 1, securityEpoch: 1, files }, bytes = JSON.stringify(legacy);
  await writeFile(path.join(root, 'Contents/Resources/package-manifest.json'), bytes);
  await assert.rejects(verifyPackage(root, legacy));
  const { verifyLegacyPackage } = await import('../src/legacy-package-manifest.mjs');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await verifyLegacyPackage(root, digest), legacy);
  const { verifyPinnedArtifact, captureTrustedArtifact, verifyCapturedArtifact } = await import('../../../scripts/local-migration/installation/artifact-preflight.mjs');
  assert.deepEqual(await verifyPinnedArtifact(root, { manifestSha256: digest }), legacy);
  const captured = await captureTrustedArtifact(root);
  await verifyCapturedArtifact(root, captured);
  assert.equal(captured.files.length, legacy.files.length + 1);
  await assert.rejects(verifyPinnedArtifact(root, { manifestSha256: '0'.repeat(64) }));
  await assert.rejects(verifyLegacyPackage(root, '0'.repeat(64)));
  await assert.rejects(verifyLegacyPackage(root));
  await writeFile(path.join(root, 'Contents/Resources/lib/module.js'), 'tampered');
  await assert.rejects(verifyLegacyPackage(root, digest));
  await assert.rejects(verifyCapturedArtifact(root, captured));
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
