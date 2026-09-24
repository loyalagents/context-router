import assert from 'node:assert/strict';
import test from 'node:test';
import { runEarlyBoundary, auditEarlyBoundaryLog } from './fixtures/local-model-feasibility/early-boundary.mjs';

function clientFixture({ admitted = false, recovered = false, emit = true } = {}) {
  let calls = 0;
  return { state: 'ready', get calls() { return calls; }, settled: async () => {},
    get controlEvidence() { return { state: this.state, overflow: false, records: [{ phase: 'readiness', sequence: 1, event: 'dispatch', elapsedMs: 0, remainingMs: 5000 }] }; },
    async complete(_, options) {
      calls++;
      if (this.state === 'unavailable') throw new Error('Local model unavailable');
      if (emit) options.onWriteFinished({ writeFinished: true, headersObserved: false, admitted });
      this.state = recovered ? 'ready' : 'unavailable';
      throw new Error(options.signal.aborted ? 'Local model cancelled' : 'Local model unavailable');
    },
  };
}
const render = async () => ({ prompt: 'synthetic', inputTokens: 20 });

test('post-write caller abort and injected transport loss retain unknown work and reject reuse', async () => {
  for (const mode of ['early-abort', 'early-disconnect']) {
    const client = clientFixture();
    const result = await runEarlyBoundary({}, client, mode, { render });
    assert.equal(result.passed, true);
    assert.equal(result.capacityRecoveryQualified, false);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.reuseRejectedWithoutNewEvidence, true);
    assert.equal(client.calls, 2);
  }
});

test('a missed boundary, missing injection or unexpected recovered capacity cannot qualify', async () => {
  for (const options of [{ admitted: true }, { emit: false }, { recovered: true }]) {
    const result = await runEarlyBoundary({}, clientFixture(options), 'early-disconnect', { render });
    assert.equal(result.passed, false);
    assert.equal(result.capacityRecoveryQualified, false);
  }
});

const launch = '0.01.000.000 I slot launch_slot_: id  0 | task 1 | processing task, is_child = 0\n';
const release = '0.01.500.000 I slot      release: id  0 | task 1 | stop processing: n_tokens = 0, truncated = 0\n';
const startup = '0.00.500.000 I srv  llama_server: listening on https://127.0.0.1:12345\n';
test('early native projection distinguishes no admission, observed release and unknown-at-cleanup', () => {
  assert.equal(auditEarlyBoundaryLog(Buffer.from(startup), { passed: true }).nativeTaskState, 'no-launch-observed');
  assert.equal(auditEarlyBoundaryLog(Buffer.from(launch), { passed: true }).nativeTaskState, 'release-not-observed-before-cleanup');
  const result = auditEarlyBoundaryLog(Buffer.from(launch + release), { passed: true });
  assert.equal(result.passed, true);
  assert.equal(result.nativeTaskState, 'release-observed');
  assert.equal(result.capacityRecoveryQualified, false);
  assert.equal(result.tasks[0].releaseTokens, 0);
});

test('ambiguous, repeated, invalid or oversized native evidence fails the early-case audit', () => {
  for (const body of ['', 'unrecognized raw log\n', startup + launch.replace('0.01.000.000', '0.01.'),
    startup + release.replace('0.01.500.000', '0.01.'), startup + launch.replace('launch_slot_', 'launch_slot_new'),
    startup + release.replace('release:', 'release_new:'), startup + launch.replace(' I ', ' X '),
    release, launch.slice(0, -1), launch + launch, launch + release + release, launch + release.replace('task 1', 'task 2'),
    launch + release.replace('truncated = 0', 'truncated = 1'), Buffer.from([0xff]), Buffer.alloc(512 * 1024 + 1)]) {
    assert.equal(auditEarlyBoundaryLog(Buffer.from(body), { passed: true }).passed, false);
  }
  assert.equal(auditEarlyBoundaryLog(Buffer.from(''), { passed: false }).passed, false);
});
