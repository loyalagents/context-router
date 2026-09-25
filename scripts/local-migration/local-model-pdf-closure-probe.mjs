import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PdfProcess } from './fixtures/local-model-feasibility/pdf-process.mjs';
import { stagePdfLayout, verifyPdfLayout, pdfSandboxProfile } from './fixtures/local-model-feasibility/pdf-stage.mjs';
import { spawnOwned } from './fixtures/local-model-feasibility/process.mjs';
import { greekPdfFixture, emptyPdfFixture, standardFontPdfFixture, encryptedPdfFixture, imageOnlyPdfFixture } from './fixtures/local-model-feasibility/pdf-fixtures.mjs';

const evidence = '/private/tmp/step06-evidence';
const assets = '/private/tmp/context-router-step06-assets';
const repository = await realpath(process.cwd());
const originalRepository = '/Users/lucasnovak/loyal-agents/context-router';
const sourceRoot = resolve('scripts/local-migration/fixtures/local-model-feasibility');
const packageRoot = join(assets, 'pdfjs-dist-6.3.289/package');
const testedRevision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('/usr/bin/git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit probe inputs before live measurement');
const run = `pdf-closure-${Date.now()}`;
const receipt = { run, testedRevision, node: process.version, passed: false, layouts: [], cases: [] };
let root; let cleanupSafe = true;
const records = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function command(profile, name, binary, args) {
  let child;
  try {
    const logPath = join(root, `${name}.jsonl`);
    child = await spawnOwned({ command: '/usr/bin/sandbox-exec', args: ['-p', profile, binary, ...args],
      cwd: root, logPath, logLimit: 4096 });
    const outcome = await Promise.race([child.exited, delay(10000, null, { ref: false })]);
    if (!outcome || outcome.code !== 0 || child.logOverflow) throw new Error();
    return JSON.parse(await readFile(logPath, 'utf8'));
  } finally {
    try { await child?.stop(); if (child?.running) throw new Error(); }
    catch { cleanupSafe = false; throw new Error('PDF closure cleanup failed'); }
  }
}

try {
  const archive = join(assets, 'pdfjs-dist-6.3.289.tgz');
  const bytes = await readFile(archive);
  assert.equal(bytes.length, 8503425);
  assert.equal(createHash('sha512').update(bytes).digest('base64'), 'ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==');
  for (const file of ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs']) {
    const archived = execFileSync('/usr/bin/tar', ['-xOf', archive, `package/${file}`], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' } });
    assert.equal(sha256(await readFile(join(packageRoot, file))), sha256(archived));
  }
  root = await realpath(await mkdtemp(join(evidence, 'pdf-closure-owned-')));
  for (const file of ['offline-controls.mjs', 'pdf-offline-controls.mjs']) await copyFile(join(sourceRoot, file), join(root, file));
  const source = join(root, 'source-layout');
  const relocated = join(root, 'relocated-layout');
  const sourceInventory = await stagePdfLayout({ target: source, sourceRoot, packageRoot });
  records.push({ root: source, inventory: sourceInventory });
  const relocatedInventory = await stagePdfLayout({ target: relocated, sourceRoot: source,
    packageRoot: join(source, 'node_modules/pdfjs-dist'), sealed: true });
  records.push({ root: relocated, inventory: relocatedInventory });
  assert.deepEqual(sourceInventory.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    relocatedInventory.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })));
  const greek = await greekPdfFixture();
  const cases = [
    { name: 'repository-i9', bytes: await readFile('examples/eval/forms/i-9/form.pdf'), contains: 'Employment Eligibility Verification' },
    { name: 'embedded-greek', bytes: Buffer.from(greek.bytes), exact: greek.expectedText },
    { name: 'auxiliary-standard-font', bytes: await standardFontPdfFixture(), error: 'PDF_AUXILIARY' },
    { name: 'encrypted-password', bytes: encryptedPdfFixture('fixture-user'), error: 'PDF_ENCRYPTED' },
    { name: 'encrypted-empty-password', bytes: encryptedPdfFixture(''), error: 'PDF_ENCRYPTED' },
    { name: 'malformed', bytes: Buffer.from('not a PDF'), error: 'PDF_INVALID' },
    { name: 'empty', bytes: await emptyPdfFixture(1), error: 'PDF_EMPTY' },
    { name: 'image-only', bytes: await imageOnlyPdfFixture(), error: 'PDF_EMPTY' },
    { name: 'page-limit', bytes: await emptyPdfFixture(51), error: 'PDF_LIMIT' },
    { name: 'input-byte-limit', bytes: Buffer.alloc(10 * 1024 * 1024 + 1), error: 'PDF_LIMIT' },
    { name: 'text-byte-limit', bytes: Buffer.from((await greekPdfFixture(20000)).bytes), error: 'PDF_LIMIT' },
  ];
  for (const [name, layout, inventory] of [['source-derived', source, sourceInventory], ['sealed-relocated', relocated, relocatedInventory]]) {
    const deniedRoots = [repository, originalRepository, assets, ...(name === 'sealed-relocated' ? [source] : [])];
    const deniedFiles = [join(repository, 'README.md'), join(originalRepository, 'README.md'), join(packageRoot, 'package.json'),
      ...(name === 'sealed-relocated' ? [join(source, 'pdf.mjs')] : [])];
    const profile = pdfSandboxProfile(deniedRoots);
    const controls = await command(profile, `${name}-controls`, process.execPath,
      ['--no-global-search-paths', join(root, 'pdf-offline-controls.mjs'), JSON.stringify(deniedFiles), join(layout, 'node_modules/pdfjs-dist/package.json')]);
    assert.equal(controls.passed, true);
    const dns = await command(profile, `${name}-dns`, join(evidence, 'dns-control'), []);
    assert.equal(dns.machLookupResult, dns.permissionDeniedCode); assert.notEqual(dns.nativeLookupResult, 0);
    const parser = new PdfProcess({ workerPath: join(layout, 'pdf-worker.mjs'), sandboxProfile: profile });
    try {
      for (const item of cases) {
        const started = performance.now(); const entry = { layout: name, case: item.name, inputBytes: item.bytes.length, inputSha256: sha256(item.bytes), passed: false };
        receipt.cases.push(entry);
        if (item.error) { await assert.rejects(parser.parse(item.bytes), (error) => error.message === item.error); entry.error = item.error; }
        else {
          const value = await parser.parse(item.bytes);
          if (item.exact) assert.equal(value.text, item.exact); else assert.ok(value.text.includes(item.contains));
          assert.equal(value.canvasPresent, false);
          entry.output = { bytes: value.bytes, pages: value.pages, items: value.items, textSha256: sha256(value.text), canvasPresent: false };
        }
        assert.equal(parser.state, 'ready'); entry.elapsedMs = performance.now() - started; entry.passed = true;
      }
    } finally { if (parser.state !== 'ready') cleanupSafe = false; }
    const controller = new AbortController(); let abortTimer; let spawned = false;
    const abortParser = new PdfProcess({ workerPath: join(layout, 'pdf-worker.mjs'), sandboxProfile: profile,
      onSpawn: () => { spawned = true; if (!controller.signal.aborted) abortTimer = setTimeout(() => controller.abort(), 10); } });
    const abortStarted = performance.now();
    try {
      await assert.rejects(abortParser.parse(cases[0].bytes, { signal: controller.signal }), /^Error: PDF_CANCELLED$/);
      assert.equal(spawned, true); assert.equal(abortParser.state, 'ready');
      receipt.cases.push({ layout: name, case: 'real-worker-early-abort', passed: true, error: 'PDF_CANCELLED',
        elapsedMs: performance.now() - abortStarted, ownedChildStoppedAndReaped: true, parsingStageAtAbort: 'not-observed' });
      assert.equal((await abortParser.parse(Buffer.from(greek.bytes))).text, greek.expectedText);
      receipt.cases.push({ layout: name, case: 'real-worker-after-abort', passed: true, exactGreekText: true });
    } finally { clearTimeout(abortTimer); if (abortParser.state !== 'ready') cleanupSafe = false; }
    await verifyPdfLayout(layout, inventory);
    receipt.layouts.push({ name, inventory, controls, dns, unchangedAfterExecution: true });
  }
  const negative = join(root, 'missing-worker-layout');
  await stagePdfLayout({ target: negative, sourceRoot: source, packageRoot: join(source, 'node_modules/pdfjs-dist') });
  await rm(join(negative, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'));
  const missing = new PdfProcess({ workerPath: join(negative, 'pdf-worker.mjs'),
    sandboxProfile: pdfSandboxProfile([repository, originalRepository, assets, source, relocated]) });
  try { await assert.rejects(missing.parse(Buffer.from(greek.bytes)), /^Error: PDF_INVALID$/); }
  finally { if (missing.state !== 'ready') cleanupSafe = false; }
  receipt.missingWorkerRejectedWithoutFallback = true;
  receipt.passed = true;
} catch { receipt.failure = 'PDF closure qualification failed'; }
finally {
  if (root && cleanupSafe) {
    try {
      for (const record of records) for (const directory of record.inventory.directories) await chmod(join(record.root, directory.path), 0o700);
      await rm(root, { recursive: true, force: true }); receipt.ownedRootsRemovedAfterReaping = true;
    } catch { receipt.passed = false; receipt.failure = 'PDF closure cleanup failed'; }
  } else if (root) { receipt.passed = false; receipt.failure = 'PDF closure cleanup unconfirmed'; }
}
const output = join(evidence, `${run}.json`);
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run, passed: receipt.passed, receiptPath: output }));
process.exitCode = receipt.passed ? 0 : 1;
