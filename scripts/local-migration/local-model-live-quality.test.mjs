import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './fixtures/local-model-feasibility/cases.mjs';
import { fixtureReply } from './fixtures/local-model-feasibility/consumers.mjs';
import { runQuality } from './fixtures/local-model-feasibility/live-quality.mjs';

test('quality runner retains all 48 trials and reports one bounded structure correction', async () => {
  const replies = cases.flatMap((entry) => [0, 1, 2].map(() => JSON.stringify(fixtureReply(entry))));
  let calls = 0;
  const client = { state: 'ready', settled: async () => {}, complete: async () => ({
    text: calls++ === 0 ? '{malformed' : replies.shift(), inputTokens: 100, outputTokens: 30 }) };
  const result = await runQuality({}, client, { render: async () => ({ prompt: 'synthetic rendered prompt' }) });
  assert.equal(calls, 49);
  assert.equal(result.score.passed, true);
  assert.equal(result.measurements.length, 48);
  assert.equal(result.measurements[0].calls.length, 2);
  assert.equal(result.measurements[0].calls[0].structureValid, false);
  assert.equal(result.measurements[0].calls[1].structureValid, true);
});

test('transport failure gets no correction retry and no trial is omitted', async () => {
  let calls = 0;
  const client = { state: 'unavailable', settled: async () => {}, complete: async () => { calls++; throw new Error('transport failed'); } };
  const result = await runQuality({}, client, { render: async () => ({ prompt: 'synthetic rendered prompt' }) });
  assert.equal(calls, 48);
  assert.equal(result.score.passed, false);
  assert.equal(result.score.overall.failedTrials, 48);
  assert.equal(result.measurements.length, 48);
  assert.ok(result.measurements.every((entry) => entry.calls.length === 1 && entry.calls[0].transportFailed));
});
