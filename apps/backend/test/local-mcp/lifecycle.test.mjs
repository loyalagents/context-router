import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
const require = createRequire(import.meta.url);
const {
  PreferenceMutateTool,
} = require('../../dist/mcp/tools/preference-mutate.tool.js');
const {
  PreferenceSearchTool,
} = require('../../dist/mcp/tools/preference-search.tool.js');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.ok(Date.now() < end, 'bounded completion');
    await pause(10);
  }
};
async function session(f, token = f.tokens[0]) {
  const r = await f.raw(
    {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'same-product', version: '1' },
      },
    },
    { token },
  );
  assert.equal(r.status, 200);
  const auth = {
    token,
    headers: {
      'mcp-session-id': r.headers.get('mcp-session-id'),
      'mcp-protocol-version': '2025-11-25',
    },
  };
  assert.equal(
    (await f.raw({ jsonrpc: '2.0', method: 'notifications/initialized' }, auth))
      .status,
    202,
  );
  return auth;
}
const call = (f, auth, id, name = 'searchPreferences', args = {}) =>
  f.raw(
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    auth,
  );
const cancel = (f, auth, requestId) =>
  f.raw(
    {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId },
    },
    auth,
  );
function hold(tool) {
  const execute = tool.execute.bind(tool);
  let release;
  let entered = 0;
  const barrier = new Promise((r) => {
    release = r;
  });
  tool.execute = async (...args) => {
    entered++;
    await barrier;
    return execute(...args);
  };
  return {
    release,
    get entered() {
      return entered;
    },
  };
}

test('saturated request quota keeps cancellation/DELETE usable and retains ownership until handler settlement', async (t) => {
  const f = await fixture(t),
    a = await session(f),
    b = await session(f, f.tokens[1]);
  const held = hold(f.runtime.application.get(PreferenceSearchTool));
  f.cleanups.push(held.release);
  const active = Array.from({ length: 8 }, (_, id) => call(f, a, id));
  await until(() => held.entered === 8);
  assert.equal((await call(f, a, 8)).status, 429);
  assert.equal((await cancel(f, a, 0)).status, 202);
  assert.equal((await active[0]).text, '');
  assert.equal(f.runtime.http.diagnostics.active, 8);
  assert.equal(
    (await f.raw(undefined, { ...a, method: 'DELETE' })).status,
    200,
  );
  assert.ok(
    (await Promise.all(active)).every((r) => r.status === 200 && r.text === ''),
  );
  assert.equal(f.runtime.http.diagnostics.active, 8);
  held.release();
  await until(() => f.runtime.http.diagnostics.active === 0);
  assert.equal((await call(f, a, 9)).status, 404);
  assert.equal((await call(f, b, 0)).status, 200);
});

test('cancellation before publication may commit once; late cancellation never changes a published mutation', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  const a = await session(f);
  const definition = {
    slug: 'synthetic.cancel',
    description: 'Synthetic',
    valueType: 'STRING',
    scope: 'GLOBAL',
  };
  assert.equal(
    JSON.parse(
      (
        await call(f, a, 0, 'mutatePreferences', {
          operation: 'CREATE_DEFINITION',
          definition,
        })
      ).text,
    ).result.isError,
    false,
  );
  const held = hold(f.runtime.application.get(PreferenceMutateTool));
  f.cleanups.push(held.release);
  const running = call(f, a, 1, 'mutatePreferences', {
    operation: 'SET_PREFERENCE',
    preference: { slug: definition.slug, value: '"once"' },
  });
  await until(() => held.entered === 1);
  await cancel(f, a, 1);
  assert.equal((await running).text, '');
  held.release();
  await until(() => f.runtime.http.diagnostics.active === 0);
  assert.equal(
    (await call(f, a, 1, 'mutatePreferences', {})).status,
    400,
    'never retry a consumed request ID',
  );
  const published = await call(f, a, 2, 'mutatePreferences', {
    operation: 'SET_PREFERENCE',
    preference: { slug: definition.slug, value: '"twice"' },
  });
  assert.equal(JSON.parse(published.text).result.isError, false);
  await cancel(f, a, 2);
  const c = f.db.connect();
  try {
    assert.equal(c.get('SELECT count(*) n FROM preference_audit_events').n, 3);
    assert.equal(c.get('SELECT value FROM user_preferences').value, '"twice"');
  } finally {
    c.close();
  }
});

test('slow body loses revoked authority before final admission', async (t) => {
  const f = await fixture(t),
    a = await session(f);
  let observed;
  const bodyRead = new Promise((r) => {
    observed = r;
  });
  f.runtime.http.server.once('request', (req) => req.once('data', observed));
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(
      f.url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${a.token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...a.headers,
        },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
      },
    );
    request.on('error', reject);
    request.write('{"jsonrpc":"2.0",');
  });
  await bodyRead;
  f.store.revoke(f.a.id);
  request.end('"id":0,"method":"tools/list"}');
  assert.equal(await response, 401);
  assert.equal(f.runtime.http.diagnostics.active, 0);
});

test('rotation retires obsolete idle sessions without releasing already-admitted work', async (t) => {
  const f = await fixture(t),
    a = await session(f);
  for (let i = 0; i < 7; i++) await session(f);
  const held = hold(f.runtime.application.get(PreferenceSearchTool));
  f.cleanups.push(held.release);
  const active = call(f, a, 0);
  await until(() => held.entered === 1);
  const output = path.join(f.root, 'rotated.token');
  f.store.rotate(f.a.id, output);
  const token = fs.readFileSync(output, 'utf8').trim();
  const fresh = await session(f, token);
  assert.equal(f.runtime.http.diagnostics.sessions, 2);
  assert.equal(f.runtime.http.diagnostics.active, 1);
  assert.equal((await call(f, a, 1)).status, 401);
  assert.equal((await call(f, { ...a, token }, 1)).status, 404);
  held.release();
  assert.equal((await active).status, 200);
  await until(() => f.runtime.http.diagnostics.active === 0);
  assert.equal(f.runtime.http.diagnostics.sessions, 1);
  assert.equal((await call(f, fresh, 0)).status, 200);
});

test('body, session, retained-ID and idle bounds fail closed while other clients continue', async (t) => {
  const f = await fixture(t),
    a = await session(f);
  assert.equal(
    (
      await call(f, a, 0, 'searchPreferences', {
        query: 'x'.repeat(128 * 1024),
      })
    ).status,
    413,
  );
  for (let i = 0; i < 7; i++) await session(f);
  assert.equal(
    (
      await f.raw({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'synthetic', version: '1' },
        },
      })
    ).status,
    429,
  );
  const state = f.runtime.http.sessions.get(a.headers['mcp-session-id']);
  for (let i = 0; i < 4096; i++) state.seen.add(`number:${i}`);
  assert.equal((await call(f, a, 'new')).status, 400);
  state.touched = performance.now() - 30 * 60 * 1000;
  assert.equal((await call(f, a, 'expired')).status, 404);
  assert.equal((await call(f, await session(f, f.tokens[1]), 0)).status, 200);
});

test('watchdog ends a response but retains active ownership until actual terminal output', async (t) => {
  const f = await fixture(t),
    a = await session(f),
    held = hold(f.runtime.application.get(PreferenceSearchTool));
  f.cleanups.push(held.release);
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) =>
    original(fn, delay === 185000 ? 30 : delay, ...args);
  try {
    const response = await call(f, a, 0);
    assert.equal(response.status, 503);
    assert.equal(f.runtime.http.diagnostics.active, 1);
    held.release();
    await until(() => f.runtime.http.diagnostics.active === 0);
  } finally {
    globalThis.setTimeout = original;
    held.release();
  }
});

test('shutdown retires an owned slow reader after terminal publication and closes every socket', async (t) => {
  const f = await fixture(t),
    a = await session(f);
  const tool = f.runtime.application.get(PreferenceSearchTool);
  tool.execute = async () => ({
    result: { content: [{ type: 'text', text: 'x'.repeat(8 * 1024 * 1024) }] },
  });
  let request, response;
  await new Promise((resolve, reject) => {
    request = http.request(
      f.url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${a.token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...a.headers,
        },
      },
      (res) => {
        response = res;
        res.pause();
        resolve();
      },
    );
    request.on('error', reject);
    request.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: { name: 'searchPreferences', arguments: {} },
      }),
    );
  });
  try {
    await f.runtime.close();
    await until(() => f.runtime.http.diagnostics.sockets === 0);
    assert.equal(f.runtime.http.diagnostics.listening, false);
  } finally {
    response.destroy();
    request.destroy();
  }
});
