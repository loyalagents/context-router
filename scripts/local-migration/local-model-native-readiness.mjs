import { createReadStream } from 'node:fs';
import { stat, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { withNative } from './fixtures/local-model-feasibility/native.mjs';

const assets = '/private/tmp/context-router-step06-assets';
const evidence = '/private/tmp/step06-evidence';
const assetsInfo = await stat(assets);
if (!assetsInfo.isDirectory() || assetsInfo.uid !== process.getuid() || (assetsInfo.mode & 0o777) !== 0o700) throw new Error('Invalid asset root');
async function verify(name, size, sha256) {
  const path = join(assets, name);
  if ((await stat(path)).size !== size) throw new Error('Asset size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== sha256) throw new Error('Asset hash mismatch');
  return path;
}
await verify('llama-b11146-bin-macos-arm64.tar.gz', 11189714, '1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711');
const model = await verify('Qwen3.5-4B-Q4_K_M.gguf', 2740937888, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4');
const run = `native-readiness-${Date.now()}`;
const logPath = join(evidence, `${run}.log`);
let receipt = { run, timestamp: new Date().toISOString(), model: 'Qwen3.5-4B-Q4_K_M', result: 'failed' };
try {
  const result = await withNative({ binary: join(assets, 'runtime/llama-b11146/llama-server'), model, logPath,
    sandboxProfile: '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))' },
    async ({ metadata, args }) => ({ ...metadata, args }));
  receipt = { ...receipt, result: 'passed', ...result, ownedChildStoppedAndReaped: true };
} catch (error) { receipt.failure = error.message; process.exitCode = 1; }
await writeFile(join(evidence, `${run}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
await chmod(logPath, 0o600).catch(() => {});
console.log(JSON.stringify(receipt));
