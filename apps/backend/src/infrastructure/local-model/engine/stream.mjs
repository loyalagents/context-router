const fail = () => { throw new Error('Invalid local model stream'); };
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

/** Strict native b11146 completion framing. Buffered application results require a complete successful terminal response. */
export class CompletionStream {
  #decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  #buffer = '';
  #wire = 0;
  #events = 0;
  #text = '';
  #outputBytes = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #processed = 0;
  #terminal = false;
  #terminalObserved = false;
  #failed = false;
  #witnessed = false;
  #limits;
  #onProgress;
  #onTerminalObservation;

  constructor({ limits = {}, onProgress = () => {}, onTerminalObservation = () => {} } = {}) {
    this.#limits = { wireBytes: 2 * 1024 * 1024, eventBytes: 16 * 1024, events: 8192,
      outputBytes: 256 * 1024, ...limits };
    this.#onProgress = onProgress;
    this.#onTerminalObservation = onTerminalObservation;
  }

  get witnessed() { return this.#witnessed; }

  push(bytes) {
    try {
      if (this.#failed || !Buffer.isBuffer(bytes)) fail();
      this.#wire += bytes.length;
      if (this.#wire > this.#limits.wireBytes) fail();
      this.#buffer += this.#decoder.decode(bytes, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(this.#buffer))) {
        const event = this.#buffer.slice(0, boundary.index);
        this.#buffer = this.#buffer.slice(boundary.index + boundary[0].length);
        if (Buffer.byteLength(event) > this.#limits.eventBytes || ++this.#events > this.#limits.events) fail();
        this.#event(event);
      }
      if (Buffer.byteLength(this.#buffer) > this.#limits.eventBytes) fail();
    } catch {
      this.#failed = true;
      fail();
    }
  }

  #event(event) {
    const lines = event.split(/\r?\n/);
    if (this.#terminalObserved || !lines.length || lines.some((line) => !line.startsWith('data: '))) fail();
    const value = JSON.parse(lines.map((line) => line.slice(6)).join('\n'));
    if (!value || typeof value !== 'object' || value.error || value.index !== 0 ||
        typeof value.stop !== 'boolean' || typeof value.content !== 'string' ||
        !integer(value.tokens_evaluated, 12000) || value.tokens_evaluated === 0 ||
        !integer(value.tokens_predicted, 2048) || value.tokens_predicted < this.#outputTokens) fail();
    let admitted = false;
    if (!this.#witnessed) {
      const progress = value.prompt_progress;
      if (value.stop || value.content !== '' || value.tokens_predicted !== 0 || !progress ||
          progress.total !== value.tokens_evaluated || progress.cache !== 0 || progress.processed !== 0 ||
          !Number.isFinite(progress.time_ms) || progress.time_ms < 0) fail();
      this.#inputTokens = value.tokens_evaluated;
      this.#witnessed = admitted = true;
    } else if (value.tokens_evaluated !== this.#inputTokens) fail();

    if (value.prompt_progress) {
      const progress = value.prompt_progress;
      if (progress.total !== this.#inputTokens || progress.cache !== 0 ||
          !integer(progress.processed, this.#inputTokens) || progress.processed < this.#processed ||
          !Number.isFinite(progress.time_ms) || progress.time_ms < 0 ||
          (!admitted && progress.processed === 0)) fail();
      this.#processed = progress.processed;
    }
    this.#outputTokens = value.tokens_predicted;
    this.#outputBytes += Buffer.byteLength(value.content);
    if (this.#outputBytes > this.#limits.outputBytes) fail();
    this.#text += value.content;
    if (value.stop) {
      if (typeof value.truncated !== 'boolean' || !['eos', 'word', 'limit'].includes(value.stop_type)) fail();
      // A stop observation is not proof of clean EOF or of a successful response.
      // Limit/truncation still fail immediately; no content or arbitrary fields escape.
      this.#terminalObserved = true;
      if (value.truncated || value.stop_type === 'limit') this.#failed = true;
      this.#onTerminalObservation({ stopType: value.stop_type, truncated: value.truncated,
        inputTokens: this.#inputTokens, outputTokens: this.#outputTokens });
      if (this.#failed) fail();
      this.#terminal = true;
    }
    this.#onProgress({ admitted, processed: this.#processed, total: this.#inputTokens,
      decoded: this.#outputTokens, terminal: this.#terminal });
  }

  finish() {
    try {
      if (this.#failed || this.#decoder.decode() || this.#buffer || !this.#terminal || !this.#text) fail();
      return { text: this.#text, inputTokens: this.#inputTokens, outputTokens: this.#outputTokens };
    } catch {
      this.#failed = true;
      fail();
    }
  }
}
