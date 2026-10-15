// Explicit, opt-in synthetic A-to-B and lost-reply rehearsal. Not a release gate.
// Never select a default application/state root or contact the user's MCP port.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { cp, mkdir, realpath, lstat, readFile, writeFile, rename, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { verifyPinnedArtifact } from './artifact-preflight.mjs';
import { requestMcpSmoke } from '../local-mcp-smoke.mjs';
import { createPilotLossProxy } from '../../../apps/backend/test/local-mcp/fixtures/pilot-loss-proxy.mjs';
import { offlineModelRetention } from './offline-model-retention.mjs';
import { observePilotProcessExit } from './pilot-process-exit.mjs';

const { values } = parseArgs({ strict: true, options: {
  from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string' },
  'model-file': { type: 'string' },
  'from-manifest': { type: 'string' }, 'to-manifest': { type: 'string' },
  'from-sealed-payload': { type: 'string' }, 'from-sealed-payload-sha256': { type: 'string' },
  'to-sealed-payload': { type: 'string' }, 'to-sealed-payload-sha256': { type: 'string' },
} });
assert.equal(process.version, 'v24.21.0');
assert.ok(!['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS'].some(name => process.env[name]),
  'Disable Node debugging/options before qualification startup');
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
for (const key of ['from', 'to', 'out']) {
  assert.ok(typeof values[key] === 'string' && path.isAbsolute(values[key]) &&
    path.resolve(values[key]) === values[key] && !/[\x00-\x1f\x7f]/u.test(values[key]));
}
for (const key of ['from-manifest', 'to-manifest']) assert.match(values[key], /^[a-f0-9]{64}$/);
const repository = path.resolve(import.meta.dirname, '../../..');
const root = values.out, app = path.join(root, 'current.app'), envelope = path.join(root, 'managed-v1');
assert.equal(path.dirname(root), '/private/tmp', 'This bounded rehearsal uses a fresh private directory in /private/tmp');
assert.equal(await realpath(path.dirname(root)), path.dirname(root));
for (const source of [values.from, values.to]) {
  assert.equal(await realpath(source), source);
  assert.ok(!source.startsWith(root + '/') && !root.startsWith(source + '/'));
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = async p => readFile(path.join(p, 'Contents/Resources/package-manifest.json'));
const aBytes = await manifest(values.from), bBytes = await manifest(values.to);
assert.equal(hash(aBytes), values['from-manifest']); assert.equal(hash(bBytes), values['to-manifest']);
const pinned = side => ({ manifestSha256: values[`${side}-manifest`], sealedPayload: values[`${side}-sealed-payload`], sealedPayloadSha256: values[`${side}-sealed-payload-sha256`] });
const aManifest = await verifyPinnedArtifact(values.from, {...pinned('from'),allowPreviousEpoch1:true}), bManifest = await verifyPinnedArtifact(values.to, pinned('to'));
assert.notEqual(aManifest.source, bManifest.source);
assert.notEqual(hash(JSON.stringify(aManifest.files)), hash(JSON.stringify(bManifest.files)));
assert.ok(aManifest.securityEpoch===bManifest.securityEpoch||(aManifest.securityEpoch===1&&bManifest.securityEpoch===2));
for (const key of ['node', 'sqliteVersions', 'identityVersion', 'model'])
  assert.equal(JSON.stringify(aManifest[key]), JSON.stringify(bManifest[key]));
await mkdir(root, { mode: 0o700 }); // Must be absent; retain all outputs on failure.
const receipt = { version: 1, status: 'running', fromManifest: hash(aBytes), toManifest: hash(bBytes),
  fromSealedPayloadSha256: values['from-sealed-payload-sha256'] ?? null, toSealedPayloadSha256: values['to-sealed-payload-sha256'] ?? null,
  phases: [], disk: [], limitations: [
    'Synthetic isolated state and ephemeral ports; no actual Claude UI or personal configuration.',
    'No download, Gatekeeper, signing, model inference or new hardware acceptance. Optional verified-weight retention is offline only.',
    'Allocated blocks may share APFS clone extents; phase samples are not an exact instantaneous peak.',
  ] };
const owners = [], clients = [];
let proxy;
// This outer qualification budget includes two complete sealed artifact copies,
// repeated inventory verification and optional 5.7 GB offline weight hashes.
// Startup, stop and command deadlines below retain their existing bounds.
const started=Date.now(),signal = AbortSignal.timeout(600000);
const exe = () => path.join(app, 'Contents/MacOS/context-router');
const node = () => path.join(app, 'Contents/Resources/bin/node');
const profile = path.join(root, 'offline.sb');
await writeFile(profile, '(version 1)\n(allow default)\n(deny network-outbound)\n' +
  '(allow network-outbound (remote ip "localhost:*"))\n' +
  `(deny process-exec (literal ${JSON.stringify(path.join(app, 'Contents/Resources/model/llama-server'))}))\n`, { mode: 0o600 });
const cliArgs = args => ['-f', profile, exe(), ...(args[0] === 'verify-package' ? args :
  args[0] === 'guardian' ? ['guardian', '--root', envelope, ...args.slice(1)] : ['--root', envelope, ...args])];
function command(args, expected = 0) {
  signal.throwIfAborted();
  const result = spawnSync('/usr/bin/sandbox-exec', cliArgs(args), {
    cwd: root, env: { PATH: '', LC_ALL: 'C' }, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ok(!result.error && result.status === expected, 'Installed command failed; preserve evidence for diagnosis');
  return result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Owned-process deadline; preserve state')), ms);
  })]); } finally { clearTimeout(timer); }
}
async function launch() {
  signal.throwIfAborted();
  const child = spawn('/usr/bin/sandbox-exec', cliArgs(['guardian', '--ui-port', '0', '--mcp-port', '0']), {
    cwd: root, env: { PATH: '', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const owner = { child, exit: observePilotProcessExit(child), events: [], bytes: '', diagnosticBytes: 0 };
  owners.push(owner); child.stdin?.on('error', () => {});
  child.stdout?.on('data', chunk => {
    owner.bytes += chunk;
    if (owner.bytes.length > 65536 || owner.events.length > 100) { child.stdin.end(); return; }
    let end;
    while ((end = owner.bytes.indexOf('\n')) !== -1) {
      try { owner.events.push(JSON.parse(owner.bytes.slice(0, end))); }
      catch { owner.invalid = true; child.stdin.end(); }
      owner.bytes = owner.bytes.slice(end + 1);
    }
  });
  child.stderr?.on('data', chunk => { owner.diagnosticBytes += chunk.length; });
  await bounded((async () => {
    while (!owner.events.some(e => e.type === 'ready')) {
      assert.equal(owner.exit.spawnFailed, false, 'Guardian spawn failed; preserve evidence');
      assert.equal(child.exitCode, null, 'Guardian exited before ready');
      assert.ok(!owner.invalid); signal.throwIfAborted();
      await new Promise(r => setTimeout(r, 20));
    }
  })(), 125000);
  owner.ready = owner.events.find(e => e.type === 'ready');
  assert.equal(owner.ready.modelEnabled, false);
  const url = new URL(owner.ready.mcpOrigin);
  assert.equal(url.hostname, '127.0.0.1'); assert.notEqual(url.port, '8787');
  owner.port = Number(url.port);
  return owner;
}
async function stop(owner) {
  if (owner.stopped) return;
  owner.child.stdin?.end();
  const outcome = await bounded(owner.exit.ended, 30000);
  if (outcome.spawnFailed && owner.child.pid === undefined) {
    owner.stopped = true; owner.notSpawned = true; return;
  }
  assert.equal(outcome.spawnFailed, false);
  assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
  assert.equal(owner.diagnosticBytes, 0); assert.ok(!owner.invalid);
  const last = owner.events.at(-1), journal = JSON.parse(await readFile(path.join(envelope, 'owner.json')));
  assert.equal(last?.type, 'stopped'); assert.equal(last.outcome, 'ok');
  assert.equal(journal.lifecycle, 'quiescent'); assert.equal(journal.outcome, 'ok');
  assert.equal(journal.generation, last.generation); owner.stopped = true;
}
async function client(port, token) {
  const init = await requestMcpSmoke(port, token, { jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pilot-rehearsal', version: '1' } } });
  assert.equal(init.status, 200);
  const headers = { 'mcp-session-id': init.headers['mcp-session-id'], 'mcp-protocol-version': '2025-11-25' };
  assert.equal((await requestMcpSmoke(port, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers)).status, 202);
  const discovery = await requestMcpSmoke(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers);
  assert.equal(discovery.status, 200); assert.ok(Array.isArray(discovery.value.result?.tools));
  let id = 2;
  return async (name, args) => {
    const response = await requestMcpSmoke(port, token, { jsonrpc: '2.0', id: id++, method: 'tools/call',
      params: { name, arguments: args ?? {} } }, headers);
    assert.equal(response.status, 200); assert.equal(response.value.error, undefined);
    return response.value.result;
  };
}
const slug = 'pilot_rehearsal.allowed';
const set = (call, value) => call('mutatePreferences', { operation: 'SET_PREFERENCE',
  preference: { slug, value: JSON.stringify(value), confidence: 1 } });
async function state() {
  assert.ok(owners.every(o => o.stopped));
  const installation = JSON.parse(await readFile(path.join(envelope, 'installation.json')));
  const store = path.join(envelope, 'stores', installation.selectedStore);
  const database = path.join(store, 'data/database.sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  let count;
  try {
    count = db.prepare('SELECT count(*) AS n FROM preference_audit_events WHERE subject_slug = ?').get(slug).n;
  } finally { db.close(); }
  return { count, hashes: await Promise.all(['installation.json',
      `stores/${installation.selectedStore}/data/database.sqlite`,
      `stores/${installation.selectedStore}/identity/identity.json`].map(async p => hash(await readFile(path.join(envelope, p))))) };
}
async function measure(name) {
  const totals = { logicalBytes: 0, allocatedBytes: 0, files: 0 };
  async function visit(p) {
    const s = await lstat(p);
    if (s.isDirectory()) for (const f of await readdir(p)) await visit(path.join(p, f));
    else { totals.logicalBytes += s.size; totals.allocatedBytes += s.blocks * 512; totals.files++; }
  }
  await visit(root);
  const volume = await statfs(root);
  receipt.disk.push({ phase: name, ...totals, volumeAvailableBytes: volume.bavail * volume.bsize });
}
async function phase(name) { receipt.phases.push(name); await measure(name);(receipt.phaseTiming??=[]).push({name,elapsedMs:Date.now()-started});console.log(`Pilot rehearsal: ${name}`); }
async function inspectLive(owner) {
  const origin = new URL(owner.ready.origin);
  assert.equal(origin.protocol, 'http:'); assert.equal(origin.hostname, '127.0.0.1');
  assert.ok(owner.ready.unlockFile.startsWith(envelope + '/'));
  const request = (route, body, token) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: Number(origin.port), path: route,
      method: 'POST', headers: { origin: origin.origin, 'content-type': 'application/json',
        'x-context-router-ui': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 1024 * 1024) req.destroy(); });
      res.on('error', reject);
      res.on('end', () => {
        try { assert.equal(res.statusCode, 200); resolve(JSON.parse(text)); } catch { reject(new Error('Synthetic UI read failed')); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Synthetic UI deadline')));
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  const bootstrap = (await readFile(owner.ready.unlockFile, 'utf8')).trim();
  const unlocked = await request('/api/local/unlock', { bootstrap });
  assert.ok(typeof unlocked.token === 'string' && unlocked.token.startsWith('cr_ui_session_'));
  return async () => {
    const response = await request('/graphql', { query: `{ activePreferences { slug value }
      preferenceAuditHistory(input: {first: 100, subjectSlug: "${slug}"}) {
        items { id eventType subjectSlug afterState } hasNextPage } }` }, unlocked.token);
    assert.equal(response.errors, undefined); assert.equal(response.data.preferenceAuditHistory.hasNextPage, false);
    return response.data;
  };
}
try {
  const proofPaths = ['scripts/local-migration/installation/pilot-rehearsal.mjs',
    'scripts/local-migration/installation/pilot-process-exit.mjs',
    'scripts/local-migration/installation/offline-model-retention.mjs',
    'scripts/local-migration/installation/artifact-preflight.mjs',
    'apps/desktop/src/package-manifest.mjs', 'apps/desktop/src/legacy-package-manifest.mjs',
    'apps/backend/test/local-mcp/fixtures/pilot-loss-proxy.mjs',
    'apps/backend/test/local-mcp/fixtures/bridge-child.mjs',
    ...['bridge', 'cli', 'credential'].map(n => `apps/backend/scripts/mcp-bridge/${n}.mjs`)];
  receipt.inputHashes = Object.fromEntries(await Promise.all(proofPaths.map(async p => [p, hash(await readFile(path.join(repository, p)))])));
  receipt.nodeSha256 = hash(await readFile(path.join(values.to, 'Contents/Resources/bin/node')));
  assert.equal(receipt.nodeSha256, 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b');
  receipt.sdkVersion = JSON.parse(await readFile(path.join(repository, 'apps/backend/node_modules/@modelcontextprotocol/sdk/package.json'))).version;
  assert.equal(receipt.sdkVersion, '1.27.1');
  await measure('before-copy');
  await cp(values.from, app, { recursive: true, verbatimSymlinks: true });
  assert.equal(hash(await manifest(app)), values['from-manifest']);
  await verifyPinnedArtifact(app, {...pinned('from'),allowPreviousEpoch1:true}); command(['verify-package']);
  const initial = await launch(); await stop(initial);
  const file = path.join(root, 'writer.token');
  const writer = command(['mcp', 'provision', '--label', 'Synthetic replacement writer', '--out', file])[0].result;
  command(['mcp', 'permissions', '--id', writer.id, '--capabilities', 'preferences:read,preferences:write,preferences:define', '--targets', 'pilot_rehearsal.*']);
  const revokedFile = path.join(root, 'revoked.token');
  const revoked = command(['mcp', 'provision', '--label', 'Synthetic revoked client', '--out', revokedFile])[0].result;
  command(['mcp', 'revoke', '--id', revoked.id]);
  const token = (await readFile(file, 'utf8')).trim(), revokedToken = (await readFile(revokedFile, 'utf8')).trim();
  const first = await launch(), callA = await client(first.port, token);
  assert.equal((await callA('mutatePreferences', { operation: 'CREATE_DEFINITION',
    definition: { slug, description: 'Synthetic replacement rehearsal', valueType: 'STRING', scope: 'GLOBAL', isSensitive: false } })).isError, false);
  assert.equal((await set(callA, 'synthetic-version-a')).isError, false);
  await stop(first);
  command(['mcp', 'permissions', '--id', writer.id, '--capabilities', 'preferences:read,preferences:write', '--targets', slug]);
  command(['backup']);
  const before = await state(); await phase('A-seeded-closed-backed-up');
  await cp(values.to, path.join(root, 'next.app'), { recursive: true, verbatimSymlinks: true });
  assert.equal(hash(await manifest(path.join(root, 'next.app'))), values['to-manifest']);
  await verifyPinnedArtifact(path.join(root, 'next.app'), pinned('to')); await measure('B-staged-before-replacement');
  await rename(app, path.join(root, 'previous.app')); await rename(path.join(root, 'next.app'), app);
  command(['verify-package']);
  assert.deepEqual((await state()).hashes, before.hashes); await phase('B-whole-app-replacement-before-state-open');
  const second = await launch(), callB = await client(second.port, token);
  assert.equal((await callB('searchPreferences')).structuredContent.active.preferences.find(p => p.slug === slug)?.value, 'synthetic-version-a');
  const denied = await callB('mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug: 'pilot_rehearsal.denied', value: '"synthetic-denied"' } });
  assert.equal(denied.isError, true);
  const denial = JSON.parse(denied.content[0].text);
  assert.equal(denial.success, false); assert.equal(denial.changed, false);
  assert.equal(denial.code, 'MCP_PERMISSION_DENIED');
  assert.equal((await requestMcpSmoke(second.port, revokedToken, { jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'revoked-rehearsal', version: '1' } } })).status, 401);
  assert.equal((await set(callB, 'synthetic-version-b')).isError, false);
  await stop(second); const after = await state(); assert.equal(after.count, before.count + 1);
  await phase('B-authority-and-state-continuity');
  if(aManifest.securityEpoch===1&&bManifest.securityEpoch===2){
    const upgraded=await readFile(path.join(envelope,'installation.json')),journal=await readFile(path.join(envelope,'owner.json'));
    const rejected=spawnSync('/usr/bin/sandbox-exec',['-f',profile,path.join(root,'previous.app/Contents/MacOS/context-router'),'--root',envelope,'mcp','list'],{env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:30000});
    assert.equal(rejected.error,undefined);assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');
    assert.deepEqual(await readFile(path.join(envelope,'installation.json')),upgraded);assert.deepEqual(await readFile(path.join(envelope,'owner.json')),journal);assert.deepEqual((await state()).hashes,after.hashes);
    await phase('epoch1-artifact-refuses-upgraded-envelope-without-state-mutation');
  }
  const require = createRequire(path.join(repository, 'apps/backend/package.json'));
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const cli = path.join(repository, 'apps/backend/scripts/mcp-bridge/cli.mjs');
  for (const arg of ['--help', '--version']) {
    const result = spawnSync(node(), ['--no-global-search-paths', cli, arg], { env: { PATH: '', LC_ALL: 'C' }, encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
  }
  const third = await launch();
  const inspect = await inspectLive(third), baseline = await inspect();
  proxy = await createPilotLossProxy({ credential: token, upstreamPort: third.port,
    slug, value: 'synthetic-lost-reply' });
  assert.notEqual(proxy.port, 8787);
  const sdk = new Client({ name: 'pilot-installed-bridge', version: '1' }, { capabilities: {} });
  clients.push(sdk);
  const transport = new StdioClientTransport({ command: node(), args: ['--no-global-search-paths',
    path.join(repository, 'apps/backend/test/local-mcp/fixtures/bridge-child.mjs'), String(proxy.port), file], env: {}, stderr: 'pipe' });
  let diagnostics = 0; transport.stderr.on('data', c => { diagnostics += c.length; });
  await sdk.connect(transport); await sdk.listTools(); proxy.arm();
  const result = await sdk.callTool({ name: 'mutatePreferences', arguments: { operation: 'SET_PREFERENCE',
    preference: { slug, value: '"synthetic-lost-reply"' } } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Outcome unknown.*may have completed.*no request was replayed/);
  const observed = await inspect();
  const auditBefore = baseline.preferenceAuditHistory.items, auditAfter = observed.preferenceAuditHistory.items;
  const added = auditAfter.filter(e => !auditBefore.some(old => old.id === e.id));
  assert.equal(auditAfter.length, auditBefore.length + 1); assert.equal(added.length, 1);
  assert.equal(added[0].eventType, 'PREFERENCE_SET'); assert.equal(added[0].subjectSlug, slug);
  assert.equal(observed.activePreferences.find(p => p.slug === slug)?.value, 'synthetic-lost-reply');
  receipt.persistenceBeforeRecovery = { newAuditEvents: added.length, expectedValueObserved: true };
  const read = await sdk.callTool({ name: 'searchPreferences', arguments: {} });
  assert.equal(read.structuredContent.active.preferences.find(p => p.slug === slug)?.value, 'synthetic-lost-reply');
  await sdk.close(); clients.pop();
  receipt.lossProxy = proxy.snapshot(); await proxy.close(); proxy = undefined;
  assert.equal(diagnostics, 0);
  assert.equal(receipt.lossProxy.mutationAttempts, 1); assert.equal(receipt.lossProxy.mutationForwards, 1);
  assert.equal(receipt.lossProxy.replyLosses, 1); assert.equal(receipt.lossProxy.failedInjection, false);
  assert.equal(receipt.lossProxy.initializes, 2); assert.equal(receipt.lossProxy.initialized, 2);
  await stop(third); assert.equal((await state()).count, after.count + 1);
  const fourth = await launch(), finalRead = await client(fourth.port, token);
  assert.equal((await finalRead('searchPreferences')).structuredContent.active.preferences.find(p => p.slug === slug)?.value, 'synthetic-lost-reply');
  await stop(fourth); assert.equal((await state()).count, after.count + 1);
  command(['mcp', 'revoke', '--id', writer.id]);
  for (const [p, digest] of Object.entries(receipt.inputHashes)) assert.equal(hash(await readFile(path.join(repository, p))), digest);
  await phase('bundled-node-bridge-lost-reply-one-commit-explicit-read-and-durable-restart');
  if(values['model-file']){receipt.offlineModelRetention=await offlineModelRetention({root,previous:path.join(root,'previous.app'),current:app,source:values['model-file'],model:bManifest.model});await phase('verified-real-weight-clone-offline-epoch-retention');}
  else receipt.limitations.push('No trusted real-weight input supplied; real-weight retention remains unproved.');
  receipt.status = 'passed';
} catch(error) {
  receipt.status = 'failed'; receipt.failure = 'Rehearsal assertion or owned-process failure; preserve output for diagnosis.';
  receipt.failureDiagnostic={name:error?.name,code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:null,deadlineExpired:signal.aborted,elapsedMs:Date.now()-started,lastCompletedPhase:receipt.phases.at(-1)??null};
  process.exitCode = 1;
} finally {
  for (const client of clients) try { await bounded(client.close(), 5000); } catch { receipt.status = 'failed'; }
  try { await proxy?.close(); } catch { receipt.status = 'failed'; }
  for (const owner of owners) if (!owner.stopped) try { await stop(owner); } catch {
    receipt.status = 'failed'; receipt.uncertainOwnership = true;
    owner.child.stdin?.destroy(); owner.child.stdout?.destroy(); owner.child.stderr?.destroy(); owner.child.unref();
  }
  if (receipt.status !== 'passed') process.exitCode = 1;
  receipt.owners = owners.map(o => ({ pid: o.child.pid, stopped: o.stopped === true,
    notSpawned: o.notSpawned === true, exitCode: o.child.exitCode, signal: o.child.signalCode,
    diagnosticBytes:o.diagnosticBytes,eventTypes:o.events.map(e=>e.type),lastOutcome:o.events.at(-1)?.outcome??null }));
  receipt.elapsedMs=Date.now()-started;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`Pilot rehearsal: ${receipt.status}; ${path.join(root, 'receipt.json')}`);
}
