import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfProcess } from './fixtures/local-model-feasibility/pdf-process.mjs';

async function fixture(t, body) {
  const root = await mkdtemp(join(tmpdir(), 'step06-pdf-worker-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'worker.mjs'); await writeFile(path, body);
  return path;
}
const good = `process.stdout.write(JSON.stringify({ok:true,pages:1,items:1,bytes:10,canvasPresent:false})+'\\nΑθήνα');`;

test('owned PDF worker receives bounded bytes in a stripped environment and resolves only after reaping', async (t) => {
  const worker = await fixture(t, `import assert from 'node:assert/strict';
// CoreFoundation adds this fixed platform variable after exec on macOS.
assert.deepEqual(Object.keys(process.env).filter((key)=>process.platform !== 'darwin' || key !== '__CF_USER_TEXT_ENCODING').sort(), ['LC_ALL','PATH','TMPDIR']);
assert.ok(process.execArgv.includes('--max-old-space-size=256'));
assert.ok(process.execArgv.includes('--no-global-search-paths'));
const parts=[]; for await (const chunk of process.stdin) parts.push(chunk);
assert.equal(Buffer.concat(parts).toString(), 'synthetic bytes'); ${good}`);
  let pid;
  const parser = new PdfProcess({ workerPath: worker, onSpawn: (value) => { pid = value; } });
  const result = await parser.parse(Buffer.from('synthetic bytes'));
  assert.equal(result.text, 'Αθήνα'); assert.equal(result.canvasPresent, false);
  assert.equal(parser.state, 'ready');
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
});

test('abort before admission and invalid input never spawn a parser', async () => {
  let spawned = 0; const abort = new AbortController(); abort.abort();
  const parser = new PdfProcess({ workerPath: '/missing', onSpawn: () => { spawned++; } });
  await assert.rejects(parser.parse(Buffer.from('x'), { signal: abort.signal }), /^Error: PDF_CANCELLED$/);
  await assert.rejects(parser.parse(Buffer.alloc(10 * 1024 * 1024 + 1)), /^Error: PDF_LIMIT$/);
  await assert.rejects(parser.parse(Buffer.from('x'), { deadline: performance.now() + 500 }), /^Error: PDF_TIMEOUT$/);
  assert.equal(spawned, 0); assert.equal(parser.state, 'ready');
});

test('abort and deadline kill only the owned parser, await reaping, and permit the next call', async (t) => {
  const worker = await fixture(t, `const parts=[];for await(const chunk of process.stdin)parts.push(chunk);
if(Buffer.concat(parts).toString()==='ok'){${good}}else{process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}`);
  let pid; let notify; const parser = new PdfProcess({ workerPath: worker, onSpawn: (value) => { pid = value; notify?.(); } });
  const controller = new AbortController();
  const spawned = new Promise((resolve) => { notify = resolve; });
  const pending = parser.parse(Buffer.from('hang'), { signal: controller.signal });
  await spawned;
  await assert.rejects(parser.parse(Buffer.from('ok')), /^Error: PDF_BUSY$/);
  const start = performance.now(); controller.abort();
  await assert.rejects(pending, /^Error: PDF_CANCELLED$/);
  assert.ok(performance.now() - start < 1000);
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  assert.equal((await parser.parse(Buffer.from('ok'))).text, 'Αθήνα');
  await assert.rejects(parser.parse(Buffer.from('hang'), { deadline: performance.now() + 1200 }), /^Error: PDF_TIMEOUT$/);
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  assert.equal((await parser.parse(Buffer.from('ok'))).text, 'Αθήνα');
});

test('invalid output, late failure and byte floods never yield partial text or raw errors', async (t) => {
  const bad = [
    `process.stdout.write('SECRET_BAD_JSON\\n');`,
    `process.stdout.write(JSON.stringify({ok:true,pages:1,items:1,bytes:1,canvasPresent:false})+'\\n');process.stdout.write(Buffer.from([0xff]));`,
    `${good}process.stdout.write('extra');`,
    `process.stdout.write(JSON.stringify({ok:true,pages:1,items:1,bytes:3,canvasPresent:false})+'\\nx');`,
    `process.stdout.write('SECRET'.repeat(30000));setInterval(()=>{},1000);`,
    `process.stderr.write('SECRET'.repeat(20000));setInterval(()=>{},1000);`,
    `${good}process.exitCode=1;`,
  ];
  for (const body of bad) {
    const worker = await fixture(t, body); let pid;
    const parser = new PdfProcess({ workerPath: worker, onSpawn: (value) => { pid = value; } });
    await assert.rejects(parser.parse(Buffer.from('x')), /^Error: PDF_INVALID$/);
    assert.equal(parser.state, 'ready');
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  }
});

test('fixed parser errors require a complete successful child protocol and exit', async (t) => {
  for (const error of ['PDF_ENCRYPTED', 'PDF_LIMIT', 'PDF_EMPTY', 'PDF_AUXILIARY', 'PDF_INVALID']) {
    const worker = await fixture(t, `process.stdout.write(JSON.stringify({ok:false,error:${JSON.stringify(error)}})+'\\n');`);
    const parser = new PdfProcess({ workerPath: worker });
    await assert.rejects(parser.parse(Buffer.from('x')), (failure) => failure.message === error);
  }
});
