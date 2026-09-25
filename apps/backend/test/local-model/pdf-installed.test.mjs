import assert from 'node:assert/strict';
import test from 'node:test';
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
