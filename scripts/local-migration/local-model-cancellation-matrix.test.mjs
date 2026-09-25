import assert from 'node:assert/strict';
import test from 'node:test';
import { runCancellationMatrix } from './fixtures/local-model-feasibility/cancellation-matrix.mjs';

const render = async (_configuration, prompt) => ({ prompt, inputTokens: prompt.includes('Record 0000:') ? 8000 : 64 });

test('matrix requires five baseline calls, three witnessed cancellations per phase and six actual followups', async () => {
  let calls = 0; let cancellations = 0;
  const client = { state: 'ready', get controlEvidence() { return { state: this.state, overflow: false, records: [{ phase: 'readiness', sequence: 1, event: 'idle', elapsedMs: 0, remainingMs: 100 }] }; }, settled: async () => {}, complete: async (_prompt, options) => {
    calls++;
    if (options.schema) return { text: '{"answer":"ok"}', inputTokens: 64, outputTokens: 6 };
    cancellations++;
    options.onProgress({ admitted: true, processed: 0, total: 8000, decoded: 0 });
    options.onProgress({ admitted: false, processed: 2048, total: 8000, decoded: 0 });
    if (!options.signal.aborted) options.onProgress({ admitted: false, processed: 8000, total: 8000, decoded: 8 });
    assert.equal(options.signal.aborted, true);
    throw new Error('Local model cancelled');
  } };
  const result = await runCancellationMatrix({}, client, { render });
  assert.equal(result.passed, true);
  assert.equal(result.baselines.length, 5);
  assert.equal(calls, 17); assert.equal(cancellations, 6);
  assert.deepEqual(result.trials.map((entry) => entry.phase), ['prefill', 'prefill', 'prefill', 'decode', 'decode', 'decode']);
  assert.ok(result.trials.every((entry) => entry.witnessed && entry.followupMs >= 0));
});

test('unknown settlement retains a failed matrix without further preparation, inference or omitted trial records', async () => {
  let calls = 0; let renders = 0;
  const client = { state: 'ready', get controlEvidence() { return { state: this.state, overflow: false, records: [{ phase: 'readiness', sequence: 1, event: 'idle', elapsedMs: 0, remainingMs: 100 }] }; }, settled: async () => {}, complete: async (_prompt, options) => {
    calls++;
    if (options.schema) return { text: '{"answer":"ok"}' };
    options.onProgress({ admitted: true, processed: 0, total: 8000, decoded: 0 });
    options.onProgress({ admitted: false, processed: 2048, total: 8000, decoded: 0 });
    client.state = 'unavailable'; throw new Error('Local model cancelled');
  } };
  const result = await runCancellationMatrix({}, client, { render: async (...args) => { renders++; return render(...args); } });
  assert.equal(result.passed, false); assert.equal(calls, 6); assert.equal(renders, 6);
  assert.equal(result.trials.length, 6); assert.equal(result.trials[0].passed, false);
  assert.ok(result.trials.slice(1).every((entry) => entry.notRun && !entry.passed));
});

test('failed warm baseline blocks inference trials and does not qualify a timing baseline', async () => {
  let calls = 0;
  const client = { state: 'ready', get controlEvidence() { return { state: this.state, overflow: false, records: [{ phase: 'readiness', sequence: 1, event: 'idle', elapsedMs: 0, remainingMs: 100 }] }; }, settled: async () => {}, complete: async () => { calls++; return { text: '{"answer":"incorrect"}' }; } };
  const result = await runCancellationMatrix({}, client, { render });
  assert.equal(result.passed, false); assert.equal(calls, 1);
  assert.equal(result.baselineP95Ms, null);
  assert.equal(result.trials.length, 6);
  assert.ok(result.trials.every((entry) => entry.notRun && !entry.passed));
});

test('long inference retains the absolute deadline established before preparation', async (t) => {
  let now = performance.now(); let preparationDeadline; let inferenceDeadline; let inferenceRemaining;
  t.mock.method(performance, 'now', () => now);
  const client = { state: 'ready', get controlEvidence() { return { state: this.state, overflow: false, records: [{ phase: 'readiness', sequence: 1, event: 'idle', elapsedMs: 0, remainingMs: 100 }] }; }, settled: async () => {}, complete: async (_prompt, options) => {
    if (options.schema) return { text: '{"answer":"ok"}' };
    inferenceDeadline = options.deadline; inferenceRemaining = options.deadline - now;
    client.state = 'unavailable'; throw new Error('Local model unavailable');
  } };
  await runCancellationMatrix({}, client, { render: async (configuration, prompt, file, deadline) => {
    if (prompt.includes('Record 0000:')) { preparationDeadline = deadline; now += 500; }
    return render(configuration, prompt, file, deadline);
  } });
  assert.equal(inferenceDeadline, preparationDeadline);
  assert.equal(inferenceRemaining, 119500);
});

test('missing or overflowed control evidence prevents cancellation qualification', async () => {
  for (const controlEvidence of [undefined, { state: 'ready', records: [], overflow: true }]) {
    let calls = 0;
    const client = { state: 'ready', controlEvidence, settled: async () => {}, complete: async (_prompt, options) => {
      calls++;
      if (options.schema) return { text: '{"answer":"ok"}' };
      options.onProgress({ processed: 2048, total: 8000, decoded: 0 });
      if (!options.signal.aborted) options.onProgress({ processed: 8000, total: 8000, decoded: 8 });
      throw new Error('Local model cancelled');
    } };
    const result = await runCancellationMatrix({}, client, { render });
    assert.equal(result.passed, false);
    assert.equal(calls, 1);
  }
});
