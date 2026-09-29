import assert from 'node:assert/strict';
import { createProductionCancellationBridge, shortPrompt, longPrompt } from './production-cancellation.mjs';
import { completeControlEvidence } from './control-evidence.mjs';
import { installControlObserver } from './client-observer.mjs';

/** One diagnostic, never a qualification runner: five short calls, one prefill abort, no followup. */
export async function runClientDiagnostic(service) {
  const result = { mode: 'client-only-cancellation-diagnostic', qualification: false, diagnosticValid: false,
    cancellationRecovered: false, stoppedAt: 'readiness', baselines: [], trial: null,
    observations: [], controls: [], operations: [], wrapperRestored: false };
  let bridge, observer;
  try {
    assert.equal((await service.getStatus()).state, 'available'); await service.settled();
    bridge = createProductionCancellationBridge(service);
    const client = bridge.client;
    observer = installControlObserver({ getControlEvidence: () => client.controlEvidence });
    const finish = async () => {
      await client.settled(); observer.mark('settled');
      const control = client.controlEvidence;
      result.controls.push(control); result.observations.push(observer.end(control));
      assert.ok(completeControlEvidence(control));
      assert.ok(result.observations.at(-1).valid);
    };
    result.stoppedAt = 'baseline';
    for (let repetition = 0; repetition < 5; repetition++) {
      assert.equal(client.state, 'ready'); observer.begin(repetition);
      const started = performance.now(); let response, successful = false;
      try {
        response = await client.complete(shortPrompt, { deadline: started + 120000 });
        assert.deepEqual(JSON.parse(response.text), { answer: 'ok' }); successful = true;
      } catch { /* Fixed pass/fail evidence only, never a response or exception. */ }
      finally {
        observer.mark('client-return');
        try { await finish(); } catch { successful = false; }
        const elapsedMs = performance.now() - started;
        result.baselines.push({ repetition, elapsedMs, passed: successful && elapsedMs <= 60000 && client.state === 'ready' });
      }
      if (!result.baselines.at(-1).passed) return result;
    }
    result.stoppedAt = 'cancellation'; assert.equal(client.state, 'ready'); observer.begin(5);
    const controller = new AbortController();
    let abortAt, returnedAt, witness, cancelled = false, terminalObserved = false, observationOverflow = false;
    const progress = [];
    try {
      await client.complete(longPrompt, { signal: controller.signal, deadline: performance.now() + 120000,
        onTerminalObservation: () => { terminalObserved = true; },
        onProgress(event) {
          terminalObserved ||= event.terminal === true;
          const projected = { admitted: event.admitted === true, processed: event.processed,
            total: event.total, decoded: event.decoded, terminal: event.terminal === true };
          if (abortAt === undefined && !event.terminal && event.processed > 0 && event.processed < event.total && event.decoded === 0) {
            witness = projected; abortAt = performance.now(); observer.mark('abort'); controller.abort();
          }
          if (abortAt !== undefined) {
            if (progress.length >= 32) observationOverflow = true;
            else progress.push({ ...projected, afterAbortMs: performance.now() - abortAt });
          }
        },
      });
    } catch (error) { cancelled = error?.kind === 'cancelled' || error?.message === 'Local model cancelled'; }
    finally { returnedAt = performance.now(); observer.mark('client-return'); }
    let observed = true;
    try { await finish(); } catch { observed = false; }
    const settledAt = performance.now();
    result.trial = { phase: 'prefill', witnessed: abortAt !== undefined, cancelled, state: client.state,
      clientReturnMs: abortAt === undefined ? null : returnedAt - abortAt,
      settledMs: abortAt === undefined ? null : settledAt - abortAt,
      witness: witness ?? null, terminalObserved, observationOverflow, observations: progress };
    result.diagnosticValid = observed && result.trial.witnessed && cancelled && !terminalObserved && !observationOverflow &&
      bridge.records.length === 6 && bridge.records.every(record => record.nativeCalls === 1);
    result.cancellationRecovered = result.diagnosticValid && client.state === 'ready' &&
      result.trial.clientReturnMs <= 1000 && result.trial.settledMs <= 5000;
    result.stoppedAt = 'complete';
  } catch { result.diagnosticValid = false; }
  finally {
    try { if (bridge) await bridge.restore(); } catch { result.diagnosticValid = false; }
    result.operations = bridge?.records ?? [];
    result.wrapperRestored = observer ? observer.restore() : false;
    if (!result.wrapperRestored) result.diagnosticValid = false;
    // 96 KiB observer + unchanged 16 KiB control + bounded progress/metadata fit 128 KiB per operation.
    for (let i = 0; i < result.operations.length; i++) {
      if (Buffer.byteLength(JSON.stringify({ operation: result.operations[i], observation: result.observations[i],
        control: result.controls[i], trial: i === 5 ? result.trial : result.baselines[i] })) > 128 * 1024) result.diagnosticValid = false;
    }
    if (result.operations.length > 6 || Buffer.byteLength(JSON.stringify(result)) > 768 * 1024) throw new Error('Diagnostic receipt invalid');
    if (!result.diagnosticValid) result.cancellationRecovered = false;
  }
  return result;
}
