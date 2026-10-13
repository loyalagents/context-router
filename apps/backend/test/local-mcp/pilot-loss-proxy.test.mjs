import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPilotLossProxy } from './fixtures/pilot-loss-proxy.mjs';

const credential = `cr_mcp_${'a'.repeat(22)}.${'b'.repeat(43)}`;
const slug = 'pilot_loss_fixture.allowed';
const value = 'synthetic-reply-loss';
const mutation = (overrides = {}) => ({
  jsonrpc: '2.0', id: 7, method: 'tools/call',
  params: { name: 'mutatePreferences', arguments: {
    operation: 'SET_PREFERENCE', preference: { slug, value: JSON.stringify(value) },
    ...overrides,
  } },
});
const success = (id = 7, result = { success: true, changed: true }) => ({
  jsonrpc: '2.0', id,
  result: { isError: false, content: [{ type: 'text', text: JSON.stringify(result) }] },
});
async function fixture(t, responder = (req, res, body) => {
  res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'synthetic-session' });
  res.end(JSON.stringify(success(body.id)));
}, options = {}) {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let bytes = '';
    for await (const chunk of req) bytes += chunk;
    const body = bytes ? JSON.parse(bytes) : null;
    received.push({ method: req.method, host: req.headers.host, headers: req.headers, body });
    responder(req, res, body);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(r => upstream.close(r)); });
  const proxy = await createPilotLossProxy({
    credential, upstreamPort: upstream.address().port, slug, value, ...options,
  });
  t.after(() => proxy.close());
  return { proxy, received, upstreamPort: upstream.address().port };
}
function send(port, body, { headers = {}, path = '/mcp', method = 'POST', raw } = {}) {
  return new Promise(resolve => {
    let bytes = '', status;
    const req = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', ...headers },
    }, res => {
      status = res.statusCode;
      res.on('data', chunk => { bytes += chunk; });
      res.on('end', () => resolve({ status, bytes, headers: res.headers }));
      res.on('error', () => resolve({ status, bytes, disconnected: true }));
    });
    req.on('error', () => resolve({ status, bytes, disconnected: true }));
    req.end(raw ?? (body ? JSON.stringify(body) : ''));
  });
}

test('pilot proxy refuses wrong authority, routes, origin and oversized inputs before forwarding', async t => {
  const { proxy, received } = await fixture(t);
  for (const opts of [
    { headers: { authorization: 'Bearer wrong' } },
    { headers: { authorization: '' } },
    { headers: { origin: 'http://127.0.0.1' } },
    { headers: { host: 'localhost' } },
    { path: '/other' },
    { raw: 'x'.repeat(128 * 1024 + 1) },
    { raw: '{' },
  ]) {
    const result = await send(proxy.port, mutation(), opts);
    assert.ok(result.status >= 400 || result.disconnected);
  }
  assert.equal(received.length, 0);
  assert.equal(JSON.stringify(proxy.snapshot()).includes(credential), false);
});

test('pilot proxy transparently forwards discovery/read and session headers to pinned loopback', async t => {
  const expected = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
  const { proxy, received, upstreamPort } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'synthetic-session' });
    res.end(expected);
  });
  const result = await send(proxy.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, {
    headers: { 'mcp-session-id': 'synthetic-old', 'mcp-protocol-version': '2025-11-25' },
  });
  assert.equal(result.bytes, expected);
  assert.equal(result.headers['mcp-session-id'], 'synthetic-session');
  assert.equal(received[0].host, `127.0.0.1:${upstreamPort}`);
  assert.equal(received[0].headers['mcp-session-id'], 'synthetic-old');
  assert.equal(received[0].headers['mcp-protocol-version'], '2025-11-25');
});

test('pilot proxy refuses unarmed or non-exact mutations and model calls', async t => {
  const { proxy, received } = await fixture(t);
  assert.equal((await send(proxy.port, mutation())).status, 403);
  const model = mutation(); model.params.name = 'analyzeDocument';
  assert.equal((await send(proxy.port, model)).status, 403);
  assert.equal(received.length, 0);
  assert.equal(proxy.snapshot().mutationAttempts, 1);
  for (const body of [
    mutation({ operation: 'DELETE_PREFERENCE' }),
    mutation({ preference: { slug: 'other', value: JSON.stringify(value) } }),
    mutation({ preference: { slug, value: 'different' } }),
    mutation({ preference: { slug, value: JSON.stringify(value), confidence: 1 } }),
    { ...mutation(), id: null },
  ]) await t.test('first armed request is independently rejected', async sub => {
    const { proxy, received } = await fixture(sub);
    proxy.arm();
    assert.equal((await send(proxy.port, body)).status, 403);
    assert.equal(received.length, 0);
    assert.equal(proxy.snapshot().mutationAttempts, 1);
    assert.equal(proxy.snapshot().consumed, true);
  });
});

test('pilot proxy drops exactly one completed mutation reply and exposes concurrent replay attempts', async t => {
  let release;
  const { proxy, received } = await fixture(t, (_req, res, body) => {
    release = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(success(body.id))); };
  });
  proxy.arm();
  const first = send(proxy.port, mutation());
  while (!release) await new Promise(r => setTimeout(r, 5));
  assert.equal((await send(proxy.port, mutation())).status, 403);
  release();
  const result = await first;
  assert.equal(result.disconnected, true);
  assert.equal(result.bytes, '');
  assert.equal(received.length, 1);
  assert.equal(proxy.snapshot().mutationAttempts, 2);
  assert.equal(proxy.snapshot().mutationForwards, 1);
  assert.equal(proxy.snapshot().replyLosses, 1);
  assert.throws(() => proxy.arm());
});

test('a refused armed mutation exhausts the attempt before any model correction or retry', async t => {
  const { proxy, received } = await fixture(t);
  proxy.arm();
  const wrong = mutation({ preference: { slug: 'other', value: JSON.stringify(value) } });
  assert.equal((await send(proxy.port, wrong)).status, 403);
  assert.equal((await send(proxy.port, mutation())).status, 403);
  assert.equal(received.length, 0);
  assert.equal(proxy.snapshot().mutationAttempts, 2);
  assert.equal(proxy.snapshot().mutationForwards, 0);
  assert.equal(proxy.snapshot().consumed, true);
  assert.throws(() => proxy.arm());
});

test('denied, noop, wrong-ID, malformed and incomplete replies never count as successful injected loss', async t => {
  for (const payload of [success(7, { success: false, changed: false }),
    success(7, { success: true, changed: false }), success(8), '{',
    { jsonrpc: '2.0', id: 7, error: { code: -1, message: 'synthetic error' } },
    { jsonrpc: '2.0', id: 7, result: { isError: false, content: [{ type: 'image', text: '{"success":true,"changed":true}' }] } },
  ]) {
    await t.test('non-success reply', async sub => {
      const { proxy } = await fixture(sub, (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      });
      proxy.arm(); await send(proxy.port, mutation());
      assert.equal(proxy.snapshot().replyLosses, 0);
      assert.equal(proxy.snapshot().mutationForwards, 1);
      assert.equal(proxy.snapshot().failedInjection, true);
    });
  }
  await t.test('incomplete reply', async sub => {
    const { proxy } = await fixture(sub, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': 1000 });
      res.write('{'); res.destroy();
    });
    proxy.arm(); await send(proxy.port, mutation());
    assert.equal(proxy.snapshot().replyLosses, 0);
    assert.equal(proxy.snapshot().failedInjection, true);
  });
});

test('invalid credential setup errors contain no supplied credential bytes or assertion actual field', async () => {
  const sentinel = 'synthetic-secret-must-not-appear';
  await assert.rejects(createPilotLossProxy({ credential: sentinel, upstreamPort: 12345, slug, value }), error => {
    assert.equal(String(error).includes(sentinel), false);
    assert.equal(Object.hasOwn(error, 'actual'), false);
    return true;
  });
});

test('downstream disconnect and in-flight shutdown mark incomplete injection and do not replay', async t => {
  for (const action of ['disconnect', 'shutdown']) await t.test(action, async sub => {
    const { proxy, received } = await fixture(sub, () => {});
    proxy.arm();
    const req = http.request({ hostname: '127.0.0.1', port: proxy.port, path: '/mcp', method: 'POST',
      headers: { authorization: `Bearer ${credential}` } });
    req.on('error', () => {}); req.end(JSON.stringify(mutation()));
    const deadline = Date.now() + 2000;
    while (!received.length) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); }
    if (action === 'disconnect') req.destroy(); else await proxy.close();
    while (proxy.snapshot().active) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); }
    assert.equal(proxy.snapshot().failedInjection, true);
    assert.equal(proxy.snapshot().replyLosses, 0);
    assert.equal(received.length, 1);
  });
});

test('oversized upstream body is incomplete evidence with no payload escape', async t => {
  const { proxy } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('x'.repeat(8 * 1024 * 1024 + 1));
  });
  proxy.arm(); const result = await send(proxy.port, mutation());
  assert.equal(result.disconnected, true); assert.equal(result.bytes, '');
  assert.equal(proxy.snapshot().replyLosses, 0); assert.equal(proxy.snapshot().failedInjection, true);
});

test('timeout and shutdown close only owned sockets, never retry, and retain sanitized counts', async t => {
  const { proxy, received } = await fixture(t, () => {}, { deadlineMs: 50 });
  proxy.arm();
  assert.equal((await send(proxy.port, mutation())).disconnected, true);
  assert.equal(received.length, 1);
  assert.equal(proxy.snapshot().replyLosses, 0);
  assert.equal(proxy.snapshot().failedInjection, true);
  await proxy.close(); await proxy.close();
  const report = JSON.stringify(proxy.snapshot());
  for (const secret of [credential, slug, value, 'authorization']) assert.equal(report.includes(secret), false);
});
