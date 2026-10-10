import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/session-fixture.mjs';
import { greekPdfFixture } from './fixtures/pdf-fixtures.mjs';

for (const pdf of [false, true]) test(`private menu polling does not reserve admission ahead of a file request (PDF=${pdf})`, async t => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  const file = pdf ? { mimeType: 'application/pdf', buffer: Buffer.from((await greekPdfFixture()).bytes) }
    : { mimeType: 'text/plain', buffer: Buffer.from('Synthetic preference') };
  const before = state.calls.length;
  const status = service.getManagedStatus();
  const generation = service.generateTextWithFile('Extract synthetic preferences', file);
  const [observed, result] = await Promise.allSettled([status, generation]);
  assert.deepEqual(observed, { status: 'fulfilled', value: { state: 'available', configured: true } });
  assert.equal(result.status, 'fulfilled', result.reason?.message);
  assert.equal(result.value, '{"answer":"ok"}');
  assert.equal(state.completionBodies.length, 1);
  assert.match(state.completionBodies[0].prompt, pdf ? /Αθήνα/ : /Synthetic preference/);
  assert.equal(state.calls.slice(before).filter(url => url === '/props').length, 3);
});

test('private menu qualifies once, then polls without any endpoint I/O', async t => {
  const { service, state } = await fixture(t);
  assert.equal((await service.getManagedStatus()).state, 'available'); await service.settled();
  assert.ok(state.calls.includes('/models'));
  const before = state.calls.length;
  for (let i = 0; i < 3; i++) assert.equal((await service.getManagedStatus()).state, 'available');
  assert.equal(state.calls.length, before);
  assert.equal(state.completionBodies.length, 0);
});

test('failed observed qualification is not retried by the menu; explicit status can requalify', async t => {
  const { service, state } = await fixture(t);
  state.hook = async (req, res) => { if (req.url !== '/models') return false; res.destroy(); return true; };
  assert.equal((await service.getManagedStatus()).state, 'unavailable'); await service.settled();
  state.hook = null;
  const before = state.calls.length;
  assert.equal((await service.getManagedStatus()).state, 'unavailable');
  assert.equal(state.calls.length, before);
  assert.equal((await service.getStatus()).state, 'available'); await service.settled();
  const qualified = state.calls.length;
  assert.equal((await service.getManagedStatus()).state, 'available');
  assert.equal(state.calls.length, qualified);
});

test('observed preparation unavailability clears only the display observation and permits explicit requalification', async t => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  state.hook = async (req, res) => { if (req.url !== '/apply-template') return false; res.destroy(); return true; };
  await assert.rejects(service.generateText('synthetic'), { kind: 'unavailable' }); await service.settled();
  state.hook = null;
  const before = state.calls.length;
  assert.equal((await service.getManagedStatus()).state, 'unavailable');
  assert.equal(state.calls.length, before); assert.equal(state.completionBodies.length, 0);
  assert.equal((await service.getStatus()).state, 'available');
  assert.equal(await service.generateText('synthetic'), '{"answer":"ok"}');
});

test('private snapshot stays busy during real preparation and pending settlement', async t => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  let entered, release, settle;
  const preparing = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const settlement = new Promise(resolve => { settle = resolve; });
  const originalSettled = service.client.settled.bind(service.client);
  state.hook = async req => { if (req.url !== '/apply-template') return false; entered(); await hold; return false; };
  service.client.settled = async () => { await originalSettled(); await settlement; };
  try {
    const operation = service.generateText('synthetic'); await preparing;
    const before = state.calls.length;
    assert.equal((await service.getManagedStatus()).state, 'busy');
    await assert.rejects(service.generateText('second'), { kind: 'busy' });
    assert.equal(state.calls.length, before);
    release(); assert.equal(await operation, '{"answer":"ok"}');
    const after = state.calls.length;
    assert.equal((await service.getManagedStatus()).state, 'busy');
    assert.equal(state.calls.length, after);
    settle(); await service.settled();
    assert.equal((await service.getManagedStatus()).state, 'available');
  } finally { release(); settle(); service.client.settled = originalSettled; }
});

test('qualified private snapshots preserve caller controls and shutdown without I/O', async t => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  const before = state.calls.length, stop = new AbortController(); stop.abort();
  await assert.rejects(service.getManagedStatus({ signal: stop.signal }), { kind: 'cancelled' });
  for (const deadline of [NaN, Infinity, -Infinity, performance.now() - 1])
    await assert.rejects(service.getManagedStatus({ deadline }), { kind: 'deadline' });
  assert.equal(state.calls.length, before);
  await service.onModuleDestroy();
  assert.equal((await service.getManagedStatus()).state, 'unavailable');
  assert.equal(state.calls.length, before);
});

for (const fault of ['auth', 'model']) test(`cached private availability never bypasses generation qualification (${fault})`, async t => {
  const { service, state } = await fixture(t);
  await service.getStatus(); await service.settled();
  assert.equal((await service.getManagedStatus()).state, 'available');
  if (fault === 'auth') state.authBypass = async (req, res) => {
    if (req.url !== '/props' || req.headers.authorization) return false;
    res.writeHead(200).end('{}'); return true;
  };
  else state.hook = async (req, res) => { if (req.url !== '/models') return false; res.end('{"data":[{"id":"wrong-model"}]}'); return true; };
  await assert.rejects(service.generateText('must not be sent'), { kind: 'unsafe_configuration' }); await service.settled();
  const before = state.calls.length;
  assert.equal(state.completionBodies.length, 0);
  assert.ok(!state.calls.includes('/apply-template'));
  assert.equal((await service.getManagedStatus()).state, 'unavailable');
  assert.equal(state.calls.length, before);
});
