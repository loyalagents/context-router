import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareDemo, backend, configuration, verifyDemo, statusDemo, history } from './runtime.mjs';
import { loadDemoPlan } from './records.mjs';
import { connect, call } from './mcp-import.mjs';

test('v2 grants A DEFINE, keeps B/C independent readers, and distinguishes strict baseline from descriptive status', async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-v2-')));
  let runtime; const sessions = [];
  t.after(async () => { for (const c of sessions) await c.close(); await runtime?.close(); await fs.rm(parent, { recursive: true, force: true }); });
  const input = path.join(parent, 'input'); await fs.mkdir(input);
  const plan = await loadDemoPlan();
  for (const category of ['home', 'health', 'finance']) await fs.writeFile(path.join(input, `${category}.jsonl`), JSON.stringify(plan.entries.find(e => e.definition.slug.startsWith(category + '.')).preference.evidence.sourceRecord) + '\n');
  const root = path.join(parent, 'first'), manifest = await prepareDemo({ out: root, input, durable: true });
  assert.equal(manifest.format, 'context-router-portability-demo-v2');
  assert.notEqual(manifest.clients.agentB.id, manifest.clients.agentC.id);
  assert.equal((await verifyDemo(root)).status, 'verified');
  const b = backend(), config = configuration(root);
  const credentials = new b.SqliteMcpCredentials(b.SqliteDatabase.open({ databaseRoot: config.databaseRoot, identityRoot: config.stateRoot }), manifest.principalId);
  for (const role of ['agentB', 'agentC']) {
    assert.deepEqual(credentials.inspectForUi(manifest.clients[role].id).grants.map(({ target, action, effect }) => ({ target, action, effect })), [{ target: 'health.*', action: 'READ', effect: 'DENY' }]);
  }
  credentials.grant(manifest.clients.agentC.id, 'health.*', 'READ', 'REMOVE');
  await assert.rejects(verifyDemo(root), /authority/);
  credentials.grant(manifest.clients.agentC.id, 'health.*', 'READ', 'DENY');
  assert.equal((await verifyDemo(root)).status, 'verified');
  runtime = await b.createLocalMcpApplication(config, { port: 0 });
  const port = runtime.port;
  const a = await connect(port, path.join(root, 'exports/agent-a.token'));
  const readers = await Promise.all(['b', 'c'].map(role => connect(port, path.join(root, `exports/agent-${role}.token`))));
  sessions.push(a, ...readers);
  await call(a, 'mutatePreferences', { operation: 'CREATE_DEFINITION', definition: { slug: 'home.demo001.new_memory', displayName: 'New rehearsal memory', description: 'Explicit rehearsal addition', valueType: 'STRING', scope: 'GLOBAL', isSensitive: true } });
  await call(a, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug: 'home.demo001.new_memory', value: '"Shared new memory"' } });
  for (const reader of readers) {
    assert.equal((await reader.listTools()).tools.some(x => x.name === 'mutatePreferences'), false);
    assert.equal((await call(reader, 'searchPreferences', { query: 'home.demo001.new_memory' })).active.preferences[0].value, 'Shared new memory');
    for (const category of ['health', 'finance']) assert.equal((await call(reader, 'searchPreferences', { query: category + '.demo001.' })).active.count, 0);
    const denied = await reader.callTool({ name: 'mutatePreferences', arguments: { operation: 'SET_PREFERENCE', preference: { slug: 'home.demo001.new_memory', value: '"denied"' } } });
    assert.equal(denied.isError, true); assert.match(JSON.parse(denied.content[0].text).error, /is not allowed to call tool "mutatePreferences"/);
  }
  assert.equal((await history(runtime.application, b.PreferenceAuditQueryService, manifest.principalId)).filter(e => e.actorClientKey === `local:${manifest.clients.agentA.id}`).length, 2);
  await assert.rejects(verifyDemo(root), /membership/);
  credentials.revoke(manifest.clients.agentB.id);
  assert.equal((await call(readers[1], 'searchPreferences', { query: 'home.demo001.new_memory' })).active.count, 1);
  for (const c of sessions.splice(0)) await c.close(); await runtime.close(); runtime = undefined;
  const status = await statusDemo(root);
  assert.equal(status.status, 'descriptive'); assert.equal(status.active, 4);
  assert.equal(status.clients.agentB.client.revoked, true);
  await assert.rejects(verifyDemo(root), /authority/);
  const nextRoot = path.join(parent, 'second'); await prepareDemo({ out: nextRoot, input, durable: true });
  runtime = await b.createLocalMcpApplication(configuration(nextRoot), { port });
  for (const role of ['a', 'b', 'c']) await assert.rejects(connect(port, path.join(root, `exports/agent-${role}.token`)));
  assert.equal((await verifyDemo(nextRoot)).status, 'verified');
});
