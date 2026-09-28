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
