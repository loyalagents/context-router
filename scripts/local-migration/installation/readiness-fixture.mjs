// P1 protocol/admission fixture only. Does not change or reset the real adapter.
export class ReadinessFixture {
  #generation; #adapter; #state = 'loading'; #buffer = '';
  constructor(generation, adapter) {
    if (!/^[a-f0-9-]{36}$/.test(generation)) throw new Error('invalid fixture generation');
    this.#generation = generation; this.#adapter = adapter;
  }
  receive(chunk) {
    if (this.#state === 'failed') return;
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer) > 256) return this.controlLost();
    const newline = this.#buffer.indexOf('\n');
    if (newline < 0) return;
    try {
      if (newline !== this.#buffer.length - 1 || this.#state !== 'loading') throw new Error();
      const message = JSON.parse(this.#buffer.slice(0, -1));
      if (Object.keys(message).sort().join(',') !== 'generation,kind,version' || message.version !== 1 ||
          message.generation !== this.#generation || !['ready', 'failed'].includes(message.kind)) throw new Error();
      this.#state = message.kind;
      this.#buffer = '';
    } catch { this.controlLost(); }
  }
  controlLost() { this.#state = 'failed'; this.#buffer = ''; }
  dashboard() { return 'non-AI available'; }
  status() { return this.#state === 'ready' ? this.#adapter.status() : { state: 'unavailable', configured: true }; }
  complete() {
    if (this.#state !== 'ready') throw new Error('model unavailable');
    return this.#adapter.complete();
  }
}
