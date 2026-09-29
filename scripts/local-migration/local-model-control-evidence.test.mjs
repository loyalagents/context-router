import assert from 'node:assert/strict';
import test from 'node:test';
import { createControlEvidence } from './fixtures/local-model-feasibility/control-evidence.mjs';

test('control evidence projects only fixed labels and numeric counters', () => {
  const trace = createControlEvidence();
  trace.record('settlement', 2, 'dispatch', 4999, { body: 'PRIVATE' });
  trace.record('settlement', 2, 'idle', 4300);
  const value = trace.snapshot('ready');
  assert.equal(value.overflow, false); assert.equal(value.state, 'ready');
  assert.equal(value.records[0].remainingMs, 4999);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  value.records.length = 0;
  assert.equal(trace.snapshot('ready').records.length, 2);
});

test('unknown labels and excessive trace records fail evidence without retaining arbitrary data', () => {
  for (const invalid of ['phase', 'event', 'number']) {
    const trace = createControlEvidence();
    trace.record(invalid === 'phase' ? 'PRIVATE_PHASE' : 'control', invalid === 'number' ? NaN : 1,
      invalid === 'event' ? 'PRIVATE_ERROR' : 'close', 0);
    const value = trace.snapshot('unavailable');
    assert.equal(value.overflow, true); assert.equal(value.records.length, 0);
    assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  }
  const trace = createControlEvidence();
  for (let count = 0; count < 300; count++) trace.record('active', 1, 'busy', 1000);
  const value = trace.snapshot('ready');
  assert.equal(value.overflow, true); assert.ok(value.records.length <= 128);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 16384);
});
