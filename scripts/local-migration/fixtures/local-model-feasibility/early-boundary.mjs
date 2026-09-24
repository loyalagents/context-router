import assert from 'node:assert/strict';
import { renderForCompletion } from './protocol.mjs';
import { completeControlEvidence } from './control-evidence.mjs';

// Fixed CP1 post-write/pre-witness characterization, not a recovery mechanism.
export async function runEarlyBoundary(configuration, client, mode, { render = renderForCompletion } = {}) {
  const result = { passed: false, mode, capacityRecoveryQualified: false };
  const start = performance.now(); const abort = new AbortController(); let injectedAt; let overflow = false;
  try {
    assert.ok(['early-abort', 'early-disconnect'].includes(mode));
    const deadline = start + 120000;
    const prepared = await render(configuration, 'Return exactly {"answer":"ok"}.', undefined, deadline);
    result.inputTokens = prepared.inputTokens;
    try {
      await client.complete(prepared.prompt, { deadline, signal: abort.signal, maxTokens: 128,
        faultAfterWrite: mode === 'early-disconnect' ? 'disconnect' : undefined,
        onWriteFinished: (event) => {
          if (injectedAt !== undefined) { overflow = true; return; }
          injectedAt = performance.now();
          result.injection = { writeFinished: event.writeFinished === true, headersObserved: event.headersObserved === true,
            admitted: event.admitted === true, elapsedMs: injectedAt - start };
          if (mode === 'early-abort') abort.abort();
        },
      });
      result.errorKind = 'none';
    } catch (error) {
      result.errorKind = error.message === 'Local model cancelled' ? 'cancelled' : error.message === 'Local model unavailable' ? 'unavailable' : 'other';
    }
    if (injectedAt !== undefined) result.clientReturnMs = performance.now() - injectedAt;
    await client.settled();
    if (injectedAt !== undefined) result.settledMs = performance.now() - injectedAt;
    result.state = client.state; result.controlEvidence = client.controlEvidence;
    assert.ok(injectedAt !== undefined && !overflow && result.injection.writeFinished && !result.injection.admitted);
    assert.equal(result.errorKind, mode === 'early-abort' ? 'cancelled' : 'unavailable');
    assert.ok(result.clientReturnMs <= 1000 && result.settledMs <= 5000);
    assert.equal(result.state, 'unavailable'); assert.ok(completeControlEvidence(result.controlEvidence));
    const before = JSON.stringify(result.controlEvidence); let wroteAgain = false; let reuseRejected = false;
    try { await client.complete('Return exactly {"answer":"ok"}.', { deadline,
      onWriteFinished: () => { wroteAgain = true; } }); }
    catch (error) { reuseRejected = error.message === 'Local model unavailable'; }
    await client.settled();
    result.reuseRejectedWithoutNewEvidence = reuseRejected && !wroteAgain && before === JSON.stringify(client.controlEvidence);
    assert.ok(result.reuseRejectedWithoutNewEvidence && client.state === 'unavailable');
    result.passed = true;
  } catch { result.failure = 'Bounded early-boundary probe failed'; }
  return result;
}

/** Post-reap native observation only. No release/restart is counted as recovered capacity. */
export function auditEarlyBoundaryLog(bytes, worker) {
  const output = { passed: false, capacityRecoveryQualified: false, tasks: [] };
  try {
    assert.ok(worker?.passed === true && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 512 * 1024 && bytes.at(-1) === 10);
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
    let task; let nativeFraming = false; const timings = new Set();
    for (const line of lines) {
      assert.ok(!/^\d+\.\d+\.\d+\.\d+ E /.test(line));
      if (/^\d+\.\d+\.\d+\.\d+ I srv\s+llama_server: listening on https:\/\/127\.0\.0\.1:\d+$/.test(line)) nativeFraming = true;
      // A damaged prefix/label must not hide a lifecycle candidate as an unrelated line.
      const relevant = ['launch_slot', 'release', 'print_timing'].some((marker) => line.includes(marker));
      if (!relevant) continue;
      const match = /^\d+\.\d+\.\d+\.\d+ I slot\s+(launch_slot_|release|print_timing): id\s+0 \| task (\d+) \| (.*)$/.exec(line);
      assert.ok(match); const [, event, rawId, detail] = match; const id = Number(rawId); assert.ok(Number.isSafeInteger(id));
      nativeFraming = true;
      if (event === 'launch_slot_') {
        assert.ok(!task && detail === 'processing task, is_child = 0');
        task = { taskId: id, released: false, releaseTokens: null, normalFinalTimingCount: 0 }; output.tasks.push(task);
      } else {
        assert.ok(task && task.taskId === id && !task.released);
        if (event === 'release') {
          const release = /^stop processing: n_tokens = (\d+), truncated = 0$/.exec(detail);
          assert.ok(release && Number(release[1]) <= 14048);
          task.released = true; task.releaseTokens = Number(release[1]);
        } else {
          const timing = /^\s*(prompt eval time|eval time|total time|graphs reused) = [\d\s.,()/a-z]+$/.exec(detail);
          assert.ok(timing && !timings.has(timing[1])); timings.add(timing[1]); task.normalFinalTimingCount = timings.size;
        }
      }
    }
    assert.ok(nativeFraming && (timings.size === 0 || timings.size === 4));
    output.nativeTaskState = !task ? 'no-launch-observed' : task.released ? 'release-observed' : 'release-not-observed-before-cleanup';
    output.passed = true;
  } catch { output.failure = 'Bounded early native audit failed'; }
  return output;
}
