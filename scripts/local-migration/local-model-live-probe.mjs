import { createReadStream } from 'node:fs';
import { mkdtemp, chmod, stat, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withNative } from './fixtures/local-model-feasibility/native.mjs';
import { spawnOwned } from './fixtures/local-model-feasibility/process.mjs';
const assets = '/private/tmp/context-router-step06-assets';
const evidence = '/private/tmp/step06-evidence';
const model = join(assets, 'Qwen3.5-4B-Q4_K_M.gguf');
if ((await stat(model)).size !== 2740937888) throw new Error('Model asset size mismatch');
const hash = createHash('sha256');
for await (const chunk of createReadStream(model)) hash.update(chunk);
if (hash.digest('hex') !== '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4') throw new Error('Model asset hash mismatch');
const profile = '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))';
const mode = process.argv[2] ?? 'smoke';
if (!['smoke', 'quality'].includes(mode)) throw new Error('Unknown probe mode');
const run = `native-${mode}-${Date.now()}`;
const logPath = join(evidence, `${run}.log`);
let receipt = { run, timestamp: new Date().toISOString(), passed: false };
try {
  const result = await withNative({ binary: join(assets, 'runtime/llama-b11146/llama-server'), model, logPath, sandboxProfile: profile },
    async ({ configuration, metadata, args }) => {
      const root = await mkdtemp(join(evidence, 'worker-')); await chmod(root, 0o700);
      let worker; let reaped = false;
      try {
        const configPath = join(root, 'config.json'); const outputPath = join(root, 'receipt.json');
        await writeFile(configPath, JSON.stringify({ configuration: { ...configuration, certificate: configuration.certificate.toString('utf8') }, mode, outputPath }), { flag: 'wx', mode: 0o600 });
        worker = await spawnOwned({ command: '/usr/bin/sandbox-exec', args: ['-p', profile.replaceAll('PORT', String(configuration.port)), process.execPath,
          resolve('scripts/local-migration/fixtures/local-model-feasibility/live-worker.mjs'), configPath], cwd: root, logPath: join(root, 'worker.log') });
        const result = await Promise.race([worker.exited, delay(mode === 'quality' ? 48 * 181000 : 180000, null, { ref: false })]);
        if (!result || worker.logOverflow) throw new Error('Native worker failed');
        const data = JSON.parse(await readFile(outputPath, 'utf8'));
        return { metadata, args, worker: data, passed: result.code === 0 && data.passed };
      } finally {
        if (worker) { await worker.stop(); reaped = !worker.running; } else reaped = true;
        if (reaped) await rm(root, { recursive: true, force: true });
      }
    });
  if ((await readFile(logPath)).includes(Buffer.from('STEP06_PRIVATE_SENTINEL'))) throw new Error('Native sentinel log violation');
  receipt = { ...receipt, ...result, ownedChildStoppedAndReaped: true, sentinelAbsentFromRuntimeLog: true };
} catch (error) { receipt.failure = error.message; }
await writeFile(join(evidence, `${run}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(receipt));
process.exitCode = receipt.passed ? 0 : 1;
