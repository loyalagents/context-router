import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runDiagnosticNative } from './fixtures/local-model-feasibility/diagnostic-native.mjs';
import { runDiagnosticWorker } from './fixtures/local-model-feasibility/diagnostic-worker-runner.mjs';

const failed = () => new Error('Client diagnostic preflight failed');
if (process.argv.length !== 3 || process.argv[2] !== '--run-approved-client-diagnostic') throw failed();
const assets = '/private/tmp/context-router-step06-assets', evidence = '/private/tmp/step06-evidence';
const profile = '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))';
const manifestPath = resolve('docs/plans/active/local-migration/06-local-model/evidence/client-diagnostic-manifest.json');
const digestFile = async path => {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
};
async function runtimeEntries(root, prefix = '') {
  const entries = [];
  for (const name of await readdir(root)) {
    const path = join(root, name), relative = prefix + name, info = await lstat(path);
    if (info.isSymbolicLink()) entries.push([relative, 'link', await readlink(path)]);
    else if (info.isDirectory()) entries.push(...await runtimeEntries(path, relative + '/'));
    else if (info.isFile()) entries.push([relative, 'file', await digestFile(path)]);
    else throw failed();
  }
  return entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
const memorySample = pid => {
  const raw = JSON.parse(execFileSync(join(evidence, 'memory-control'), pid ? [String(pid)] : [],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin' } }));
  const value = {};
  for (const key of ['physicalFootprintBytes', 'lifetimePeakPhysicalFootprintBytes', 'residentBytes', 'pressure', 'swapUsedBytes']) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw failed(); value[key] = raw[key];
  }
  return value;
};
if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node !== '24.21.0') throw failed();
for (const root of [assets, evidence]) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw failed();
}
const testedRevision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('/usr/bin/git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw failed();
const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes);
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const run = 'native-9b-client-diagnostic-' + Date.now();
// One approved attempt. Never delete/reclaim this guard or automatically retry after any outcome.
await writeFile(join(evidence, 'client-diagnostic-approved-2026-09-27.claim.json'), JSON.stringify({ run, testedRevision, manifestSha256 }) + '\n', { flag: 'wx', mode: 0o600 });
let receipt = { run, testedRevision, manifestSha256, timestamp: new Date().toISOString(), qualification: false, valid: false };
try {
  for (const [name, bytes, hash] of [
    ['llama-b11146-bin-macos-arm64.tar.gz', manifest.runtimeArchiveBytes, manifest.runtimeArchiveSha256],
    ['Qwen3.5-9B-Q4_K_M.gguf', manifest.modelBytes, manifest.modelSha256],
  ]) {
    const path = join(assets, name), info = await lstat(path);
    if (!info.isFile() || info.size !== bytes || await digestFile(path) !== hash) throw failed();
  }
  const entries = await runtimeEntries(join(assets, 'runtime/llama-b11146'));
  if (entries.length !== manifest.runtimeTreeEntries || createHash('sha256').update(JSON.stringify(entries)).digest('hex') !== manifest.runtimeTreeSha256) throw failed();
  receipt.assetsVerified = true; receipt.memoryBefore = memorySample();
  receipt.memoryObserverSha256 = await digestFile(join(evidence, 'memory-control'));
  const result = await runDiagnosticNative({ binary: join(assets, 'runtime/llama-b11146/llama-server'),
    model: join(assets, 'Qwen3.5-9B-Q4_K_M.gguf'), logPath: join(evidence, run + '.discard'), sandboxProfile: profile },
  context => runDiagnosticWorker({ evidenceRoot: evidence, ...context, runtimeChild: context.child, memorySample, sandboxProfile: profile }));
  receipt = { ...receipt, ...result }; receipt.memoryAfter = memorySample();
} catch { receipt.valid = false; receipt.failure = 'Client diagnostic failed'; }
let encoded = JSON.stringify(receipt) + '\n';
if (Buffer.byteLength(encoded) > 1024 * 1024) {
  receipt = { run, testedRevision, manifestSha256, qualification: false, valid: false, failure: 'Diagnostic receipt overflow' };
  encoded = JSON.stringify(receipt) + '\n';
}
await writeFile(join(evidence, run + '.json'), encoded, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run, valid: receipt.valid, qualification: false, cancellationRecovered: receipt.worker?.data?.cancellationRecovered ?? false }));
process.exitCode = receipt.valid ? 0 : 1;
