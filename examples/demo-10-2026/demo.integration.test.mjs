import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareDemo, backend, readManifest, verifyDemo, history, configuration } from './runtime.mjs';
import { loadDemoPlan, defaultInput } from './records.mjs';
import { connect, call, importEntries } from './mcp-import.mjs';

test('fresh demo uses real SQLite/MCP: complete import, independent clients, portable update, scoped denial, persistence', async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-integration-')));
  let runtime;
  const clients = [];
  t.after(async () => {
    for (const c of clients) await c.close();
    await runtime?.close();
    await fs.rm(parent, { recursive: true, force: true });
  });
  const root = path.join(parent, 'demo');
  const manifest = await prepareDemo({ out: root, input: defaultInput });
  assert.equal(manifest.active, 189);
  assert.equal(manifest.inactiveSkipped, 9);
  assert.deepEqual(await readManifest(root), manifest);
  await fs.chmod(path.join(root, 'manifest.json'), 0o644);
  await assert.rejects(readManifest(root), /permissions/);
  await fs.chmod(path.join(root, 'manifest.json'), 0o600);
  await fs.rename(path.join(root, 'manifest.json'), path.join(root, 'manifest.saved'));
  await fs.symlink(path.join(root, 'manifest.saved'), path.join(root, 'manifest.json'));
  await assert.rejects(readManifest(root), /links/);
  await fs.unlink(path.join(root, 'manifest.json'));
  await fs.rename(path.join(root, 'manifest.saved'), path.join(root, 'manifest.json'));
  assert.equal((await fs.stat(path.join(root, 'exports', 'agent-a.token'))).mode & 0o777, 0o600);
  await assert.rejects(prepareDemo({ out: root, input: defaultInput }));
  const b = backend();
  const config = { kind: 'sqlite', databaseRoot: path.join(root, 'data'), stateRoot: path.join(root, 'identity') };
  runtime = await b.createLocalMcpApplication(config, { port: 0 });
  const a = await connect(runtime.port, path.join(root, 'exports', 'agent-a.token'));
  const reader = await connect(runtime.port, path.join(root, 'exports', 'agent-b.token'));
  clients.push(a, reader);
  await assert.rejects(connect(runtime.port, path.join(root, 'exports', 'importer.token')));
  const plan = await loadDemoPlan();
  assert.equal((await reader.listTools()).tools.some(t => t.name === 'mutatePreferences'), false);
  assert.equal((await a.listTools()).tools.some(t => t.name === 'mutatePreferences'), true);
  let aTotal = 0, bTotal = 0;
  for (const source of plan.sources) {
    const category = source.file.slice(0, -6);
    const found = await call(a, 'searchPreferences', { query: `${category}.demo001.` });
    assert.equal(found.active.count, plan.entries.filter(e => e.definition.slug.startsWith(`${category}.`)).length);
    aTotal += found.active.count;
    bTotal += (await call(reader, 'searchPreferences', { query: `${category}.demo001.` })).active.count;
  }
  assert.equal(aTotal, 189); assert.equal(bTotal, 145);
  assert.equal(Math.max(...Object.values(manifest.categories)), 31);
  const slug = plan.entries.find(e => e.preference.value.includes('phone-free Sunday')).definition.slug;
  const before = await call(reader, 'searchPreferences', { query: slug });
  assert.equal(before.active.count, 1);
  const value = before.active.preferences[0].value + ' Rehearsal change: dinner starts at 6 PM.';
  const changed = await call(a, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug, value: JSON.stringify(value) } });
  assert.equal(changed.changed, true);
  assert.equal(changed.audit.actorClientKey, `local:${manifest.clients.agentA.id}`);
  assert.equal((await call(reader, 'searchPreferences', { query: slug })).active.preferences[0].value, value);
  assert.equal((await call(reader, 'searchPreferences', { query: 'finance.demo001.' })).active.count, 0);
  const denial = await reader.callTool({ name: 'mutatePreferences', arguments: { operation: 'SET_PREFERENCE', preference: { slug, value: '"forbidden"' } } });
  assert.equal(denial.isError, true);
  assert.deepEqual(JSON.parse(denial.content.find(c => c.type === 'text').text), { error: `Client "local:${manifest.clients.agentB.id}" is not allowed to call tool "mutatePreferences"` });
  await assert.rejects(call(a, 'mutatePreferences', { operation: 'CREATE_DEFINITION', definition: { slug: 'home.demo001.extra', description: 'extra', valueType: 'STRING', scope: 'GLOBAL' } }), error => error.code === 'MCP_PERMISSION_DENIED');
  for (const category of ['health', 'finance']) {
    const excluded = plan.entries.find(e => e.definition.slug.startsWith(`${category}.`));
    assert.equal((await call(reader, 'searchPreferences', { query: excluded.definition.slug })).active.count, 0);
  }
  const audits = await history(runtime.application, b.PreferenceAuditQueryService, manifest.principalId);
  const edits = audits.filter(e => e.actorClientKey === `local:${manifest.clients.agentA.id}`);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].origin, 'MCP');
  assert.equal(edits[0].beforeState.value, before.active.preferences[0].value);
  assert.equal(edits[0].afterState.value, value);
  assert.deepEqual(edits[0].beforeState.evidence, plan.entries.find(e => e.definition.slug === slug).preference.evidence);
  assert.equal(edits[0].afterState.evidence, null);
  assert.ok(edits[0].correlationId);
  const live = (await runtime.application.get(b.PreferenceService).getActivePreferences(manifest.principalId)).find(r => r.slug === slug);
  assert.equal(live.value, value);
  assert.equal(live.evidence, null);
  assert.equal(live.lastModifiedBy.actorClientKey, `local:${manifest.clients.agentA.id}`);
  const accesses = await history(runtime.application, b.McpAccessLogQueryService, manifest.principalId);
  assert.ok(accesses.some(e => e.correlationId === edits[0].correlationId && e.outcome === 'SUCCESS'));
  assert.ok(accesses.some(e => e.clientKey === `local:${manifest.clients.agentB.id}` && e.operationName === 'searchPreferences' && e.outcome === 'SUCCESS'));
  assert.ok(accesses.some(e => e.clientKey === `local:${manifest.clients.agentB.id}` && e.outcome === 'DENY'));
  assert.ok(accesses.some(e => e.clientKey === `local:${manifest.clients.agentA.id}` && e.outcome === 'DENY'));
  assert.equal(JSON.stringify(accesses).includes('Rehearsal change:'), false);
  assert.equal(JSON.stringify(accesses).includes('sourceRecord'), false);
  for (const e of accesses) {
    assert.equal(e.requestMetadata, null);
    if (e.outcome === 'DENY') assert.deepEqual(e.errorMetadata, { source: 'LOCAL_MCP', code: 'DENY' });
  }
  await a.close(); await reader.close(); clients.length = 0;
  await runtime.close(); runtime = undefined;
  const verification = await verifyDemo(root);
  assert.deepEqual(verification.modified, [{ slug, valueChanged: true, evidenceChanged: true }]);
  runtime = await b.createLocalMcpApplication(config, { port: 0 });
  const reopened = await connect(runtime.port, path.join(root, 'exports', 'agent-b.token'));
  clients.push(reopened);
  assert.equal((await call(reopened, 'searchPreferences', { query: slug })).active.preferences[0].value, value);
  assert.equal((await history(runtime.application, b.PreferenceAuditQueryService, manifest.principalId)).length, audits.length);
  const persistedAccess = await history(runtime.application, b.McpAccessLogQueryService, manifest.principalId);
  for (const event of accesses) assert.ok(persistedAccess.some(e => e.id === event.id));
  const creds = new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), manifest.principalId);
  creds.revoke(manifest.clients.agentA.id);
  assert.equal((await call(reopened, 'searchPreferences', { query: slug })).active.count, 1);
  await assert.rejects(connect(runtime.port, path.join(root, 'exports/agent-a.token')));
});

test('a lost or rejected mutation stops import immediately without replay', async () => {
  const plan = await loadDemoPlan();
  const calls = [];
  const client = { async callTool(request) {
    calls.push(request);
    if (calls.length === 2) throw new Error('Lost response: may have committed');
    const d = request.arguments.definition;
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, changed: true, definition: { ...d, visibility: 'USER' } }) }] };
  } };
  await assert.rejects(importEntries(client, plan.entries.slice(0, 2)), /Import stopped/);
  assert.deepEqual(calls.map(c => c.arguments.operation), ['CREATE_DEFINITION', 'SET_PREFERENCE']);
});

test('serve refuses partial or mismatched preparation without opening it', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-partial-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(readManifest(root));
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ status: 'failed', root }));
  await assert.rejects(readManifest(root));
});

test('failed partial import revokes importer, preserves failure evidence and never publishes completion', async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-failure-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const input = path.join(parent, 'source'), root = path.join(parent, 'demo'); await fs.mkdir(input);
  const plan = await loadDemoPlan();
  const record = { ...plan.entries.find(e => e.definition.slug.startsWith('home.')).preference.evidence.sourceRecord, memory: 'x'.repeat(1024 * 1024) };
  await fs.writeFile(path.join(input, 'home.jsonl'), JSON.stringify(record));
  await assert.rejects(prepareDemo({ out: root, input }), /Import stopped/);
  const failure = JSON.parse(await fs.readFile(path.join(root, 'failed.json'), 'utf8'));
  assert.equal(failure.stage, 'import'); assert.equal(failure.importerRevoked, true);
  await assert.rejects(fs.access(path.join(root, 'manifest.json')));
  await assert.rejects(readManifest(root));
  const identity = JSON.parse(await fs.readFile(path.join(root, 'identity/identity.json'), 'utf8'));
  const b = backend(), config = configuration(root);
  const credentials = new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), identity.principalId);
  assert.equal(credentials.list().length, 1); assert.equal(credentials.list()[0].revoked, true);
  assert.equal(await fs.readFile(path.join(input, 'home.jsonl'), 'utf8'), JSON.stringify(record));
});

test('verification rejects persisted client grants and accepts the restored prepared authority', async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-grants-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const input = path.join(parent, 'source'), root = path.join(parent, 'demo');
  await fs.mkdir(input);
  const source = (await loadDemoPlan()).entries.find(e => e.definition.slug.startsWith('family.')).preference.evidence.sourceRecord;
  await fs.writeFile(path.join(input, 'family.jsonl'), JSON.stringify(source) + '\n');
  const manifest = await prepareDemo({ out: root, input });
  const b = backend(), config = configuration(root);
  const credentials = new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), manifest.principalId);
  assert.equal((await verifyDemo(root)).status, 'verified');
  for (const [role, action] of [['agentB', 'READ'], ['agentA', 'WRITE']]) {
    const id = manifest.clients[role].id;
    const original = credentials.inspectForUi(id);
    assert.equal(original.status, 'AVAILABLE');
    assert.deepEqual(original.grants, []);
    credentials.grant(id, 'family.demo001.*', action, 'DENY');
    const narrowed = credentials.inspectForUi(id);
    assert.deepEqual(narrowed.client.policy, original.client.policy);
    assert.equal(narrowed.grants.length, 1);
    try {
      await assert.rejects(verifyDemo(root), /Verification mismatch: client authority/);
    } finally {
      credentials.grant(id, 'family.demo001.*', action, 'REMOVE');
    }
    assert.deepEqual(credentials.inspectForUi(id).grants, []);
    assert.equal((await verifyDemo(root)).status, 'verified');
  }
});
