import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { fixture } from './fixtures/session-fixture.mjs';
import { runClientDiagnostic } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/client-diagnostic.mjs';
import { parseDiagnosticReceipt } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/diagnostic-worker-runner.mjs';
import { longPrompt } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/production-cancellation.mjs';

function prefill(f, mode = 'ready') {
  let started = false;
  f.state.hook = async (req, res, body) => {
    if (req.url === '/tokenize' && JSON.parse(body).content.endsWith(longPrompt)) {
      res.end(JSON.stringify({ tokens: Array(5000).fill(1) })); return true;
    }
    if (req.url === '/completion' && JSON.parse(body).prompt.endsWith(longPrompt)) {
      started = true; f.state.completionBodies.push(JSON.parse(body));
      res.setHeader('content-type', 'text/event-stream');
      for (const processed of [0, 512]) res.write('data: ' + JSON.stringify({ index: 0, stop: false, content: '', tokens_predicted: 0,
        tokens_evaluated: 5000, prompt_progress: { total: 5000, cache: 0, processed, time_ms: 1 } }) + '\n\n');
      return true;
    }
    if (req.url === '/slots' && started && mode === 'stall') return true;
    if (req.url === '/slots' && started && mode === 'delayed') {
      setTimeout(() => {
        res.setHeader('content-type', 'application/json'); res.write('[{"id":0,');
        setTimeout(() => res.end('"is_processing":false}]'), 40);
      }, 40); return true;
    }
    return false;
  };
}

test('diagnostic uses exactly five baseline calls and one prefill abort, no followup, and restores original transport/service', async t => {
  const f = await fixture(t); prefill(f);
  const request = https.request;
  assert.equal((await f.service.getStatus()).state, 'available');
  const complete = f.service.client.complete, probe = f.service.probe;
  const result = await runClientDiagnostic(f.service);
  assert.equal(result.diagnosticValid, true); assert.equal(result.qualification, false);
  assert.equal(result.cancellationRecovered, true); assert.equal(result.wrapperRestored, true);
  assert.equal(result.baselines.length, 5); assert.equal(result.operations.length, 6);
  assert.equal(result.trial.witness.processed, 512); assert.equal(result.trial.witness.total, 5000);
  assert.equal(result.trial.cancelled, true); assert.equal(result.trial.terminalObserved, false);
  assert.equal(f.state.completionBodies.length, 6); assert.ok(f.state.completionBodies.every(body => body.n_predict === 2048));
  assert.equal(f.state.calls.filter(path => path === '/apply-template').length, 6);
  assert.equal(f.state.calls.filter(path => path === '/tokenize').length, 6);
  assert.ok(result.observations.every(op => op.valid && Buffer.byteLength(JSON.stringify(op)) <= 96 * 1024));
  assert.equal(https.request, request); assert.equal(f.service.client.complete, complete); assert.equal(f.service.probe, probe);
  const serialized = JSON.stringify(result);
  assert.deepEqual(parseDiagnosticReceipt(Buffer.from(serialized), f.credentials.apiKey), result);
  assert.ok(!serialized.includes(longPrompt)); assert.ok(!serialized.includes(f.credentials.apiKey));
  assert.ok(serialized.length < 768 * 1024);
});

test('baseline invalid output stops after one inference without retry and restores observation', async t => {
  const f = await fixture(t); f.state.reply = 'invalid';
  const request = https.request;
  const result = await runClientDiagnostic(f.service);
  assert.equal(result.diagnosticValid, false); assert.equal(result.stoppedAt, 'baseline');
  assert.equal(result.baselines.length, 1); assert.equal(result.operations.length, 1); assert.equal(result.trial, null);
  assert.equal(f.state.completionBodies.length, 1); assert.equal(https.request, request);
  assert.equal(result.wrapperRestored, true);
});

test('diagnostic records delayed headers and end while unchanged client still accepts timely settlement', async t => {
  const f = await fixture(t); prefill(f, 'delayed');
  const result = await runClientDiagnostic(f.service);
  assert.equal(result.diagnosticValid, true); assert.equal(result.cancellationRecovered, true);
  const records = result.observations.at(-1).records;
  const sequence = records.filter(r => r.event === 'dispatch').at(-1).sequence;
  const time = event => records.find(r => r.sequence === sequence && r.event === event).elapsedMs;
  assert.ok(time('headers') - time('write-finish') >= 20);
  assert.ok(time('response-end') - time('headers') >= 20);
  assert.ok(result.trial.settledMs < 5000); assert.equal(f.state.completionBodies.length, 6);
});

test('stalled post-abort control response preserves absolute five-second deadline and unavailable latch without another request', async t => {
  const f = await fixture(t); prefill(f, 'stall');
  const result = await runClientDiagnostic(f.service);
  assert.equal(result.diagnosticValid, true); assert.equal(result.cancellationRecovered, false);
  assert.equal(result.trial.state, 'unavailable');
  assert.ok(result.trial.settledMs >= 4900 && result.trial.settledMs < 6000);
  const observed = result.observations.at(-1), sequence = observed.records.filter(r => r.event === 'dispatch').at(-1).sequence;
  assert.equal(observed.records.some(r => r.sequence === sequence && r.event === 'write-finish'), true);
  assert.equal(observed.records.some(r => r.sequence === sequence && r.event === 'headers'), false);
  assert.equal(observed.records.some(r => r.sequence === sequence && r.event === 'request-close'), true);
  assert.equal(f.state.completionBodies.length, 6);
  const before = f.state.calls.length;
  await assert.rejects(f.service.generateText('must stay unavailable'), error => error.kind === 'unavailable');
  assert.equal(f.state.calls.length, before);
});
