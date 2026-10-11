import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures/session-fixture.mjs';
import { inspectManualSession } from '../../dist/infrastructure/local-model/engine/manual-session.mjs';
import { ManagedModelReadiness } from '../../dist/infrastructure/local-model/engine/managed-readiness.mjs';
const require = createRequire(import.meta.url);
const { LocalModelService } = require('../../dist/infrastructure/local-model/local-model.service.js');
async function waitFor(check) {
  const end = performance.now() + 3000;
  while (!check()) { assert.ok(performance.now() < end, 'bounded fixture condition'); await delay(10); }
}
async function managed(t, options = {}) {
  const f = await fixture(t);
  let ready = false;
  f.state.authBypass = async (req, res) => {
    if (req.url !== '/health') return false;
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ready ? 'ok' : 'loading model' })); return true;
  };
  const startup = new ManagedModelReadiness(f.config, options);
  const service = new LocalModelService(f.config, startup);
  t.after(async () => { await service.onModuleDestroy(); await startup.close(); });
  return { ...f, startup, service, ready: () => { ready = true; } };
}
test('read-only strict session inspection neither consumes a claim nor returns the key', async t => {
  const { config } = await fixture(t);
  const before = await readdir(config.root);
  const inspected = await inspectManualSession(config);
  assert.deepEqual(Object.keys(inspected).sort(), ['certificate', 'expiresAt', 'port']);
  assert.equal(inspected.port, config.port);
  assert.ok(inspected.expiresAt > Date.now());
  assert.deepEqual(await readdir(config.root), before);
});
test('slow managed startup polls only public pinned TLS and claims only after ready', async t => {
  const f = await managed(t);
  await waitFor(() => f.state.calls.length >= 2);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await f.service.getStatus(), { state: 'unavailable', configured: true });
    await assert.rejects(f.service.generateText('synthetic'), { kind: 'unavailable' });
  }
  await assert.rejects(access(join(f.config.root, 'backend-session.claim')));
  assert.ok(f.state.calls.every(call => call === '/health'));
  assert.ok(f.state.auth.every(auth => auth === undefined));
  f.ready(); await waitFor(() => f.startup.state === 'ready');
  assert.equal((await f.service.getStatus()).state, 'available');
  assert.equal(await f.service.generateText('synthetic'), '{"answer":"ok"}');
  assert.equal(f.state.completionBodies.length, 1);
});
test('status cancellation cannot cancel or poison generation startup', async t => {
  const f = await managed(t), caller = new AbortController(); caller.abort();
  await assert.rejects(f.service.getStatus({ signal: caller.signal }), { kind: 'cancelled' });
  assert.equal(f.startup.state, 'loading');
  f.ready(); await waitFor(() => f.startup.state === 'ready');
  assert.equal((await f.service.getStatus()).state, 'available');
});
test('startup deadline permanently fails the generation without creating a claim', async t => {
  const f = await managed(t, { startupMs: 300 });
  await waitFor(() => f.startup.state === 'failed');
  f.ready(); await delay(250);
  assert.equal(f.startup.state, 'failed');
  assert.equal((await f.service.getStatus()).state, 'unavailable');
  await assert.rejects(access(join(f.config.root, 'backend-session.claim')));
});
test('control invalidation and certificate expiry refuse new AI for the same generation', async t => {
  let wall = Date.now();
  const f = await managed(t, { wallNow: () => wall });
  f.ready(); await waitFor(() => f.startup.state === 'ready');
  assert.equal((await f.service.getStatus()).state, 'available');
  wall = (await inspectManualSession(f.config)).expiresAt + 1;
  assert.equal((await f.service.getStatus()).state, 'unavailable');
  await assert.rejects(f.service.generateText('synthetic'), { kind: 'unavailable' });
  assert.equal(f.startup.signal.aborted, true);
});
test('control loss while loading settles polling and is permanently unavailable', async t => {
  const control = new AbortController(), f = await managed(t, { signal: control.signal });
  await waitFor(() => f.state.calls.length > 0);
  control.abort(); await f.startup.close();
  const count = f.state.calls.length; f.ready(); await delay(250);
  assert.equal(f.state.calls.length, count);
  assert.equal(f.startup.state, 'failed');
  assert.equal((await f.service.getStatus()).state, 'unavailable');
});
test('private managed status distinguishes healthy loading without changing public availability', async t => {
  const f = await managed(t);
  assert.deepEqual(await f.service.getManagedStatus(), { state: 'loading', configured: true });
  assert.deepEqual(await f.service.getStatus(), { state: 'unavailable', configured: true });
  await assert.rejects(access(join(f.config.root, 'backend-session.claim')));
  f.ready(); await waitFor(() => f.startup.state === 'ready');
  assert.deepEqual(await f.service.getManagedStatus(), { state: 'available', configured: true });
});
test('private managed status reports terminal startup failure as unavailable', async t => {
  const f = await managed(t, { startupMs: 300 });
  await waitFor(() => f.startup.state === 'failed');
  assert.equal((await f.service.getManagedStatus()).state, 'unavailable');
  await assert.rejects(access(join(f.config.root, 'backend-session.claim')));
});

for (const expiry of [false, true]) test(`qualified menu observation cannot outlive managed authority (expiry=${expiry})`, async t => {
  let wall = Date.now();
  const control = new AbortController(), f = await managed(t, { signal: control.signal, wallNow: () => wall });
  f.ready(); await waitFor(() => f.startup.state === 'ready');
  assert.equal((await f.service.getManagedStatus()).state, 'available'); await f.service.settled();
  const before = f.state.calls.length;
  if (expiry) wall = (await inspectManualSession(f.config)).expiresAt + 1;
  else control.abort();
  assert.equal((await f.service.getManagedStatus()).state, 'unavailable');
  await assert.rejects(f.service.generateText('must not be sent'), { kind: 'unavailable' });
  assert.equal(f.state.calls.length, before);
});
