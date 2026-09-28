import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiagnosticWorker } from './fixtures/local-model-feasibility/diagnostic-worker-runner.mjs';

const memorySample = () => ({ physicalFootprintBytes: 10, lifetimePeakPhysicalFootprintBytes: 20, residentBytes: 30, pressure: 1, swapUsedBytes: 0 });
async function fixture(t, body) {
  const root = await mkdtemp(join(tmpdir(), 'step06-diagnostic-worker-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workerPath = join(root, 'worker.mjs');
  await writeFile(workerPath, "import {readFile,writeFile} from 'node:fs/promises';const input=JSON.parse(await readFile(process.argv[2],'utf8'));" + body);
  return { evidenceRoot: root, credentialRoot: root, workerPath, runtimeChild: { pid: process.pid, running: true },
    memorySample, configuration: { port: 12345, certificate: Buffer.from('fixture'), apiKey: 'API_KEY_VALUE' } };
}

test('worker failure receipt survives exact-child cleanup, raw output is discarded and credentials config is removed', async t => {
  const f = await fixture(t, "process.stdout.write('PRIVATE_PATH');await writeFile(input.outputPath,JSON.stringify({mode:'client-only-cancellation-diagnostic',qualification:false,diagnosticValid:false,failureStage:'application'}));process.exitCode=1;");
  const result = await runDiagnosticWorker(f);
  assert.equal(result.diagnosticValid, false); assert.equal(result.data.failureStage, 'application');
  assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
  assert.equal(result.workerOutput.complete, true);
  assert.deepEqual(await readdir(f.evidenceRoot), ['worker.mjs']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PATH')); assert.ok(!JSON.stringify(result).includes('API_KEY_VALUE'));
});

test('worker deadline stops and reaps the owned child and never labels missing data successful', async t => {
  const f = await fixture(t, 'setInterval(()=>{},1000);');
  const result = await runDiagnosticWorker({ ...f, timeoutMs: 30 });
  assert.equal(result.diagnosticValid, false); assert.equal(result.data, null);
  assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
  assert.equal(result.failureStage, 'wait');
});

test('oversized receipt or leaked key invalidates observation and is not retained in the parent result', async t => {
  for (const body of [
    "await writeFile(input.outputPath,'x'.repeat(900000));",
    "await writeFile(input.outputPath,JSON.stringify({mode:'client-only-cancellation-diagnostic',qualification:false,diagnosticValid:false,note:input.configuration.apiKey}));",
    "process.stderr.write(input.configuration.apiKey);setInterval(()=>{},1000);",
  ]) {
    const f = await fixture(t, body), result = await runDiagnosticWorker(f);
    assert.equal(result.diagnosticValid, false); assert.equal(result.data, null);
    assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
    assert.ok(!JSON.stringify(result).includes('API_KEY_VALUE'));
  }
});

test('memory observer failure produces bounded fixed evidence and still reaps the worker', async t => {
  const f = await fixture(t, "await writeFile(input.outputPath,JSON.stringify({mode:'client-only-cancellation-diagnostic',qualification:false,diagnosticValid:false}));");
  const result = await runDiagnosticWorker({ ...f, memorySample: () => { throw new Error('PRIVATE_PATH'); } });
  assert.equal(result.memoryPassed, false); assert.equal(result.diagnosticValid, false);
  assert.equal(result.workerStoppedAndReaped, true); assert.ok(!JSON.stringify(result).includes('PRIVATE_PATH'));
});

test('series memory control rejects an abnormal initial sample before spawning a worker', async t => {
  const f = await fixture(t, "await writeFile(input.outputPath,JSON.stringify({mode:'client-only-cancellation-diagnostic',qualification:false,diagnosticValid:false}));");
  const result = await runDiagnosticWorker({ ...f, stopOnMemoryFailure: true,
    memorySample: () => ({ ...memorySample(), pressure: 2 }) });
  assert.equal(result.failureStage, 'memory'); assert.equal(result.data, null);
  assert.equal(result.memoryPassed, false); assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
});

test('series memory control stops and reaps a running worker at the first abnormal sample', async t => {
  const f = await fixture(t, 'setInterval(()=>{},1000);'); let samples = 0;
  const started = performance.now();
  const result = await runDiagnosticWorker({ ...f, stopOnMemoryFailure: true, timeoutMs: 10000,
    memorySample: () => ({ ...memorySample(), pressure: ++samples >= 2 ? 2 : 1 }) });
  assert.ok(performance.now() - started < 5000); assert.equal(samples, 2);
  assert.equal(result.failureStage, 'memory'); assert.equal(result.data, null);
  assert.equal(result.memoryPassed, false); assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
});

test('all abnormal initial memory cases prevent spawning, including observer failure and dead runtime', async t => {
  for (const overrides of [
    { memorySample: () => ({ ...memorySample(), lifetimePeakPhysicalFootprintBytes: 18 * 1024 ** 3 + 1 }) },
    { memorySample: () => ({ ...memorySample(), pressure: NaN }) },
    { memorySample: () => { throw new Error('PRIVATE_PATH'); } },
    { runtimeChild: { running: false } },
  ]) {
    const f = await fixture(t, ''); let spawns = 0;
    const result = await runDiagnosticWorker({ ...f, ...overrides, stopOnMemoryFailure: true, spawn: () => { spawns++; throw new Error('unexpected spawn'); } });
    assert.equal(spawns, 0); assert.equal(result.failureStage, 'memory');
    assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
  }
});

for (const stopRejects of [false, true]) test('memory failure during spawn remains latched; stop rejection=' + stopRejects, async t => {
  const f = await fixture(t, ''); let samples = 0, stops = 0;
  const handle = { running: true, logOverflow: false, exited: new Promise(() => {}), stop() {
    stops++; if (stopRejects) return Promise.reject(new Error('PRIVATE_PATH'));
    this.running = false; return Promise.resolve({ code: 0 });
  } };
  const started = performance.now();
  const result = await runDiagnosticWorker({ ...f, stopOnMemoryFailure: true, timeoutMs: 10000,
    spawn: async () => { await new Promise(resolve => setTimeout(resolve, 2100)); return handle; },
    memorySample: () => { samples++; if (samples === 2) throw new Error('PRIVATE_PATH'); return memorySample(); } });
  assert.ok(performance.now() - started < 5000); assert.equal(samples, 2); assert.equal(stops, 1);
  assert.equal(result.failureStage, 'memory'); assert.equal(result.workerStoppedAndReaped, !stopRejects);
  assert.equal(result.workerRootRemoved, !stopRejects); assert.equal(result.memoryPassed, false);
  assert.equal((await readdir(f.evidenceRoot)).some(x => x.startsWith('client-diagnostic-worker-')), stopRejects);
});

test('default one-shot memory behavior retains a worker receipt while failing its final memory result', async t => {
  const f = await fixture(t, "await writeFile(input.outputPath,JSON.stringify({mode:'client-only-cancellation-diagnostic',qualification:false,diagnosticValid:false,failureStage:'application'}));");
  const result = await runDiagnosticWorker({ ...f, memorySample: () => ({ ...memorySample(), pressure: 2 }) });
  assert.equal(result.data.failureStage, 'application'); assert.equal(result.memoryPassed, false);
  assert.equal(result.workerStoppedAndReaped, true); assert.equal(result.workerRootRemoved, true);
});
