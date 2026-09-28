import { open, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const seriesClaimName = 'client-diagnostic-three-session.claim.json';
const originalClaimName = 'client-diagnostic-approved-2026-09-27.claim.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failed = () => new Error('Diagnostic series invalid');
async function retain(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}
const abnormal = sample => sample && sample.pressure !== 1;
function disposition(value) {
  const worker = value.worker, data = worker?.data;
  const outputs = [value.nativeOutput, worker?.workerOutput];
  if (outputs.some(x => x?.leakDetected)) return 'leak';
  if (outputs.some(x => x?.overflow) || data?.observations?.some(x => x.overflow) ||
      data?.controls?.some(x => x.overflow) || data?.trial?.observationOverflow) return 'overflow';
  if (abnormal(value.memoryBefore) || abnormal(value.memoryAfter)) return 'abnormal-memory';
  if (value.ownedChildStoppedAndReaped !== true || value.credentialRootRemoved !== true ||
      worker?.workerStoppedAndReaped !== true || worker?.workerRootRemoved !== true) return 'cleanup-uncertain';
  if (worker.memoryPassed !== true || abnormal(value.memoryBefore) || abnormal(value.memoryAfter)) return 'abnormal-memory';
  if (data?.baselines && (data.baselines.length !== 5 || data.baselines.some(x => x.passed !== true))) return 'baseline-failed';
  if (value.valid !== true || worker.diagnosticValid !== true || data?.diagnosticValid !== true ||
      data.qualification !== false || data.wrapperRestored !== true || data.identityStable !== true || data.applicationClosed !== true ||
      outputs.some(x => !x || x.complete !== true || x.invalid !== false || x.leakDetected !== false || x.overflow !== false) ||
      data.baselines?.length !== 5 || data.operations?.length !== 6 || data.operations.some(x => x.nativeCalls !== 1) ||
      data.observations?.length !== 6 || data.observations.some(x => x.valid !== true || x.overflow !== false) ||
      data.controls?.length !== 6 || data.controls.some(x => x.overflow !== false)) return 'invalid-observation';
  const trial = data.trial;
  if (data.cancellationRecovered !== true || trial?.witnessed !== true || trial.cancelled !== true ||
      trial.terminalObserved !== false || trial.state !== 'ready' ||
      !Number.isFinite(trial.clientReturnMs) || trial.clientReturnMs < 0 || trial.clientReturnMs > 1000 ||
      !Number.isFinite(trial.settledMs) || trial.settledMs < 0 || trial.settledMs > 5000) return 'cancellation-unrecovered';
  return 'complete';
}
function observedCalls(value) {
  const operations = value.worker?.data?.operations;
  if (!Array.isArray(operations) || operations.some(x => !Number.isSafeInteger(x.nativeCalls) || x.nativeCalls < 0)) return null;
  return operations.reduce((sum, x) => sum + x.nativeCalls, 0);
}

/** One consumed authorization, at most three sequential sessions; never a qualification/retry loop. */
export async function runDiagnosticSeries({ evidenceRoot, testedRevision, manifestSha256, originalClaimSha256, preflight, runSession }) {
  if (!/^[a-f0-9]{40}$/.test(testedRevision) || !/^[a-f0-9]{64}$/.test(manifestSha256) ||
      !/^[a-f0-9]{64}$/.test(originalClaimSha256)) throw failed();
  const run = 'native-9b-client-reproducibility-' + Date.now();
  // Exclusive creation is permanent, including preflight, interruption and partial failures.
  await retain(join(evidenceRoot, seriesClaimName), JSON.stringify({ run, testedRevision, manifestSha256, originalClaimSha256 }) + '\n');
  const directory = await open(evidenceRoot, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  const aggregate = { run, testedRevision, manifestSha256, qualification: false, stopReason: 'preflight',
    maximumReservedInferenceCalls: 0, observedInferenceCalls: 0, attempts: [] };
  try {
    const originalPath = join(evidenceRoot, originalClaimName), info = await lstat(originalPath);
    if (!info.isFile() || info.size > 4096 || hash(await readFile(originalPath)) !== originalClaimSha256) throw failed();
    await preflight();
    for (let index = 0; index < 3; index++) {
      const receipt = run + '-session-' + (index + 1) + '.json';
      const attempt = { session: index + 1, receipt, retained: false, bytes: 0, sha256: null, observedInferenceCalls: null, stopReason: 'session-error' };
      aggregate.attempts.push(attempt); aggregate.maximumReservedInferenceCalls += 6;
      let value;
      try { value = await runSession(index, receipt); attempt.stopReason = disposition(value); }
      catch { value = { valid: false, failure: 'Session failed' }; }
      attempt.observedInferenceCalls = observedCalls(value);
      aggregate.observedInferenceCalls = aggregate.observedInferenceCalls === null || attempt.observedInferenceCalls === null
        ? null : aggregate.observedInferenceCalls + attempt.observedInferenceCalls;
      let bytes;
      try { bytes = Buffer.from(JSON.stringify({ ...value, session: index + 1, testedRevision, manifestSha256, qualification: false }) + '\n'); }
      catch {
        attempt.stopReason = 'invalid-observation';
        bytes = Buffer.from(JSON.stringify({ session: index + 1, testedRevision, manifestSha256, qualification: false, valid: false, failure: 'Receipt invalid' }) + '\n');
      }
      if (bytes.length > 1024 * 1024) {
        attempt.stopReason = 'overflow';
        bytes = Buffer.from(JSON.stringify({ session: index + 1, testedRevision, manifestSha256, qualification: false, valid: false, failure: 'Receipt overflow' }) + '\n');
      }
      attempt.bytes = bytes.length; attempt.sha256 = hash(bytes);
      try { await retain(join(evidenceRoot, receipt), bytes); attempt.retained = true; }
      catch { attempt.stopReason = 'evidence-write'; }
      aggregate.stopReason = attempt.stopReason;
      if (attempt.stopReason !== 'complete') break;
    }
  } catch { /* Only a fixed preflight/last-attempt disposition is retained. */ }
  const bytes = JSON.stringify(aggregate) + '\n';
  if (Buffer.byteLength(bytes) > 16384) throw failed();
  await retain(join(evidenceRoot, run + '.json'), bytes);
  return aggregate;
}
