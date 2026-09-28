import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runDiagnosticNative } from './fixtures/local-model-feasibility/diagnostic-native.mjs';
import { runDiagnosticWorker } from './fixtures/local-model-feasibility/diagnostic-worker-runner.mjs';
import { runDiagnosticSeries } from './fixtures/local-model-feasibility/diagnostic-series.mjs';

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

test('three fake-process sessions use fresh private credentials, claims and worker state after prior exact cleanup', async t => {
  const f = await fakeRuntime(t), seen = [], original = Buffer.from('{"consumed":true}\n');
  await writeFile(join(f.root, 'client-diagnostic-approved-2026-09-27.claim.json'), original, { mode: 0o600 });
  const data = { mode: 'client-only-cancellation-diagnostic', qualification: false, diagnosticValid: true,
    cancellationRecovered: true, wrapperRestored: true, identityStable: true, applicationClosed: true,
    baselines: Array.from({ length: 5 }, (_, repetition) => ({ repetition, passed: true })),
    operations: Array.from({ length: 6 }, () => ({ nativeCalls: 1 })),
    observations: Array.from({ length: 6 }, () => ({ valid: true, overflow: false })),
    controls: Array.from({ length: 6 }, () => ({ overflow: false })),
    trial: { witnessed: true, cancelled: true, terminalObserved: false, observationOverflow: false, state: 'ready', clientReturnMs: 1, settledMs: 3 } };
  const result = await runDiagnosticSeries({ evidenceRoot: f.root, testedRevision: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
    originalClaimSha256: createHash('sha256').update(original).digest('hex'), preflight: async () => {},
    async runSession(index, receiptName) {
      for (const prior of seen) {
        await assert.rejects(access(prior.credentialRoot)); await assert.rejects(access(prior.workerRoot));
      }
      const marker = join(f.root, 'session-' + index + '.json'), workerPath = join(f.root, 'worker-' + index + '.mjs');
      await writeFile(workerPath, [
        "import fs from 'node:fs';import {dirname,join} from 'node:path';import {randomBytes,createHash} from 'node:crypto';",
        "const input=JSON.parse(fs.readFileSync(process.argv[2]));const workerRoot=dirname(process.argv[2]);",
        "fs.writeFileSync(join(input.credentialRoot,'backend-session.claim'),'fixture',{flag:'wx',mode:0o600});",
        "fs.mkdirSync(join(workerRoot,'data'),{mode:0o700});fs.mkdirSync(join(workerRoot,'identity'),{mode:0o700});",
        "const identity=randomBytes(32);fs.writeFileSync(join(workerRoot,'identity/identity.json'),identity,{mode:0o600});",
        'fs.writeFileSync(' + JSON.stringify(marker) + ',JSON.stringify({workerRoot,credentialRoot:input.credentialRoot,',
        "keyDigest:createHash('sha256').update(input.configuration.apiKey).digest('hex'),",
        "certDigest:createHash('sha256').update(input.configuration.certificate).digest('hex'),identityDigest:createHash('sha256').update(identity).digest('hex')}),{mode:0o600});",
        'fs.writeFileSync(input.outputPath,' + JSON.stringify(JSON.stringify(data)) + ',{mode:0o600});',
      ].join('\n'));
      const value = await runDiagnosticNative({ binary: f.binary, model: '/normal', logPath: join(f.root, receiptName + '.discard') },
        context => runDiagnosticWorker({ evidenceRoot: f.root, ...context, runtimeChild: context.child, workerPath, stopOnMemoryFailure: true,
          memorySample: () => ({ physicalFootprintBytes: 1, lifetimePeakPhysicalFootprintBytes: 1, residentBytes: 1, pressure: 1, swapUsedBytes: 0 }) }));
      const snapshot = JSON.parse(await readFile(marker));
      for (const prior of seen) for (const field of ['workerRoot', 'credentialRoot', 'keyDigest', 'certDigest', 'identityDigest']) {
        assert.notEqual(snapshot[field], prior[field]);
      }
      assert.ok(!snapshot.workerRoot.startsWith(snapshot.credentialRoot));
      await assert.rejects(access(snapshot.workerRoot)); await assert.rejects(access(snapshot.credentialRoot)); seen.push(snapshot);
      return value;
    },
  });
  assert.equal(result.stopReason, 'complete'); assert.equal(seen.length, 3); assert.equal(result.maximumReservedInferenceCalls, 18);
});
