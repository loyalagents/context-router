import https from 'node:https';

const phases = new Set(['readiness', 'active', 'settlement', 'control', 'cleanup']);
const marks = new Set(['abort', 'client-return', 'settled']);
const installed = new WeakSet();
const failed = () => new Error('Control observation invalid');

/** Diagnostic worker only. Passive event listeners; the original transport owns every decision. */
export function installControlObserver({ transport = https, getControlEvidence,
  now = () => performance.now(), maxRecords = 1024, maxBytes = 96 * 1024 }) {
  if (installed.has(transport) || typeof transport.request !== 'function' || typeof getControlEvidence !== 'function' ||
      !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 1024 ||
      !Number.isInteger(maxBytes) || maxBytes < 128 || maxBytes > 96 * 1024) throw failed();
  const original = transport.request;
  let current; let nextOperation = 0; let restored = false;
  const guard = (operation, action) => {
    try { return action(); } catch { operation.invalid = true; return undefined; }
  };
  const record = (operation, sequence, event, retainedMatch = null) => guard(operation, () => {
    if (operation.overflow) return;
    const elapsedMs = Math.round((now() - operation.started) * 1000) / 1000;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 181000 || elapsedMs < operation.lastTime) throw failed();
    operation.lastTime = elapsedMs;
    const value = { sequence, event, elapsedMs, retainedMatch };
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (operation.records.length >= maxRecords || operation.bytes + bytes > maxBytes) {
      operation.invalid = operation.overflow = true; return;
    }
    operation.bytes += bytes; operation.records.push(value);
  });
  const listen = (operation, emitter, event, callback) => {
    const listener = (...args) => guard(operation, () => callback(...args));
    emitter.once(event, listener);
    operation.listeners.push(() => emitter.removeListener(event, listener));
  };
  function wrapped(...args) {
    const operation = current;
    // The fixed production call shape is an options object. Never inspect or retain headers/body.
    const observed = operation && args[0]?.path === '/slots';
    let entry;
    if (observed) guard(operation, () => {
      const sequence = operation.requests.length + 1;
      const source = getControlEvidence()?.records?.at(-1);
      if (sequence > 90 || source?.event !== 'dispatch' || source.sequence !== sequence || !phases.has(source.phase)) throw failed();
      entry = { sequence, phase: source.phase, attached: false, closed: false };
      operation.requests.push(entry); record(operation, sequence, 'dispatch');
    });
    // Delegate exactly once, preserving this, arguments, original exceptions and return identity.
    const request = Reflect.apply(original, this, args);
    if (observed && entry) guard(operation, () => {
      listen(operation, request, 'socket', socket => {
        const match = operation.socket === undefined ? null : socket === operation.socket;
        operation.socket ??= socket; record(operation, entry.sequence, 'socket', match);
      });
      listen(operation, request, 'finish', () => record(operation, entry.sequence, 'write-finish'));
      listen(operation, request, 'error', () => record(operation, entry.sequence, 'request-error'));
      listen(operation, request, 'close', () => { entry.closed = true; record(operation, entry.sequence, 'request-close'); });
      listen(operation, request, 'response', response => {
        record(operation, entry.sequence, 'headers');
        listen(operation, response, 'end', () => record(operation, entry.sequence, 'response-end'));
        listen(operation, response, 'close', () => record(operation, entry.sequence, 'response-close'));
        listen(operation, response, 'error', () => record(operation, entry.sequence, 'response-error'));
      });
      entry.attached = true; record(operation, entry.sequence, 'attached');
    });
    return request;
  }
  transport.request = wrapped; installed.add(transport);
  const detach = operation => {
    for (const remove of operation.listeners) guard(operation, remove);
    operation.listeners.length = 0; operation.socket = undefined;
  };
  return {
    begin(operation) {
      if (restored || current || operation !== nextOperation || operation >= 6) throw failed();
      current = { operation, started: 0, lastTime: 0, invalid: false, overflow: false,
        records: [], requests: [], listeners: [], bytes: 192 };
      guard(current, () => { current.started = now(); if (!Number.isFinite(current.started)) throw failed(); });
      nextOperation++;
    },
    mark(event) {
      if (!current) return;
      if (!marks.has(event)) { current.invalid = true; return; }
      record(current, 0, event);
    },
    end(controlEvidence) {
      if (!current) throw failed();
      const operation = current;
      guard(operation, () => {
        const dispatches = controlEvidence.records.filter(r => r.event === 'dispatch');
        if (controlEvidence.overflow || dispatches.length === 0 || dispatches.length !== operation.requests.length ||
            !operation.requests.every((entry, index) => entry.attached && entry.closed &&
              dispatches[index].sequence === entry.sequence && dispatches[index].phase === entry.phase)) throw failed();
        for (const entry of operation.requests) {
          const accepted = controlEvidence.records.some(r => r.sequence === entry.sequence && ['idle', 'busy'].includes(r.event));
          const observed = operation.records.filter(r => r.sequence === entry.sequence).map(r => r.event);
          if (accepted && !['socket', 'write-finish', 'headers', 'response-end'].every(event => observed.includes(event))) throw failed();
        }
      });
      detach(operation); current = undefined;
      const result = { operation: operation.operation, valid: !operation.invalid, overflow: operation.overflow,
        requests: operation.requests.length, records: operation.records };
      if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw failed();
      return result;
    },
    restore() {
      if (restored) return true;
      const valid = !current && transport.request === wrapped;
      if (current) { detach(current); current = undefined; }
      if (transport.request === wrapped) transport.request = original;
      installed.delete(transport); restored = true;
      return valid;
    },
  };
}
