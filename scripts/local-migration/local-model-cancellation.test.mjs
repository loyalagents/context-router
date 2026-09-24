import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellationTrial } from './fixtures/local-model-feasibility/cancellation.mjs';

test('prefill requires observed intermediate processing and decode requires emitted tokens', async () => {
  for (const phase of ['prefill', 'decode']) {
    const controller = new AbortController();
    let signalAtIntermediate = false;
    const client = { state: 'ready', complete: async (_prompt, options) => {
      options.onProgress({ admitted: true, processed: 0, total: 100, decoded: 0 });
      assert.equal(options.signal.aborted, false);
      options.onProgress({ admitted: false, processed: 50, total: 100, decoded: 0 });
      signalAtIntermediate = options.signal.aborted;
      if (phase === 'decode') options.onProgress({ admitted: false, processed: 100, total: 100, decoded: 8 });
      assert.equal(options.signal.aborted, true);
      throw new Error('Local model cancelled');
    }, settled: async () => {} };
    const result = await cancellationTrial({ client, phase, prompt: 'rendered', controller, followup: async () => 2, baselineP95Ms: 10 });
    assert.equal(result.passed, true);
    assert.equal(signalAtIntermediate, phase === 'prefill');
  }
});

test('unknown settlement or no phase witness can never count as recovered cancellation', async () => {
  let followed = false;
  const client = { state: 'unavailable', complete: async () => { throw new Error('Local model unavailable'); }, settled: async () => {} };
  const result = await cancellationTrial({ client, phase: 'prefill', prompt: 'rendered', followup: async () => { followed = true; return 0; }, baselineP95Ms: 10 });
  assert.equal(result.passed, false); assert.equal(followed, false);
});

test('a terminal-only or coalesced completed response never qualifies cancellation', async () => {
  for (const coalesced of [false, true]) {
    let followed = false;
    const client = { state: 'ready', settled: async () => {}, complete: async (_prompt, options) => {
      if (coalesced) options.onProgress({ processed: 100, total: 100, decoded: 8, terminal: false });
      options.onProgress({ processed: 100, total: 100, decoded: 9, terminal: true });
      throw new Error('Local model cancelled');
    } };
    const result = await cancellationTrial({ client, phase: 'decode', prompt: 'synthetic', followup: async () => { followed = true; return 1; }, baselineP95Ms: 10 });
    assert.equal(result.passed, false); assert.equal(followed, false);
    assert.equal(result.terminalObserved, true);
    assert.equal(result.witnessed, coalesced);
  }
});

test('followup failure retains the cancellation witness and timing evidence', async () => {
  const client = { state: 'ready', settled: async () => {}, complete: async (_prompt, options) => {
    options.onProgress({ processed: 100, total: 100, decoded: 8, terminal: false });
    throw new Error('Local model cancelled');
  } };
  const result = await cancellationTrial({ client, phase: 'decode', prompt: 'synthetic',
    followup: async () => { throw new Error('private diagnostic must not escape'); }, baselineP95Ms: 10 });
  assert.equal(result.passed, false); assert.equal(result.witnessed, true);
  assert.ok(result.clientReturnMs >= 0 && result.settledMs >= 0);
  assert.equal(result.failure, 'Cancellation followup failed');
  assert.ok(!JSON.stringify(result).includes('private diagnostic'));
});

test('post-trigger progress retention is bounded and overflow fails measurement', async () => {
  const client = { state: 'ready', settled: async () => {}, complete: async (_prompt, options) => {
    for (let decoded = 8; decoded < 80; decoded++) options.onProgress({ processed: 100, total: 100, decoded, terminal: false, content: 'must not retain' });
    throw new Error('Local model cancelled');
  } };
  const result = await cancellationTrial({ client, phase: 'decode', prompt: 'synthetic', followup: async () => 1, baselineP95Ms: 10 });
  assert.equal(result.passed, false); assert.equal(result.observations.length, 32);
  assert.equal(result.observationOverflow, true);
  assert.ok(!JSON.stringify(result).includes('must not retain'));
});
