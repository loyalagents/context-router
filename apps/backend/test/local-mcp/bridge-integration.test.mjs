import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {
  PreferenceMutateTool,
} = require('../../dist/mcp/tools/preference-mutate.tool.js');
const {
  createLocalMcpApplication,
} = require('../../dist/bootstrap/local-mcp.js');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.ok(Date.now() < end);
    await pause(5);
  }
}
async function connect(f, file = 'a.token') {
  const client = new Client(
    { name: 'bridge-sdk-fixture', version: '1' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve('test/local-mcp/fixtures/bridge-child.mjs'),
      String(f.runtime.port),
      path.join(f.root, file),
    ],
    stderr: 'pipe',
    env: {},
  });
  let stderr = '';
  transport.stderr.on('data', (v) => {
    stderr += v;
  });
  f.cleanups.push(() => client.close());
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}
const mutation = (client, operation, payload) =>
  client.callTool({
    name: 'mutatePreferences',
    arguments: { operation, ...payload },
  });
const create = (client, slug) =>
  mutation(client, 'CREATE_DEFINITION', {
    definition: {
      slug,
      description: 'Synthetic',
      valueType: 'STRING',
      scope: 'GLOBAL',
    },
  });
const set = (client, slug, value) =>
  mutation(client, 'SET_PREFERENCE', {
    preference: { slug, value: JSON.stringify(value) },
  });
function rows(f, sql) {
  const c = f.db.connect();
  try {
    return c.all(sql);
  } finally {
    c.close();
  }
}

test('real SDK stdio bridge preserves tools/resources, SQLite authority, independent rotation/revoke and direct HTTP', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  f.store.permissions(f.b.id, {
    capabilities: ['preferences:read'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  const a = await connect(f),
    b = await connect(f, 'b.token'),
    direct = (await f.connect(f.tokens[1])).client;
  assert.equal((await a.client.listTools()).tools.length, 6);
  assert.ok(
    (await a.client.listResources()).resources.some(
      (r) => r.uri === 'schema://graphql',
    ),
  );
  assert.ok(
    (await a.client.readResource({ uri: 'schema://graphql' })).contents[0].text
      .length > 0,
  );
  assert.equal((await create(a.client, 'synthetic.bridge')).isError, false);
  assert.equal(
    (await set(a.client, 'synthetic.bridge', 'blue')).isError,
    false,
  );
  assert.equal(
    (await set(b.client, 'synthetic.bridge', 'denied')).isError,
    true,
  );
  for (const client of [a.client, b.client, direct]) {
    // Discovery caches output schemas on this exact SDK client, as Claude does.
    await client.listTools();
    assert.equal(
      (await client.callTool({ name: 'searchPreferences', arguments: {} }))
        .structuredContent.active.preferences[0].value,
      'blue',
    );
  }
  assert.equal(
    rows(f, 'SELECT count(*) n FROM preference_audit_events')[0].n,
    2,
  );
  f.store.rotate(f.a.id, path.join(f.root, 'rotated.token'));
  await assert.rejects(a.client.listTools(), /Access denied/);
  assert.equal(
    (await b.client.listTools()).tools.some(
      (tool) => tool.name === 'mutatePreferences',
    ),
    false,
  );
  const rotated = await connect(f, 'rotated.token');
  assert.equal((await rotated.client.listTools()).tools.length, 6);
  f.store.revoke(f.a.id);
  await assert.rejects(rotated.client.listTools(), /Access denied/);
  assert.equal(
    (await direct.listTools()).tools.some(
      (tool) => tool.name === 'mutatePreferences',
    ),
    false,
  );
  assert.equal(a.stderr(), '');
});
test('real expired session and backend restart require explicit new calls and never replay', async (t) => {
  const f = await fixture(t),
    { client } = await connect(f);
  assert.equal((await client.listTools()).tools.length, 5);
  // Deterministic server-age manipulation is not evidence of real 35-minute inactivity.
  for (const session of f.runtime.http.sessions.values())
    session.touched -= 36 * 60 * 1000;
  await assert.rejects(client.listTools(), /not dispatched/);
  assert.equal((await client.listTools()).tools.length, 5);
  const port = f.runtime.port;
  await f.runtime.close();
  const replacement = await createLocalMcpApplication(f.config, { port });
  f.cleanups.unshift(() => replacement.close());
  await assert.rejects(client.listTools(), /not dispatched/);
  assert.equal((await client.listTools()).tools.length, 5);
});
test('lost successful mutation response is unknown, commits once, and remains readable without replay', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  const { client } = await connect(f);
  await create(client, 'synthetic.lost');
  let injected = 0;
  f.runtime.http.server.on('request', (req, res) => {
    const end = res.end;
    res.end = function (chunk, ...args) {
      const payload = typeof chunk === 'string' ? JSON.parse(chunk) : null;
      const result = payload?.result?.content?.[0]?.text;
      if (result && JSON.parse(result).changed === true) {
        injected++;
        res.destroy();
        return res;
      }
      return end.call(this, chunk, ...args);
    };
  });
  await assert.rejects(
    set(client, 'synthetic.lost', 'once'),
    /Outcome unknown/,
  );
  await pause(30);
  assert.equal(injected, 1);
  assert.equal(
    rows(f, 'SELECT count(*) n FROM preference_audit_events')[0].n,
    2,
  );
  assert.equal(
    (await client.callTool({ name: 'searchPreferences', arguments: {} }))
      .structuredContent.active.preferences[0].value,
    'once',
  );
});
test('cancelled admitted mutation may commit once; empty SSE never becomes a confirmed failure', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  const { client, transport } = await connect(f);
  await create(client, 'synthetic.cancel_bridge');
  const tool = f.runtime.application.get(PreferenceMutateTool),
    execute = tool.execute.bind(tool);
  let release,
    entered = false;
  const barrier = new Promise((r) => {
    release = r;
  });
  f.cleanups.unshift(release);
  tool.execute = async (...args) => {
    entered = true;
    await barrier;
    return execute(...args);
  };
  // Send a raw request through the actual stdio transport to observe its terminal error.
  const prior = transport.onmessage;
  let result;
  transport.onmessage = (message) => {
    if (message.id === 'cancel-observe') result = message;
    else prior(message);
  };
  await transport.send({
    jsonrpc: '2.0',
    id: 'cancel-observe',
    method: 'tools/call',
    params: {
      name: 'mutatePreferences',
      arguments: {
        operation: 'SET_PREFERENCE',
        preference: { slug: 'synthetic.cancel_bridge', value: '"once"' },
      },
    },
  });
  await until(() => entered);
  await transport.send({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 'cancel-observe' },
  });
  await until(() => result);
  assert.equal(result.error.data.outcome, 'unknown');
  release();
  await until(() => f.runtime.http.diagnostics.active === 0);
  assert.equal(
    rows(f, 'SELECT count(*) n FROM preference_audit_events')[0].n,
    2,
  );
  assert.equal(
    rows(f, 'SELECT value FROM user_preferences')[0].value,
    '"once"',
  );
});
