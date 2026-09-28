import { mkdtemp, chmod, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnOwned } from './process.mjs';
import { DiagnosticOutput } from './diagnostic-output.mjs';

const failure = () => new Error('Diagnostic worker invalid');
const textValues = new Set(('client-only-cancellation-diagnostic readiness baseline cancellation complete manifest offline application close prefill ready active cancel-pending unavailable settlement control cleanup short long EPERM EACCES dispatch idle busy timeout transport http invalid aborted continuity deadline start attached socket write-finish headers response-end response-close request-close request-error response-error abort client-return settled').split(' '));
const keys = new Set(('mode qualification diagnosticValid cancellationRecovered stoppedAt baselines repetition elapsedMs passed trial phase witnessed cancelled state clientReturnMs settledMs witness admitted processed total decoded terminal terminalObserved observationOverflow observations afterAbortMs controls overflow records sequence event remainingMs operations kind messageSha256 schemaSha256 templates tokenizations nativeCalls inputTokens deadline renderedSha256 wrapperRestored valid requests operation retainedMatch offlineControls nonLoopback otherLoopbackPort dnsTransport resolverUnixIpc identityStable applicationClosed failureStage').split(' '));
function fixedReceipt(value, depth = 0) {
  if (depth > 10) throw failure();
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) return;
  if (typeof value === 'string' && (textValues.has(value) || /^[a-f0-9]{64}$/.test(value))) return;
  if (Array.isArray(value)) {
    if (value.length > 1024) throw failure();
    for (const item of value) fixedReceipt(item, depth + 1); return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { if (!keys.has(key)) throw failure(); fixedReceipt(item, depth + 1); }
    return;
  }
  throw failure();
}

export function parseDiagnosticReceipt(bytes, apiKey) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 800 * 1024 || bytes.includes(Buffer.from(apiKey)) || bytes.includes(Buffer.from('STEP06_PRIVATE_SENTINEL'))) throw failure();
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); fixedReceipt(data);
  if (data.mode !== 'client-only-cancellation-diagnostic' || data.qualification !== false || typeof data.diagnosticValid !== 'boolean' || (data.operations?.length ?? 0) > 6) throw failure();
  return data;
}

/** Dedicated disposable worker. It cannot introduce a seventh operation or raw diagnostic persistence. */
export async function runDiagnosticWorker({ evidenceRoot, credentialRoot, configuration, runtimeChild, memorySample,
  sandboxProfile, workerPath = fileURLToPath(new URL('./client-diagnostic-worker.mjs', import.meta.url)), timeoutMs = 6 * 181000 }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 6 * 181000) throw failure();
  const result = { diagnosticValid: false, data: null, workerStoppedAndReaped: false,
    workerRootRemoved: false, workerOutput: null, memory: [], memoryPassed: false };
  const started = performance.now();
  let root, worker, projection, timer, memoryTimer, memoryFailed = false, stage = 'provision';
  const sample = () => {
    try {
      if (!runtimeChild.running || result.memory.length >= 600) throw failure();
      const raw = memorySample(runtimeChild.pid), value = { elapsedMs: performance.now() - started };
      for (const key of ['physicalFootprintBytes', 'lifetimePeakPhysicalFootprintBytes', 'residentBytes', 'pressure', 'swapUsedBytes']) {
        if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw failure(); value[key] = raw[key];
      }
      result.memory.push(value);
    } catch { memoryFailed = true; }
  };
  try {
    root = await mkdtemp(join(evidenceRoot, 'client-diagnostic-worker-')); await chmod(root, 0o700);
    const configPath = join(root, 'config.json'), outputPath = join(root, 'receipt.json');
    await writeFile(configPath, JSON.stringify({ configuration: { ...configuration, certificate: configuration.certificate.toString('utf8') }, credentialRoot, outputPath }), { flag: 'wx', mode: 0o600 });
    projection = new DiagnosticOutput({ apiKey: configuration.apiKey });
    sample(); memoryTimer = setInterval(sample, 2000);
    stage = 'spawn';
    worker = await spawnOwned({ command: sandboxProfile ? '/usr/bin/sandbox-exec' : process.execPath,
      args: sandboxProfile ? ['-p', sandboxProfile.replaceAll('PORT', String(configuration.port)), process.execPath, workerPath, configPath] : [workerPath, configPath],
      cwd: root, logPath: join(root, 'discard.log'), projection });
    stage = 'wait';
    const outcome = await Promise.race([worker.exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    if (!outcome || worker.logOverflow) throw failure();
    stage = 'receipt';
    const info = await lstat(outputPath);
    if (!info.isFile() || info.size > 800 * 1024) throw failure();
    const bytes = await readFile(outputPath);
    const data = parseDiagnosticReceipt(bytes, configuration.apiKey);
    result.data = data; sample();
    result.memoryPassed = !memoryFailed && result.memory.length > 0 && result.memory.every(item => item.pressure === 1 && item.lifetimePeakPhysicalFootprintBytes <= 18 * 1024 ** 3);
    result.diagnosticValid = outcome.code === 0 && data.diagnosticValid && data.identityStable === true && data.applicationClosed === true && result.memoryPassed;
  } catch { result.diagnosticValid = false; result.failureStage = stage; }
  finally {
    clearTimeout(timer); clearInterval(memoryTimer);
    try {
      if (worker) {
        await worker.stop(); result.workerStoppedAndReaped = !worker.running;
        result.workerOutput = { ...projection.snapshot(), overflow: worker.logOverflow };
        if (worker.logOverflow) result.workerOutput.complete = false;
        if (!result.workerOutput.complete || result.workerOutput.invalid || result.workerOutput.leakDetected) result.diagnosticValid = false;
      } else result.workerStoppedAndReaped = true;
    } catch { result.diagnosticValid = false; }
    if (result.workerStoppedAndReaped) {
      try { if (root) await rm(root, { recursive: true, force: true }); result.workerRootRemoved = true; }
      catch { result.diagnosticValid = false; }
    }
    if (!result.workerStoppedAndReaped || !result.workerRootRemoved) result.diagnosticValid = false;
  }
  return result;
}
