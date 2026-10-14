import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { loadDemoPlan, summarize, hash, validateDataset } from './records.mjs';
import { connect, importEntries } from './mcp-import.mjs';
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export const backendRoot = path.join(repoRoot, 'apps/backend');
const require = createRequire(path.join(backendRoot, 'package.json'));
export const safeError = message => Object.assign(new Error(message), { demoSafeMessage: message });
export const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export const configuration = root => ({ kind: 'sqlite', databaseRoot: path.join(root, 'data'), stateRoot: path.join(root, 'identity') });
const policy = (capabilities, targets) => ({ capabilities, targets, allowSensitive: true });
export const cleanEnvironment = () => ({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', NEXT_TELEMETRY_DISABLED: '1' });

export function backend() {
  require('reflect-metadata');
  return {
    ...require('@nestjs/core'),
    ...require('./dist/composition/local-mcp-application.module.js'),
    ...require('./dist/bootstrap/local-mcp.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-database.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-local-runtime.js'),
    ...require('./dist/modules/preferences/preference/preference.service.js'),
    ...require('./dist/modules/preferences/preference-definition/preference-definition.repository.js'),
    ...require('./dist/modules/preferences/audit/preference-audit-query.service.js'),
    ...require('./dist/mcp/access-log/mcp-access-log-query.service.js'),
  };
}

export async function privatePath(name, directory = false) {
  if (!path.isAbsolute(name) || path.resolve(name) !== name || await fs.realpath(name) !== name) throw safeError('Private demo paths must be canonical and must not contain links.');
  const s = await fs.lstat(name);
  if (s.uid !== process.getuid() || (s.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      !(directory ? s.isDirectory() : s.isFile() && s.nlink === 1 && s.size <= 16 * 1024 * 1024)) throw safeError('Invalid private demo path ownership, type or permissions.');
  return s;
}
export async function privateBytes(file) {
  const before = await privatePath(file), handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev) throw new Error();
    const data = await handle.readFile(), after = await handle.stat();
    if (data.length !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs) throw new Error();
    return data;
  } finally { await handle.close(); }
}
export const privateJson = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(file)));

async function treeDigest(root) {
  const entries = [];
  async function visit(dir) {
    for (const name of (await fs.readdir(dir)).sort()) {
      const file = path.join(dir, name), stat = await fs.lstat(file);
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile()) entries.push([path.relative(root, file), hash(await fs.readFile(file))]);
      else throw safeError('Build inputs must not contain links or special files.');
    }
  }
  await visit(root);
  return hash(JSON.stringify(entries));
}
export async function buildEvidence() {
  if (process.versions.node !== '24.21.0') throw safeError('Use Node 24.21.0.');
  // Discover the user's installation, then execute only this check with the
  // same clean environment used for demo processes (no inherited secrets).
  const found = spawnSync('/usr/bin/which', ['pnpm'], { env: { PATH: process.env.PATH ?? cleanEnvironment().PATH }, encoding: 'utf8', timeout: 10000 });
  const pnpmHint = 'Use pnpm 10.25.0 on PATH. With Node 24.21.0 selected, run "corepack enable && corepack prepare pnpm@10.25.0 --activate", put the Node bin directory first on PATH, then run "pnpm check:toolchain".';
  if (found.status !== 0) throw safeError(pnpmHint);
  const pnpm = spawnSync(path.resolve(found.stdout.trim()), ['--version'], { env: cleanEnvironment(), encoding: 'utf8', timeout: 10000 });
  if (pnpm.status !== 0 || pnpm.stdout.trim() !== '10.25.0') throw safeError(pnpmHint);
  try { await fs.access(path.join(backendRoot, 'dist/local-identity.js')); }
  catch { throw safeError('Backend build missing; run pnpm --filter backend build.'); }
  let webBuildId;
  try { webBuildId = (await fs.readFile(path.join(repoRoot, 'apps/web/.next/BUILD_ID'), 'utf8')).trim(); }
  catch { throw safeError('Web build missing; run pnpm --filter web build.'); }
  const git = args => { const result = spawnSync('/usr/bin/git', args, { cwd: repoRoot, encoding: 'utf8' }); if (result.status !== 0) throw new Error('Source revision unavailable'); return result.stdout.trim(); };
  return { node: process.versions.node, pnpm: pnpm.stdout.trim(), sourceRevision: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain'])), sourceStatus: git(['status', '--porcelain']),
    backendSha256: await treeDigest(path.join(backendRoot, 'dist')), webBuildId,
    webServerSha256: await treeDigest(path.join(repoRoot, 'apps/web/.next/server')),
    importerSha256: await treeDigest(fileURLToPath(new URL('./', import.meta.url))) };
}

export async function history(application, service, principalId, filter = {}) {
  const result = []; let after;
  do {
    const page = await application.get(service).getHistory(principalId, { ...filter, first: 100, ...(after ? { after } : {}) });
    result.push(...page.items); after = page.nextCursor;
    if (result.length > 50000) throw safeError('Demo history exceeds verification bound.');
  } while (after);
  return result;
}

export async function verifyApplication(application, principalId, plan, { strict = false, importerId } = {}) {
  const b = backend();
  const rows = await application.get(b.PreferenceService).getActivePreferences(principalId);
  const definitions = await application.get(b.PreferenceDefinitionRepository).getAll(principalId);
  const bySlug = new Map(rows.map(row => [row.slug, row])), defs = new Map(definitions.map(def => [def.slug, def]));
  const audits = await history(application, b.PreferenceAuditQueryService, principalId);
  const modified = [];
  if (rows.length !== plan.entries.length) throw safeError('Verification mismatch: active membership.');
  const ownedDefs = definitions.filter(d => d.ownerUserId === principalId);
  if (ownedDefs.length !== plan.entries.length) throw safeError('Verification mismatch: definition membership.');
  for (const entry of plan.entries) {
    const row = bySlug.get(entry.definition.slug), def = defs.get(entry.definition.slug);
    if (!row || def?.ownerUserId !== principalId || !def.isSensitive || def.valueType !== 'STRING' || def.scope !== 'GLOBAL' ||
        def.description !== entry.definition.description || def.displayName !== entry.definition.displayName ||
        (strict && (row.confidence != null || row.sourceType !== 'INFERRED')) || !row.lastModifiedBy) throw safeError('Verification mismatch: schema, ownership, source type or attribution.');
    const imported = audits.find(a => a.subjectSlug === row.slug && a.actorClientKey === `local:${importerId}` && a.origin === 'MCP' && isDeepStrictEqual(a.afterState?.evidence, entry.preference.evidence));
    if (!imported || imported.afterState.value !== JSON.parse(entry.preference.value) || imported.afterState.confidence != null || imported.afterState.sourceType !== 'INFERRED') throw safeError('Verification mismatch: retained import audit evidence.');
    const latest = audits.find(a => a.subjectSlug === row.slug && a.targetType === 'PREFERENCE');
    if (!latest || latest.afterState?.value !== row.value || !isDeepStrictEqual(latest.afterState.evidence, row.evidence) || !isDeepStrictEqual(latest.afterState.lastModifiedBy, row.lastModifiedBy)) throw safeError('Verification mismatch: current attribution or audited state.');
    if (row.value !== JSON.parse(entry.preference.value) || !isDeepStrictEqual(row.evidence, entry.preference.evidence)) {
      if (strict) throw safeError('Verification mismatch: imported value or evidence.');
      modified.push({ slug: row.slug, valueChanged: row.value !== JSON.parse(entry.preference.value), evidenceChanged: !isDeepStrictEqual(row.evidence, entry.preference.evidence) });
    }
  }
  return { active: rows.length, importAuditsVerified: plan.entries.length, modified };
}

export async function prepareDemo({ out, input, dataset = 'demo001', durable = false }, { beforeCreate = async () => {}, onProgress, writeManifest = writeJson } = {}) {
  if (out === repoRoot || out?.startsWith(repoRoot + path.sep)) throw safeError('Prepare private state outside the repository.');
  const plan = await loadDemoPlan(input, dataset);
  if (!plan.entries.length) throw safeError('The source has no active memories.');
  const builds = await buildEvidence();
  let b;
  try { b = backend(); } catch { throw safeError('Backend modules unavailable; install dependencies, generate Prisma and rebuild the backend.'); }
  const abort = new AbortController();
  let interruptedBy;
  const onInterrupt = signal => {
    if (interruptedBy) {
      // Restore the behavior outside this preparation scope. Do not remove
      // another caller's handlers or claim cleanup after forced termination.
      removeSignalHandlers(); process.kill(process.pid, signal); return;
    }
    interruptedBy = signal;
    abort.abort(safeError(`Preparation interrupted by ${signal}; partial state is preserved and must not be replayed.`));
    process.stderr.write('Stopping preparation after the current operation. Press Ctrl-C again to force termination; cleanup may be incomplete.\n');
  };
  const onInt = () => onInterrupt('SIGINT'), onTerm = () => onInterrupt('SIGTERM');
  const removeSignalHandlers = () => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); };
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  let runtime, importer, credentials, seed, revoked = false, stage = 'initialize', cleanupError, rootCreated = false, manifestPublished = false;
  const recovery = durable ? 'Stop and inspect writer.lock and retained artifacts before deciding recovery.'
    : 'Inspect retained artifacts before preparing a new output directory; never replay.';
  const advance = next => { abort.signal.throwIfAborted(); stage = next; };
  try {
    await beforeCreate(); abort.signal.throwIfAborted();
    await createFreshRoot(out); rootCreated = true; abort.signal.throwIfAborted();
    for (const name of ['exports', 'claude-workspace', 'codex-workspace', 'claude-home', 'codex-home', 'claude-config', 'codex-config', 'codex-a-workspace', 'codex-a-home', 'codex-a-config']) {
      abort.signal.throwIfAborted(); await fs.mkdir(path.join(out, name), { mode: 0o700 });
    }
    await writeJson(path.join(out, 'import-plan.json'), plan);
    abort.signal.throwIfAborted();
    const config = configuration(out);
    const initialized = spawnSync(process.execPath, ['--no-global-search-paths', path.join(backendRoot, 'dist/local-identity.js'), 'initialize'], {
      cwd: backendRoot, env: { ...cleanEnvironment(), LOCAL_DATABASE_ROOT: config.databaseRoot, LOCAL_IDENTITY_STATE_ROOT: config.stateRoot }, encoding: 'utf8', timeout: 20000,
    });
    if (initialized.status !== 0) throw new Error();
    advance('credentials');
    const identity = await privateJson(path.join(config.stateRoot, 'identity.json'));
    abort.signal.throwIfAborted();
    const db = b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot });
    credentials = new b.SqliteMcpCredentials(db, identity.principalId); credentials.upgrade();
    const targets = plan.sources.map(s => `${s.file.slice(0, -6)}.${dataset}.*`);
    seed = credentials.provision('demo preparation', path.join(out, 'exports/importer.token'));
    credentials.permissions(seed.id, policy(['preferences:write', 'preferences:define'], targets));
    advance('start'); runtime = await b.createLocalMcpApplication(config, { port: 0 });
    advance('connect'); importer = await connect(runtime.port, path.join(out, 'exports/importer.token'));
    advance('import'); await importEntries(importer, plan.entries, { signal: abort.signal, onProgress });
    advance('verify'); await verifyApplication(runtime.application, identity.principalId, plan, { strict: true, importerId: seed.id });
    advance('revoke'); credentials.revoke(seed.id); revoked = true;
    advance('clients');
    const agentA = credentials.provision('Demo agent A — writer', path.join(out, 'exports/agent-a.token'));
    const agentB = credentials.provision('Demo agent B — reader', path.join(out, 'exports/agent-b.token'));
    credentials.permissions(agentA.id, policy(durable ? ['preferences:write', 'preferences:define'] : ['preferences:write'], targets));
    const bTargets = targets.filter(t => !/^(finance|health)\./.test(t));
    credentials.permissions(agentB.id, policy(['preferences:read'], bTargets));
    let agentC;
    if (durable) {
      agentC = credentials.provision('Demo agent C — Desktop reader', path.join(out, 'exports/agent-c.token'));
      credentials.permissions(agentC.id, policy(['preferences:read'], bTargets));
      for (const client of [agentB, agentC]) credentials.grant(client.id, 'health.*', 'READ', 'DENY');
    }
    advance('close'); await importer.close(); importer = undefined; await runtime.close(); runtime = undefined;
    const manifest = { format: durable ? 'context-router-portability-demo-v2' : 'context-router-portability-demo-v1', status: 'prepared', root: out, principalId: identity.principalId,
      preparedAt: new Date().toISOString(), builds, ...summarize(plan), importerId: seed.id,
      planSha256: hash(await fs.readFile(path.join(out, 'import-plan.json'))),
      clients: { agentA: { id: agentA.id, write: true, targets }, agentB: { id: agentB.id, write: false, targets: bTargets },
        ...(durable ? { agentC: { id: agentC.id, write: false, targets: bTargets } } : {}) },
      limits: ['Native MCP SET sourceType is INFERRED.', 'Ordinary SET without evidence clears live evidence; import audit retains it.', 'Live assistant rehearsal pending.'] };
    // Finish a started manifest write, but honor cancellation before returning
    // to home selection. A completed manifest must not also get failed.json.
    advance('manifest'); await writeManifest(path.join(out, 'manifest.json'), manifest); manifestPublished = true;
    if (abort.signal.aborted) throw safeError('Preparation interrupted after manifest publication; completed manifest preserved for inspection.');
    return manifest;
  } catch (error) {
    if (seed && !revoked) { try { credentials.revoke(seed.id); revoked = true; } catch { cleanupError = true; } }
    if (rootCreated && !manifestPublished) await writeJson(path.join(out, 'failed.json'), { status: 'failed', stage, ...(interruptedBy ? { interruptedBy } : {}), partialStatePreserved: true, importerRevoked: revoked, cleanupRequiresInspection: Boolean(cleanupError), retry: recovery }).catch(() => {});
    throw safeError(`${error?.demoSafeMessage ?? `Demo preparation failed during ${stage}; partial state preserved.`} ${recovery}`);
  } finally {
    // Attempt both closures even when one fails. Never erase partial or uncertain state.
    try { try { await importer?.close(); } finally { await runtime?.close(); } }
    finally { removeSignalHandlers(); }
  }
}

export async function readManifest(root) {
  await privatePath(root, true);
  const manifest = await privateJson(path.join(root, 'manifest.json'));
  if (!['context-router-portability-demo-v1', 'context-router-portability-demo-v2'].includes(manifest.format) || manifest.status !== 'prepared' || manifest.root !== root ||
      !/^[a-f0-9]{64}$/.test(manifest.planSha256) || !manifest.principalId || !manifest.importerId) throw safeError('Only a successfully prepared demo can be opened.');
  validateDataset(manifest.dataset);
  for (const name of ['data', 'identity', 'exports', 'claude-workspace', 'codex-workspace', 'claude-home', 'codex-home', 'claude-config', 'codex-config', 'codex-a-workspace', 'codex-a-home', 'codex-a-config']) await privatePath(path.join(root, name), true);
  const plan = await privateJson(path.join(root, 'import-plan.json'));
  if (hash(await fs.readFile(path.join(root, 'import-plan.json'))) !== manifest.planSha256 || !isDeepStrictEqual(summarize(plan), { dataset: manifest.dataset, total: manifest.total, active: manifest.active, inactiveSkipped: manifest.inactiveSkipped, categories: manifest.categories, sources: manifest.sources })) throw safeError('Demo manifest or import plan mismatch.');
  const identity = await privateJson(path.join(root, 'identity/identity.json'));
  if (identity.principalId !== manifest.principalId) throw safeError('Demo identity mismatch.');
  const names = manifest.format.endsWith('-v2') ? ['agentA', 'agentB', 'agentC'] : ['agentA', 'agentB'];
  if (!isDeepStrictEqual(Object.keys(manifest.clients ?? {}).sort(), names)) throw safeError('Demo clients missing or unexpected.');
  const targets = plan.sources.map(s => `${s.file.slice(0, -6)}.${manifest.dataset}.*`);
  for (const [name, client] of Object.entries(manifest.clients)) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(client.id) || client.write !== (name === 'agentA') ||
        !isDeepStrictEqual(client.targets, name === 'agentA' ? targets : targets.filter(t => !/^(finance|health)\./.test(t)))) throw safeError('Demo client manifest mismatch.');
    const token = readCredential(path.join(root, 'exports', `agent-${name.at(-1).toLowerCase()}.token`));
    if (!token.startsWith(`cr_mcp_${client.id}.`)) throw safeError('Demo credential identity mismatch.');
  }
  if (!manifest.clients?.agentA || !manifest.clients?.agentB) throw safeError('Demo clients missing.');
  return manifest;
}

export async function verifyDemo(root) {
  const manifest = await readManifest(root), plan = await privateJson(path.join(root, 'import-plan.json')), b = backend();
  const identity = b.createSqliteIdentityRuntime(configuration(root)); await identity.service.verifyReadyState();
  const app = await b.NestFactory.createApplicationContext(b.LocalMcpApplicationModule.register(configuration(root)), { logger: false, abortOnError: false });
  try {
    const credentials = new b.SqliteMcpCredentials(identity.database, manifest.principalId), clients = credentials.list();
    if (clients.find(c => c.id === manifest.importerId)?.revoked !== true) throw safeError('Importer remains authorized.');
    for (const [name, record] of Object.entries(manifest.clients)) {
      let authority;
      try { authority = credentials.inspectForUi(record.id); }
      catch { throw safeError('Verification mismatch: client authority could not be inspected.'); }
      const durable = manifest.format.endsWith('-v2');
      const capabilities = name === 'agentA' ? (durable ? ['preferences:write', 'preferences:define'] : ['preferences:write']) : ['preferences:read'];
      const grants = durable && name !== 'agentA' ? [{ target: 'health.*', action: 'READ', effect: 'DENY' }] : [];
      if (authority.status !== 'AVAILABLE' || authority.client.revoked ||
          !isDeepStrictEqual(authority.grants.map(({ target, action, effect }) => ({ target, action, effect })), grants) ||
          !isDeepStrictEqual(authority.client.policy, policy(capabilities, record.targets))) {
        throw safeError('Verification mismatch: client authority differs from the versioned prepared policy/grant baseline.');
      }
    }
    return { status: 'verified', ...(await verifyApplication(app, manifest.principalId, plan, { importerId: manifest.importerId })) };
  } finally { await app.close(); }
}

// Descriptive owner inspection after additions or policy edits; never a baseline
// check or a claim that a listening server is healthy. No values or tokens shown.
export async function statusDemo(root) {
  const manifest = await readManifest(root), b = backend();
  const identity = b.createSqliteIdentityRuntime(configuration(root)); await identity.service.verifyReadyState();
  const app = await b.NestFactory.createApplicationContext(b.LocalMcpApplicationModule.register(configuration(root)), { logger: false, abortOnError: false });
  try {
    const credentials = new b.SqliteMcpCredentials(identity.database, manifest.principalId);
    const rows = await app.get(b.PreferenceService).getActivePreferences(manifest.principalId);
    const defs = await app.get(b.PreferenceDefinitionRepository).getAll(manifest.principalId);
    return { status: 'descriptive', baselineChecked: false, readinessChecked: false, root, format: manifest.format, dataset: manifest.dataset,
      active: rows.length, definitions: defs.filter(d => d.ownerUserId === manifest.principalId).length, importedActive: manifest.active,
      clients: Object.fromEntries(Object.entries(manifest.clients).map(([name, c]) => [name, credentials.inspectForUi(c.id)])),
      otherClients: credentials.list().filter(c => !Object.values(manifest.clients).some(record => record.id === c.id)) };
  } finally { await app.close(); }
}

export function startServer(root, port, mcpPort, stdio = 'inherit') {
  const config = configuration(root);
  return spawn(process.execPath, [path.join(repoRoot, 'apps/web/local-ui.mjs'), 'serve', '--unlock-dir', path.join(root, 'exports'), '--port', String(port), '--mcp-port', String(mcpPort)], {
    cwd: repoRoot, stdio, env: { ...cleanEnvironment(), HOME: root, LOCAL_DATABASE_ROOT: config.databaseRoot, LOCAL_IDENTITY_STATE_ROOT: config.stateRoot },
  });
}
export async function serveDemo({ root, port, mcpPort }) {
  await readManifest(root);
  const child = startServer(root, port, mcpPort);
  const stop = signal => child.kill(signal);
  const int = () => stop('SIGINT'), term = () => stop('SIGTERM');
  process.on('SIGINT', int); process.on('SIGTERM', term);
  try { return await new Promise((resolve, reject) => { child.once('error', () => reject(safeError('Demo server could not start.'))); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { process.off('SIGINT', int); process.off('SIGTERM', term); }
}
export async function createFreshRoot(root) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || /[\x00-\x1f\x7f]/.test(root)) {
    throw new Error('--out must be a canonical absolute path.');
  }
  const parent = path.dirname(root);
  if (await fs.realpath(parent) !== parent) throw new Error('Output parent must be canonical, without symlinks.');
  let current = parent;
  for (;;) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || ![0, process.getuid()].includes(stat.uid) ||
        ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0))) {
      throw new Error('Output parent must have trusted ownership and permissions.');
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  await fs.mkdir(root, { mode: 0o700 }); // Exclusive: never accepts or clears existing state.
  return root;
}
