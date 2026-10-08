import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadinessFixture } from './readiness-fixture.mjs';

const generation = '4ed6f157-08f4-4d84-8cc8-06c74390b299';
const ready = JSON.stringify({ version: 1, generation, kind: 'ready' }) + '\n';
const failed = JSON.stringify({ version: 1, generation, kind: 'failed' }) + '\n';
function fixture() {
  let claims = 0, qualifications = 0, calls = 0;
  const value = new ReadinessFixture(generation, {
    status() { claims++; qualifications++; return { state: 'available', configured: true }; },
    complete() { calls++; return 'synthetic'; },
  });
  return { value, counts: () => ({ claims, qualifications, calls }) };
}
test('slow loading permits non-AI state but never claims, qualifies or dispatches inference', () => {
  const { value, counts } = fixture();
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(value.status(), { state: 'unavailable', configured: true });
    assert.equal(value.dashboard(), 'non-AI available');
    assert.throws(() => value.complete(), /unavailable/);
  }
  assert.deepEqual(counts(), { claims: 0, qualifications: 0, calls: 0 });
  value.receive(ready.slice(0, 10));
  assert.equal(value.status().state, 'unavailable');
  value.receive(ready.slice(10));
  assert.equal(value.status().state, 'available');
  assert.deepEqual(counts(), { claims: 1, qualifications: 1, calls: 0 });
  assert.equal(value.complete(), 'synthetic');
  assert.equal(counts().calls, 1);
});
test('failed, stale, malformed, overlong and lost-control generations cannot re-enable', () => {
  for (const input of [failed, ready.replace(generation, '3ed6f157-08f4-4d84-8cc8-06c74390b299'),
    ready.replace('"kind"', '"extra":true,"kind"'), '{\n', 'x'.repeat(257), ready + ready]) {
    const { value, counts } = fixture();
    value.receive(input); value.receive(ready);
    assert.equal(value.status().state, 'unavailable');
    assert.deepEqual(counts(), { claims: 0, qualifications: 0, calls: 0 });
  }
  const { value } = fixture();
  value.receive(ready); value.controlLost(); value.receive(ready);
  assert.equal(value.status().state, 'unavailable');
});
