import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCancellationLog } from './fixtures/local-model-feasibility/cancellation-audit.mjs';

function fixture() {
  const trials = ['prefill', 'prefill', 'prefill', 'decode', 'decode', 'decode'].map((phase) => ({ phase, passed: true,
    inputTokens: 8000, witness: { total: 8000, processed: phase === 'prefill' ? 2048 : 8000, decoded: phase === 'prefill' ? 0 : 8 } }));
  const worker = { passed: true, baselines: Array.from({ length: 5 }, () => ({ passed: true })), trials };
  const calls = [...Array.from({ length: 5 }, () => null), ...trials.flatMap((trial) => [trial, null])];
  const chunks = calls.map((trial, index) => {
    const prefix = `0.00.000.000 I slot print_timing: id  0 | task ${index + 1} | `;
    const timings = trial ? '' : ['prompt eval time = 1 ms / 64 tokens', '       eval time = 1 ms / 6 tokens', '      total time = 2 ms / 70 tokens', '   graphs reused = 4'].map((value) => `${prefix}${value}\n`).join('');
    return `0.00.000.000 I slot launch_slot_: id  0 | task ${index + 1} | processing task, is_child = 0\n${timings}0.00.000.000 I slot      release: id  0 | task ${index + 1} | stop processing: n_tokens = ${trial ? trial.phase === 'prefill' ? 4096 : 8008 : 69}, truncated = 0\n`;
  });
  return { worker, chunks };
}

test('audit binds native early releases to the complete ordered matrix', () => {
  const { worker, chunks } = fixture();
  const result = auditCancellationLog(Buffer.from(chunks.join('')), worker);
  assert.equal(result.passed, true); assert.equal(result.calls.length, 17);
  assert.equal(result.calls[5].nTokensAtRelease, 4096);
});

test('completed, errored, truncated, missing and duplicated native lifecycles fail', () => {
  const { worker, chunks } = fixture();
  const log = chunks.join('');
  for (const broken of [log.replace('task 6 | stop processing', 'task 6 | prompt eval time = 1 ms / 8000 tokens\n0.00.000.000 I slot release: id 0 | task 6 | stop processing'),
    `${log}0.00.000.000 E srv task id = 6, error: synthetic\n`, log.replace('truncated = 0', 'truncated = 1'),
    chunks.slice(0, -1).join(''), chunks.join('') + chunks[0], log.replaceAll('task 6 |', 'task 5 |')]) {
    assert.equal(auditCancellationLog(Buffer.from(broken), worker).passed, false);
  }
});

test('stale or mismatched phase witnesses cannot qualify native counter evidence', () => {
  const { worker, chunks } = fixture(); const log = chunks.join('');
  assert.equal(auditCancellationLog(Buffer.from(log.replace('n_tokens = 4096', 'n_tokens = 8000')), worker).passed, false);
  assert.equal(auditCancellationLog(Buffer.from(log.replace('n_tokens = 8008', 'n_tokens = 8006')), worker).passed, false);
  worker.trials[0].witness.total = 7999;
  assert.equal(auditCancellationLog(Buffer.from(log), worker).passed, false);
});

test('missing normal timing, invalid UTF8 and oversized diagnostics fail closed', () => {
  const { worker, chunks } = fixture();
  assert.equal(auditCancellationLog(Buffer.from(chunks.join('').replace('graphs reused = 4', 'unrecognized')), worker).passed, false);
  assert.equal(auditCancellationLog(Buffer.from([0xff]), worker).passed, false);
  assert.equal(auditCancellationLog(Buffer.alloc(512 * 1024 + 1), worker).passed, false);
});
