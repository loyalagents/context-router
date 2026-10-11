// P1-N ONLY. Do not run without the user's separately recorded bounded approval.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, chmod, stat, lstat, readdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { runtimeArgs, vacantPort, summarizeProps } from '../fixtures/local-model-feasibility/native.mjs';
import { renderForCompletion } from '../fixtures/local-model-feasibility/protocol.mjs';
import { NativeCompletionClient, probeJson } from '../../../apps/backend/src/infrastructure/local-model/engine/client.mjs';
// Current validator depends on managed admission; use the complete compiled closure.
import { claimManualSession } from '../../../apps/backend/dist/infrastructure/local-model/engine/manual-session.mjs';
import { NativeProbeControl } from './native-control.mjs';

assert.equal(process.env.STEP09_NATIVE_APPROVAL, 'P1-N.2-two-sessions-two-synthetic-completions');
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.version, 'v24.21.0');
const [certificateRootInput] = process.argv.slice(2);
const certificateRoot = await realpath(certificateRootInput);
assert.match(path.basename(certificateRoot), /^context-router-cert-p1-/);
assert.equal(createHash('sha256').update(await readFile(path.join(certificateRoot, 'acquisition.json'))).digest('hex'),
  '39417cb972524ca985d7f5c6a467e221a7688a82447dfae560eccdd60619aa96');
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'context-router-step09-native-')));
await chmod(root, 0o700);
console.log(`P1-N private evidence root: ${root}`);
const receipt = { revision: 'P1-N.2', result: 'failed', startedAt: new Date().toISOString(), sessions: [], cleanupErrors: [] };
const start = performance.now(), control = new NativeProbeControl(), signal = control.signal;
const deadlineTimer = setTimeout(() => control.stop('active-deadline'), 340_000);
let active;
const requestStop = () => control.stop('interrupted');
process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop);
function command(executable, args, timeout = 20_000) {
  const result = spawnSync(executable, args, { cwd: root, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    encoding: 'utf8', timeout: Math.ceil(control.activeBudget(timeout)), maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `bounded command failed: ${path.basename(executable)}`);
  return result.stdout;
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  return hash.digest('hex');
}
async function waitFor(predicate, deadline, label) {
  while (!predicate()) {
    assert.ok(performance.now() < deadline && !signal.aborted, label);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(performance.now() < deadline && !signal.aborted, label);
}
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
try {
  const assets = '/private/tmp/context-router-step06-assets';
  const archive = path.join(assets, 'llama-b11146-bin-macos-arm64.tar.gz');
  const model = path.join(assets, 'Qwen3.5-9B-Q4_K_M.gguf');
  assert.equal((await stat(archive)).size, 11_189_714);
  assert.equal((await stat(model)).size, 5_680_522_464);
  assert.equal(await hashFile(archive), '1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711');
  assert.equal(await hashFile(model), '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8');
  receipt.assetsVerified = true;
  command('/usr/bin/tar', ['-xzf', archive, '-C', root]);
  const binary = path.join(root, 'llama-b11146/llama-server');
  const owner = path.join(root, 'owner');
  command('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2', path.join(import.meta.dirname, 'native-owner-probe.c'), '-o', owner]);
  const memory = path.join(root, 'memory-control');
  command('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2', path.resolve(import.meta.dirname, '../fixtures/local-model-feasibility/memory-control.c'), '-o', memory]);
  const baseline = JSON.parse(command(memory, []));
  assert.equal(baseline.pressure, 1);
  receipt.memoryBefore = baseline;
  // Import only the separately inspected closure; no package install/network operation.
  const packageFiles = [];
  async function inventory(directory) {
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name), info = await lstat(file);
      assert.ok(!info.isSymbolicLink(), 'certificate closure symlink refused');
      if (info.isDirectory()) await inventory(file);
      else { assert.ok(info.isFile()); packageFiles.push(file); }
    }
  }
  await inventory(path.join(certificateRoot, 'node_modules'));
  const closure = createHash('sha256');
  for (const file of packageFiles.sort()) {
    closure.update(path.relative(certificateRoot, file)); closure.update(Buffer.from([0]));
    closure.update(Buffer.from(await hashFile(file), 'hex'));
  }
  // Full-path string order, matching Array.sort(); Path component order differs.
  assert.equal(closure.digest('hex'), '5ac9d3fb2dc0f22949a02f45331cfa25a6f4283c469e669ce4ca769a7ca90ca7');
  assert.equal(await hashFile(path.join(certificateRoot, 'certificate-generator.mjs')),
    '5927a60206b130b477bd26efb843cd2602e0e5f9538ef8ff7b2dfcbe72a31c2b');
  control.check();
  const { generateCertificateFixture } = await import(pathToFileURL(path.join(certificateRoot, 'certificate-generator.mjs')).href);
  let previousKey;
  for (let generation = 1; generation <= 2; generation++) {
    control.admitGeneration();
    const generationRoot = path.join(root, `generation-${generation}`);
    await mkdir(generationRoot, { mode: 0o700 });
    const [sessionRoot, identityRoot, databaseRoot] = ['session', 'identity', 'data'].map(p => path.join(generationRoot, p));
    for (const p of [sessionRoot, identityRoot, databaseRoot]) await mkdir(p, { mode: 0o700 });
    const credentials = await generateCertificateFixture();
    assert.ok(credentials.apiKey !== previousKey, 'session keys must be fresh'); previousKey = credentials.apiKey;
    const keyPath = path.join(sessionRoot, 'server-key.pem'), certPath = path.join(sessionRoot, 'server-cert.pem'), apiKeyPath = path.join(sessionRoot, 'api-key.txt');
    for (const [file, bytes] of [[keyPath, credentials.privateKey], [certPath, credentials.certificate], [apiKeyPath, credentials.apiKey + '\n']])
      await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
    const port = await vacantPort();
    const configuration = { port, certificate: credentials.certificate, apiKey: credentials.apiKey };
    const profile = `(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:${port}"))` +
      `(allow network-outbound (remote tcp "localhost:${port}"))(deny mach-lookup (global-name "com.apple.dnssd.service"))`;
    control.admitGeneration(); // Cancellation during asynchronous setup must prevent launch.
    const child = spawn(owner, ['own', generationRoot, '150', '/usr/bin/sandbox-exec', '-p', profile,
      binary, ...runtimeArgs({ model, port, keyPath, certPath, apiKeyPath })],
      { cwd: generationRoot, env: { PATH: '/usr/bin:/bin', HOME: generationRoot, TMPDIR: generationRoot, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
    active = child;
    control.attach(child);
    const ended = once(child, 'close');
    let output = '', errors = '', client, memoryTimer, memoryFailure, modelPid;
    const measurements = [];
    child.stdout.on('data', data => { output += data; if (output.length > 16384) control.stop('output-bound'); });
    child.stderr.on('data', data => { errors += data; if (errors.length > 16384) control.stop('output-bound'); });
    const record = { generation, healthAttempts: 0, memory: measurements, result: 'failed' };
    receipt.sessions.push(record);
    const generationStart = performance.now();
    try {
      control.check();
      await waitFor(() => output.includes('\n'), performance.now() + 5000, 'native owner startup deadline');
      modelPid = JSON.parse(output.split('\n')[0]).pid;
      assert.ok(Number.isSafeInteger(modelPid) && modelPid > 0);
      const sample = () => {
        try {
          const measurement = JSON.parse(command(memory, [String(modelPid)], 1000));
          measurements.push({ elapsedMs: performance.now() - generationStart, ...measurement });
          assert.equal(measurement.pressure, 1); assert.ok(measurement.lifetimePeakPhysicalFootprintBytes <= 18 * 1024 ** 3);
        } catch { memoryFailure = true; control.stop('resource-bound'); }
      };
      sample(); memoryTimer = setInterval(sample, 2000);
      let ready = false;
      const healthDeadline = generationStart + 60_000;
      while (performance.now() < healthDeadline && !memoryFailure && child.exitCode === null && child.signalCode === null) {
        control.check();
        record.healthAttempts++;
        const remaining = healthDeadline - performance.now();
        if (remaining <= 0) break;
        try {
          await probeJson(configuration, '/health', undefined, { key: null, timeoutMs: Math.max(1, Math.floor(Math.min(1000, remaining))), signal });
          ready = performance.now() < healthDeadline;
          break;
        } catch { await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(200, healthDeadline - performance.now())))); }
      }
      assert.ok(ready && !memoryFailure, 'bounded public TLS readiness failed');
      record.readyMs = performance.now() - generationStart;
      // First actual claim and authenticated qualification happen only after public ready.
      control.check();
      const claimed = await claimManualSession({ root: sessionRoot, identityRoot, databaseRoot, port });
      assert.ok(claimed.apiKey === configuration.apiKey, 'claimed fixture key mismatch');
      for (const key of [null, 'deliberately-wrong-key']) {
        control.check();
        await probeJson(configuration, '/props', undefined, { key, expectedStatus: 401, timeoutMs: 1000, signal });
      }
      control.check();
      record.properties = summarizeProps((await probeJson(configuration, '/props', undefined, { timeoutMs: 1000, signal })).value);
      assert.equal(record.properties.templateSha256, '7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67');
      control.sendRelease();
      await waitFor(() => output.includes('lock-released'), performance.now() + 2000, 'lock-release deadline');
      assert.equal(spawnSync(owner, ['check', generationRoot], { timeout: 1000 }).status, 2, 'native model must retain lock after owner drops its descriptor');
      record.nativeDescriptorRetainedAfterTlsReady = true;
      control.check();
      const deadline = performance.now() + 30_000;
      const guardedProbe = (...args) => { control.check(); return probeJson(args[0], args[1], args[2], { ...args[3], signal }); };
      const rendered = await renderForCompletion(configuration, 'Return exactly the word OK.', undefined, deadline, guardedProbe);
      control.check();
      client = new NativeCompletionClient(configuration);
      const result = await client.complete(rendered.prompt, { deadline, maxTokens: 64, signal });
      assert.match(result.text, /\bOK\b/);
      record.completions = 1;
      sample(); assert.ok(!memoryFailure);
      record.result = 'passed';
    } finally {
      clearInterval(memoryTimer);
      try { await bounded(client?.close(), control.cleanupBudget(6000), 'client cleanup deadline'); }
      finally {
        control.endOwner();
        const result = await bounded(ended, control.cleanupBudget(12_000), 'exact owner exit unobserved');
        assert.equal(result[0], 0); assert.match(output, /reaped/); assert.equal(errors, '');
        assert.equal(spawnSync(owner, ['check', generationRoot], { timeout: 1000 }).status, 0);
        record.exactNativeOwnerReaped = true;
        control.detach(child);
        active = undefined;
      }
      const diagnostics = await readFile(path.join(generationRoot, 'native.log'));
      assert.ok(diagnostics.length <= 1024 * 1024 && !diagnostics.includes(Buffer.from(credentials.apiKey)));
      assert.equal(output.includes(credentials.apiKey), false);
      record.diagnosticsPrivateBoundedSecretAbsent = true;
    }
  }
  receipt.result = 'passed';
} catch (error) {
  receipt.failure = error.message;
  process.exitCode = 1;
} finally {
  clearTimeout(deadlineTimer);
  requestStop();
  if (active) { receipt.cleanupErrors.push('Exact owner cleanup was not established; no further generation or automatic cleanup authorized.'); process.exitCode = 1; }
  process.off('SIGINT', requestStop); process.off('SIGTERM', requestStop);
  receipt.elapsedMs = performance.now() - start;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`P1-N ${receipt.result}; private receipt retained`);
}
