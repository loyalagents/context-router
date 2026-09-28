import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { runDiagnosticSeries, seriesClaimName } from './fixtures/local-model-feasibility/diagnostic-series.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const audit = () => ({ complete: true, invalid: false, leakDetected: false, overflow: false });
function success() {
  return { valid: true, ownedChildStoppedAndReaped: true, credentialRootRemoved: true, nativeOutput: audit(),
    worker: { diagnosticValid: true, workerStoppedAndReaped: true, workerRootRemoved: true, workerOutput: audit(), memoryPassed: true,
      data: { diagnosticValid: true, qualification: false, cancellationRecovered: true, wrapperRestored: true,
        identityStable: true, applicationClosed: true,
        trial: { witnessed: true, cancelled: true, terminalObserved: false, observationOverflow: false,
          state: 'ready', clientReturnMs: 2, settledMs: 3300 },
        baselines: Array.from({ length: 5 }, (_, repetition) => ({ repetition, passed: true })),
        operations: Array.from({ length: 6 }, () => ({ nativeCalls: 1 })),
        observations: Array.from({ length: 6 }, () => ({ valid: true, overflow: false })),
        controls: Array.from({ length: 6 }, () => ({ overflow: false })),
      } } };
}
async function fixture(t) {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'step06-series-test-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const original = Buffer.from('{"previous":"consumed"}\n');
  await writeFile(join(evidenceRoot, 'client-diagnostic-approved-2026-09-27.claim.json'), original, { mode: 0o600 });
  return { evidenceRoot, testedRevision: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
    originalClaimSha256: digest(original), preflight: async () => ({ assetsVerified: true }), original };
}

test('three sequential successes reserve at most eighteen calls and retain receipts before continuing', async t => {
  const f = await fixture(t); let calls = 0, active = 0, maximumActive = 0, previous;
  const result = await runDiagnosticSeries({ ...f, async runSession(index, receiptName) {
    active++; maximumActive = Math.max(maximumActive, active); assert.equal(index, calls++);
    if (previous) assert.equal(JSON.parse(await readFile(join(f.evidenceRoot, previous))).session, index);
    await new Promise(resolve => setImmediate(resolve)); previous = receiptName; active--; return success();
  } });
  assert.equal(calls, 3); assert.equal(maximumActive, 1); assert.equal(result.stopReason, 'complete');
  assert.equal(result.qualification, false); assert.equal(result.maximumReservedInferenceCalls, 18);
  assert.equal(result.observedInferenceCalls, 18); assert.equal(result.attempts.length, 3);
  for (const attempt of result.attempts) {
    const bytes = await readFile(join(f.evidenceRoot, attempt.receipt));
    assert.equal(attempt.sha256, digest(bytes)); assert.equal(attempt.bytes, bytes.length); assert.equal(attempt.retained, true);
    assert.equal((await stat(join(f.evidenceRoot, attempt.receipt))).mode & 0o777, 0o600);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 16384);
  assert.equal((await stat(join(f.evidenceRoot, seriesClaimName))).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(join(f.evidenceRoot, 'client-diagnostic-approved-2026-09-27.claim.json')), f.original);
  await assert.rejects(runDiagnosticSeries({ ...f, runSession: async () => { assert.fail('consumed series repeated'); } }));
});

const stops = [
  ['baseline-failed', x => { x.worker.data.baselines[2].passed = false; }],
  ['cancellation-unrecovered', x => { x.worker.data.cancellationRecovered = false; }],
  ['cancellation-unrecovered', x => { x.worker.data.trial.settledMs = 5001; }],
  ['cancellation-unrecovered', x => { x.worker.data.trial.clientReturnMs = 1001; }],
  ['invalid-observation', x => { x.worker.data.observations[0].valid = false; }],
  ['invalid-observation', x => { x.worker.data.operations.push({ nativeCalls: 1 }); }],
  ['invalid-observation', x => { x.worker.data.operations[0].nativeCalls = 2; }],
  ['invalid-observation', x => { x.worker.data.wrapperRestored = false; }],
  ['invalid-observation', x => { x.worker.data.identityStable = false; }],
  ['invalid-observation', x => { x.worker.data.applicationClosed = false; }],
  ['invalid-observation', x => { x.worker.data.diagnosticValid = false; }],
  ['invalid-observation', x => { x.worker.diagnosticValid = false; }],
  ['invalid-observation', x => { x.worker.workerOutput.invalid = true; }],
  ['invalid-observation', x => { delete x.worker.data.controls; }],
  ['invalid-observation', x => { x.nativeOutput.complete = false; }],
  ['overflow', x => { x.nativeOutput.overflow = true; }],
  ['overflow', x => { x.worker.workerOutput.overflow = true; }],
  ['overflow', x => { x.worker.data.observations[0].overflow = true; }],
  ['overflow', x => { x.worker.data.controls[0].overflow = true; }],
  ['leak', x => { x.nativeOutput.leakDetected = true; }],
  ['leak', x => { x.worker.workerOutput.leakDetected = true; }],
  ['abnormal-memory', x => { x.worker.memoryPassed = false; }],
  ['abnormal-memory', x => { x.memoryBefore = { pressure: 2 }; }],
  ['abnormal-memory', x => { x.memoryAfter = { pressure: 4 }; }],
  ['cleanup-uncertain', x => { x.ownedChildStoppedAndReaped = false; }],
  ['cleanup-uncertain', x => { x.credentialRootRemoved = false; }],
  ['cleanup-uncertain', x => { x.worker.workerStoppedAndReaped = false; }],
  ['cleanup-uncertain', x => { x.worker.workerRootRemoved = false; }],
];
for (const [reason, mutate] of stops) test('series stops on ' + reason + ' even with an outer valid result: ' + mutate.toString(), async t => {
  const f = await fixture(t); let calls = 0;
  const result = await runDiagnosticSeries({ ...f, runSession: async () => { calls++; const value = success(); mutate(value); return value; } });
  assert.equal(calls, 1); assert.equal(result.stopReason, reason); assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].retained, true); assert.equal(result.maximumReservedInferenceCalls, 6);
  await assert.rejects(runDiagnosticSeries({ ...f, runSession: async () => { assert.fail('failed attempt replaced'); } }));
});

test('partial or thrown session consumes its attempt without inventing zero native calls or persisting errors', async t => {
  for (const runSession of [async () => ({ valid: false, worker: null }), async () => { throw new Error('PRIVATE_PATH SECRET'); }]) {
    const f = await fixture(t); const result = await runDiagnosticSeries({ ...f, runSession });
    assert.equal(result.attempts.length, 1); assert.equal(result.observedInferenceCalls, null);
    assert.equal(result.maximumReservedInferenceCalls, 6); assert.equal(result.attempts[0].retained, true);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.ok(!(await readFile(join(f.evidenceRoot, result.attempts[0].receipt), 'utf8')).includes('PRIVATE_PATH'));
  }
});

test('preflight failure consumes the series but starts no session and preserves the old guard', async t => {
  const f = await fixture(t);
  const result = await runDiagnosticSeries({ ...f, preflight: async () => { throw new Error('SECRET'); }, runSession: () => assert.fail('not preflighted') });
  assert.equal(result.stopReason, 'preflight'); assert.equal(result.attempts.length, 0);
  assert.deepEqual(await readFile(join(f.evidenceRoot, 'client-diagnostic-approved-2026-09-27.claim.json')), f.original);
  await assert.rejects(runDiagnosticSeries({ ...f, runSession: () => assert.fail('reclaimed') }));
});

test('concurrent invocations grant exactly one immutable series owner', async t => {
  const f = await fixture(t); let calls = 0;
  const args = { ...f, runSession: async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return success(); } };
  const outcomes = await Promise.allSettled([runDiagnosticSeries(args), runDiagnosticSeries(args)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.equal(calls, 3);
});

test('changed original guard prevents new sessions without altering either guard', async t => {
  const f = await fixture(t);
  const result = await runDiagnosticSeries({ ...f, originalClaimSha256: '0'.repeat(64), runSession: () => assert.fail('changed guard') });
  assert.equal(result.stopReason, 'preflight'); assert.equal(result.attempts.length, 0);
  assert.deepEqual(await readFile(join(f.evidenceRoot, 'client-diagnostic-approved-2026-09-27.claim.json')), f.original);
});

test('receipt persistence failure stops rather than overwriting evidence or launching another session', async t => {
  const f = await fixture(t); let calls = 0;
  const result = await runDiagnosticSeries({ ...f, async runSession(index, receiptName) {
    calls++; await writeFile(join(f.evidenceRoot, receiptName), 'existing'); return success();
  } });
  assert.equal(calls, 1); assert.equal(result.stopReason, 'evidence-write'); assert.equal(result.attempts[0].retained, false);
  assert.equal(await readFile(join(f.evidenceRoot, result.attempts[0].receipt), 'utf8'), 'existing');
});

test('unserializable or oversized receipts cannot report success or permit another session', async t => {
  for (const circular of [false, true]) {
    const f = await fixture(t); let calls = 0;
    const result = await runDiagnosticSeries({ ...f, runSession: async () => {
      calls++; const value = success(); value.extra = circular ? value : 'x'.repeat(1024 * 1024); return value;
    } });
    assert.equal(calls, 1); assert.notEqual(result.stopReason, 'complete');
    assert.equal(result.attempts[0].retained, true);
  }
});

test('interruption during a session leaves the series guard consumed and cannot resume or replace the attempt', async t => {
  const f = await fixture(t), marker = join(f.evidenceRoot, 'started'), script = join(f.evidenceRoot, 'interrupted.mjs');
  const args = { evidenceRoot: f.evidenceRoot, testedRevision: f.testedRevision, manifestSha256: f.manifestSha256, originalClaimSha256: f.originalClaimSha256 };
  await writeFile(script, 'import {writeFile} from "node:fs/promises";import {runDiagnosticSeries} from ' +
    JSON.stringify(new URL('./fixtures/local-model-feasibility/diagnostic-series.mjs', import.meta.url).href) +
    ';await runDiagnosticSeries({...'+ JSON.stringify(args) +',preflight:async()=>{},runSession:async()=>{await writeFile('+JSON.stringify(marker)+',"started");await new Promise(()=>{setInterval(()=>{},1000)});}});');
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { child.kill('SIGKILL'); await exited; });
  let started = false;
  for (let i = 0; i < 100; i++) {
    try { await access(marker); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  assert.equal(started, true); child.kill('SIGTERM'); await exited;
  await assert.rejects(runDiagnosticSeries({ ...f, runSession: () => assert.fail('interrupted attempt replaced') }));
  assert.deepEqual(await readFile(join(f.evidenceRoot, 'client-diagnostic-approved-2026-09-27.claim.json')), f.original);
});
