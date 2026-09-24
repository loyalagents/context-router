export async function cancellationTrial({ client, phase, prompt, controller = new AbortController(), followup, baselineP95Ms }) {
  if (!['prefill', 'decode'].includes(phase)) throw new Error('Unknown cancellation phase');
  let abortAt; let witness; let returnedAt; let cancelled = false;
  const start = performance.now();
  try {
    await client.complete(prompt, { signal: controller.signal, deadline: start + 120000,
      onProgress: (event) => {
        const matched = phase === 'prefill' ? event.processed > 0 && event.processed < event.total && event.decoded === 0 : event.decoded >= 8;
        if (abortAt === undefined && matched) { witness = event; abortAt = performance.now(); controller.abort(); }
      } });
    returnedAt = performance.now();
  } catch (error) { returnedAt = performance.now(); cancelled = error.message === 'Local model cancelled'; }
  await client.settled();
  const settledAt = performance.now();
  const result = { phase, witnessed: abortAt !== undefined, cancelled, state: client.state,
    clientReturnMs: abortAt === undefined ? null : returnedAt - abortAt,
    settledMs: abortAt === undefined ? null : settledAt - abortAt, witness: witness ?? null, passed: false };
  if (!result.witnessed || !cancelled || client.state !== 'ready') return result;
  result.followupMs = await followup();
  result.passed = result.clientReturnMs <= 1000 && result.settledMs <= 5000 && result.followupMs <= baselineP95Ms + 5000;
  return result;
}
