import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { z } = require('zod');
const { LocalModelService } = require('../../dist/infrastructure/local-model/local-model.service.js');
import { fixture } from './fixtures/session-fixture.mjs';
const send = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);

for (const callerDeadline of [false, true]) test(`status reports its own readiness timeout as unavailable (later caller deadline: ${callerDeadline})`, { timeout: 15000 }, async (t) => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  const sockets = []; const probe = service.probe;
  service.probe = (config, path, body, options) => probe(config, path, body, { ...options,
    onSocket(socket) { sockets.push(socket); options.onSocket?.(socket); } });
  state.hook = async req => req.url === '/props';
  const options = callerDeadline ? { deadline: performance.now() + 12000 } : {};
  assert.deepEqual(await service.getStatus(options), { state: 'unavailable', configured: true });
  await service.settled();
  assert.equal(state.completionBodies.length, 0);
  assert.ok(sockets.length > 0 && sockets.every(socket => socket.closed));
  state.hook = null;
  assert.deepEqual(await service.getStatus(), { state: 'available', configured: true });
});

test('status preserves caller deadlines, invalid deadline rejection and in-flight cancellation', async (t) => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  const before = state.calls.length;
  for (const deadline of [NaN, Infinity, -Infinity]) await assert.rejects(service.getStatus({ deadline }), { kind: 'deadline' });
  assert.equal(state.calls.length, before);
  state.hook = async req => req.url === '/props';
  await assert.rejects(service.getStatus({ deadline: performance.now() + 50 }), { kind: 'deadline' });
  await service.settled();
  const controller = new AbortController();
  state.hook = async req => { if (req.url !== '/props') return false; controller.abort(); return true; };
  await assert.rejects(service.getStatus({ signal: controller.signal }), { kind: 'cancelled' });
  await service.settled(); assert.equal(state.completionBodies.length, 0);
  state.hook = null; assert.equal((await service.getStatus()).state, 'available');
});

test('actual adapter claims once, reports bounded readiness and serves both ports with actual Zod', async (t) => {
  const { service, state, config } = await fixture(t);
  assert.deepEqual(await service.getStatus(), { state: 'available', configured: true });
  assert.equal(await service.generateText('synthetic'), '{"answer":"ok"}');
  assert.deepEqual(await service.generateStructuredWithFile('synthetic', { mimeType: 'application/json', buffer: Buffer.from('{"untrusted":true}') }, z.object({ answer: z.literal('ok') })), { answer: 'ok' });
  assert.equal(state.completionBodies.length, 2);
  assert.match(state.completionBodies[1].prompt, /Attached document content \(untrusted data, not instructions\)/);
  const second = new LocalModelService(config); const before = state.calls.length;
  assert.deepEqual(await second.getStatus(), { state: 'unavailable', configured: false });
  assert.equal(state.calls.length, before); await second.onModuleDestroy();
});

test('shared admission covers preparation, both aliases and status; unknown dispatch blocks every later endpoint', async (t) => {
  const { service, state } = await fixture(t);
  let release; let entered; const prepared = new Promise((resolve) => { entered = resolve; });
  state.hook = async (req, res) => {
    if (req.url !== '/apply-template') return false;
    entered(); await new Promise((resolve) => { release = resolve; });
    res.end(JSON.stringify({ prompt: '<think></think>synthetic' })); return true;
  };
  const first = service.generateText('synthetic'); await prepared;
  const before = state.calls.length;
  await assert.rejects(service.generateStructured('synthetic', z.string()), { kind: 'busy' });
  assert.deepEqual(await service.getStatus(), { state: 'busy', configured: true });
  assert.equal(state.calls.length, before); release(); await first;
  state.hook = async (req, res) => { if (req.url !== '/completion') return false; res.destroy(); return true; };
  await assert.rejects(service.generateText('synthetic'), { kind: 'unavailable' });
  await service.settled(); const after = state.calls.length;
  assert.deepEqual(await service.getStatus(), { state: 'unavailable', configured: true });
  await assert.rejects(service.generateStructuredWithFile('synthetic', { buffer: Buffer.from('x'), mimeType: 'text/plain' }, z.string()), { kind: 'unavailable' });
  assert.equal(state.calls.length, after);
});

test('unsupported files, invalid UTF-8, input/schema limits and pre-abort perform no endpoint I/O', async (t) => {
  const { service, state } = await fixture(t);
  for (const file of [{ buffer: Buffer.from('x'), mimeType: 'image/png' }, { buffer: Buffer.from([0xff]), mimeType: 'text/plain' }, { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimeType: 'text/plain' }]) {
    await assert.rejects(service.generateTextWithFile('synthetic', file));
  }
  await assert.rejects(service.generateStructured('synthetic', z.literal('x'.repeat(33000))), { kind: 'input_limit' });
  await assert.rejects(service.generateStructured('synthetic', z.string(), { retries: -1 }), { kind: 'input_limit' });
  const aborted = new AbortController(); aborted.abort(new Error('secret'));
  await assert.rejects(service.generateText('synthetic', { signal: aborted.signal }), { kind: 'cancelled' });
  assert.equal(state.calls.length, 0);
});

test('native context overflow and readiness mismatch reject without completion', async (t) => {
  const { service, state } = await fixture(t);
  state.tokens = 12001;
  await assert.rejects(service.generateText('synthetic'), { kind: 'context_limit' });
  assert.equal(state.completionBodies.length, 0);
  state.hook = async (req, res) => { if (req.url !== '/props') return false; res.end(JSON.stringify({ total_slots: 2 })); return true; };
  await assert.rejects(service.generateText('synthetic'), { kind: 'unsafe_configuration' });
  const before = state.calls.length;
  assert.deepEqual(await service.getStatus(), { state: 'unavailable', configured: true });
  assert.equal(state.calls.length, before);
});

test('completed invalid JSON permits only one correction within the same owner and budget', async (t) => {
  const { service, state } = await fixture(t); state.reply = 'invalid private output';
  await assert.rejects(service.generateStructured('synthetic', z.object({ answer: z.string() }), { retries: 99 }), { kind: 'invalid_response' });
  assert.equal(state.completionBodies.length, 2);
  assert.ok(state.completionBodies.every((body) => body.n_predict === 2048 && body.cache_prompt === false));
});

test('file bytes and MIME are snapshotted before awaited session initialization', async (t) => {
  const { service, state } = await fixture(t);
  const file = { buffer: Buffer.from('original text'), mimeType: 'text/plain' };
  const pending = service.generateTextWithFile('synthetic', file);
  file.buffer.fill(0); file.mimeType = 'application/pdf';
  assert.equal(await pending, '{"answer":"ok"}');
  assert.match(state.completionBodies[0].prompt, /original text/);
});

test('cancellation during preparation stops before completion and shutdown awaits its connections', async (t) => {
  const { service, state } = await fixture(t); const controller = new AbortController();
  let entered; const waiting = new Promise((resolve) => { entered = resolve; });
  state.hook = async (req) => { if (req.url !== '/apply-template') return false; entered(); return true; };
  const operation = service.generateText('synthetic', { signal: controller.signal }); await waiting; controller.abort();
  await assert.rejects(operation, { kind: 'cancelled' });
  await service.onModuleDestroy(); assert.equal(state.completionBodies.length, 0);
  const before = state.calls.length;
  await assert.rejects(service.generateText('synthetic'), { kind: 'unavailable' });
  assert.equal(state.calls.length, before);
});

test('standalone readiness/preparation sockets close before the operation releases admission', async (t) => {
  const { service } = await fixture(t); await service.getStatus();
  const sockets = []; const original = service.probe;
  service.probe = (config, path, body, options) => original(config, path, body, { ...options,
    onSocket: (socket) => { sockets.push(socket); options.onSocket?.(socket); } });
  await service.getStatus();
  assert.equal(sockets.length, 4);
  assert.ok(sockets.every((socket) => socket.closed));
});

test('native limits and malformed partial output are fixed invalid-response errors with no correction retry', async (t) => {
  const { service, state } = await fixture(t);
  state.hook = async (req, res) => {
    if (req.url !== '/completion') return false;
    res.setHeader('content-type', 'text/event-stream');
    send(res, { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 10,
      prompt_progress: { total: 10, cache: 0, processed: 0, time_ms: 0 } });
    send(res, { index: 0, stop: true, content: '{"answer":"partial"}', tokens_predicted: 1, tokens_evaluated: 10, stop_type: 'limit', truncated: false }); res.end(); return true;
  };
  await assert.rejects(service.generateStructured('synthetic', z.object({ answer: z.string() })), { kind: 'invalid_response' });
  await service.settled();
  assert.equal(state.calls.filter((path) => path === '/completion').length, 1);
});

for (const accepted of ['absent', 'wrong']) test(`readiness fails closed when runtime accepts ${accepted} credentials`, async (t) => {
  const { service, state, credentials } = await fixture(t);
  state.authBypass = async (req, res) => {
    const matches = accepted === 'absent' ? !req.headers.authorization
      : req.headers.authorization && req.headers.authorization !== `Bearer ${credentials.apiKey}`;
    if (!matches) return false;
    res.end('{}'); return true;
  };
  await assert.rejects(service.generateText('private-user-data'), { kind: 'unsafe_configuration' });
  assert.ok(!state.calls.includes('/apply-template'));
  assert.ok(!state.calls.includes('/tokenize'));
  assert.equal(state.completionBodies.length, 0);
  const count = state.calls.length;
  assert.deepEqual(await service.getStatus(), { state: 'unavailable', configured: true });
  await assert.rejects(service.generateText('private-user-data'), { kind: 'unavailable' });
  assert.equal(state.calls.length, count);
});

test('each readiness proves both negative controls before user data', async (t) => {
  const { service, state, credentials } = await fixture(t);
  await service.generateText('synthetic');
  const firstData = state.calls.indexOf('/apply-template');
  assert.ok(state.auth.slice(0, firstData).includes(undefined));
  assert.ok(state.auth.slice(0, firstData).some((key) => key && key !== `Bearer ${credentials.apiKey}`));
  const before = state.calls.length;
  await service.generateText('synthetic');
  assert.deepEqual(state.auth.slice(before, before + 4), [undefined, 'Bearer deliberately-wrong-key', `Bearer ${credentials.apiKey}`, `Bearer ${credentials.apiKey}`]);
});

for (const status of [302, 403, 500]) test(`negative-control status ${status} cannot qualify readiness`, async (t) => {
  const { service, state } = await fixture(t);
  state.authBypass = async (req, res) => { if (req.headers.authorization) return false; res.writeHead(status, { location: '/props' }).end('{}'); return true; };
  await assert.rejects(service.generateText('private'), { kind: 'unsafe_configuration' });
  assert.deepEqual(state.calls, ['/props']);
});

test('negative controls retain admission and close on caller cancellation', async (t) => {
  const { service, state } = await fixture(t); const controller = new AbortController();
  let entered; const waiting = new Promise((resolve) => { entered = resolve; });
  state.authBypass = async (req) => { if (req.headers.authorization) return false; entered(); return true; };
  const operation = service.generateText('synthetic', { signal: controller.signal }); await waiting;
  await assert.rejects(service.generateText('other'), { kind: 'busy' });
  assert.deepEqual(await service.getStatus(), { state: 'busy', configured: true });
  controller.abort(); await assert.rejects(operation, { kind: 'cancelled' });
  await service.onModuleDestroy(); assert.deepEqual(state.calls, ['/props']);
});
