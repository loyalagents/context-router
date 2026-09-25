import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runAllocationStartup } from './fixtures/local-model-feasibility/allocation-startup.mjs';

const assets = '/private/tmp/context-router-step06-assets';
const evidence = '/private/tmp/step06-evidence';
const runtimeRevision = '7fe450e19305b828c199d602c23a8337aaa1f03b';
const modelSha256 = '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8';
const testedRevision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('/usr/bin/git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit probe inputs before live measurement');
const run = `native-9b-startup-allocation-${Date.now()}`;
const output = join(evidence, `${run}.json`);
let receipt = { run, testedRevision, runtimeRevision, modelSha256, modelBytes: 5680522464,
  timestamp: new Date().toISOString(), passed: false };
try {
  for (const root of [assets, evidence]) {
    const info = await stat(root);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw new Error();
  }
  for (const [name, bytes, digest] of [
    ['llama-b11146-bin-macos-arm64.tar.gz', 11189714, '1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711'],
    ['Qwen3.5-9B-Q4_K_M.gguf', 5680522464, modelSha256],
  ]) {
    const path = join(assets, name); if ((await stat(path)).size !== bytes) throw new Error();
    const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== digest) throw new Error();
  }
  const result = await runAllocationStartup({
    binary: join(assets, 'runtime/llama-b11146/llama-server'), model: join(assets, 'Qwen3.5-9B-Q4_K_M.gguf'),
    logPath: join(evidence, `${run}.jsonl`),
    sandboxProfile: '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))',
  });
  receipt = { ...receipt, ...result, passed: true };
} catch (error) {
  receipt.failure = 'Startup allocation capture failed';
  if (error?.capture && ['credentials', 'spawn', 'readiness', 'shutdown'].includes(error.capture.phase) &&
      typeof error.capture.ownedChildStoppedAndReaped === 'boolean' && typeof error.capture.credentialRootRemoved === 'boolean') {
    receipt.capture = { phase: error.capture.phase, ownedChildStoppedAndReaped: error.capture.ownedChildStoppedAndReaped,
      credentialRootRemoved: error.capture.credentialRootRemoved };
  }
}
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run, passed: receipt.passed, receiptPath: output }));
process.exitCode = receipt.passed ? 0 : 1;
