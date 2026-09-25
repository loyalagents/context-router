import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, chmod, lstat, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stagePdfLayout, describePdfLayout, verifyPdfLayout, pdfSandboxProfile } from './fixtures/local-model-feasibility/pdf-stage.mjs';

async function inputs(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'step06-pdf-stage-test-')));
  t.after(async () => {
    for (const directory of ['', 'node_modules', 'node_modules/pdfjs-dist', 'node_modules/pdfjs-dist/legacy', 'node_modules/pdfjs-dist/legacy/build']) {
      await chmod(join(root, 'sealed', directory), 0o700).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  });
  const sourceRoot = join(root, 'input'); const packageRoot = join(root, 'package');
  for (const [base, files] of [[sourceRoot, ['pdf.mjs', 'pdf-worker.mjs']], [packageRoot, ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs']]]) {
    for (const file of files) {
      const path = join(base, file); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file === 'package.json' ? JSON.stringify({ version: '6.3.289' }) : `fixed ${file}\n`);
    }
  }
  return { root, sourceRoot, packageRoot };
}

test('stages only the pinned parser closure as independent regular files and verifies sealed inventory', async (t) => {
  const input = await inputs(t); const target = join(input.root, 'sealed');
  const record = await stagePdfLayout({ ...input, target, sealed: true });
  assert.equal(record.files.length, 7);
  assert.equal(record.files.some((file) => /canvas|\.node$/.test(file.path)), false);
  assert.ok(record.files.every((file) => file.mode === 0o400));
  assert.equal((await lstat(target)).mode & 0o777, 0o500);
  assert.notEqual((await lstat(join(target, 'pdf.mjs'))).ino, (await lstat(join(input.sourceRoot, 'pdf.mjs'))).ino);
  assert.equal(await readFile(join(target, 'pdf.mjs'), 'utf8'), 'fixed pdf.mjs\n');
  await verifyPdfLayout(target, record);
  await chmod(join(target, 'pdf.mjs'), 0o600); await writeFile(join(target, 'pdf.mjs'), 'changed');
  await assert.rejects(verifyPdfLayout(target, record), /^Error: PDF layout failed$/);
  // Explicit fixture cleanup restores only this owned sealed tree's directory modes.
  for (const directory of record.directories) await chmod(join(target, directory.path), 0o700);
});

test('symlinks, unexpected files, wrong versions and reused target directories cannot qualify a layout', async (t) => {
  const input = await inputs(t); const target = join(input.root, 'source');
  await writeFile(join(input.packageRoot, 'package.json'), '{"version":"different"}');
  await assert.rejects(stagePdfLayout({ ...input, target }), /^Error: PDF layout failed$/);
  await writeFile(join(input.packageRoot, 'package.json'), '{"version":"6.3.289"}');
  await rm(join(input.sourceRoot, 'pdf.mjs')); await symlink(join(input.packageRoot, 'LICENSE'), join(input.sourceRoot, 'pdf.mjs'));
  await assert.rejects(stagePdfLayout({ ...input, target: join(input.root, 'linked') }), /^Error: PDF layout failed$/);
  await rm(join(input.sourceRoot, 'pdf.mjs')); await writeFile(join(input.sourceRoot, 'pdf.mjs'), 'fixed');
  const valid = join(input.root, 'valid'); await stagePdfLayout({ ...input, target: valid });
  await assert.rejects(stagePdfLayout({ ...input, target: valid }), /^Error: PDF layout failed$/);
  await writeFile(join(valid, 'extra.node'), 'native');
  await assert.rejects(describePdfLayout(valid), /^Error: PDF layout failed$/);
});

test('parser sandbox denies all networking and the exact excluded read roots', () => {
  const profile = pdfSandboxProfile(['/private/source', '/private/model-assets']);
  assert.ok(profile.includes('(deny network*)'));
  assert.ok(profile.includes('(deny file-read* (subpath "/private/source") (subpath "/private/model-assets"))'));
  assert.ok(profile.includes('(deny mach-lookup (global-name "com.apple.dnssd.service"))'));
  assert.ok(!profile.includes('allow network'));
  for (const paths of [['/'], ['relative'], ['/private/../root'], ['/private/evil"syntax']]) assert.throws(() => pdfSandboxProfile(paths), /^Error: PDF layout failed$/);
});
