import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDiagnosticNative } from './fixtures/local-model-feasibility/diagnostic-native.mjs';

async function fakeRuntime(t) {
  const root = await mkdtemp(join(tmpdir(), 'step06-native-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, 'fake-runtime.cjs');
  const source = '#!' + process.execPath + '\n' + [
    "const fs=require('node:fs'),https=require('node:https');",
    "const value=k=>process.argv[process.argv.indexOf(k)+1];",
    "const key=fs.readFileSync(value('--api-key-file'),'utf8').trim(),mode=value('--model').split('/').at(-1);",
    "const server=https.createServer({key:fs.readFileSync(value('--ssl-key-file')),cert:fs.readFileSync(value('--ssl-cert-file'))},(req,res)=>{",
    "if(req.url!=='/health'&&req.headers.authorization!=='Bearer '+key){res.writeHead(401).end('{}');return;}",
    "const body=req.url==='/props'?{total_slots:mode==='bad-props'?2:1,default_generation_settings:{n_ctx:16384},chat_template:'fixture-template'}:req.url==='/models'?{data:[{id:'step06-qwen35'}]}:{};res.end(JSON.stringify(body));});",
    "server.listen(Number(value('--port')),'127.0.0.1',()=>{process.stdout.write(mode==='leak'?key:'PRIVATE_PATH');});",
  ].join('\n');
  await writeFile(binary, source, { mode: 0o700 });
  return { binary, root };
}

test('dedicated launcher authenticates fixed readiness, discards raw logs, reaps owned runtime before deleting credentials', async t => {
  const f = await fakeRuntime(t); let credentialRoot, calls = 0;
  const result = await runDiagnosticNative({ binary: f.binary, model: '/normal', logPath: join(f.root, 'native.log') }, async context => {
    credentialRoot = context.credentialRoot; calls++;
    assert.equal(context.child.running, true);
    assert.equal(context.metadata.context, 16384);
    return { diagnosticValid: true, workerStoppedAndReaped: true };
  });
  assert.equal(calls, 1); assert.equal(result.valid, true);
  assert.equal(result.ownedChildStoppedAndReaped, true); assert.equal(result.credentialRootRemoved, true);
  assert.equal(result.nativeOutput.complete, true); assert.equal(result.nativeOutput.leakDetected, false);
  assert.equal((await readFile(join(f.root, 'native.log'))).length, 0);
  await assert.rejects(access(credentialRoot));
  assert.ok(!JSON.stringify(result).includes(credentialRoot)); assert.ok(!JSON.stringify(result).includes('PRIVATE_PATH'));
});

for (const mode of ['leak', 'bad-props']) test('dedicated launcher rejects ' + mode + ' without running inference and retains fixed failure evidence', async t => {
  const f = await fakeRuntime(t); let calls = 0;
  const result = await runDiagnosticNative({ binary: f.binary, model: '/' + mode, logPath: join(f.root, 'native.log') }, async () => { calls++; });
  assert.equal(calls, 0); assert.equal(result.valid, false);
  assert.equal(result.ownedChildStoppedAndReaped, true); assert.equal(result.credentialRootRemoved, true);
  assert.equal((await readFile(join(f.root, 'native.log'))).length, 0);
  if (mode === 'leak') { assert.equal(result.nativeOutput.leakDetected, true); assert.equal(result.nativeOutput.complete, false); }
});

test('uncertain worker cleanup prevents credential deletion and invalidates the diagnostic', async t => {
  const f = await fakeRuntime(t); let credentialRoot;
  try {
    const result = await runDiagnosticNative({ binary: f.binary, model: '/normal', logPath: join(f.root, 'native.log') }, async context => {
      credentialRoot = context.credentialRoot;
      return { diagnosticValid: true, workerStoppedAndReaped: false };
    });
    assert.equal(result.valid, false); assert.equal(result.ownedChildStoppedAndReaped, true);
    assert.equal(result.credentialRootRemoved, false); await access(credentialRoot);
  } finally { if (credentialRoot) await rm(credentialRoot, { recursive: true, force: true }); }
});
