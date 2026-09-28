import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runDiagnosticSeries } from './fixtures/local-model-feasibility/diagnostic-series.mjs';
import { runDiagnosticNative } from './fixtures/local-model-feasibility/diagnostic-native.mjs';
import { runDiagnosticWorker } from './fixtures/local-model-feasibility/diagnostic-worker-runner.mjs';

const failed = () => new Error('Client reproducibility preflight failed');
if (process.argv.length !== 3 || process.argv[2] !== '--run-approved-three-session-diagnostic') throw failed();
const assets = '/private/tmp/context-router-step06-assets', evidence = '/private/tmp/step06-evidence';
const profile = '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
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
const manifestRoot = resolve('docs/plans/active/local-migration/06-local-model/evidence');
const seriesBytes = await readFile(join(manifestRoot, 'client-reproducibility-manifest.json')), series = JSON.parse(seriesBytes);
const originalBytes = await readFile(join(manifestRoot, 'client-diagnostic-manifest.json')), manifest = JSON.parse(originalBytes);
assert.deepEqual(series, { mode: 'client-only-cancellation-reproducibility', qualification: false,
  maximumSessions: 3, maximumInferenceCalls: 18, operationsPerSession: 6, followups: 0, retries: 0,
  diagnosticManifestSha256: digest(originalBytes), originalClaimSha256: series.originalClaimSha256,
  originalReceiptSha256: '25e49b4498f7eb254b0b2096fdb38da232a7597fa848e32a9289186e23d90272',
  stopOnMemoryFailure: true, sessionReceiptByteLimit: 1048576, aggregateByteLimit: 16384 });
const seenRoots = new Set(), seenCertificates = new Set(), seenKeys = new Set();
let memoryObserverSha256;
const result = await runDiagnosticSeries({ evidenceRoot: evidence, testedRevision, manifestSha256: digest(seriesBytes),
  originalClaimSha256: series.originalClaimSha256,
  async preflight() {
    for (const [name, bytes, hash] of [
      ['llama-b11146-bin-macos-arm64.tar.gz', manifest.runtimeArchiveBytes, manifest.runtimeArchiveSha256],
      ['Qwen3.5-9B-Q4_K_M.gguf', manifest.modelBytes, manifest.modelSha256],
    ]) {
      const path = join(assets, name), info = await lstat(path);
      if (!info.isFile() || info.size !== bytes || await digestFile(path) !== hash) throw failed();
    }
    const entries = await runtimeEntries(join(assets, 'runtime/llama-b11146'));
    if (entries.length !== manifest.runtimeTreeEntries || digest(JSON.stringify(entries)) !== manifest.runtimeTreeSha256) throw failed();
    memoryObserverSha256 = await digestFile(join(evidence, 'memory-control'));
  },
  async runSession(index, receiptName) {
    let receipt = { valid: false, assetsVerified: true, memoryObserverSha256, freshCredentials: false };
    try {
      receipt.memoryBefore = memorySample();
      if (receipt.memoryBefore.pressure !== 1) return receipt;
      const native = await runDiagnosticNative({ binary: join(assets, 'runtime/llama-b11146/llama-server'),
        model: join(assets, 'Qwen3.5-9B-Q4_K_M.gguf'), logPath: join(evidence, receiptName + '.discard'), sandboxProfile: profile },
      async context => {
        const cert = digest(context.configuration.certificate), key = digest(context.configuration.apiKey);
        if (seenRoots.has(context.credentialRoot) || seenCertificates.has(cert) || seenKeys.has(key)) throw failed();
        seenRoots.add(context.credentialRoot); seenCertificates.add(cert); seenKeys.add(key); receipt.freshCredentials = true;
        return runDiagnosticWorker({ evidenceRoot: evidence, ...context, runtimeChild: context.child, memorySample,
          sandboxProfile: profile, stopOnMemoryFailure: true });
      });
      receipt = { ...receipt, ...native }; receipt.memoryAfter = memorySample();
    } catch { receipt.valid = false; receipt.failure = 'Session failed'; }
    return receipt;
  },
});
console.log(JSON.stringify({ run: result.run, stopReason: result.stopReason, sessions: result.attempts.length,
  observedInferenceCalls: result.observedInferenceCalls, maximumReservedInferenceCalls: result.maximumReservedInferenceCalls, qualification: false }));
process.exitCode = result.stopReason === 'complete' && result.attempts.length === 3 ? 0 : 1;
