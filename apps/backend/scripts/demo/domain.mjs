import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { backend, verifyApplication } from './backend.mjs';
import { hash } from './records.mjs';
import { privateJson, privateBytes, privatePath, safeError } from './files.mjs';
import { connect, importEntries } from './mcp-import.mjs';
import { readCredential } from '../mcp-bridge/credential.mjs';

export const policy = (capabilities, targets) => ({ capabilities, targets, allowSensitive: true });
export function baseline(plan) {
  const targets = plan.sources.map(s => `${s.file.slice(0, -6)}.${plan.dataset}.*`);
  const readTargets = targets.filter(t => !/^(health|finance)\./.test(t));
  return { agentA: { policy: policy(['preferences:write', 'preferences:define'], targets), grants: [] },
    agentB: { policy: policy(['preferences:read'], readTargets), grants: [{ target: 'health.*', action: 'READ', effect: 'DENY' }] },
    agentC: { policy: policy(['preferences:read'], readTargets), grants: [{ target: 'health.*', action: 'READ', effect: 'DENY' }] } };
}
export async function syncDirectory(directory) {
  const fd = await fs.open(directory, 'r'); try { await fd.sync(); } finally { await fd.close(); }
}
export async function writeSynced(file, bytes) {
  const fd = await fs.open(file, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  await syncDirectory(path.dirname(file));
}
const encoded = value => JSON.stringify(value, null, 2) + '\n';
export async function verifyAuthority(credentials, receipt, plan) {
  if (credentials.list().find(c => c.id === receipt.importerId)?.revoked !== true) throw safeError('Importer remains authorized.');
  for (const [role, expected] of Object.entries(baseline(plan))) {
    const authority = credentials.inspectForUi(receipt.clients[role]);
    if (authority.status !== 'AVAILABLE' || authority.client.revoked || !isDeepStrictEqual(authority.client.policy, expected.policy) ||
        !isDeepStrictEqual(authority.grants.map(({ target, action, effect }) => ({ target, action, effect })), expected.grants)) {
      throw safeError('Verification mismatch: client authority differs from the prepared baseline.');
    }
  }
}
/** Only the adapter initializes a pair; this importer receives one exact pair. */
export async function seedDemo({ configuration, directory, seed, storeId, installationId }, { signal, onProgress, checkpoint = async () => {} } = {}) {
  const b = backend(), { plan } = seed;
  await privatePath(directory, true); await privatePath(path.join(directory, 'exports'), true);
  const check = () => signal?.throwIfAborted();
  check();
  const identity = b.createSqliteIdentityRuntime(configuration), ready = await identity.service.verifyReadyState();
  const credentials = new b.SqliteMcpCredentials(identity.database, ready.state.principalId);
  const planBytes = encoded(plan); await writeSynced(path.join(directory, 'import-plan.json'), planBytes);
  let importer, client, runtime, revoked = false, closed = false, stage = 'credentials', complete = false;
  try {
    check(); importer = credentials.provision('Demo historical sample importer', path.join(directory, 'exports/importer.token'));
    credentials.permissions(importer.id, baseline(plan).agentA.policy);
    check(); stage = 'runtime'; runtime = await b.createLocalMcpApplication(configuration, { port: 0 });
    check(); client = await connect(runtime.port, path.join(directory, 'exports/importer.token'));
    stage = 'import'; await importEntries(client, plan.entries, { signal, onProgress });
    check(); stage = 'verify'; await verifyApplication(runtime.application, ready.state.principalId, plan, { strict: true, importerId: importer.id });
    check(); stage = 'revoke'; await checkpoint('before-revoke'); credentials.revoke(importer.id); revoked = true;
    check(); stage = 'clients'; const clients = {};
    for (const [role, expected] of Object.entries(baseline(plan))) {
      check(); const c = credentials.provision(`Demo ${role === 'agentA' ? 'agent A — writer' : role === 'agentB' ? 'agent B — reader' : 'agent C — Desktop reader'}`, path.join(directory, 'exports', `agent-${role.at(-1).toLowerCase()}.token`));
      clients[role] = c.id; credentials.permissions(c.id, expected.policy);
      for (const grant of expected.grants) credentials.grant(c.id, grant.target, grant.action, grant.effect);
    }
    const receipt = { version: 1, status: 'complete', storeId, installationId, principalId: ready.state.principalId,
      targetId: identity.database.targetId, seedVersion: seed.version, seedSha256: seed.sha256, planSha256: hash(planBytes), importerId: importer.id, clients };
    check(); await verifyAuthority(credentials, receipt, plan);
    stage = 'close'; await checkpoint('before-close'); await client.close(); client = undefined; await runtime.close(); runtime = undefined;
    await b.waitForNativeOwners(); closed = true;
    // Never open/hash/fsync database files while native owners are alive. The
    // receipt binds identity/seed/authority, not mutable live database bytes.
    check(); stage = 'receipt'; await checkpoint('before-receipt');
    await writeSynced(path.join(directory, 'generation.json'), encoded(receipt)); complete = true;
    await checkpoint('after-receipt'); check();
    return receipt;
  } catch {
    if (importer && !revoked) { try { credentials.revoke(importer.id); revoked = true; } catch { /* retained, unconfirmed */ } }
    if (!complete) await writeSynced(path.join(directory, 'failed.json'), encoded({ version: 1, stage, importerRevoked: revoked, partialStateRetained: true })).catch(() => {});
    throw safeError('Demo preparation stopped; retained candidate must never be replayed.');
  } finally {
    let failure;
    try { await client?.close(); } catch (error) { failure = error; }
    try { await runtime?.close(); } catch (error) { failure = error; }
    await b.waitForNativeOwners();
    if (failure) throw safeError('Demo service closure is unconfirmed; preserve candidate and ownership evidence.');
    void closed;
  }
}
/** Reopen validates durable identity, never reimposes original membership/policy. */
export async function readDemoGeneration({ configuration: config, config: alias, directory, installationId, storeId }) {
  const configuration = config ?? alias;
  await privatePath(directory, true);
  const receipt = await privateJson(path.join(directory, 'generation.json'));
  const keys = ['version','status','storeId','installationId','principalId','targetId','seedVersion','seedSha256','planSha256','importerId','clients'];
  if (!receipt || Object.keys(receipt).sort().join() !== keys.sort().join() || receipt.version !== 1 || receipt.status !== 'complete' ||
      !/^[a-f0-9]{32}$/.test(receipt.storeId) || (storeId && receipt.storeId !== storeId) || (installationId && receipt.installationId !== installationId) ||
      !/^[a-f0-9]{32}$/.test(receipt.installationId) || !/^[A-Za-z0-9_-]{43}$/.test(receipt.principalId) || !/^[A-Za-z0-9_-]{43}$/.test(receipt.targetId) ||
      receipt.seedVersion !== 'historical-2024-2025-v1' || !/^[a-f0-9]{64}$/.test(receipt.seedSha256) || !/^[a-f0-9]{64}$/.test(receipt.planSha256) ||
      !/^[A-Za-z0-9_-]{22}$/.test(receipt.importerId) || Object.keys(receipt.clients ?? {}).sort().join() !== 'agentA,agentB,agentC') throw safeError('Demo generation receipt mismatch.');
  const planBytes = await privateBytes(path.join(directory, 'import-plan.json'));
  if (hash(planBytes) !== receipt.planSha256) throw safeError('Demo generation import evidence changed.');
  for (const [name, id] of Object.entries(receipt.clients)) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !readCredential(path.join(directory, 'exports', `agent-${name.at(-1).toLowerCase()}.token`)).startsWith(`cr_mcp_${id}.`)) throw safeError('Demo credential identity mismatch.');
  }
  const identity = await privateJson(path.join(configuration.stateRoot, 'identity.json'));
  if (identity.principalId !== receipt.principalId || identity.databaseTargetId !== receipt.targetId) throw safeError('Demo pair identity mismatch.');
  return receipt;
}
export async function verifyDemoBaseline(options) {
  const configuration = options.configuration ?? options.config;
  const receipt = await readDemoGeneration({ ...options, configuration });
  const plan = await privateJson(path.join(options.directory, 'import-plan.json')), b = backend();
  const identity = b.createSqliteIdentityRuntime(configuration); await identity.service.verifyReadyState();
  const app = await b.NestFactory.createApplicationContext(b.LocalMcpApplicationModule.register(configuration), { logger: false, abortOnError: false });
  try {
    await verifyAuthority(new b.SqliteMcpCredentials(identity.database, receipt.principalId), receipt, plan);
    return await verifyApplication(app, receipt.principalId, plan, { importerId: receipt.importerId });
  } finally { await app.close(); await b.waitForNativeOwners(); }
}
