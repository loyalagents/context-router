import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ProbeClient, probeJson } from './fixtures/local-model-feasibility/client.mjs';
import { createTlsFixture } from './fixtures/local-model-feasibility/tls-fixture.mjs';

const admission = { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 10,
  prompt_progress: { total: 10, cache: 0, processed: 0, time_ms: 0 } };
const chunk = { index: 0, stop: false, content: 'ok', tokens_predicted: 1, tokens_evaluated: 10 };
const terminal = { index: 0, stop: true, content: '', tokens_predicted: 2, tokens_evaluated: 10,
  stop_type: 'eos', truncated: false };
const send = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);

async function fixture(t, completion, { ip, statusTimeoutMs = 100, settleMs = 180 } = {}) {
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
    pollMs: 20, settleMs, statusTimeoutMs });
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

test('readiness negative controls require exact unauthorized status on the pinned peer', async (t) => {
  const { credentials, server } = await fixture(t, async () => assert.fail('no inference'));
  const configuration = { port: server.address().port, certificate: credentials.cert, apiKey: credentials.apiKey };
  for (const key of [null, 'wrong-key']) {
    const result = await probeJson(configuration, '/slots', undefined, { key, expectedStatus: 401 });
    assert.equal(result.status, 401);
    assert.equal(result.value, null);
  }
  await assert.rejects(probeJson(configuration, '/slots', undefined, { expectedStatus: 401 }));
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

for (const phase of ['readiness', 'inference']) {
  test(`close during ${phase} awaits the operation and permanently prevents reuse`, async (t) => {
    let reached;
    const atPhase = new Promise((resolve) => { reached = resolve; });
    const { client, state } = await fixture(t, async (_, res) => {
      res.setHeader('content-type', 'text/event-stream'); send(res, admission);
    });
    if (phase === 'readiness') state.statusHook = async () => { reached(); return true; };
    let finished = false;
    const call = client.complete('synthetic', { onProgress: (event) => { if (event.admitted) reached(); } })
      .catch(() => { finished = true; });
    await atPhase;
    await client.close();
    assert.equal(finished, true);
    await call; await delay(10);
    assert.equal(client.state, 'unavailable');
    const count = state.requests.length;
    await assert.rejects(client.complete('must not send'), /Local model unavailable/);
    assert.equal(state.requests.length, count);
  });
}

test('absolute deadline is enforced when readiness crosses it before its timer fires', async (t) => {
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission); send(res, chunk); send(res, terminal); res.end();
  });
  let now = performance.now(); const deadline = now + 1000;
  t.mock.method(performance, 'now', () => now);
  state.statusHook = async () => { now = deadline + 1; return false; };
  await assert.rejects(client.complete('synthetic', { deadline }), /Local model deadline/);
  assert.equal(state.completions, 0);
});

test('late terminal callback cannot publish success before an overdue timer runs', async (t) => {
  const { client } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission); send(res, chunk); send(res, terminal); res.end();
  });
  const deadline = performance.now() + 80;
  await assert.rejects(client.complete('synthetic', { deadline, onProgress: (event) => {
    if (event.terminal) while (performance.now() <= deadline + 5) { /* bounded event-loop stall */ }
  } }), /Local model deadline/);
  await client.settled();
  assert.equal(client.state, 'ready');
});

test('successful terminal result survives intentional cleanup of an outstanding status poll', async (t) => {
  let completionResponse;
  const { client, state } = await fixture(t, async (_, res) => {
    completionResponse = res;
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  });
  let statuses = 0;
  state.statusHook = async () => {
    if (++statuses !== 2) return false;
    send(completionResponse, chunk); send(completionResponse, terminal); completionResponse.end();
    return true;
  };
  assert.equal((await client.complete('synthetic')).text, 'ok');
  assert.equal(client.state, 'ready');
  assert.equal(statuses, 2);
});

test('active control polling uses its full readiness budget', async (t) => {
  let completionResponse;
  const { client, state } = await fixture(t, async (_, res) => {
    completionResponse = res;
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  }, { statusTimeoutMs: 1000 });
  let statuses = 0;
  state.statusHook = async (_, res) => {
    if (++statuses !== 2) return false;
    await delay(650);
    res.end(JSON.stringify([{ id: 0, is_processing: true }]));
    setTimeout(() => { send(completionResponse, chunk); send(completionResponse, terminal); completionResponse.end(); }, 5);
    return true;
  };
  assert.equal((await client.complete('synthetic')).text, 'ok');
  assert.equal(client.state, 'ready');
});

test('prompt, schema and encoded request-body bounds reject before any HTTP dispatch', async (t) => {
  const { client, state } = await fixture(t, async () => assert.fail('input limits must not dispatch'));
  for (const [prompt, options] of [
    ['x'.repeat(128 * 1024 + 1), {}],
    ['short', { schema: { description: 'x'.repeat(32 * 1024) } }],
    ['\u0000'.repeat(64000), {}],
  ]) {
    await assert.rejects(client.complete(prompt, options), /Local model input limit/);
    assert.equal(client.state, 'ready');
  }
  assert.deepEqual(state.requests, []);
});

for (const responseKind of ['http-error', 'malformed-frame', 'truncated-frame']) {
  test(`TLS ${responseKind} fails without returning partial output or retrying`, async (t) => {
    const { client, state } = await fixture(t, async (_, res) => {
      if (responseKind === 'http-error') { res.writeHead(503).end('{"private":"must not escape"}'); return; }
      res.setHeader('content-type', 'text/event-stream'); send(res, admission); send(res, chunk);
      if (responseKind === 'malformed-frame') res.end('data: {"private":"must not escape"\n\n');
      else { send(res, { ...terminal, truncated: true }); res.end(); }
    });
    let caught;
    try { await client.complete('synthetic'); } catch (error) { caught = error; }
    assert.equal(caught?.message, 'Local model unavailable');
    await client.settled();
    assert.equal(state.completions, 1);
  });
}

test('fresh idle response beyond 500ms recovers within the original settlement deadline', async (t) => {
  const abort = new AbortController();
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  }, { statusTimeoutMs: 1500, settleMs: 1200 });
  let count = 0;
  state.statusHook = async (_req, res) => {
    if (++count === 1) return false;
    await delay(650);
    res.end(JSON.stringify([{ id: 0, is_processing: false }])); return true;
  };
  await assert.rejects(client.complete('synthetic', { signal: abort.signal,
    onProgress: (event) => { if (event.admitted) abort.abort(); } }), /Local model cancelled/);
  await client.settled();
  assert.equal(client.state, 'ready');
  assert.equal(state.controlSockets.size, 1);
  assert.equal(count, 2);
});

test('event-loop delay after abort cannot restart the settlement deadline', async (t) => {
  const abort = new AbortController();
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  });
  let now = performance.now(); t.mock.method(performance, 'now', () => now);
  await assert.rejects(client.complete('synthetic', { signal: abort.signal,
    onProgress: (event) => { if (event.admitted) { abort.abort(); now += 200; } } }), /Local model cancelled/);
  await client.settled();
  assert.equal(client.state, 'unavailable');
  assert.equal(state.requests.filter((path) => path === '/slots').length, 1);
});

test('a late post-abort idle response cannot publish readiness before its overdue timer fires', async (t) => {
  const abort = new AbortController();
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  });
  let now = performance.now(); t.mock.method(performance, 'now', () => now);
  let count = 0;
  state.statusHook = async (_req, res) => {
    if (++count === 1) return false;
    now += 200; res.end(JSON.stringify([{ id: 0, is_processing: false }])); return true;
  };
  await assert.rejects(client.complete('synthetic', { signal: abort.signal,
    onProgress: (event) => { if (event.admitted) abort.abort(); } }), /Local model cancelled/);
  await client.settled();
  assert.equal(client.state, 'unavailable');
  assert.equal(state.controlSockets.size, 1);
});

test('pre-abort poll drainage consumes the original settlement window and never becomes its witness', async (t) => {
  const abort = new AbortController();
  const { client, state } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  }, { statusTimeoutMs: 1500, settleMs: 180 });
  let count = 0;
  state.statusHook = async (_req, res) => {
    if (++count !== 2) return false;
    abort.abort(); await delay(650);
    res.end(JSON.stringify([{ id: 0, is_processing: false }])); return true;
  };
  const started = performance.now();
  await assert.rejects(client.complete('synthetic', { signal: abort.signal }), /Local model cancelled/);
  await client.settled();
  assert.equal(client.state, 'unavailable');
  assert.equal(count, 2);
  assert.ok(performance.now() - started < 500, 'drain must be bounded by settlement, not the old request timeout');
});

test('control evidence distinguishes a settlement timeout without retaining response or credential data', async (t) => {
  const abort = new AbortController();
  const { client, state, credentials } = await fixture(t, async (_, res) => {
    res.setHeader('content-type', 'text/event-stream'); send(res, admission);
  }, { statusTimeoutMs: 50, settleMs: 180 });
  let count = 0;
  state.statusHook = async () => ++count !== 1;
  await assert.rejects(client.complete('PRIVATE_PROMPT', { signal: abort.signal,
    onProgress: (event) => { if (event.admitted) abort.abort(); } }));
  await client.settled();
  const evidence = client.controlEvidence;
  assert.equal(evidence.state, 'unavailable');
  assert.equal(evidence.overflow, false);
  assert.ok(evidence.records.some((record) => record.phase === 'settlement' && record.event === 'timeout'));
  assert.ok(evidence.records.some((record) => record.event === 'close'));
  const encoded = JSON.stringify(evidence);
  for (const secret of ['PRIVATE_PROMPT', credentials.apiKey, '/slots', 'authorization']) assert.ok(!encoded.includes(secret));
});
