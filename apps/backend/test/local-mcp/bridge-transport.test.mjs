import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  deserializeMessage,
} = require('@modelcontextprotocol/sdk/shared/stdio.js');
const {
  InitializeResultSchema,
} = require('@modelcontextprotocol/sdk/types.js');
import { PassThrough, Writable } from 'node:stream';
import { createBridge } from '../../scripts/mcp-bridge/bridge.mjs';

const token = `cr_mcp_${'a'.repeat(22)}.${'b'.repeat(43)}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  const end = Date.now() + 3000;
  while (!fn()) {
    assert.ok(Date.now() < end, 'bounded wait');
    await pause(5);
  }
}
async function fixture(t, custom = () => false, options = {}) {
  const requests = [];
  let count = 0;
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    const message = text ? JSON.parse(text) : undefined;
    requests.push({ message, headers: req.headers, method: req.method });
    if (await custom(req, res, message, requests)) return;
    if (req.method === 'DELETE') {
      res.writeHead(200).end();
      return;
    }
    if (!('id' in message)) {
      res.writeHead(202).end();
      return;
    }
    let result = { tools: [] };
    if (message.method === 'initialize') {
      count++;
      res.setHeader('mcp-session-id', String(count).padStart(43, 's'));
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'context-router-local', version: '1' },
      };
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const input = new PassThrough(),
    output = new PassThrough(),
    diagnostics = new PassThrough();
  const replies = [];
  let pending = '',
    stderr = '';
  output.on('data', (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(pending.slice(0, i)));
      pending = pending.slice(i + 1);
    }
  });
  diagnostics.on('data', (c) => {
    stderr += c;
  });
  const bridge = createBridge({
    input,
    output,
    diagnostics,
    credential: token,
    port: server.address().port,
    ...options,
  });
  t.after(async () => {
    await bridge.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const send = (id, method, params) =>
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) })}\n`,
    );
  const reply = async (id) => {
    await until(() => replies.some((v) => v.id === id));
    return replies.find((v) => v.id === id);
  };
  const ready = async () => {
    send('init', 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.ok((await reply('init')).result);
    send(undefined, 'notifications/initialized');
    await until(() =>
      requests.some((r) => r.message?.method === 'notifications/initialized'),
    );
    await pause(5);
  };
  return {
    input,
    output,
    bridge,
    requests,
    replies,
    send,
    reply,
    ready,
    stderr: () => stderr,
  };
}
test('stdio handshake, exact typed IDs, headers and clean EOF preserve backend ownership', async (t) => {
  const f = await fixture(t);
  await f.ready();
  f.send(1, 'tools/list');
  f.send('1', 'resources/list');
  assert.ok((await f.reply(1)).result);
  assert.ok((await f.reply('1')).result);
  const calls = f.requests.filter((r) => r.message?.id !== undefined);
  assert.equal(new Set(calls.map((r) => r.message.id)).size, 3);
  for (const r of f.requests) {
    assert.equal(r.headers.authorization, `Bearer ${token}`);
    assert.match(r.headers.host, /^127\.0\.0\.1:\d+$/);
    assert.equal(r.headers.origin, undefined);
  }
  f.input.end();
  await f.bridge.closed;
  assert.equal(f.requests.filter((r) => r.method === 'DELETE').length, 1);
  assert.equal(f.stderr(), '');
});
test('404 never replays rejected calls and concurrent next requests share one compatible initialization', async (t) => {
  let stale = true;
  const f = await fixture(t, (req, res, msg) => {
    if (msg?.method === 'tools/call' && stale) {
      stale = false;
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
  });
  await f.ready();
  f.send(1, 'tools/call', { name: 'mutatePreferences', arguments: {} });
  assert.equal((await f.reply(1)).error.data.outcome, 'not_dispatched');
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/call').length,
    1,
  );
  f.send(2, 'tools/list');
  f.send(3, 'tools/list');
  assert.ok((await f.reply(2)).result);
  assert.ok((await f.reply(3)).result);
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'initialize').length,
    2,
  );
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'notifications/initialized')
      .length,
    2,
  );
});
test('lost or invalid terminal responses are unknown and are not replayed or leaked', async (t) => {
  for (const failure of [
    'lost',
    'redirect',
    'mismatch',
    'bad-jsonrpc',
    'bad-error',
    'sse',
    'oversize',
    'timeout',
  ]) {
    await t.test(failure, async (t) => {
      const f = await fixture(
        t,
        (req, res, msg) => {
          if (msg?.method !== 'tools/call') return;
          if (failure === 'lost') {
            req.socket.destroy();
            return true;
          }
          if (failure === 'timeout') return true;
          if (failure === 'redirect') {
            res
              .writeHead(307, { location: 'http://example.invalid/secret' })
              .end(token);
            return true;
          }
          if (failure === 'sse') {
            res
              .writeHead(200, { 'content-type': 'text/event-stream' })
              .end(`data: ${token}\n\n`);
            return true;
          }
          const value =
            failure === 'oversize'
              ? 'x'.repeat(3000)
              : JSON.stringify({
                  jsonrpc: failure === 'bad-jsonrpc' ? '1.0' : '2.0',
                  id: failure === 'mismatch' ? 'wrong' : msg.id,
                  ...(failure === 'bad-error'
                    ? { error: { code: 'oops', message: token } }
                    : { result: {} }),
                });
          res.writeHead(200, { 'content-type': 'application/json' }).end(value);
          return true;
        },
        { limits: { responseBytes: 2048, operationMs: 80 } },
      );
      await f.ready();
      f.send(1, 'tools/call', {
        name: 'mutatePreferences',
        arguments: { value: token },
      });
      const r = await f.reply(1);
      assert.equal(r.error.data.outcome, 'unknown');
      await pause(15);
      assert.equal(
        f.requests.filter((r) => r.message?.method === 'tools/call').length,
        1,
      );
      assert.equal(JSON.stringify(r).includes(token), false);
      assert.equal(f.stderr().includes(token), false);
      await until(() =>
        f.requests.some((request) => request.method === 'DELETE'),
      );
    });
  }
});
test('cancellation targets original generation and remains usable at request capacity', async (t) => {
  const held = new Map();
  const f = await fixture(
    t,
    (req, res, msg) => {
      if (msg?.method === 'tools/call') {
        held.set(msg.id, { res, session: req.headers['mcp-session-id'] });
        return true;
      }
      if (msg?.method === 'notifications/cancelled') {
        const target = held.get(msg.params.requestId);
        assert.ok(target);
        assert.equal(req.headers['mcp-session-id'], target.session);
        target.res
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end();
        res.writeHead(202).end();
        return true;
      }
    },
    { limits: { activeRequests: 2 } },
  );
  await f.ready();
  f.send(1, 'tools/call');
  f.send(2, 'tools/call');
  await until(() => held.size === 2);
  f.send(3, 'tools/list');
  assert.equal((await f.reply(3)).error.data.outcome, 'not_dispatched');
  f.send(undefined, 'notifications/cancelled', { requestId: 1, reason: token });
  assert.equal((await f.reply(1)).error.data.outcome, 'unknown');
  assert.equal(
    f.requests.find((r) => r.message?.method === 'notifications/cancelled')
      .message.params.reason,
    undefined,
  );
});
test('duplicate IDs, bad input and unterminated oversized frames are bounded', async (t) => {
  const f = await fixture(t, () => false, { limits: { inputBytes: 512 } });
  await f.ready();
  f.send(1, 'tools/list');
  await f.reply(1);
  f.send(1, 'tools/list');
  await until(() => f.replies.filter((r) => r.id === 1).length === 2);
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/list').length,
    1,
  );
  f.input.write(
    `${JSON.stringify([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }])}\n`,
  );
  f.input.write(Buffer.from([0xff, 10]));
  f.input.write('x'.repeat(513));
  await f.bridge.closed;
  assert.ok(f.replies.some((r) => r.error));
});
test('blocked stdout forces bounded exit without diagnostic payloads', async (t) => {
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, _callback) {},
  });
  const f = await fixture(t, () => false, {
    output,
    limits: { drainMs: 40, shutdownMs: 50 },
  });
  f.send(0, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  await f.bridge.closed;
  assert.equal(f.stderr().includes(token), false);
});
test('requests pipelined after initialized wait for its HTTP acknowledgment', async (t) => {
  const f = await fixture(t, async (req, res, msg) => {
    if (msg?.method === 'notifications/initialized') {
      await pause(50);
      res.writeHead(202).end();
      return true;
    }
  });
  f.send('init', 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  await f.reply('init');
  f.send(undefined, 'notifications/initialized');
  f.send(1, 'tools/list');
  assert.ok((await f.reply(1)).result);
});
test('a poisoned global agent cannot redirect bridge credentials', async (t) => {
  const original = http.globalAgent;
  const poisoned = new http.Agent();
  let attempts = 0;
  poisoned.addRequest = () => {
    attempts++;
    throw new Error('proxy reached');
  };
  http.globalAgent = poisoned;
  try {
    const f = await fixture(t);
    await f.ready();
    f.send(1, 'tools/list');
    assert.ok((await f.reply(1)).result);
    assert.equal(attempts, 0);
  } finally {
    http.globalAgent = original;
    poisoned.destroy();
  }
});
test('cancellation during session renewal prevents dispatch and targets no new generation', async (t) => {
  let inits = 0;
  const f = await fixture(t, async (req, res, msg) => {
    if (msg?.method === 'initialize' && ++inits === 2) await pause(50);
    if (msg?.method === 'tools/call') {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
  });
  await f.ready();
  f.send(1, 'tools/call');
  await f.reply(1);
  f.send(2, 'tools/list');
  f.send(undefined, 'notifications/cancelled', { requestId: 2 });
  assert.equal((await f.reply(2)).error.data.outcome, 'not_dispatched');
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/list').length,
    0,
  );
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'notifications/cancelled')
      .length,
    0,
  );
});
test('changed renewal protocol fails before dispatching a new call', async (t) => {
  let inits = 0;
  const f = await fixture(t, (req, res, msg) => {
    if (msg?.method === 'initialize' && ++inits === 2) {
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'x'.repeat(43),
        })
        .end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'context-router-local', version: '1' },
            },
          }),
        );
      return true;
    }
    if (msg?.method === 'tools/call') {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
  });
  await f.ready();
  f.send(1, 'tools/call');
  await f.reply(1);
  f.send(2, 'tools/list');
  assert.match((await f.reply(2)).error.message, /contract changed/);
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/list').length,
    0,
  );
});
test('renewal notification failure disposes its unpublishable session without dispatching work', async (t) => {
  let initialized = 0;
  const f = await fixture(t, (req, res, msg) => {
    if (msg?.method === 'notifications/initialized' && ++initialized === 2) {
      res.writeHead(503).end();
      return true;
    }
    if (msg?.method === 'tools/call') {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
  });
  await f.ready();
  f.send(1, 'tools/call');
  await f.reply(1);
  f.send(2, 'tools/list');
  assert.equal((await f.reply(2)).error.data.outcome, 'not_dispatched');
  await until(() => f.requests.some((r) => r.method === 'DELETE'));
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/list').length,
    0,
  );
});
test('old-generation cancellation 404 does not settle admitted work or target replacement', async (t) => {
  let held;
  const f = await fixture(t, (req, res, msg) => {
    if (msg?.method === 'tools/call') {
      held = { id: msg.id, res, session: req.headers['mcp-session-id'] };
      return true;
    }
    if (msg?.method === 'resources/list') {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
    if (msg?.method === 'notifications/cancelled') {
      assert.equal(req.headers['mcp-session-id'], held.session);
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Local MCP request rejected"}');
      return true;
    }
  });
  await f.ready();
  f.send(1, 'tools/call');
  await until(() => held);
  f.send(2, 'resources/list');
  await f.reply(2);
  f.send(3, 'tools/list');
  await f.reply(3);
  f.send(undefined, 'notifications/cancelled', { requestId: 1 });
  await pause(30);
  assert.equal(
    f.replies.some((r) => r.id === 1),
    false,
  );
  held.res
    .writeHead(200, { 'content-type': 'application/json' })
    .end(
      JSON.stringify({ jsonrpc: '2.0', id: held.id, result: { done: true } }),
    );
  assert.equal((await f.reply(1)).result.done, true);
});
test('aggregate response buffering is bounded across concurrent requests', async (t) => {
  const held = [];
  const f = await fixture(
    t,
    (req, res, msg) => {
      if (msg?.method !== 'tools/call') return;
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { value: 'x'.repeat(800) },
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(payload.slice(0, 600));
      held.push({ res, rest: payload.slice(600) });
      if (held.length === 2)
        setTimeout(() => {
          for (const item of held) item.res.end(item.rest);
        }, 40);
      return true;
    },
    { limits: { responseBytes: 2000, aggregateResponseBytes: 1000 } },
  );
  await f.ready();
  f.send(1, 'tools/call');
  f.send(2, 'tools/call');
  const responses = await Promise.all([f.reply(1), f.reply(2)]);
  assert.equal(
    responses.filter((r) => r.error?.data?.outcome === 'unknown').length,
    1,
  );
  assert.equal(responses.filter((r) => r.result).length, 1);
});
test('SDK-invalid upstream envelopes become valid fixed unknown errors without replay', async (t) => {
  const variants = [
    { result: null },
    { result: [] },
    { result: 3 },
    { result: { _meta: null } },
    { result: { _meta: { progressToken: null } } },
    {
      result: {
        _meta: { 'io.modelcontextprotocol/related-task': { taskId: 3 } },
      },
    },
    { result: {}, method: 'unexpected' },
    { result: {}, debug: token },
    { error: { code: Number.MAX_SAFE_INTEGER + 1, message: token } },
  ];
  for (const [index, variant] of variants.entries())
    await t.test(`invalid envelope ${index + 1}`, async (t) => {
      const f = await fixture(t, (req, res, msg) => {
        if (msg?.method !== 'tools/call') return;
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          ...variant,
        });
        assert.throws(() => deserializeMessage(payload));
        res.writeHead(200, { 'content-type': 'application/json' }).end(payload);
        return true;
      });
      await f.ready();
      f.send(1, 'tools/call');
      const reply = await f.reply(1);
      assert.equal(reply.error?.data?.outcome, 'unknown');
      assert.doesNotThrow(() => deserializeMessage(JSON.stringify(reply)));
      assert.equal(JSON.stringify(reply).includes(token), false);
      assert.equal(
        f.requests.filter((r) => r.message?.method === 'tools/call').length,
        1,
      );
    });
});
test('malformed input and typed IDs emit SDK-valid uncorrelated errors', async (t) => {
  const f = await fixture(t);
  f.input.write('{malformed}\n');
  for (const id of [null, 1.5, 'x'.repeat(129)]) f.send(id, 'tools/list');
  await until(() => f.replies.length === 4);
  for (const reply of f.replies) {
    assert.equal(Object.hasOwn(reply, 'id'), false);
    assert.doesNotThrow(() => deserializeMessage(JSON.stringify(reply)));
  }
  assert.equal(f.requests.length, 0);
});
test('fragmented multibyte UTF-8 survives framing and lifetime IDs require explicit restart', async (t) => {
  const f = await fixture(t, () => false, { limits: { ids: 2 } });
  await f.ready();
  const frame = Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'synthetic', arguments: { value: 'café🍎' } },
    }) + '\n',
  );
  const split = frame.indexOf(Buffer.from('🍎')) + 2;
  f.input.write(frame.subarray(0, split));
  f.input.write(frame.subarray(split));
  assert.ok((await f.reply(1)).result);
  assert.equal(
    f.requests.find((r) => r.message?.method === 'tools/call').message.params
      .arguments.value,
    'café🍎',
  );
  f.send(2, 'tools/list');
  assert.match((await f.reply(2)).error.message, /Restart/);
  assert.equal(
    f.requests.filter((r) => r.message?.method === 'tools/list').length,
    0,
  );
});
test('shutdown remains bounded with an active request and unresponsive DELETE', async (t) => {
  const f = await fixture(
    t,
    (req, _res, msg) => req.method === 'DELETE' || msg?.method === 'tools/call',
    { limits: { shutdownMs: 50, controlMs: 500 } },
  );
  await f.ready();
  f.send(1, 'tools/call');
  await until(() => f.requests.some((r) => r.message?.method === 'tools/call'));
  const started = Date.now();
  await f.bridge.close();
  assert.ok(Date.now() - started < 1000);
  assert.equal(f.requests.filter((r) => r.method === 'DELETE').length, 1);
});
test('initialization never forwards SDK-invalid optional instructions or server metadata', async (t) => {
  for (const badInstructions of [true, false])
    await t.test(String(badInstructions), async (t) => {
      const f = await fixture(t, (_req, res, msg) => {
        if (msg?.method !== 'initialize') return;
        const result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: 'context-router-local',
            version: '1',
            icons: 'invalid',
          },
          ...(badInstructions ? { instructions: { value: token } } : {}),
        };
        res
          .writeHead(200, {
            'content-type': 'application/json',
            'mcp-session-id': 's'.repeat(43),
          })
          .end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        return true;
      });
      f.send('init', 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const reply = await f.reply('init');
      if (badInstructions) assert.ok(reply.error);
      else {
        assert.equal(
          InitializeResultSchema.safeParse(reply.result).success,
          true,
        );
        assert.equal(reply.result.serverInfo.icons, undefined);
      }
    });
});
