import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const failure = (code = 'PDF_INVALID') => new Error(code);
export const parsePdfReply = (output) => {
  const separator = output.indexOf(10);
  if (separator < 0 || separator > 1024) throw failure();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const header = JSON.parse(decoder.decode(output.subarray(0, separator)));
  const body = output.subarray(separator + 1);
  if (header?.ok === false && Object.keys(header).sort().join() === 'error,ok' && body.length === 0 &&
      ['PDF_LIMIT', 'PDF_EMPTY', 'PDF_ENCRYPTED', 'PDF_AUXILIARY', 'PDF_INVALID'].includes(header.error)) throw failure(header.error);
  if (header?.ok !== true || Object.keys(header).sort().join() !== 'bytes,canvasPresent,items,ok,pages' ||
      !Number.isInteger(header.pages) || header.pages < 1 || header.pages > 50 ||
      !Number.isInteger(header.items) || header.items < 1 || header.items > 100000 ||
      !Number.isInteger(header.bytes) || header.bytes < 1 || header.bytes > 128 * 1024 ||
      header.bytes !== body.length || header.canvasPresent !== false) throw failure();
  const text = decoder.decode(body);
  if (!text.trim()) throw failure();
  return { text, pages: header.pages, items: header.items, bytes: header.bytes, canvasPresent: false };
};

/** Byte-only parser ownership. Never manages or signals an inference runtime. */
export class PdfProcess {
  #state = 'ready';
  #workerPath;
  #sandboxProfile;
  #onSpawn;
  #beforeCleanup;
  constructor({ workerPath, sandboxProfile, onSpawn = () => {}, beforeCleanup = () => {} }) {
    if (!isAbsolute(workerPath)) throw failure();
    this.#workerPath = workerPath; this.#sandboxProfile = sandboxProfile; this.#onSpawn = onSpawn;
    this.#beforeCleanup = beforeCleanup;
  }
  get state() { return this.#state; }

  async parse(bytes, { signal, deadline = performance.now() + 10000 } = {}) {
    if (this.#state !== 'ready') throw failure(this.#state === 'active' ? 'PDF_BUSY' : 'PDF_UNAVAILABLE');
    if (signal?.aborted) throw failure('PDF_CANCELLED');
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw failure('PDF_LIMIT');
    const end = Math.min(deadline, performance.now() + 10000);
    // Reserve one second for exact-child termination/reaping inside the outer deadline.
    if (!Number.isFinite(end) || end - performance.now() <= 1000) throw failure('PDF_TIMEOUT');
    this.#state = 'active';
    let root; let child; let closed = false; let timer; let reapTimer; let code; let result; let error;
    let resolveExit;
    const exited = new Promise((resolve) => { resolveExit = resolve; });
    const stop = (reason) => {
      code ??= reason;
      if (!child || closed) return;
      child.stdin.destroy();
      try { child.kill('SIGKILL'); } catch { /* Only the retained child handle is targeted. */ }
      if (!reapTimer) reapTimer = setTimeout(() => resolveExit(null), Math.max(0, Math.min(1000, end - performance.now())));
    };
    const abort = () => stop('PDF_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    try {
      root = await mkdtemp(join(tmpdir(), 'step06-pdf-process-'));
      if (signal?.aborted || code) throw failure('PDF_CANCELLED');
      if (performance.now() >= end - 1000) throw failure('PDF_TIMEOUT');
      const args = ['--no-global-search-paths', '--max-old-space-size=256', '--unhandled-rejections=strict', this.#workerPath];
      child = spawn(this.#sandboxProfile ? '/usr/bin/sandbox-exec' : process.execPath,
        this.#sandboxProfile ? ['-p', this.#sandboxProfile, process.execPath, ...args] : args,
        { cwd: root, env: { PATH: '/usr/bin:/bin', TMPDIR: root, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let outputBytes = 0; let diagnosticBytes = 0; const chunks = [];
      child.stdout.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > 128 * 1024 + 1024) stop('PDF_INVALID');
        else if (!code) chunks.push(chunk);
      });
      child.stderr.on('data', (chunk) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 64 * 1024) stop('PDF_INVALID'); });
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop('PDF_INVALID'));
      child.once('error', () => stop('PDF_INVALID'));
      child.once('close', (status, terminatedBy) => {
        closed = true; clearTimeout(timer); clearTimeout(reapTimer); resolveExit({ status, terminatedBy });
      });
      child.once('spawn', () => {
        try { this.#onSpawn(child.pid); } catch { stop('PDF_INVALID'); }
        if (signal?.aborted) stop('PDF_CANCELLED');
        if (performance.now() >= end - 1000) stop('PDF_TIMEOUT');
        if (!code) child.stdin.end(bytes);
      });
      timer = setTimeout(() => stop('PDF_TIMEOUT'), Math.max(0, end - 1000 - performance.now()));
      const outcome = await exited;
      if (!closed || !outcome) throw failure('PDF_UNAVAILABLE');
      if (code) throw failure(code);
      if (outcome.status !== 0 || outcome.terminatedBy !== null) throw failure();
      result = parsePdfReply(Buffer.concat(chunks));
    } catch (caught) {
      error = failure(['PDF_LIMIT', 'PDF_EMPTY', 'PDF_ENCRYPTED', 'PDF_AUXILIARY', 'PDF_INVALID', 'PDF_TIMEOUT', 'PDF_CANCELLED', 'PDF_UNAVAILABLE'].includes(caught?.message) ? caught.message : 'PDF_INVALID');
    } finally {
      clearTimeout(timer); clearTimeout(reapTimer); signal?.removeEventListener('abort', abort);
      if (!child || closed) {
        try { await this.#beforeCleanup(); if (root) await rm(root, { recursive: true, force: true }); this.#state = 'ready'; }
        catch { this.#state = 'unavailable'; error = failure('PDF_UNAVAILABLE'); }
      } else { this.#state = 'unavailable'; error = failure('PDF_UNAVAILABLE'); }
    }
    if (error) throw error;
    if (signal?.aborted) throw failure('PDF_CANCELLED');
    if (performance.now() >= end) throw failure('PDF_TIMEOUT');
    return result;
  }
}
