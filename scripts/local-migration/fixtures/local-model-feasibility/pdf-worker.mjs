import { extractPdfText } from './pdf.mjs';

// Parent discards and bounds stderr too; library diagnostics are never application output.
for (const method of ['debug', 'error', 'info', 'log', 'warn']) console[method] = () => {};
let response;
try {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 10 * 1024 * 1024) throw new Error('PDF_LIMIT');
    chunks.push(chunk);
  }
  const result = await extractPdfText(Buffer.concat(chunks));
  const body = Buffer.from(result.text);
  const header = { ok: true, pages: result.pages, items: result.items, bytes: body.length, canvasPresent: result.canvasPresent };
  response = Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`), body]);
} catch (error) {
  const code = ['PDF_LIMIT', 'PDF_EMPTY', 'PDF_ENCRYPTED', 'PDF_AUXILIARY'].includes(error?.message) ? error.message : 'PDF_INVALID';
  response = Buffer.from(`${JSON.stringify({ ok: false, error: code })}\n`);
}
await new Promise((resolve, reject) => process.stdout.write(response, (error) => error ? reject(new Error('PDF_OUTPUT')) : resolve()));
