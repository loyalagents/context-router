const failed = () => new Error('Allocation projection failed');
const expected = Object.freeze({ n_seq_max: 1, n_ctx: 16384, n_ctx_seq: 16384,
  n_batch: 512, n_ubatch: 512, n_rs_seq: 0, n_outputs_max: 1 });
const formats = [
  ['model', 'load_tensors', 12, 'model', ['CPU', 'CPU_Mapped', 'MTL0', 'MTL0_Mapped']],
  ['kv', 'llama_kv_cache', 10, 'KV', ['CPU', 'MTL0']],
  ['recurrent', 'llama_memory_recurrent', 10, 'RS', ['CPU', 'MTL0']],
  ['compute', 'sched_reserve', 10, 'compute', ['CPU', 'MTL0']],
  ['output', 'llama_context', 10, ' output', ['CPU']],
];
const prefix = /^(?:0|[1-9][0-9]*)\.[0-5][0-9]\.[0-9]{3}\.[0-9]{3} I /;
const candidate = /(?:model|KV|RS|compute|output) buffer size|llama_context: *n_(?:seq_max|ctx|ctx_seq|batch|ubatch|rs_seq|outputs_max)\b/;

/** Only fixed enums/numbers leave this parser. Never retain rejected or ignored raw lines. */
export class AllocationProjection {
  #streams = new Map(['stdout', 'stderr'].map((name) => [name, {
    decoder: new TextDecoder('utf-8', { fatal: true }), pending: '', ended: false,
  }]));
  #failed = false;
  #bytes = 0;
  #outputBytes = 0;
  #records = [];
  #configuration = {};
  #families = new Set();

  #guard(action) {
    if (this.#failed) throw failed();
    try { return action(); }
    catch { this.#failed = true; throw failed(); }
  }

  #line(line) {
    if (!candidate.test(line)) return '';
    const match = prefix.exec(line);
    if (!match) throw failed();
    const body = line.slice(match[0].length);
    let record;
    for (const [field, value] of Object.entries(expected)) {
      if (body === `llama_context: ${field.padEnd(21)} = ${value}`) {
        if (Object.hasOwn(this.#configuration, field)) throw failed();
        this.#configuration[field] = value;
        record = { kind: 'configuration', field, value };
        break;
      }
    }
    if (!record) {
      for (const [family, label, width, noun, backends] of formats) {
        for (const backend of backends) {
          const start = `${label}: ${backend.padStart(width)} ${noun} buffer size = `;
          if (!body.startsWith(start)) continue;
          const number = body.slice(start.length);
          if (!/^ *(?:0|[1-9][0-9]*)\.[0-9]{2} MiB$/.test(number)) throw failed();
          const value = Number(number.slice(0, -4));
          if (!Number.isFinite(value) || value < 0 || value > 1048576 ||
              number !== `${value.toFixed(2).padStart(8)} MiB`) throw failed();
          record = { kind: 'buffer', family, backend, reportedMiB: value };
          this.#families.add(family);
        }
      }
    }
    if (!record) throw failed();
    const serialized = `${JSON.stringify(record)}\n`;
    this.#outputBytes += Buffer.byteLength(serialized);
    if (this.#records.length >= 64 || this.#outputBytes > 32 * 1024) throw failed();
    this.#records.push(record);
    return serialized;
  }

  push(name, chunk) {
    return this.#guard(() => {
      const stream = this.#streams.get(name);
      if (!stream || stream.ended || !Buffer.isBuffer(chunk)) throw failed();
      this.#bytes += chunk.length;
      if (this.#bytes > 512 * 1024) throw failed();
      stream.pending += stream.decoder.decode(chunk, { stream: true });
      let output = ''; let end;
      while ((end = stream.pending.indexOf('\n')) !== -1) {
        const line = stream.pending.slice(0, end);
        if (Buffer.byteLength(line) > 16 * 1024) throw failed();
        stream.pending = stream.pending.slice(end + 1);
        output += this.#line(line);
      }
      if (Buffer.byteLength(stream.pending) > 16 * 1024) throw failed();
      return Buffer.from(output);
    });
  }

  end(name) {
    return this.#guard(() => {
      const stream = this.#streams.get(name);
      if (!stream || stream.ended) throw failed();
      stream.pending += stream.decoder.decode();
      if (stream.pending.length) throw failed();
      stream.ended = true;
    });
  }

  finish() {
    return this.#guard(() => {
      if (![...this.#streams.values()].every((stream) => stream.ended) ||
          this.#families.size !== 5 || Object.keys(this.#configuration).length !== 7) throw failed();
      return { records: this.#records.map((record) => ({ ...record })),
        configuration: { ...this.#configuration }, rawBytesDiscardedOrProjected: this.#bytes,
        projectedBytes: this.#outputBytes, reportedPrecisionMiB: 0.01 };
    });
  }
}
