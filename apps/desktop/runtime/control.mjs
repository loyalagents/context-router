import { fstatSync } from 'node:fs';
import { Socket } from 'node:net';
const failure = () => new Error('Managed control unavailable');

/** Bounded private protocol; no HTTP, executable names or arbitrary arguments. */
export class ControlProtocol {
  #buffer = Buffer.alloc(0);
  #abort = new AbortController();
  #start;
  #rejectStart;
  #stop;
  #timer;
  #ready = false;
  #failed = false;
  #quitRequested = false;
  #onStop;
  #onCommand;
  constructor(generation, { onStop, onCommand }) {
    if (!/^[a-f0-9]{32}$/.test(generation) || typeof onStop !== 'function' || typeof onCommand !== 'function') throw failure();
    this.generation = generation; this.#onStop = onStop; this.#onCommand = onCommand;
    this.started = new Promise((resolve, reject) => { this.#start = resolve; this.#rejectStart = reject; });
    void this.started.catch(() => {});
    this.stopped = new Promise(resolve => { this.#stop = resolve; });
    this.#timer = setTimeout(() => this.fail(), 5000);
  }
  get signal() { return this.#abort.signal; }
  get failed() { return this.#failed; }
  get quitRequested() { return this.#quitRequested; }
  push(bytes) {
    if (this.signal.aborted) return;
    try {
      // Bound each incomplete frame rather than accumulating a peer's whole stream.
      let cursor = 0;
      while (cursor < bytes.length) {
        const end = bytes.indexOf(10, cursor), limit = end < 0 ? bytes.length : end;
        if (this.#buffer.length + limit - cursor > 16384) throw failure();
        this.#buffer = Buffer.concat([this.#buffer, bytes.subarray(cursor, limit)]);
        if (end < 0) return;
        const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.#buffer)); this.#buffer = Buffer.alloc(0);
        if (!frame || Object.keys(frame).sort().join() !== 'command,generation,version' || frame.version !== 1 || frame.generation !== this.generation) throw failure();
        if (!this.#ready) {
          if (frame.command !== 'start') throw failure();
          this.#ready = true; clearTimeout(this.#timer); this.#start();
        } else {
          if (!['unlock','quit','model-unavailable'].includes(frame.command)) throw failure();
          if (frame.command === 'quit') this.#quitRequested = true;
          this.#onCommand(frame.command);
          if (frame.command === 'quit') { this.end(); return; }
        }
        cursor = end + 1;
      }
    } catch { this.fail(); }
  }
  fail() { this.#failed = true; this.end(); }
  end() {
    if (this.signal.aborted) return;
    if (!this.#ready || this.#buffer.length) this.#failed = true;
    clearTimeout(this.#timer); this.#buffer = Buffer.alloc(0);
    this.#abort.abort(); this.#rejectStart(failure());
    try { this.#onStop(); } finally { this.#stop(); }
  }
  assertActive() { if (!this.#ready || this.signal.aborted) throw failure(); }
}
export class ManagedControl extends ControlProtocol {
  #input;
  #output;
  #pending = new Set();
  #bytes = 0;
  #closed = false;
  constructor(generation, handlers) {
    if (![5,6].every(fd => fstatSync(fd).isFIFO())) throw failure();
    super(generation, handlers);
    try {
      this.#input = new Socket({ fd: 5, readable: true, writable: false });
      this.#output = new Socket({ fd: 6, readable: false, writable: true });
      this.#input.on('data', bytes => this.push(bytes));
      this.#input.once('end', () => this.end());
      this.#input.once('error', () => this.fail());
      this.#output.once('error', () => this.fail());
    } catch { this.fail(); throw failure(); }
  }
  #settle(record, error) {
    if (!this.#pending.delete(record)) return;
    clearTimeout(record.timer); this.#bytes -= record.bytes;
    if (error) record.reject(error); else record.resolve();
  }
  async send(type, payload = {}) {
    if (this.#closed || this.failed || Object.keys(payload).some(key => ['type','version','generation'].includes(key))) throw failure();
    const bytes = Buffer.from(JSON.stringify({ version: 1, generation: this.generation, type, ...payload }) + '\n');
    if (bytes.length > 16384 || this.#bytes + bytes.length > 32768) { this.fail(); throw failure(); }
    const record = { bytes: bytes.length };
    record.promise = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
    this.#pending.add(record); this.#bytes += bytes.length;
    record.timer = setTimeout(() => this.fail(), 2000);
    try { this.#output.write(bytes, error => { this.#settle(record, error); if (error) this.fail(); }); }
    catch { this.fail(); }
    return record.promise;
  }
  end() { super.end(); this.#input?.destroy(); }
  fail() {
    super.fail(); this.#output?.destroy();
    for (const record of this.#pending) this.#settle(record, failure());
  }
  async close() {
    this.#closed = true;
    try { await Promise.all([...this.#pending].map(record => record.promise)); }
    finally { this.end(); this.#output?.destroy(); }
  }
}
/** Own the channel even when admission fails before the caller receives it. */
export async function openManagedControl(generation, handlers) {
  let control;
  try {
    control = new ManagedControl(generation, handlers);
    await control.started; control.assertActive(); return control;
  } catch {
    try { handlers.onStop(); } finally { await control?.close().catch(() => {}); }
    throw failure();
  }
}
