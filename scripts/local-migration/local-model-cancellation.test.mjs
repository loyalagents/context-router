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
