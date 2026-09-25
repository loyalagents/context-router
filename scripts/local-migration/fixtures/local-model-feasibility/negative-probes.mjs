import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProbeClient, probeJson } from './client.mjs';
import { renderForCompletion } from './protocol.mjs';
import { createTlsFixture } from './tls-fixture.mjs';
import { runtimeArgs, vacantPort, auditDiagnostics } from './native.mjs';
import { spawnOwned } from './process.mjs';

/** Fixed synthetic boundary input; never contributes to the frozen quality score. */
export async function runInputLimit(configuration, probe = probeJson) {
  const prompt = '0\n'.repeat(6500);
  const result = { passed: false, promptBytes: Buffer.byteLength(prompt), renderedBytes: 0,
    tokenCount: 0, paths: [], completionRequests: 0 };
  let validTokens = false;
  try {
    await renderForCompletion(configuration, prompt, undefined, performance.now() + 10000,
      async (...args) => {
        const path = args[1];
        if (path !== ['/apply-template', '/tokenize'][result.paths.length]) throw new Error('Invalid probe sequence');
        result.paths.push(path);
        const response = await probe(...args);
        if (path === '/apply-template' && typeof response.value?.prompt === 'string') {
          result.renderedBytes = Buffer.byteLength(response.value.prompt);
        }
        if (path === '/tokenize') {
          const tokens = response.value?.tokens;
          validTokens = Array.isArray(tokens) && tokens.length > 0 && tokens.every((token) => Number.isInteger(token) && token >= 0);
          if (validTokens) result.tokenCount = tokens.length;
        }
        return response;
      });
  } catch (error) {
    result.passed = error.message === 'Probe context limit' && validTokens && result.tokenCount > 12000 &&
      result.paths.length === 2 && result.renderedBytes > 0 && result.renderedBytes <= 128 * 1024;
  }
  return result;
}

export async function runUnavailable() {
  const credentials = await createTlsFixture();
  let client;
  const result = { passed: false, completionRequests: 0, credentialsRemoved: false };
  try {
    const port = await vacantPort();
    client = new ProbeClient({ port, certificate: credentials.cert, apiKey: credentials.apiKey });
    const start = performance.now();
    let unavailable = false;
    try {
      await client.complete('Synthetic unavailable endpoint probe', { deadline: start + 1000,
        onWriteFinished: () => { result.completionRequests++; } });
    } catch (error) { unavailable = error.message === 'Local model unavailable'; }
    await client.settled();
    result.elapsedMs = performance.now() - start;
    result.controlEvidence = client.controlEvidence;
    result.passed = unavailable && result.completionRequests === 0 && result.elapsedMs <= 2000 &&
      result.controlEvidence.overflow === false && result.controlEvidence.records.filter((record) => record.event === 'dispatch').length === 1 &&
      result.controlEvidence.records.some((record) => record.phase === 'readiness' && record.event === 'transport');
  } finally {
    await client?.close();
    result.state = client?.state ?? 'unavailable';
    await credentials.remove(); result.credentialsRemoved = true;
  }
  return result;
}

/** Disposable negative fixtures only. Never acts on a user-owned runtime. */
export async function runMissingAsset({ kind, binary, evidenceRoot, sandboxProfile, exitTimeoutMs = 10000,
  argsForModel = runtimeArgs, now = () => performance.now() }) {
  if (!['binary', 'model'].includes(kind)) throw new Error('Invalid negative probe');
  const credentials = await createTlsFixture();
  const result = { kind, passed: false, spawnRejected: false, naturalExit: null, readinessRequests: 0,
    completionRequests: 0, ownedChildStoppedAndReaped: false, diagnosticAuditPassed: false, missingModelDiagnostic: false, credentialsRemoved: false };
  const logPath = join(evidenceRoot, `missing-${kind}.log`);
  let child; let spawnAttempted = false; let safeToRemove = true;
  const start = now(); const deadline = start + exitTimeoutMs;
  try {
    const missing = join(credentials.root, kind === 'binary' ? 'absent-runtime' : 'absent-model.gguf');
    let absent = false;
    try { await lstat(missing); } catch (error) { absent = error.code === 'ENOENT'; }
    if (!absent) throw new Error('Invalid negative fixture');
    const port = await vacantPort();
    const args = kind === 'binary' ? [] : argsForModel({ model: missing, port, ...credentials });
    const command = kind === 'binary' ? missing : binary;
    spawnAttempted = true;
    try {
      child = await spawnOwned({ command: kind === 'model' && sandboxProfile ? '/usr/bin/sandbox-exec' : command,
        args: kind === 'model' && sandboxProfile ? ['-p', sandboxProfile.replaceAll('PORT', String(port)), command, ...args] : args,
        cwd: credentials.root, logPath });
    } catch { result.spawnRejected = true; }
    if (kind === 'binary') result.passed = result.spawnRejected;
    else if (child) {
      const remaining = deadline - now();
      if (remaining > 0) result.naturalExit = await Promise.race([child.exited, delay(remaining, null, { ref: false })]);
      const observedWithinDeadline = now() < deadline;
      if (result.naturalExit && !child.logOverflow) {
        const bytes = await readFile(logPath);
        if (bytes.length > 0 && bytes.length <= 512 * 1024 && bytes.at(-1) === 10) {
          const diagnostic = `gguf_init_from_file: failed to open GGUF file '${missing}' (No such file or directory)`;
          const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
          result.missingModelDiagnostic = lines.some((line) => line.endsWith(diagnostic) &&
            /^(?:\d+\.\d+\.\d+\.\d+ E )?$/.test(line.slice(0, -diagnostic.length)));
        }
      }
      result.passed = observedWithinDeadline && result.missingModelDiagnostic && result.naturalExit !== null &&
        Number.isInteger(result.naturalExit.code) && result.naturalExit.code !== 0 && result.naturalExit.signal === null && !child.logOverflow;
    }
  } catch { result.passed = false; }
  finally {
    try {
      if (child) await child.stop();
      result.ownedChildStoppedAndReaped = !child || !child.running;
      if (spawnAttempted) {
        try { await auditDiagnostics(logPath, credentials.apiKey, child?.logOverflow ?? false); result.diagnosticAuditPassed = true; }
        catch { result.passed = false; }
      }
    } catch { result.passed = false; safeToRemove = false; }
    if (safeToRemove) { await credentials.remove(); result.credentialsRemoved = true; }
  }
  result.elapsedMs = now() - start;
  result.passed &&= result.ownedChildStoppedAndReaped && result.diagnosticAuditPassed && result.credentialsRemoved;
  return result;
}
