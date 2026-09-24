import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractPdfText } from './fixtures/local-model-feasibility/pdf.mjs';
import { greekPdfFixture, emptyPdfFixture, standardFontPdfFixture, encryptedPdfFixture, imageOnlyPdfFixture } from './fixtures/local-model-feasibility/pdf-fixtures.mjs';

test('pinned PDF text extraction accepts an embedded-font repository form without native canvas', async () => {
  const data = await readFile('examples/eval/forms/i-9/form.pdf');
  const result = await extractPdfText(data);
  assert.ok(result.text.includes('Employment Eligibility Verification'));
  assert.ok(result.pages > 0 && result.pages <= 50);
  assert.equal(result.auxiliaryRequested, false);
  assert.equal(result.canvasPresent, false);
});

test('embedded actual Greek glyphs retain their UTF-8 text without auxiliary fonts or native canvas', async () => {
  const fixture = await greekPdfFixture();
  const result = await extractPdfText(Buffer.from(fixture.bytes));
  assert.equal(result.text, fixture.expectedText);
  assert.equal(Buffer.from(result.text).toString('hex'), 'ce91ceb8ceaecebdceb1');
  assert.equal(result.auxiliaryRequested, false);
});

test('empty and over-page/byte-budget PDFs are rejected without truncation', async () => {
  await assert.rejects(extractPdfText(await emptyPdfFixture(1)), /^Error: PDF_EMPTY$/);
  await assert.rejects(extractPdfText(await emptyPdfFixture(51)), /^Error: PDF_LIMIT$/);
  await assert.rejects(extractPdfText(Buffer.alloc(10 * 1024 * 1024 + 1)), /^Error: PDF_LIMIT$/);
});

test('PDF parser rejects non-PDF bytes with a fixed error', async () => {
  await assert.rejects(extractPdfText(Buffer.from('not a PDF')), /^Error: PDF_INVALID$/);
});

test('a swallowed auxiliary-font fetch still makes the strict text subset unsupported', async () => {
  await assert.rejects(extractPdfText(await standardFontPdfFixture()), /^Error: PDF_AUXILIARY$/);
});

test('actual embedded-font text overflow and image-only PDF reject without partial output or OCR', async () => {
  const long = await greekPdfFixture(20000);
  await assert.rejects(extractPdfText(Buffer.from(long.bytes)), /^Error: PDF_LIMIT$/);
  await assert.rejects(extractPdfText(await imageOnlyPdfFixture()), /^Error: PDF_EMPTY$/);
});

test('genuine R2 encrypted streams decrypt only with an accepted password and are always unsupported', async () => {
  const api = await import('/private/tmp/context-router-step06-assets/pdfjs-dist-6.3.289/package/legacy/build/pdf.mjs');
  for (const password of ['fixture-user', '']) {
    const bytes = encryptedPdfFixture(password);
    assert.equal(bytes.includes(Buffer.from('Encrypted fixture')), false);
    for (const supplied of [password, 'fixture-wrong-password', undefined]) {
      const task = api.getDocument({ data: new Uint8Array(bytes), password: supplied, verbosity: 0,
        useWasm: false, useSystemFonts: false, disableFontFace: true });
      try {
        if (supplied === 'fixture-wrong-password' || (password && supplied === undefined)) {
          await assert.rejects(task.promise, (error) => error.name === 'PasswordException');
        } else {
          const document = await task.promise;
          assert.equal((await document.getMetadata()).info.EncryptFilterName, 'Standard');
          const page = await document.getPage(1); const text = await page.getTextContent();
          assert.equal(text.items.map((item) => item.str).join(''), 'Encrypted fixture');
          page.cleanup();
        }
      } finally { await task.destroy(); }
    }
    await assert.rejects(extractPdfText(bytes), /^Error: PDF_ENCRYPTED$/);
  }
});

test('text-stream cleanup skips completed readers and cancels unfinished readers with a fixed Error', async () => {
  const original = ReadableStreamDefaultReader.prototype.cancel;
  const reasons = [];
  ReadableStreamDefaultReader.prototype.cancel = function (reason) {
    reasons.push(reason); return original.call(this, reason);
  };
  try {
    const normal = await greekPdfFixture();
    await extractPdfText(Buffer.from(normal.bytes));
    assert.equal(reasons.length, 0);
    const excess = await greekPdfFixture(20000);
    await assert.rejects(extractPdfText(Buffer.from(excess.bytes)), /^Error: PDF_LIMIT$/);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0] instanceof Error);
    assert.equal(reasons[0].message, 'PDF_PARSE_STOPPED');
    assert.equal((await extractPdfText(Buffer.from(normal.bytes))).text, normal.expectedText);
  } finally { ReadableStreamDefaultReader.prototype.cancel = original; }
});
