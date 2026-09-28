import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeArgs, vacantPort, summarizeProps } from './native.mjs';
import { createTlsFixture } from './tls-fixture.mjs';
import { probeJson } from './client.mjs';
import { spawnOwned } from './process.mjs';
import { DiagnosticOutput } from './diagnostic-output.mjs';

const failed = () => new Error('Native diagnostic invalid');

/** Exact owned diagnostic child; unchanged supported flags, no raw native log persistence. */
export async function runDiagnosticNative({ binary, model, logPath, sandboxProfile }, use) {
  const result = { valid: false, phase: 'credentials', ownedChildStoppedAndReaped: false,
    credentialRootRemoved: false, nativeOutput: null, worker: null };
  const start = performance.now();
  let credentials, child, projection, enteredWorker = false;
  try {
    credentials = await createTlsFixture();
    projection = new DiagnosticOutput({ apiKey: credentials.apiKey });
    const port = await vacantPort();
    const configuration = { port, certificate: credentials.cert, apiKey: credentials.apiKey };
    const args = runtimeArgs({ model, port, ...credentials });
    result.phase = 'spawn';
    child = await spawnOwned({ command: sandboxProfile ? '/usr/bin/sandbox-exec' : binary,
      args: sandboxProfile ? ['-p', sandboxProfile.replaceAll('PORT', String(port)), binary, ...args] : args,
      cwd: credentials.root, logPath, projection });
    result.phase = 'readiness';
    const until = start + 120000; let healthy = false;
    while (performance.now() < until && child.running && !child.logOverflow) {
      try { await probeJson(configuration, '/health', undefined, { timeoutMs: Math.min(1000, until - performance.now()) }); healthy = true; break; }
      catch { await delay(200); }
    }
    if (!healthy || performance.now() >= until || !child.running || child.logOverflow) throw failed();
    for (const key of [null, 'deliberately-wrong-key']) await probeJson(configuration, '/props', undefined, { key, expectedStatus: 401 });
    const metadata = summarizeProps((await probeJson(configuration, '/props')).value);
    const models = (await probeJson(configuration, '/models')).value;
    if (!Array.isArray(models?.data) || models.data.length !== 1 || models.data[0].id !== 'step06-qwen35') throw failed();
    const coldReadyMs = performance.now() - start;
    if (coldReadyMs > 120000) throw failed();
    result.metadata = { ...metadata, coldReadyMs };
    result.phase = 'worker'; enteredWorker = true;
    result.worker = await use({ configuration, credentialRoot: await realpath(credentials.root), child, metadata });
    result.valid = result.worker?.diagnosticValid === true && result.worker?.workerStoppedAndReaped === true;
    result.phase = 'cleanup';
  } catch { result.valid = false; }
  finally {
    try {
      if (child) {
        const outcome = await child.stop();
        result.ownedChildStoppedAndReaped = !child.running;
        result.nativeOutput = { ...projection.snapshot(), overflow: child.logOverflow };
        if (child.logOverflow) result.nativeOutput.complete = false;
        if (!result.nativeOutput.complete || result.nativeOutput.invalid || result.nativeOutput.leakDetected ||
            (outcome.code !== 0 && outcome.signal !== 'SIGTERM')) result.valid = false;
      } else result.ownedChildStoppedAndReaped = true;
    } catch { result.valid = false; }
    if (result.ownedChildStoppedAndReaped && (!enteredWorker || result.worker?.workerStoppedAndReaped === true)) {
      try { await credentials?.remove(); result.credentialRootRemoved = !!credentials; }
      catch { result.valid = false; }
    }
    if (!result.ownedChildStoppedAndReaped || !result.credentialRootRemoved) result.valid = false;
  }
  return result;
}
