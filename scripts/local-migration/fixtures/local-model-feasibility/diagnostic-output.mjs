const failed = () => new Error('Diagnostic output invalid');

/** Raw process output is checked in bounded memory and discarded before any persistence. */
export class DiagnosticOutput {
  #patterns;
  #tailLength;
  #streams = new Map(['stdout', 'stderr'].map(name => [name, { bytes: 0, tail: Buffer.alloc(0), ended: false }]));
  #invalid = false;
  #leakDetected = false;
  #complete = false;

  constructor({ apiKey }) {
    if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 256) throw failed();
    this.#patterns = [Buffer.from(apiKey), Buffer.from('STEP06_PRIVATE_SENTINEL')];
    this.#tailLength = Math.max(...this.#patterns.map(pattern => pattern.length)) - 1;
  }
  #guard(action) {
    if (this.#invalid) throw failed();
    try { return action(); }
    catch { this.#invalid = true; this.#complete = false; for (const stream of this.#streams.values()) stream.tail = Buffer.alloc(0); throw failed(); }
  }
  push(name, chunk) {
    return this.#guard(() => {
      const stream = this.#streams.get(name);
      if (!stream || stream.ended || !Buffer.isBuffer(chunk)) throw failed();
      if (this.snapshot().rawBytes + chunk.length > 512 * 1024) throw failed();
      stream.bytes += chunk.length;
      const joined = Buffer.concat([stream.tail, chunk]);
      if (this.#patterns.some(pattern => joined.includes(pattern))) { this.#leakDetected = true; throw failed(); }
      stream.tail = Buffer.from(joined.subarray(Math.max(0, joined.length - this.#tailLength)));
      return Buffer.alloc(0);
    });
  }
  end(name) {
    return this.#guard(() => {
      const stream = this.#streams.get(name);
      if (!stream || stream.ended) throw failed();
      stream.tail = Buffer.alloc(0); stream.ended = true;
    });
  }
  finish() {
    return this.#guard(() => {
      if (![...this.#streams.values()].every(stream => stream.ended)) throw failed();
      this.#complete = true; return this.snapshot();
    });
  }
  snapshot() {
    const stdoutBytes = this.#streams.get('stdout').bytes, stderrBytes = this.#streams.get('stderr').bytes;
    return { complete: this.#complete && !this.#invalid, invalid: this.#invalid, leakDetected: this.#leakDetected,
      stdoutBytes, stderrBytes, rawBytes: stdoutBytes + stderrBytes };
  }
}
