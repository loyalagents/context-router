/** Counter-only corroboration for one exact owned child after it has exited. */
export function auditCancellationLog(bytes, worker) {
  const calls = [];
  const reject = () => { throw new Error('Native cancellation corroboration failed'); };
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || !worker.passed || worker.baselines?.length !== 5 ||
        worker.trials?.length !== 6 || !worker.baselines.every((entry) => entry.passed) || !worker.trials.every((entry) => entry.passed)) reject();
    const expected = [...Array.from({ length: 5 }, () => null), ...worker.trials.flatMap((trial) => [trial, null])];
    const seen = new Set(); let active;
    for (const line of new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n')) {
      if (/^\S+ E /.test(line)) reject();
      const match = /^\S+ I slot +(\w+): id\s+(\d+) \| task (-?\d+) \| (.*)$/.exec(line);
      const lifecycle = line.includes('processing task,') || line.includes('stop processing:');
      if (!match) { if (lifecycle) reject(); continue; }
      const [, label, slot, rawId, message] = match; const id = Number(rawId);
      if (message.startsWith('processing task,')) {
        if (!label.startsWith('launch_slot') || slot !== '0' || active || seen.has(id) || !Number.isSafeInteger(id) || id < 0 ||
            message !== 'processing task, is_child = 0' || calls.length >= expected.length) reject();
        seen.add(id); active = { taskId: id, index: calls.length, timings: new Set() };
      } else if (message.startsWith('stop processing:')) {
        const release = /^stop processing: n_tokens = (\d+), truncated = 0$/.exec(message);
        if (label !== 'release' || slot !== '0' || !active || active.taskId !== id || !release) reject();
        const nTokensAtRelease = Number(release[1]); if (!Number.isSafeInteger(nTokensAtRelease)) reject();
        const trial = expected[active.index];
        if (trial) {
          const { witness, inputTokens: total, phase } = trial;
          if (!witness || witness.total !== total || active.timings.size || !Number.isInteger(total) || total < 4096 || total > 12000) reject();
          if (phase === 'prefill') {
            if (!(witness.decoded === 0 && witness.processed > 0 && witness.processed <= nTokensAtRelease && nTokensAtRelease < total)) reject();
          } else if (phase === 'decode') {
            if (!(witness.decoded >= 8 && nTokensAtRelease >= total + witness.decoded - 1 && nTokensAtRelease < total + 2048)) reject();
          } else reject();
        } else if (active.timings.size !== 4) reject();
        calls.push({ taskId: id, phase: trial?.phase ?? 'successful-short', nTokensAtRelease, normalFinalTimings: active.timings.size });
        active = undefined;
      } else {
        const timing = /^(prompt eval time|eval time|total time|graphs reused)\s*=/.exec(message.trim());
        if (timing) {
          if (!label.startsWith('print_timing') || slot !== '0' || !active || active.taskId !== id || active.timings.has(timing[1])) reject();
          active.timings.add(timing[1]);
        }
      }
    }
    if (active || calls.length !== 17) reject();
    return { passed: true, calls, interpretation: 'Early task release and same-runtime capacity recovery; queued context counters are not instantaneous GPU telemetry' };
  } catch { return { passed: false, calls, failure: 'Native cancellation corroboration failed' }; }
}
