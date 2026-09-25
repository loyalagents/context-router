import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measurePdfFootprint } from './fixtures/local-model-feasibility/pdf-footprint.mjs';
const counters = { physicalFootprintBytes: 1024, lifetimePeakPhysicalFootprintBytes: 2048, residentBytes: 3072, pressure: 1, swapUsedBytes: 0 };

async function workerFixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'step06-footprint-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'worker.mjs'); await writeFile(path, source);
  return path;
}
const worker = `for await(const chunk of process.stdin){} process.stdout.write(JSON.stringify({ok:true,pages:1,items:1,bytes:2,canvasPresent:false})+'\\nok');`;

test('footprint sampling is followed by acknowledgement from the same held worker before successful exit', async (t) => {
  let pid; let calls = 0;
  const result = await measurePdfFootprint({ workerPath: await workerFixture(t, worker), bytes: Buffer.from('synthetic'),
    sample: (value, budget) => { calls++; pid = value; assert.ok(budget > 0 && budget <= 500); process.kill(pid, 0); return counters; } });
  assert.equal(calls, 1); assert.deepEqual(result.memory, counters);
  assert.equal(result.postSampleAcknowledged, true); assert.equal(result.ownedChildStoppedAndReaped, true);
  assert.equal(result.output.bytes, 2); assert.equal(result.output.pages, 1);
  assert.equal(Object.hasOwn(result.output, 'text'), false);
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
});

test('no post-sample acknowledgement or malformed observation invalidates measurement and reaps the child', async (t) => {
  for (const mode of ['death', 'bad-counters', 'observer-error']) {
    let pid;
    await assert.rejects(measurePdfFootprint({ workerPath: await workerFixture(t, worker), bytes: Buffer.from('synthetic'),
      sample: (value) => {
        pid = value;
        if (mode === 'death') { process.kill(pid, 'SIGKILL'); return counters; }
        if (mode === 'observer-error') throw new Error('SECRET_OBSERVER');
        return { ...counters, physicalFootprintBytes: NaN };
      } }), (error) => { assert.equal(error.message, 'PDF footprint measurement failed'); assert.equal(error.cleanupConfirmed, true); return true; });
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  }
});

test('a valid measurement does not excuse malformed output from the worker', async (t) => {
  await assert.rejects(measurePdfFootprint({ workerPath: await workerFixture(t, 'process.stdout.write("SECRET_BAD\\n");'),
    bytes: Buffer.from('synthetic'), sample: () => counters }), /^Error: PDF footprint measurement failed$/);
});

test('instrumented worker output floods and a stalled import remain bounded and are reaped', async (t) => {
  for (const source of ['process.stdout.write("SECRET".repeat(30000));', 'process.stderr.write("SECRET".repeat(20000));',
    'setInterval(()=>{},1000);await new Promise(()=>{});']) {
    const started = performance.now();
    await assert.rejects(measurePdfFootprint({ workerPath: await workerFixture(t, source),
      bytes: Buffer.from('synthetic'), sample: () => counters }), (error) => {
      assert.equal(error.message, 'PDF footprint measurement failed'); assert.equal(error.cleanupConfirmed, true); return true;
    });
    assert.ok(performance.now() - started < 10000);
  }
});
