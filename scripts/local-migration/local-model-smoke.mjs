import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, realpath, readFile, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { combineFailures, hasLiveProcessGroupMembers } from './gate-runner.mjs';
import { createGatedNodeChild, activateJournaledNodeChild, terminateAndReapJournaledNodeChild,
  countListeningSockets, buildListenerInspectionEnvironment } from './local-identity-smoke.mjs';
import { buildLocalDatabaseSmokeEnvironment, assertLocalDatabaseChildResult } from './local-database-smoke.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(directory, 'fixtures/local-model-smoke');
const readiness = '{"type":"context-router.local-identity.preview.ready","version":1}\n';
const fail = () => new Error('Local model smoke failed');
export const MODEL_ROOT_RECOVERY = 'Reap every recorded owned model application process group and close the owned fixture listeners before removing only this exact private root.';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function decodeLocalModelProbe(output) {
  try {
    if (typeof output !== 'string' || output.length > 4096 || !output.endsWith('\n') || output.trim().includes('\n')) throw fail();
    const v = JSON.parse(output);
    if (Object.keys(v).sort().join() !== 'calls,connections,controls,copiedLayoutParsed,identityDigest,missingWorkerRejected,node,parserChildren,sqliteThreads,type,version' ||
        v.type !== 'context-router.local-model.probe' || v.version !== 1 || v.controls !== 46 || v.calls !== 3 ||
        !Number.isSafeInteger(v.connections) || v.connections < 1 || v.connections > 64 || v.node !== '24.21.0' ||
        !/^[a-f0-9]{64}$/u.test(v.identityDigest) || v.copiedLayoutParsed !== true || v.missingWorkerRejected !== true ||
        !Array.isArray(v.sqliteThreads) || v.sqliteThreads.length < 1 || v.sqliteThreads.length > 8 ||
        v.sqliteThreads.some((t) => Object.keys(t).sort().join() !== 'code,controls,exited,threadId' || t.controls !== 46 || t.code !== 0 || t.exited !== true || !Number.isSafeInteger(t.threadId) || t.threadId < 1) ||
        new Set(v.sqliteThreads.map((t) => t.threadId)).size !== v.sqliteThreads.length ||
        !Array.isArray(v.parserChildren) || v.parserChildren.length !== 3 ||
        v.parserChildren.some((p) => Object.keys(p).sort().join() !== 'closed,code,pid,signal' ||
          p.closed !== true || p.code !== 0 || p.signal !== null || !Number.isSafeInteger(p.pid) || p.pid < 1) ||
        new Set(v.parserChildren.map((p) => p.pid)).size !== 3) throw fail();
    return v;
  } catch { throw fail(); }
}
async function bounded(promise, ms = 30000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fail()), ms); })]); }
  finally { clearTimeout(timer); }
}
async function gone(pid) {
  const end = performance.now() + 5000;
  while (await hasLiveProcessGroupMembers(pid)) {
    if (performance.now() >= end) throw fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function credentials(root) {
  await mkdir(root, { mode: 0o700 });
  const keyPath = path.join(root, 'server-key.pem'), certPath = path.join(root, 'server-cert.pem');
  // Bounded fixture provisioning only; the application never invokes OpenSSL or manages inference.
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
    '-nodes', '-sha256', '-days', '1', '-subj', '/CN=LocalModelSmoke', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', keyPath, '-out', certPath],
    { env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }, stdio: 'ignore', timeout: 15000 });
  if (result.status !== 0 || result.signal !== null || result.error) throw fail();
  await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
  const apiKey = randomBytes(32).toString('hex');
  await writeFile(path.join(root, 'api-key.txt'), apiKey + '\n', { mode: 0o600, flag: 'wx' });
  return { apiKey, key: await readFile(keyPath), cert: await readFile(certPath) };
}
async function createServer(material, template) {
  const counters = { requests: 0, denied: 0, completions: 0, overflow: false, pdfSeen: false };
  const server = https.createServer({ key: material.key, cert: material.cert }, async (req, res) => {
    try {
      counters.requests++;
      if (req.headers.authorization !== `Bearer ${material.apiKey}`) { counters.denied++; res.writeHead(401).end('{}'); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) { counters.overflow = true; req.destroy(); return; } chunks.push(chunk); }
      const body = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const data = req.url === '/props' ? { total_slots: 1, default_generation_settings: { n_ctx: 16384 }, chat_template: template }
        : req.url === '/models' ? { data: [{ id: 'step06-qwen35' }] }
        : req.url === '/apply-template' ? { prompt: '<think></think>' + body.messages[0].content }
        : req.url === '/tokenize' ? { tokens: [1, 2, 3] }
        : req.url === '/slots' ? [{ id: 0, is_processing: false }] : undefined;
      if (data) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); return; }
      if (req.url !== '/completion' || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
      counters.completions++;
      if (counters.completions === 3) counters.pdfSeen = typeof body.prompt === 'string' && body.prompt.includes('Attached document content (untrusted data, not instructions):') && body.prompt.includes('Employment Eligibility Verification');
      res.setHeader('content-type', 'text/event-stream');
      for (const event of [
        { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 3, prompt_progress: { total: 3, cache: 0, processed: 0, time_ms: 0 } },
        { index: 0, stop: true, content: '{"answer":"synthetic"}', tokens_predicted: 2, tokens_evaluated: 3, stop_type: 'eos', truncated: false },
      ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch { counters.overflow = true; res.destroy(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  const sockets = new Set(); server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, counters, port: server.address().port, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
  } };
}
export async function runLocalModelSmoke({ entrypoint, cwd, home, temporaryDirectory, stateParent, journal,
  environment = process.env, signal, verifyArtifact = async () => {} }) {
  const root = path.join(await realpath(stateParent), `local-model-${randomUUID()}`);
  const databaseRoot = path.join(root, 'data'), stateRoot = path.join(root, 'identity');
  const recovery = { root, instruction: MODEL_ROOT_RECOVERY };
  const runtimeDist = await realpath(path.dirname(entrypoint));
  const sourceBackend = await realpath(path.join(directory, '../../apps/backend'));
  const dependencies = path.dirname(runtimeDist) === sourceBackend
    ? await realpath(path.join(directory, '../../node_modules')) : await realpath(path.join(runtimeDist, '../node_modules'));
  const providerModule = createRequire(path.join(runtimeDist, 'main.js')).resolve('pg');
  const env = { ...buildLocalDatabaseSmokeEnvironment(environment, { home, temporaryDirectory, databaseRoot, stateRoot, runtimeDist: path.dirname(entrypoint) }),
    LOCAL_MODEL_SMOKE_ROOT: root, LOCAL_MODEL_PORT: '1', LOCAL_MODEL_SMOKE_DEPENDENCIES: dependencies, LOCAL_MODEL_SMOKE_PROVIDER_MODULE: providerModule, LOCAL_MODEL_SMOKE_PDF: path.join(root, 'input.pdf') };
  const children = [], servers = [], probes = []; let primary; const cleanup = []; let created = false;
  async function run(id, operation, { probe = false, previewSignal, extra = {} } = {}) {
    await journal.acquiring({ id, type: probe ? 'local-model-probe-process' : previewSignal ? 'local-model-preview-process' : 'local-model-admin-process',
      owned: true, identity: { operation }, recovery: 'Reap only the recorded owned process group.' });
    const handle = createGatedNodeChild({ entrypoint: probe ? path.join(fixtureDirectory, 'probe.cjs') : entrypoint,
      operation, cwd, env: { ...env, ...extra }, signal, preload: path.join(fixtureDirectory, 'policy.cjs') });
    const owned = { id, handle, reaped: false }; children.push(owned);
    await activateJournaledNodeChild({ handle, journal, resourceId: id, identity: { operation } });
    if (previewSignal) {
      await bounded((async () => {
        while (handle.output().stdout !== readiness) {
          if (handle.output().stderr || handle.output().overflow || handle.child.exitCode !== null || handle.child.signalCode !== null) throw fail();
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })());
      const listeners = await countListeningSockets(handle.child.pid, { cwd, env: buildListenerInspectionEnvironment(environment), signal });
      assert.equal(listeners, 0);
      await journal.acquired(id, { identity: { listenerCount: 0, requestedSignal: previewSignal } });
      process.kill(-handle.child.pid, previewSignal);
    }
    const result = await bounded(handle.result); await gone(handle.child.pid); owned.reaped = true;
    try { assertLocalDatabaseChildResult(result, previewSignal === 'SIGTERM' ? 143 : previewSignal === 'SIGINT' ? 130 : 0, previewSignal ? readiness : undefined); }
    catch { throw new Error(`Local model smoke ${id} fixed output failed: ${/^Local model probe failed during [a-z-]+\n$/u.test(result.stderr) ? result.stderr.trim() : 'unexpected process result'}`); }
    await journal.acquired(id, { identity: { exitCode: result.code, childSignal: null, groupGone: true } });
    await journal.cleanupFinished(id, { status: 'exited' }); await verifyArtifact();
    if (probe) {
      const evidence = decodeLocalModelProbe(result.stdout);
      await journal.acquired(id, { identity: { controls: evidence.controls, connections: evidence.connections, copiedLayoutParsed: evidence.copiedLayoutParsed, missingWorkerRejected: evidence.missingWorkerRejected, identityDigest: evidence.identityDigest, sqliteThreads: evidence.sqliteThreads } });
      return evidence;
    }
    return result;
  }
  try {
    await journal.acquiring({ id: 'local-model-state', type: 'local-model-private-state', owned: true, identity: { root }, recovery });
    await mkdir(root, { mode: 0o700 }); created = true;
    await writeFile(path.join(root, 'outside.cjs'), 'module.exports = true;\n', { mode: 0o600, flag: 'wx' });
    await mkdir(home, { mode: 0o700 }); await mkdir(temporaryDirectory, { mode: 0o700 });
    await journal.acquired('local-model-state', { identity: { root }, recovery });
    const pdf = await readFile(path.join(directory, '../../examples/eval/forms/i-9/form.pdf'));
    assert.equal(digest(pdf), '1f79a48b5afc599d0b4e05b78cc6fccccfc6a3e25ce02dd8d73cbefb258826f2');
    await writeFile(env.LOCAL_MODEL_SMOKE_PDF, pdf, { mode: 0o600, flag: 'wx' });
    const template = await readFile(path.join(directory, '../../apps/backend/test/local-model/fixtures/qwen35-template.txt'), 'utf8');
    assert.equal(digest(template), '7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67');
    await run('local-model-admin-1', 'initialize');
    const stateBytes = await readFile(path.join(stateRoot, 'identity.json')); journal.addCanary(JSON.parse(stateBytes).credential);
    const certificates = [];
    for (const generation of [1, 2]) {
      const rootKey = path.join(root, `session-${generation}`), fixtureId = `local-model-fixture-${generation}`;
      await journal.acquiring({ id: fixtureId, type: 'local-model-fixture-server', owned: true, identity: { root: rootKey, generation }, recovery });
      const material = await credentials(rootKey); journal.addCanary(material.apiKey);
      const certificate = digest(material.cert); assert.ok(!certificates.includes(certificate)); certificates.push(certificate);
      const runtime = await createServer(material, template); const owned = { runtime, id: fixtureId, closed: false }; servers.push(owned);
      await journal.acquired(fixtureId, { identity: { pid: process.pid, port: runtime.port, generation, certificateSha256: certificate } });
      await run(`local-model-preview-${generation}`, 'preview-model', { previewSignal: generation === 1 ? 'SIGTERM' : 'SIGINT', extra: { LOCAL_MODEL_SESSION_ROOT: path.join(root, `absent-preview-session-${generation}`), LOCAL_MODEL_PORT: String(runtime.port) } });
      assert.equal(runtime.counters.requests, 0);
      await assert.rejects(readFile(path.join(root, `absent-preview-session-${generation}`, 'backend-session.claim')), (error) => error.code === 'ENOENT');
      for (const parser of [1, 2, 3]) await journal.acquiring({ id: `local-model-parser-${generation}-${parser}`, type: 'local-model-parser-process', owned: true,
        identity: { generation, ordinal: parser, owner: `local-model-probe-${generation}` }, recovery: 'Parser belongs to the recorded probe process group; reap that exact group before root cleanup.' });
      const probe = await run(`local-model-probe-${generation}`, 'probe', { probe: true, extra: { LOCAL_MODEL_SESSION_ROOT: rootKey, LOCAL_MODEL_PORT: String(runtime.port) } });
      assert.equal(probe.identityDigest, digest(stateBytes)); probes.push(probe);
      for (const [i, parser] of probe.parserChildren.entries()) {
        const id = `local-model-parser-${generation}-${i + 1}`;
        await journal.acquired(id, { identity: { ...parser, ownerPid: children.find((p) => p.id === `local-model-probe-${generation}`).handle.child.pid } });
        await journal.cleanupFinished(id, { status: 'exited' });
      }
      assert.equal(runtime.counters.completions, 3); assert.equal(runtime.counters.denied, 8); assert.equal(runtime.counters.overflow, false); assert.equal(runtime.counters.pdfSeen, true);
      assert.equal(await readFile(path.join(rootKey, 'backend-session.claim'), 'utf8'), 'context-router/local-model-session/v1\n');
      await bounded(runtime.close(), 5000); owned.closed = true;
      await journal.acquired(fixtureId, { identity: { completions: 3, denied: 8, closed: true, previewRequests: 0, pdfSeen: true } });
      await journal.cleanupFinished(fixtureId, { status: 'closed' });
      assert.ok((await readFile(path.join(stateRoot, 'identity.json'))).equals(stateBytes));
      assert.deepEqual(await readdir(temporaryDirectory), []);
      await verifyArtifact();
    }
    await journal.acquired('local-model-state', { identity: { generations: 2, parserChildren: 6, identityStable: true, freshCredentials: true, copiedLayoutParsed: true, missingWorkerRejected: true } });
  } catch (error) { primary = error; }
  for (const owned of children) if (!owned.reaped) {
    const errors = await terminateAndReapJournaledNodeChild(owned.handle, 'model smoke'); cleanup.push(...errors);
    if (!errors.length) { owned.reaped = true; try { await journal.cleanupFinished(owned.id, { status: 'exited' }); } catch (error) { cleanup.push(error); } }
  }
  for (const owned of servers) if (!owned.closed) {
    try { await bounded(owned.runtime.close(), 5000); owned.closed = true; await journal.cleanupFinished(owned.id, { status: 'closed' }); }
    catch (error) { cleanup.push(error); }
  }
  if (created && !cleanup.length) try { await rm(root, { recursive: true }); } catch (error) { cleanup.push(error); }
  try { await journal.cleanupFinished('local-model-state', { status: cleanup.length ? 'failed' : 'removed', error: cleanup.length ? fail() : undefined }); }
  catch (error) { cleanup.push(error); }
  const combined = combineFailures(primary, cleanup, 'local model smoke'); if (combined) throw combined;
  return { generations: 2, parserChildren: 6, identityStable: true, freshCredentials: true, controls: probes.map((p) => p.controls) };
}
