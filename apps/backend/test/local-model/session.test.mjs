import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { once } from 'node:events';
import { readFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createTlsFixture } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/tls-fixture.mjs';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { z } = require('zod');
const { LocalModelService } = require('../../dist/infrastructure/local-model/local-model.service.js');
const template = await readFile(new URL('./fixtures/qwen35-template.txt', import.meta.url), 'utf8');
const send = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
async function fixture(t) {
  const credentials = await createTlsFixture();
  const roots = await realpath(await mkdtemp(join(tmpdir(), 'local-model-app-test-')));
  await mkdir(join(roots, 'identity')); await mkdir(join(roots, 'database'));
  const state = { calls: [], completionBodies: [], reply: '{"answer":"ok"}', hook: null, tokens: 10 };
  const server = https.createServer({ key: credentials.key, cert: credentials.cert }, async (request, response) => {
    state.calls.push(request.url);
    if (request.headers.authorization !== `Bearer ${credentials.apiKey}`) { response.writeHead(401).end('{}'); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    if (state.hook && await state.hook(request, response, body)) return;
    response.setHeader('content-type', 'application/json');
    const result = request.url === '/props' ? { total_slots: 1, default_generation_settings: { n_ctx: 16384 }, chat_template: template }
      : request.url === '/models' ? { data: [{ id: 'step06-qwen35' }] }
      : request.url === '/apply-template' ? { prompt: '<think></think>' + JSON.parse(body).messages[0].content }
      : request.url === '/tokenize' ? { tokens: Array(state.tokens).fill(1) }
      : request.url === '/slots' ? [{ id: 0, is_processing: false }] : null;
    if (result) { response.end(JSON.stringify(result)); return; }
    if (request.url !== '/completion') { response.writeHead(404).end('{}'); return; }
    state.completionBodies.push(JSON.parse(body));
    response.setHeader('content-type', 'text/event-stream');
    send(response, { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: state.tokens,
      prompt_progress: { total: state.tokens, cache: 0, processed: 0, time_ms: 0 } });
    send(response, { index: 0, stop: true, content: state.reply, tokens_predicted: 2, tokens_evaluated: state.tokens, stop_type: 'eos', truncated: false }); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = { root: await realpath(credentials.root), identityRoot: join(roots, 'identity'), databaseRoot: join(roots, 'database'), port: server.address().port };
  const service = new LocalModelService(config);
  t.after(async () => { await service.onModuleDestroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await credentials.remove(); await rm(roots, { recursive: true, force: true }); });
  return { service, state, config, credentials };
}

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
  assert.equal(sockets.length, 2);
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
