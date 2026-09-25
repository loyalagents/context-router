import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AllocationProjection } from './fixtures/local-model-feasibility/allocation-projection.mjs';
import { allocationArgs, runAllocationStartup } from './fixtures/local-model-feasibility/allocation-startup.mjs';
import { runtimeArgs } from './fixtures/local-model-feasibility/native.mjs';

const prefix = '0.00.001.002 I ';
const buffer = (family, backend = 'MTL0', value = '12.25') => {
  const format = { model: ['load_tensors', 12, 'model'], kv: ['llama_kv_cache', 10, 'KV'],
    recurrent: ['llama_memory_recurrent', 10, 'RS'], compute: ['sched_reserve', 10, 'compute'],
    output: ['llama_context', 10, ' output'] }[family];
  return `${prefix}${format[0]}: ${backend.padStart(format[1])} ${format[2]} buffer size = ${value.padStart(8)} MiB\n`;
};
const fields = { n_seq_max: 1, n_ctx: 16384, n_ctx_seq: 16384, n_batch: 512, n_ubatch: 512, n_rs_seq: 0, n_outputs_max: 1 };
const configuration = Object.entries(fields).map(([key, value]) => `${prefix}llama_context: ${key.padEnd(21)} = ${value}\n`).join('');
export const allocationLines = configuration + buffer('model', 'CPU_Mapped') + buffer('model') + buffer('kv') + buffer('recurrent') + buffer('compute') + buffer('output', 'CPU');
const finish = (projection) => { projection.end('stdout'); projection.end('stderr'); return projection.finish(); };

test('allocation projection retains only fixed numbers and enums across separate fragmented streams', () => {
  const projection = new AllocationProjection(); const output = [];
  const secret = `${prefix}srv initialize: api_key ***TAIL\n${prefix}srv setup: /private/credentials/server-key.pem\n`;
  for (const character of secret) output.push(projection.push('stdout', Buffer.from(character)));
  for (const byte of Buffer.from(allocationLines)) output.push(projection.push('stderr', Buffer.from([byte])));
  const result = finish(projection); const persisted = Buffer.concat(output).toString();
  assert.equal(result.records.length, 13);
  assert.deepEqual(result.configuration, fields);
  assert.equal(result.records.filter((record) => record.family === 'model').length, 2);
  assert.ok(!/TAIL|private|api_key|server-key|load_tensors/.test(persisted));
  assert.deepEqual(persisted.trim().split('\n').map(JSON.parse), result.records);
  assert.throws(() => projection.push('stdout', Buffer.from('late\n')), /Allocation projection failed/);
});

test('rejects malformed required candidates, unknown backends, configuration drift and duplicate counters', () => {
  const bad = [buffer('model', 'unknown'), buffer('kv').replace('12.25', 'NaNxx'),
    buffer('kv').replace(prefix, 'garbled I '), buffer('output', 'CPU').replace('  output', ' output'),
    buffer('model').replace('12.25', '-1.25'), buffer('model').replace('12.25', '1e+99'),
    configuration.replace('= 512', '= 2048'), configuration + configuration,
    buffer('model').replace('MTL0', 'MTL\t')];
  for (const line of bad) {
    const projection = new AllocationProjection();
    assert.throws(() => projection.push('stderr', Buffer.from(line)), /^Error: Allocation projection failed$/);
    assert.throws(() => finish(projection), /Allocation projection failed/);
  }
});

test('requires complete framing on both streams and all five families and seven counters', () => {
  for (const content of ['', configuration, allocationLines.replace(buffer('kv'), ''), allocationLines.replace(configuration.split('\n')[0] + '\n', '')]) {
    const projection = new AllocationProjection(); projection.push('stderr', Buffer.from(content));
    assert.throws(() => finish(projection), /Allocation projection failed/);
  }
  const partial = new AllocationProjection(); partial.push('stderr', Buffer.from(allocationLines));
  partial.push('stdout', Buffer.from('late private path without newline'));
  assert.throws(() => partial.end('stdout'), /Allocation projection failed/);
  const unended = new AllocationProjection(); unended.push('stderr', Buffer.from(allocationLines)); unended.end('stderr');
  assert.throws(() => unended.finish(), /Allocation projection failed/);
});

test('strict UTF-8 and fixed byte, pending-line and record bounds latch failure', () => {
  for (const chunks of [[Buffer.from([0xff])], [Buffer.from('x'.repeat(16385))],
    [Buffer.from(('x'.repeat(100) + '\n').repeat(5200))], [Buffer.from(buffer('model').repeat(65))]]) {
    const projection = new AllocationProjection();
    assert.throws(() => { for (const chunk of chunks) projection.push('stderr', chunk); }, /Allocation projection failed/);
    assert.throws(() => finish(projection), /Allocation projection failed/);
  }
  const partialUtf8 = new AllocationProjection(); partialUtf8.push('stdout', Buffer.from([0xe2]));
  assert.throws(() => partialUtf8.end('stdout'), /Allocation projection failed/);
});

test('startup observation changes only verbosity and uses only unauthenticated pinned public health', async () => {
  const config = { model: '/private/model.gguf', port: 12345, keyPath: '/private/key.pem', certPath: '/private/cert.pem', apiKeyPath: '/private/api-key.txt' };
  const expectedArgs = runtimeArgs(config); expectedArgs[expectedArgs.indexOf('--log-verbosity') + 1] = '4';
  assert.deepEqual(allocationArgs(config), expectedArgs);
  const root = await mkdtemp(join(tmpdir(), 'step06-startup-test-'));
  try {
    for (const lateFailure of [false, true]) {
      const binary = join(root, `fake-runtime-${lateFailure}`);
      const marker = join(root, `public-health-${lateFailure}.json`);
      const script = `#!${process.execPath}
const https = require('node:https'); const fs = require('node:fs');
const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
process.stdout.write('0.00.001.001 I srv api_key ***TAIL\\n');
process.stderr.write(${JSON.stringify(allocationLines)});
const server = https.createServer({key:fs.readFileSync(value('--ssl-key-file')),cert:fs.readFileSync(value('--ssl-cert-file'))},(req,res)=>{
  if(req.url !== '/health' || req.headers.authorization !== undefined) { process.exit(71); }
  fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({publicHealthOnly:true}));
  res.writeHead(200, {'content-type':'application/json'}); res.end('{}');
});
process.on('SIGTERM',()=>{process.stderr.write(${JSON.stringify(lateFailure ? buffer('model', 'unknown') : '0.00.001.003 I srv shutdown: /private/SECRET_PATH\n')});server.close(()=>process.exit(0));});
server.listen(Number(value('--port')), '127.0.0.1');
`;
      await writeFile(binary, script, { mode: 0o700 });
      const logPath = join(root, `numeric-${lateFailure}.jsonl`);
      const run = runAllocationStartup({ binary, model: '/private/fake-model.gguf', logPath });
      if (lateFailure) await assert.rejects(run, /^Error: Startup allocation capture failed$/);
      else {
        const result = await run;
        assert.equal(result.ownedChildStoppedAndReaped, true);
        assert.equal(result.allocation.records.length, 13);
        assert.equal(result.clientInferenceRequests, 0);
      }
      assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), { publicHealthOnly: true });
      assert.ok(!/TAIL|SECRET|private|unknown/.test(await readFile(logPath, 'utf8')));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
