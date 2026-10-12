import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, copyFile, rm, chmod, symlink, link, readFile, lstat, cp, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { inventoryPayload, verifyPackage, sealedByteReceipt, validatePackageManifest } from '../../src/package-manifest.mjs';
import { writeSignedFixture, sealFixture, fixtureInfo } from '../fixtures/signed-package.mjs';
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
  const { manifest, manifestFile } = await writeSignedFixture(root);
  const run = () => spawnSync(executable, ['verify-package'], { encoding: 'utf8', env: {}, timeout: 3000 });
  const guard = () => spawnSync(executable, ['guardian', '--root', path.join(root, 'managed-v1'), '--ui-port', '0', '--mcp-port', '0'], { encoding: 'utf8', env: {}, timeout: 3000 });
  return { root, executable, manifest, manifestFile, run, guard };
}
test('native preflight rejects a consistently omitted offline prepare entrypoint',async t=>{
  const f=await fixture(t);await rm(path.join(f.root,'Contents/Resources/desktop/runtime/prepare-store.mjs'));await writeSignedFixture(f.root);assert.equal(f.run().status,1);
});
test('native preflight verifies its complete own bundle before invoking any runtime', async t => {
  const f = await fixture(t), result = f.run();
  assert.equal(f.manifest.version, 2);
  await verifyPackage(f.root, f.manifest);
  const receipt = await sealedByteReceipt(f.root);
  assert.equal(receipt.length, f.manifest.files.length + 1);
  for (const name of ['Contents/MacOS/context-router', 'Contents/_CodeSignature/CodeResources', 'Contents/Resources/package-manifest.json']) {
    const entry = receipt.find(item => item.path === name), bytes = await readFile(path.join(f.root, name));
    assert.equal(entry.kind, 'file'); assert.equal(entry.size, bytes.length);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, distribution: 'local-candidate', source: 'a'.repeat(64), securityEpoch: 1 });
});
for (const variant of ['altered', 'missing', 'extra', 'mode', 'hardlink', 'external-link', 'floor', 'platform', 'metadata', 'missing-required','model-pin', 'v1', 'missing-seal-marker', 'wrong-signature-role', 'wrong-bundle-id']) {
  test(`native package preflight rejects ${variant}`, async t => {
    const f = await fixture(t), file = path.join(f.root, required[0]);
    if (variant === 'altered') await writeFile(file, 'tampered');
    if (variant === 'missing') await rm(file);
    if (variant === 'extra') await writeFile(path.join(f.root, 'Contents/Resources/extra'), 'unlisted');
    if (variant === 'mode') await chmod(file, 0o777);
    if (variant === 'hardlink') await link(file, path.join(f.root, 'Contents/Resources/alias'));
    if (variant === 'external-link') await symlink('/etc/passwd', path.join(f.root, 'Contents/escape'));
    if (variant === 'floor') f.manifest.securityEpoch = 0;
    if (variant === 'platform') f.manifest.arch = 'x64';
    if (variant === 'metadata') f.manifest.files.find(e => e.kind === 'file').size = true;
    if (variant === 'missing-required') { await rm(file); f.manifest.files = await inventoryPayload(f.root, { forSigning: true }); }
    if (variant === 'model-pin') f.manifest.model={...f.manifest.model,sha256:'0'.repeat(64)};
    if (variant === 'v1') f.manifest.version = 1;
    if (variant === 'missing-seal-marker') f.manifest.files = f.manifest.files.filter(e => !e.path.endsWith('/CodeResources'));
    if (variant === 'wrong-signature-role') f.manifest.files.find(e => e.kind === 'signature').executable = false;
    if (variant === 'wrong-bundle-id') {
      await writeFile(path.join(f.root, 'Contents/Info.plist'), fixtureInfo('local.unexpected.app'));
      f.manifest.files = await inventoryPayload(f.root, { forSigning: true });
    }
    if (['floor','platform','metadata','missing-required','model-pin','v1','missing-seal-marker','wrong-signature-role','wrong-bundle-id'].includes(variant)) await writeFile(f.manifestFile, JSON.stringify(f.manifest));
    // Keep the platform seal valid: these assertions must exercise inventory and semantic floors.
    if (!['external-link'].includes(variant)) sealFixture(f.root);
    const result = f.run();
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Managed command unavailable\n');
    assert.equal(f.guard().status, 1);
    await assert.rejects(lstat(path.join(f.root, 'managed-v1')), { code: 'ENOENT' });
    await assert.rejects(verifyPackage(f.root, f.manifest));
  });
}
for (const variant of ['executable', 'seal', 'manifest', 'payload']) {
  test(`package verification rejects post-signing ${variant} changes`, async t => {
    const f = await fixture(t);
    const file = variant === 'executable' ? f.executable : variant === 'seal' ? path.join(f.root, 'Contents/_CodeSignature/CodeResources') : variant === 'manifest' ? f.manifestFile : path.join(f.root, required[0]);
    const bytes = await readFile(file); bytes[variant === 'executable' ? 4096 : bytes.length - 1] ^= 1; await writeFile(file, bytes);
    await assert.rejects(verifyPackage(f.root, f.manifest));
    // Never execute a deliberately corrupted Mach-O; test the native verifier on resource mutations.
    if (variant !== 'executable') {
      assert.equal(f.guard().status, 1);
      await assert.rejects(lstat(path.join(f.root, 'managed-v1')), { code: 'ENOENT' });
    }
  });
}

test('platform seal rejects a valid post-signing manifest source change', async t => {
  const f = await fixture(t);
  f.manifest.source = 'b'.repeat(64);
  await writeFile(f.manifestFile, JSON.stringify(f.manifest));
  assert.deepEqual(JSON.parse(await readFile(f.manifestFile, 'utf8')), f.manifest);
  assert.equal(validatePackageManifest(f.manifest), f.manifest);
  assert.deepEqual(await inventoryPayload(f.root), f.manifest.files);
  await assert.rejects(verifyPackage(f.root, f.manifest));
  for (const result of [f.run(), f.guard()]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Managed command unavailable\n');
  }
  await assert.rejects(lstat(path.join(f.root, 'managed-v1')), { code: 'ENOENT' });

  // The identical valid metadata is accepted once its platform seal is refreshed.
  const changedManifest = await readFile(f.manifestFile);
  sealFixture(f.root);
  assert.deepEqual(await readFile(f.manifestFile), changedManifest);
  await verifyPackage(f.root, f.manifest);
  const result = f.run(); // Verify only; never launch the inert fixture runtime.
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).source, f.manifest.source);
  await assert.rejects(lstat(path.join(f.root, 'managed-v1')), { code: 'ENOENT' });
});

for (const variant of ['executable', 'writable', 'hardlink']) {
  test(`native verifier rejects a sealed resource envelope with unsafe ${variant}`, async t => {
    const f = await fixture(t), seal = path.join(f.root, 'Contents/_CodeSignature/CodeResources');
    if (variant === 'executable') await chmod(seal, 0o755);
    if (variant === 'writable') await chmod(seal, 0o666);
    if (variant === 'hardlink') await link(seal, path.join(f.root, '../' + path.basename(f.root) + '-seal-alias'));
    t.after(() => rm(path.join(f.root, '../' + path.basename(f.root) + '-seal-alias'), { force: true }));
    const platform = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', f.root], { encoding: 'utf8', timeout: 3000 });
    assert.equal(platform.status, 0, platform.stderr);
    assert.equal(f.guard().status, 1);
    await assert.rejects(lstat(path.join(f.root, 'managed-v1')), { code: 'ENOENT' });
    await assert.rejects(verifyPackage(f.root, f.manifest));
  });
}

const artifactPreflight = () => import('../../../../scripts/local-migration/installation/artifact-preflight.mjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function receiptFor(f) {
  const bytes = JSON.stringify({ version: 1, files: await sealedByteReceipt(f.root) }) + '\n';
  const file = path.join(path.dirname(f.root), path.basename(f.root) + '-sealed.json');
  await writeFile(file, bytes, { mode: 0o600 });
  return { file: await realpath(file), sha256: digest(bytes), manifestSha256: digest(await readFile(f.manifestFile)) };
}
test('pinned v2 rehearsal refuses a valid re-sealed executable substitution before bundle execution', async t => {
  const { verifyPinnedArtifact } = await artifactPreflight();
  const f = await fixture(t), pinned = await receiptFor(f);
  t.after(() => rm(pinned.file, { force: true }));
  const options = { manifestSha256: pinned.manifestSha256, sealedPayload: pinned.file, sealedPayloadSha256: pinned.sha256 };
  await verifyPinnedArtifact(f.root, options);
  await assert.rejects(verifyPinnedArtifact(f.root, { manifestSha256: pinned.manifestSha256 }));
  await assert.rejects(verifyPinnedArtifact(f.root, { ...options, sealedPayloadSha256: '0'.repeat(64) }));
  const bytes = await readFile(f.executable); bytes[4096] ^= 1; await writeFile(f.executable, bytes); sealFixture(f.root);
  assert.equal(digest(await readFile(f.manifestFile)), pinned.manifestSha256);
  await verifyPackage(f.root, f.manifest); // A self-consistent ad-hoc seal does not establish reviewed artifact identity.
  let executed = false;
  await assert.rejects(verifyPinnedArtifact(f.root, options).then(() => { executed = true; }));
  assert.equal(executed, false);
  const other = await fixture(t);
  await writeFile(path.join(other.root, required[0]), 'different inert fixture');
  await writeSignedFixture(other.root, manifest => { manifest.source = 'b'.repeat(64); });
  const otherPin = await receiptFor(other); t.after(() => rm(otherPin.file, { force: true }));
  const output = path.join('/private/tmp', path.basename(f.root) + '-rehearsal');
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../../../../scripts/local-migration/installation/pilot-rehearsal.mjs'),
    '--from', await realpath(f.root), '--to', await realpath(other.root), '--out', output,
    '--from-manifest', pinned.manifestSha256, '--to-manifest', otherPin.manifestSha256,
    '--from-sealed-payload', pinned.file, '--from-sealed-payload-sha256', pinned.sha256,
    '--to-sealed-payload', otherPin.file, '--to-sealed-payload-sha256', otherPin.sha256],
    { env: { PATH: '', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /Pinned artifact verification failed/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});
test('trusted local capture pins every copied replacement before the smoke can execute it', async t => {
  const { captureTrustedArtifact, verifyCapturedArtifact } = await artifactPreflight();
  const f = await fixture(t), expected = await captureTrustedArtifact(f.root);
  const copy = f.root + '-copy'; t.after(() => rm(copy, { recursive: true, force: true }));
  for (const phase of ['initial', 'replacement', 'reinstall']) {
    await cp(f.root, copy, { recursive: true, verbatimSymlinks: true });
    await verifyCapturedArtifact(copy, expected);
    const executable = path.join(copy, 'Contents/MacOS/context-router'), bytes = await readFile(executable);
    bytes[4096] ^= 1; await writeFile(executable, bytes); sealFixture(copy);
    await verifyPackage(copy, f.manifest);
    await assert.rejects(verifyCapturedArtifact(copy, expected), phase);
    await rm(copy, { recursive: true });
  }
});
test('legacy live proposal refuses v2 before creating state or reading model assets', async t => {
  const { assertLegacyLiveManifest } = await artifactPreflight();
  assert.throws(() => assertLegacyLiveManifest(Buffer.from('{"version":2}')));
  assert.doesNotThrow(() => assertLegacyLiveManifest(Buffer.from('{"version":1}')));
  const f = await fixture(t), proposal = f.root + '-proposal.json', temp = f.root + '-temp';
  t.after(() => rm(proposal, { force: true })); t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(temp, { mode: 0o700 });
  await writeFile(proposal, JSON.stringify({ artifact: f.root, manifestSha256: digest(await readFile(f.manifestFile)),
    series: 'step09-installed-live-v1', maxGenerations: 3, maxRequests: 3, maxCompletionTokens: 2048, totalSeconds: 900 }));
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../../../../scripts/local-migration/installation/live-installed.mjs'), proposal],
    { env: { PATH: '', LC_ALL: 'C', TMPDIR: temp }, encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /Legacy live proposal requires manifest v1/);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(temp), []);
});
