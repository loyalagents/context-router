import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ProbeClient } from './fixtures/local-model-feasibility/client.mjs';
import { createTlsFixture } from './fixtures/local-model-feasibility/tls-fixture.mjs';

const admission = { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 10,
  prompt_progress: { total: 10, cache: 0, processed: 0, time_ms: 0 } };
const chunk = { index: 0, stop: false, content: 'ok', tokens_predicted: 1, tokens_evaluated: 10 };
const terminal = { index: 0, stop: true, content: '', tokens_predicted: 2, tokens_evaluated: 10,
  stop_type: 'eos', truncated: false };
const send = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);

async function fixture(t, completion, { ip } = {}) {
  const credentials = await createTlsFixture({ ip });
  let server; let client;
  t.after(async () => {
    await client?.close();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await credentials.remove();
  });
  const state = { requests: [], processing: false, foreignId: 42, statusFailure: false, completions: 0,
    statusHook: null, controlSockets: new Set() };
  server = https.createServer({ key: credentials.key, cert: credentials.cert }, async (req, res) => {
    state.requests.push(req.url);
    if (req.headers.authorization !== `Bearer ${credentials.apiKey}`) { res.writeHead(401).end('{}'); return; }
    if (req.url === '/slots') {
      state.controlSockets.add(req.socket);
      if (state.statusHook && await state.statusHook(req, res)) return;
      if (state.statusFailure) { res.writeHead(401).end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 0, id_task: state.foreignId, is_processing: state.processing }]));
    } else if (req.url === '/completion') {
      state.completions++;
      for await (const _ of req) { /* bounded synthetic request fixture */ }
      await completion(req, res, state);
    } else { res.writeHead(404).end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  client = new ProbeClient({ port: server.address().port, certificate: credentials.cert, apiKey: credentials.apiKey,
    pollMs: 20, settleMs: 180, statusTimeoutMs: 100 });
  return { client, state, credentials, server };
}

test('never-sent abort causes no I/O and successful calls reuse capacity', async (t) => {
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission); send(res, chunk); send(res, terminal); res.end();
  });
  const aborted = AbortSignal.abort();
  await assert.rejects(client.complete('synthetic', { signal: aborted }), /Local model cancelled/);
  assert.deepEqual(state.requests, []);
  assert.equal((await client.complete('synthetic')).text, 'ok');
  assert.equal((await client.complete('synthetic')).text, 'ok');
  assert.equal(client.state, 'ready');
});

test('idle before admission and stale/foreign task IDs cannot clear unknown work', async (t) => {
  let arrived;
  const dispatched = new Promise((resolve) => { arrived = resolve; });
  const { client, state } = await fixture(t, async () => { arrived(); });
  const abort = new AbortController();
  const call = client.complete('synthetic', { signal: abort.signal });
  await dispatched;
  await assert.rejects(client.complete('second'), /Local model busy/);
  abort.abort(); await assert.rejects(call, /Local model cancelled/);
  await client.settled();
  assert.equal(client.state, 'unavailable');
  state.foreignId++;
  await assert.rejects(client.complete('second'), /Local model unavailable/);
  assert.equal(state.completions, 1);
});

test('witnessed cancellation returns promptly and only fresh idle releases capacity', async (t) => {
  const { client, state } = await fixture(t, async (_, res, state) => {
    res.setHeader('content-type', 'text/event-stream'); state.processing = true; send(res, admission);
    if (state.completions > 1) { state.processing = false; send(res, chunk); send(res, terminal); res.end(); }
    else res.on('close', () => setTimeout(() => { state.processing = false; }, 40));
  });
  const abort = new AbortController();
  const start = performance.now();
  await assert.rejects(client.complete('synthetic', { signal: abort.signal,
    onProgress: (event) => { if (event.admitted) abort.abort(); } }), /Local model cancelled/);
  assert.ok(performance.now() - start < 1000);
  assert.equal(client.state, 'cancel-pending');
  await assert.rejects(client.complete('second'), /Local model busy/);
  await client.settled(); assert.equal(client.state, 'ready');
  assert.equal((await client.complete('second')).text, 'ok');
  assert.equal(state.completions, 2);
});

for (const mode of ['status-auth', 'delayed-cancel', 'dropped-connection', 'control-replaced']) {
  test(`${mode} after dispatch remains unavailable without a second prompt`, async (t) => {
    let abort;
    const { client, state } = await fixture(t, async (_, res, state) => {
      res.setHeader('content-type', 'text/event-stream'); state.processing = true;
      if (mode === 'dropped-connection') { res.destroy(); return; }
      send(res, admission);
    });
    abort = new AbortController();
    await assert.rejects(client.complete('synthetic', { signal: abort.signal,
      onProgress: (event) => { if (!event.admitted) return;
        if (mode === 'status-auth') state.statusFailure = true;
        if (mode === 'control-replaced') for (const socket of state.controlSockets) socket.destroy();
        abort.abort();
      } }));
    await client.settled(); assert.equal(client.state, 'unavailable');
    state.processing = false; state.statusFailure = false;
    await assert.rejects(client.complete('second'), /Local model unavailable/);
    assert.equal(state.completions, 1);
  });
}

test('wrong IP SAN and wrong pinned certificate send no HTTP credentials or body', async (t) => {
  const wrongSan = await fixture(t, async () => assert.fail('must not dispatch'), { ip: '127.0.0.2' });
  await assert.rejects(wrongSan.client.complete('PRIVATE_SENTINEL'), /Local model unavailable/);
  assert.equal(wrongSan.state.requests.length, 0);
  const normal = await fixture(t, async () => assert.fail('must not dispatch'));
  const other = await createTlsFixture(); t.after(other.remove);
  const wrongPin = new ProbeClient({ port: normal.server.address().port, certificate: other.cert, apiKey: 'PRIVATE_KEY' });
  t.after(() => wrongPin.close());
  await assert.rejects(wrongPin.complete('PRIVATE_SENTINEL'), /Local model unavailable/);
  assert.equal(normal.state.requests.length, 0);
});

test('deadline includes admission and leaves an unwitnessed dispatch latched', async (t) => {
  const { client, state } = await fixture(t, async () => {});
  await assert.rejects(client.complete('synthetic', { deadline: performance.now() + 50 }), /Local model deadline/);
  await client.settled(); assert.equal(client.state, 'unavailable');
  assert.equal(state.completions, 1);
});

test('pre-abort outstanding idle poll cannot count as post-abort settlement', async (t) => {
  const abort = new AbortController();
  let statusCount = 0;
  const { client, state } = await fixture(t, async (_, res, state) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission); state.processing = true;
  });
  state.statusHook = async (_, res) => {
    if (++statusCount !== 2) return false;
    abort.abort(); await delay(15);
    res.end(JSON.stringify([{ id: 0, id_task: 42, is_processing: false }]));
    return true;
  };
  await assert.rejects(client.complete('synthetic', { signal: abort.signal }), /Local model cancelled/);
  await client.settled(); assert.equal(client.state, 'unavailable');
  assert.ok(statusCount >= 3);
});
