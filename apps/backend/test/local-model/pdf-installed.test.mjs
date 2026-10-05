import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PdfProcess } from '../../dist/infrastructure/local-model/engine/pdf-process.mjs';
import { greekPdfFixture, emptyPdfFixture, encryptedPdfFixture, standardFontPdfFixture, imageOnlyPdfFixture } from './fixtures/pdf-fixtures.mjs';

test('actual built PDF worker accepts repository and embedded Greek text with no canvas', async () => {
  const parser = new PdfProcess({ workerPath: fileURLToPath(new URL('../../dist/infrastructure/local-model/engine/pdf-worker.mjs', import.meta.url)) });
  const original = await readFile(new URL('../../../../examples/eval/forms/i-9/form.pdf', import.meta.url));
  const first = await parser.parse(original);
  assert.ok(first.text.includes('Employment Eligibility Verification')); assert.equal(first.canvasPresent, false);
  const greek = await greekPdfFixture();
  assert.equal((await parser.parse(Buffer.from(greek.bytes))).text, greek.expectedText);
  assert.equal(parser.state, 'ready');
});

test('actual built parser rejects unsupported inputs and retains capacity for the next PDF', async () => {
  const parser = new PdfProcess({ workerPath: fileURLToPath(new URL('../../dist/infrastructure/local-model/engine/pdf-worker.mjs', import.meta.url)) });
  for (const [bytes, code] of [
    [Buffer.from('invalid'), 'PDF_INVALID'], [await emptyPdfFixture(1), 'PDF_EMPTY'],
    [await emptyPdfFixture(51), 'PDF_LIMIT'], [await imageOnlyPdfFixture(), 'PDF_EMPTY'],
    [encryptedPdfFixture('private'), 'PDF_ENCRYPTED'], [encryptedPdfFixture(''), 'PDF_ENCRYPTED'],
    [await standardFontPdfFixture(), 'PDF_AUXILIARY'], [Buffer.from((await greekPdfFixture(20000)).bytes), 'PDF_LIMIT'],
  ]) {
    await assert.rejects(parser.parse(bytes), { message: code }); assert.equal(parser.state, 'ready');
  }
  assert.equal((await parser.parse(Buffer.from((await greekPdfFixture()).bytes))).text, 'Αθήνα');
});

test('small compressed object-stream PDF stays behind the owned parser and is reaped', { timeout: 15000 }, async () => {
  const packed = deflateSync(Buffer.alloc(4 * 1024 * 1024, 32));
  const bytes = Buffer.concat([Buffer.from(`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>
endobj
4 0 obj
<< /Type /ObjStm /N 0 /First 0 /Length ${packed.length} /Filter /FlateDecode >>
stream
`), packed, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')]);
  assert.ok(bytes.length < 8192);
  let pid; let ticks = 0;
  const pulse = setInterval(() => ticks++, 1);
  const parser = new PdfProcess({
    workerPath: fileURLToPath(new URL('../../dist/infrastructure/local-model/engine/pdf-worker.mjs', import.meta.url)),
    onSpawn: (value) => { pid = value; },
  });
  try {
    await assert.rejects(parser.parse(bytes), (error) => ['PDF_EMPTY', 'PDF_INVALID'].includes(error.message));
    assert.ok(ticks > 0, 'shared event loop remains responsive');
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
    assert.equal(parser.state, 'ready');
  } finally { clearInterval(pulse); }
});
