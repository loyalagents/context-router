import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractPdfText } from './fixtures/local-model-feasibility/pdf.mjs';
import { greekPdfFixture, emptyPdfFixture, standardFontPdfFixture } from './fixtures/local-model-feasibility/pdf-fixtures.mjs';

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
