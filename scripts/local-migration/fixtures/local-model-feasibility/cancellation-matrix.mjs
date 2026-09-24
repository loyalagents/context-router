import { cancellationTrial } from './cancellation.mjs';
import { renderForCompletion } from './protocol.mjs';
import { completeControlEvidence } from './control-evidence.mjs';

const shortPrompt = 'Return exactly {"answer":"ok"}.';
const shortSchema = { type: 'object', properties: { answer: { const: 'ok' } }, required: ['answer'], additionalProperties: false };
const longPrompt = `${Array.from({ length: 400 }, (_, index) => `Record ${String(index).padStart(4, '0')}: synthetic inventory item is blue and belongs to sample group alpha.`).join('\n')}\nFor each record output its number and color, one per line. Include every record.`;
const phases = ['prefill', 'prefill', 'prefill', 'decode', 'decode', 'decode'];

/** One owned-runtime measurement, with no recovery/restart or result-dependent prompt changes. */
export async function runCancellationMatrix(configuration, client, { render = renderForCompletion, onProgress = () => {} } = {}) {
  const baselines = []; const shortControls = [];
  const trials = phases.map((phase, index) => ({ phase, repetition: index % 3, notRun: true, passed: false }));
  let baselineP95Ms = null;
  const short = async () => {
    if (client.state !== 'ready') throw new Error('Cancellation capacity unavailable');
    const start = performance.now();
    const prepared = await render(configuration, shortPrompt, undefined, start + 120000);
    let value;
    try { value = await client.complete(prepared.prompt, { deadline: start + 120000, schema: shortSchema, maxTokens: 128 }); }
    finally { await client.settled(); shortControls.push(client.controlEvidence ?? null); }
    if (!completeControlEvidence(shortControls.at(-1))) throw new Error('Cancellation control evidence failed');
    const parsed = JSON.parse(value.text);
    if (parsed?.answer !== 'ok' || Object.keys(parsed).length !== 1 || client.state !== 'ready') throw new Error('Cancellation followup invalid');
    return performance.now() - start;
  };
  try {
    for (let index = 0; index < 5; index++) {
      const elapsedMs = await short();
      baselines.push({ repetition: index, elapsedMs, passed: elapsedMs <= 60000 });
      onProgress({ stage: 'baseline', repetition: index, elapsedMs });
      if (elapsedMs > 60000) throw new Error('Cancellation baseline exceeded');
    }
    baselineP95Ms = [...baselines.map((entry) => entry.elapsedMs)].sort((a, b) => a - b)[4];
    for (let index = 0; index < phases.length; index++) {
      if (client.state !== 'ready') break;
      const start = performance.now();
      trials[index] = { ...trials[index], notRun: false };
      const prepared = await render(configuration, longPrompt, undefined, start + 120000);
      if (prepared.inputTokens < 4096 || prepared.inputTokens > 12000) throw new Error('Cancellation prefill size invalid');
      const trial = await cancellationTrial({ client, phase: phases[index], prompt: prepared.prompt,
        followup: short, baselineP95Ms, deadline: start + 120000 });
      trials[index] = { ...trials[index], ...trial, inputTokens: prepared.inputTokens };
      onProgress({ stage: 'cancellation', ...trials[index] });
      if (!trial.passed) break;
    }
    return { passed: baselines.length === 5 && trials.every((entry) => entry.passed), baselines, baselineP95Ms, trials, shortControls };
  } catch {
    return { passed: false, baselines, baselineP95Ms, trials, shortControls, failure: 'Bounded cancellation matrix failed' };
  }
}
