import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
let pdfjs;
async function packagedLibrary() {
  const expected = fileURLToPath(new URL('./pdfjs/pdf.mjs', import.meta.url));
  if (await realpath(expected) !== expected) throw new Error('PDF_INVALID');
  return import(new URL('./pdfjs/pdf.mjs', import.meta.url).href);
}
async function library(loadLibrary) {
  if (pdfjs) return pdfjs;
  const previous = console.warn;
  try {
    console.warn = () => {};
    pdfjs = await loadLibrary();
    if (pdfjs.version !== '6.3.289') throw new Error('PDF_VERSION');
    return pdfjs;
  } finally { console.warn = previous; }
}

// Bounded pinned PDF text algorithm. The parent-owned child/timeout boundary is separate.
export async function extractPdfText(buffer, {
  readerForPage = (page) => page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader(),
  loadLibrary = packagedLibrary,
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('PDF_LIMIT');
  const api = await library(loadLibrary);
  let auxiliaryRequested = false;
  class DenyBinaryDataFactory { async fetch() { auxiliaryRequested = true; throw new Error('PDF_AUXILIARY'); } }
  class DenyCanvasFactory { create() { throw new Error('PDF_RENDER'); } }
  const task = api.getDocument({ data: new Uint8Array(buffer), BinaryDataFactory: DenyBinaryDataFactory, CanvasFactory: DenyCanvasFactory,
    useWorkerFetch: false, useWasm: false, useSystemFonts: false, disableFontFace: true,
    enableXfa: false, enableHWA: false, enableWebGPU: false, isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false, disableRange: true, disableStream: true, disableAutoFetch: true,
    stopAtErrors: true, fontExtraProperties: false, verbosity: 0 });
  let result;
  try {
    const document = await task.promise;
    if (document.numPages > 50) throw new Error('PDF_LIMIT');
    const { info } = await document.getMetadata();
    if (info.EncryptFilterName != null) throw new Error('PDF_ENCRYPTED');
    const parts = []; let bytes = 0; let items = 0;
    const append = (text) => {
      bytes += Buffer.byteLength(text);
      if (bytes > 128 * 1024) throw new Error('PDF_LIMIT');
      parts.push(text);
    };
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const reader = readerForPage(page);
      let ended = false;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) { ended = true; break; }
          for (const item of chunk.value.items) {
            if (++items > 100000) throw new Error('PDF_LIMIT');
            if (typeof item.str === 'string') append(item.str + (item.hasEOL ? '\n' : ' '));
          }
        }
      } finally {
        try { if (!ended) await reader.cancel(new Error('PDF_PARSE_STOPPED')); }
        finally { reader.releaseLock(); page.cleanup(); }
      }
      append('\n');
    }
    if (auxiliaryRequested) throw new Error('PDF_AUXILIARY');
    const text = parts.join('').trim();
    if (!text.length) throw new Error('PDF_EMPTY');
    result = { text, pages: document.numPages, items, bytes, auxiliaryRequested, canvasPresent: !!globalThis.DOMMatrix };
  } catch (error) {
    if (['PDF_LIMIT', 'PDF_AUXILIARY', 'PDF_EMPTY', 'PDF_ENCRYPTED'].includes(error.message)) throw error;
    if (error.name === 'PasswordException') throw new Error('PDF_ENCRYPTED');
    throw new Error('PDF_INVALID');
  } finally { await task.destroy(); }
  return result;
}
