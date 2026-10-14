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
async function privateJson(file) {
  const before = await privatePath(file), handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev) throw new Error();
    const data = await handle.readFile(), after = await handle.stat();
    if (data.length !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs) throw new Error();
    return JSON.parse(data.toString('utf8'));
  } finally { await handle.close(); }
}

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
  const pnpm = spawnSync('pnpm', ['--version'], { env: cleanEnvironment(), encoding: 'utf8' });
  if (pnpm.status !== 0 || pnpm.stdout.trim() !== '10.25.0') throw safeError('Use pnpm 10.25.0.');
  await fs.access(path.join(backendRoot, 'dist/local-identity.js'));
  const webBuildId = (await fs.readFile(path.join(repoRoot, 'apps/web/.next/BUILD_ID'), 'utf8')).trim();
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

export async function prepareDemo({ out, input, dataset = 'demo001' }) {
  if (out === repoRoot || out?.startsWith(repoRoot + path.sep)) throw safeError('Prepare private state outside the repository.');
  const plan = await loadDemoPlan(input, dataset);
  if (!plan.entries.length) throw safeError('The source has no active memories.');
  const builds = await buildEvidence(), b = backend();
  await createFreshRoot(out);
  let runtime, importer, credentials, seed, revoked = false, stage = 'initialize', cleanupError;
  try {
    for (const name of ['exports', 'claude-workspace', 'codex-workspace', 'claude-home', 'codex-home', 'claude-config', 'codex-config', 'codex-a-workspace', 'codex-a-home', 'codex-a-config']) await fs.mkdir(path.join(out, name), { mode: 0o700 });
    await writeJson(path.join(out, 'import-plan.json'), plan);
    const config = configuration(out);
    const initialized = spawnSync(process.execPath, ['--no-global-search-paths', path.join(backendRoot, 'dist/local-identity.js'), 'initialize'], {
      cwd: backendRoot, env: { ...cleanEnvironment(), LOCAL_DATABASE_ROOT: config.databaseRoot, LOCAL_IDENTITY_STATE_ROOT: config.stateRoot }, encoding: 'utf8', timeout: 20000,
    });
    if (initialized.status !== 0) throw new Error();
    stage = 'credentials';
    const identity = await privateJson(path.join(config.stateRoot, 'identity.json'));
    const db = b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot });
    credentials = new b.SqliteMcpCredentials(db, identity.principalId); credentials.upgrade();
    const targets = plan.sources.map(s => `${s.file.slice(0, -6)}.${dataset}.*`);
    seed = credentials.provision('demo preparation', path.join(out, 'exports/importer.token'));
    credentials.permissions(seed.id, policy(['preferences:write', 'preferences:define'], targets));
    stage = 'start'; runtime = await b.createLocalMcpApplication(config, { port: 0 });
    stage = 'connect'; importer = await connect(runtime.port, path.join(out, 'exports/importer.token'));
    stage = 'import'; await importEntries(importer, plan.entries);
    stage = 'verify'; await verifyApplication(runtime.application, identity.principalId, plan, { strict: true, importerId: seed.id });
    stage = 'revoke'; credentials.revoke(seed.id); revoked = true;
    stage = 'clients';
    const agentA = credentials.provision('Demo agent A — writer', path.join(out, 'exports/agent-a.token'));
    const agentB = credentials.provision('Demo agent B — reader', path.join(out, 'exports/agent-b.token'));
    credentials.permissions(agentA.id, policy(['preferences:write'], targets));
    const bTargets = targets.filter(t => !/^(finance|health)\./.test(t));
    credentials.permissions(agentB.id, policy(['preferences:read'], bTargets));
    stage = 'close'; await importer.close(); importer = undefined; await runtime.close(); runtime = undefined;
    const manifest = { format: 'context-router-portability-demo-v1', status: 'prepared', root: out, principalId: identity.principalId,
      preparedAt: new Date().toISOString(), builds, ...summarize(plan), importerId: seed.id,
      planSha256: hash(await fs.readFile(path.join(out, 'import-plan.json'))),
      clients: { agentA: { id: agentA.id, write: true, targets }, agentB: { id: agentB.id, write: false, targets: bTargets } },
      limits: ['Native MCP SET sourceType is INFERRED.', 'Ordinary SET without evidence clears live evidence; import audit retains it.', 'Live assistant rehearsal pending.'] };
    stage = 'manifest'; await writeJson(path.join(out, 'manifest.json'), manifest); return manifest;
  } catch (error) {
    if (seed && !revoked) { try { credentials.revoke(seed.id); revoked = true; } catch { cleanupError = true; } }
    await writeJson(path.join(out, 'failed.json'), { status: 'failed', stage, partialStatePreserved: true, importerRevoked: revoked, cleanupRequiresInspection: Boolean(cleanupError), retry: 'Use a new output directory; never replay.' }).catch(() => {});
    throw error?.demoSafeMessage ? error : safeError(`Demo preparation failed during ${stage}; partial state preserved. Use a new directory.`);
  } finally {
    // Attempt both closures even when one fails. Never erase partial or uncertain state.
    try { await importer?.close(); } finally { await runtime?.close(); }
  }
}

export async function readManifest(root) {
  await privatePath(root, true);
  const manifest = await privateJson(path.join(root, 'manifest.json'));
  if (manifest.format !== 'context-router-portability-demo-v1' || manifest.status !== 'prepared' || manifest.root !== root ||
      !/^[a-f0-9]{64}$/.test(manifest.planSha256) || !manifest.principalId || !manifest.importerId) throw safeError('Only a successfully prepared demo can be opened.');
  validateDataset(manifest.dataset);
  for (const name of ['data', 'identity', 'exports', 'claude-workspace', 'codex-workspace', 'claude-home', 'codex-home', 'claude-config', 'codex-config', 'codex-a-workspace', 'codex-a-home', 'codex-a-config']) await privatePath(path.join(root, name), true);
  const plan = await privateJson(path.join(root, 'import-plan.json'));
  if (hash(await fs.readFile(path.join(root, 'import-plan.json'))) !== manifest.planSha256 || !isDeepStrictEqual(summarize(plan), { dataset: manifest.dataset, total: manifest.total, active: manifest.active, inactiveSkipped: manifest.inactiveSkipped, categories: manifest.categories, sources: manifest.sources })) throw safeError('Demo manifest or import plan mismatch.');
  const identity = await privateJson(path.join(root, 'identity/identity.json'));
  if (identity.principalId !== manifest.principalId) throw safeError('Demo identity mismatch.');
  for (const [name, client] of Object.entries(manifest.clients ?? {})) {
    if (!['agentA', 'agentB'].includes(name) || !/^[A-Za-z0-9_-]{22}$/.test(client.id)) throw safeError('Demo client manifest mismatch.');
    const token = readCredential(path.join(root, 'exports', name === 'agentA' ? 'agent-a.token' : 'agent-b.token'));
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
      if (authority.status !== 'AVAILABLE' || authority.client.revoked || authority.grants.length !== 0 ||
          !isDeepStrictEqual(authority.client.policy, policy([name === 'agentA' ? 'preferences:write' : 'preferences:read'], record.targets))) {
        throw safeError('Verification mismatch: client authority differs from the prepared policy and empty-grant baseline.');
      }
    }
    return { status: 'verified', ...(await verifyApplication(app, manifest.principalId, plan, { importerId: manifest.importerId })) };
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
