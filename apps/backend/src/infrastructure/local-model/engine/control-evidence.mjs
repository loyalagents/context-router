const phases = new Set(['readiness', 'active', 'settlement', 'control', 'cleanup']);
const events = new Set(['dispatch', 'idle', 'busy', 'timeout', 'transport', 'http', 'invalid', 'aborted', 'continuity', 'close', 'deadline', 'start']);
const states = new Set(['ready', 'active', 'cancel-pending', 'unavailable']);

/** Fixed private counter projection; overflow fails qualification, never expands retention. */
export function createControlEvidence() {
  const started = performance.now(); const records = []; let bytes = 128; let overflow = false;
  return {
    record(phase, sequence, event, remainingMs) {
      if (overflow) return;
      const elapsedMs = performance.now() - started;
      if (!phases.has(phase) || !events.has(event) || !Number.isInteger(sequence) || sequence < 0 || sequence > 90 ||
          !Number.isFinite(remainingMs) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || remainingMs < 0) { overflow = true; return; }
      const value = { phase, sequence, event, elapsedMs: Math.round(elapsedMs * 1000) / 1000, remainingMs: Math.round(remainingMs * 1000) / 1000 };
      const size = Buffer.byteLength(JSON.stringify(value)) + 1;
      if (records.length >= 128 || bytes + size > 16384) { overflow = true; return; }
      records.push(value); bytes += size;
    },
    snapshot(state) {
      return { state: states.has(state) ? state : 'unavailable', overflow: overflow || !states.has(state), records: records.map((record) => ({ ...record })) };
    },
  };
}

export function completeControlEvidence(value) {
  return value?.overflow === false && states.has(value.state) && Array.isArray(value.records) &&
    value.records.length > 0 && value.records.length <= 128 && Buffer.byteLength(JSON.stringify(value)) <= 16384;
}
