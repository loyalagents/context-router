import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, copyFile, rm, chmod, symlink, link } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createPackageManifest, inventoryPayload } from '../../src/package-manifest.mjs';
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
const required = ['Contents/Resources/bin/node', 'Contents/Resources/model/llama-server', 'Contents/Resources/app/local-ui.mjs',
  ...['prepare', 'prepare-store', 'application', 'maintenance', 'download'].map(name => `Contents/Resources/desktop/runtime/${name}.mjs`)];
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-native-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'Contents/MacOS/context-router');
  await mkdir(path.dirname(executable), { recursive: true });
  await copyFile(path.resolve(import.meta.dirname, '../../build/context-router'), executable);
  for (const name of required) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), 'fixture never executed', { mode: name.endsWith('.mjs') ? 0o644 : 0o755 });
  }
  await symlink('prepare.mjs', path.join(root, 'Contents/Resources/desktop/runtime/internal-link'));
  const manifest = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(root) });
  const manifestFile = path.join(root, 'Contents/Resources/package-manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  const run = () => spawnSync(executable, ['verify-package'], { encoding: 'utf8', env: {}, timeout: 3000 });
  return { root, manifest, manifestFile, run };
}
test('native preflight rejects a consistently omitted offline prepare entrypoint',async t=>{
  const f=await fixture(t);await rm(path.join(f.root,'Contents/Resources/desktop/runtime/prepare-store.mjs'));f.manifest.files=await inventoryPayload(f.root);await writeFile(f.manifestFile,JSON.stringify(f.manifest));assert.equal(f.run().status,1);
});
test('native preflight verifies its complete own bundle before invoking any runtime', async t => {
  const f = await fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, distribution: 'local-candidate', source: 'a'.repeat(64), securityEpoch: 1 });
});
for (const variant of ['altered', 'missing', 'extra', 'mode', 'hardlink', 'external-link', 'floor', 'platform', 'metadata', 'missing-required','model-pin']) {
  test(`native package preflight rejects ${variant}`, async t => {
    const f = await fixture(t), file = path.join(f.root, required[0]);
    if (variant === 'altered') await writeFile(file, 'tampered');
    if (variant === 'missing') await rm(file);
    if (variant === 'extra') await writeFile(path.join(f.root, 'Contents/extra'), 'unlisted');
    if (variant === 'mode') await chmod(file, 0o777);
    if (variant === 'hardlink') await link(file, path.join(f.root, 'Contents/alias'));
    if (variant === 'external-link') await symlink('/etc/passwd', path.join(f.root, 'Contents/escape'));
    if (variant === 'floor') f.manifest.securityEpoch = 0;
    if (variant === 'platform') f.manifest.arch = 'x64';
    if (variant === 'metadata') f.manifest.files[0].size = true;
    if (variant === 'missing-required') { await rm(file); f.manifest.files = await inventoryPayload(f.root); }
    if (variant === 'model-pin') f.manifest.model={...f.manifest.model,sha256:'0'.repeat(64)};
    if (['floor','platform','metadata','missing-required','model-pin'].includes(variant)) await writeFile(f.manifestFile, JSON.stringify(f.manifest));
    const result = f.run();
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Managed command unavailable\n');
  });
}
