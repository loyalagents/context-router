import { completeControlEvidence } from './control-evidence.mjs';
export async function cancellationTrial({ client, phase, prompt, controller = new AbortController(), followup, baselineP95Ms,
  deadline = performance.now() + 120000 }) {
  if (!['prefill', 'decode'].includes(phase)) throw new Error('Unknown cancellation phase');
  let abortAt; let witness; let returnedAt; let cancelled = false; let terminalObserved = false; let observationOverflow = false;
  const observations = [];
  try {
    await client.complete(prompt, { signal: controller.signal, deadline,
      onTerminalObservation: () => { terminalObserved = true; },
      onProgress: (event) => {
        terminalObserved ||= event.terminal === true;
        const matched = !event.terminal && (phase === 'prefill'
          ? event.processed > 0 && event.processed < event.total && event.decoded === 0 : event.decoded >= 8);
        const projected = { admitted: event.admitted === true, processed: event.processed, total: event.total,
          decoded: event.decoded, terminal: event.terminal === true };
        if (abortAt === undefined && matched) { witness = projected; abortAt = performance.now(); controller.abort(); }
        if (abortAt !== undefined) {
          if (observations.length === 32) observationOverflow = true;
          else observations.push({ ...projected, afterAbortMs: performance.now() - abortAt });
        }
      } });
    returnedAt = performance.now();
  } catch (error) { returnedAt = performance.now(); cancelled = error.message === 'Local model cancelled'; }
  await client.settled();
  const settledAt = performance.now();
  const result = { phase, witnessed: abortAt !== undefined, cancelled, state: client.state,
    clientReturnMs: abortAt === undefined ? null : returnedAt - abortAt,
    settledMs: abortAt === undefined ? null : settledAt - abortAt, witness: witness ?? null,
    terminalObserved, observationOverflow, observations, controlEvidence: client.controlEvidence, passed: false };
  if (!completeControlEvidence(result.controlEvidence)) return { ...result, failure: 'Cancellation control evidence failed' };
  if (!result.witnessed || !cancelled || terminalObserved || observationOverflow || client.state !== 'ready') return result;
  try { result.followupMs = await followup(); }
  catch { return { ...result, failure: 'Cancellation followup failed' }; }
  result.passed = result.clientReturnMs <= 1000 && result.settledMs <= 5000 && result.followupMs <= baselineP95Ms + 5000;
  return result;
}
