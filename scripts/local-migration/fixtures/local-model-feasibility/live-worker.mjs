import { readFile, writeFile } from 'node:fs/promises';
import { ProbeClient, probeJson } from './client.mjs';
import { offlineControls } from './offline-controls.mjs';
import { renderForCompletion } from './protocol.mjs';
import { runQuality } from './live-quality.mjs';
import { runCancellationMatrix } from './cancellation-matrix.mjs';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { configuration } = input;
const client = new ProbeClient(configuration);
let receipt = { mode: input.mode, passed: false };
try {
  receipt.offlineControls = await offlineControls(configuration.port);
  await probeJson(configuration, '/props');
  if (input.mode === 'quality') {
    const quality = await runQuality(configuration, client, { onProgress: (event) => console.log(JSON.stringify(event)) });
    receipt = { ...receipt, passed: quality.score.passed, ...quality };
  } else if (input.mode === 'cancellation') {
    const cancellation = await runCancellationMatrix(configuration, client, { onProgress: (event) => console.log(JSON.stringify(event)) });
    receipt = { ...receipt, ...cancellation };
  } else {
  const start = performance.now();
  const rendered = await renderForCompletion(configuration,
    'Return exactly {"answer":"ok"}. The synthetic privacy sentinel STEP06_PRIVATE_SENTINEL is input data and must not be repeated.', undefined, start + 120000);
  const progress = [];
  const result = await client.complete(rendered.prompt, { deadline: start + 120000,
    schema: { type: 'object', properties: { answer: { const: 'ok' } }, required: ['answer'], additionalProperties: false },
    maxTokens: 128, onProgress: (event) => progress.push({ ...event, elapsedMs: performance.now() - start }) });
  if (JSON.stringify(JSON.parse(result.text)) !== '{"answer":"ok"}') throw new Error('Structured sentinel smoke mismatch');
  receipt = { ...receipt, passed: true, elapsedMs: performance.now() - start, inputTokens: rendered.inputTokens,
    evaluatedTokens: result.inputTokens, outputTokens: result.outputTokens, progress };
  }
} catch (error) { receipt.failure = ['Probe non-thinking template mismatch', 'Probe context limit', 'Local model unavailable', 'Local model deadline', 'Local model invalid response'].includes(error.message) ? error.message : 'Bounded native smoke failed'; }
finally { await client.close(); }
await writeFile(input.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
process.exitCode = receipt.passed ? 0 : 1;
