import { createReadStream } from 'node:fs';
import { mkdtemp, chmod, stat, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { withNative } from './fixtures/local-model-feasibility/native.mjs';
import { spawnOwned } from './fixtures/local-model-feasibility/process.mjs';
import { auditCancellationLog } from './fixtures/local-model-feasibility/cancellation-audit.mjs';
import { auditEarlyBoundaryLog } from './fixtures/local-model-feasibility/early-boundary.mjs';
const assets = '/private/tmp/context-router-step06-assets';
const evidence = '/private/tmp/step06-evidence';
const candidate = process.argv[3] ?? '4b';
const pinned = { '4b': { name: 'Qwen3.5-4B-Q4_K_M.gguf', bytes: 2740937888, sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4' },
  '9b': { name: 'Qwen3.5-9B-Q4_K_M.gguf', bytes: 5680522464, sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8' } }[candidate];
if (!pinned) throw new Error('Unknown consented model candidate');
const model = join(assets, pinned.name);
if ((await stat(model)).size !== pinned.bytes) throw new Error('Model asset size mismatch');
const hash = createHash('sha256');
for await (const chunk of createReadStream(model)) hash.update(chunk);
if (hash.digest('hex') !== pinned.sha256) throw new Error('Model asset hash mismatch');
const profile = '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))';
const mode = process.argv[2] ?? 'smoke';
if (!['smoke', 'quality', 'cancellation', 'schemas', 'early-abort', 'early-disconnect', 'input-limit', 'production-quality', 'production-cancellation'].includes(mode)) throw new Error('Unknown probe mode');
const testedRevision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('/usr/bin/git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit probe inputs before live measurement');
const run = `native-${candidate}-${mode}-${Date.now()}`;
const logPath = join(evidence, `${run}.log`);
const memorySample = (pid) => JSON.parse(execFileSync(join(evidence, 'memory-control'), pid ? [String(pid)] : [], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin' } }));
let receipt = { run, testedRevision, timestamp: new Date().toISOString(), candidate, modelSha256: pinned.sha256, passed: false, memoryBefore: memorySample() };
try {
  const result = await withNative({ binary: join(assets, 'runtime/llama-b11146/llama-server'), model, logPath, sandboxProfile: profile },
    async ({ configuration, credentialRoot, metadata, args, child }) => {
      const root = await mkdtemp(join(evidence, 'worker-')); await chmod(root, 0o700);
      let worker; let reaped = false; const memory = []; let memoryFailure = false;
      const sample = () => { try { memory.push({ elapsedMs: performance.now(), ...memorySample(child.pid) }); } catch { memoryFailure = true; } };
      sample(); const memoryTimer = setInterval(sample, 2000);
      try {
        const configPath = join(root, 'config.json'); const outputPath = join(root, 'receipt.json');
        await writeFile(configPath, JSON.stringify({ configuration: { ...configuration, certificate: configuration.certificate.toString('utf8') }, credentialRoot, mode, outputPath }), { flag: 'wx', mode: 0o600 });
        worker = await spawnOwned({ command: '/usr/bin/sandbox-exec', args: ['-p', profile.replaceAll('PORT', String(configuration.port)), process.execPath,
          resolve(`scripts/local-migration/fixtures/local-model-feasibility/${mode === 'production-quality' ? 'production-worker' : mode === 'production-cancellation' ? 'production-cancellation-worker' : 'live-worker'}.mjs`), configPath], cwd: root, logPath: join(root, 'worker.log') });
        const result = await Promise.race([worker.exited, delay(mode === 'production-quality' ? 54 * 181000 : mode === 'quality' ? 48 * 181000 : ['cancellation','production-cancellation'].includes(mode) ? 17 * 181000 : mode === 'schemas' ? 4 * 181000 : 180000, null, { ref: false })]);
        if (!result || worker.logOverflow) throw new Error('Native worker failed');
        const data = JSON.parse(await readFile(outputPath, 'utf8'));
        sample();
        const memoryPassed = !memoryFailure && memory.length > 0 && memory.every((item) => item.pressure === 1 && item.lifetimePeakPhysicalFootprintBytes <= (candidate === '4b' ? 12 : 18) * 1024 ** 3);
        return { metadata, args, worker: data, memory, memoryPassed, passed: result.code === 0 && data.passed && memoryPassed };
      } finally {
        clearInterval(memoryTimer);
        if (worker) { await worker.stop(); reaped = !worker.running; } else reaped = true;
        if (reaped) await rm(root, { recursive: true, force: true });
      }
    });
  receipt = { ...receipt, ...result, ownedChildStoppedAndReaped: true };
  const diagnostics = await readFile(logPath);
  if (diagnostics.includes(Buffer.from('STEP06_PRIVATE_SENTINEL'))) throw new Error('Native sentinel log violation');
  receipt.sentinelAbsentFromRuntimeLog = true;
  if (['cancellation','production-cancellation'].includes(mode)) {
    receipt.nativeCancellationAudit = auditCancellationLog(diagnostics, receipt.worker);
    receipt.passed &&= receipt.nativeCancellationAudit.passed;
  }
  if (['early-abort', 'early-disconnect'].includes(mode)) {
    receipt.earlyNativeAudit = auditEarlyBoundaryLog(diagnostics, receipt.worker);
    receipt.passed &&= receipt.earlyNativeAudit.passed;
  }
  if (mode === 'input-limit') {
    receipt.noInferenceAudit = auditEarlyBoundaryLog(diagnostics, receipt.worker);
    receipt.passed &&= receipt.noInferenceAudit.passed && receipt.noInferenceAudit.tasks.length === 0;
  }
} catch (error) { receipt.passed = false; receipt.failure = error.message; }
await writeFile(join(evidence, `${run}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run, passed: receipt.passed, failure: receipt.failure, families: receipt.worker?.score?.families, memoryPassed: receipt.memoryPassed, receiptPath: join(evidence, `${run}.json`) }));
process.exitCode = receipt.passed ? 0 : 1;
