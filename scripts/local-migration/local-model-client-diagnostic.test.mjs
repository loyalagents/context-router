import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installControlObserver } from './fixtures/local-model-feasibility/client-observer.mjs';
import { DiagnosticOutput } from './fixtures/local-model-feasibility/diagnostic-output.mjs';
import { spawnOwned } from './fixtures/local-model-feasibility/process.mjs';

function setup(options = {}) {
  let time = 0;
  const control = { state: 'active', overflow: false, records: [] };
  const calls = [];
  const transport = { request(...args) {
    const request = new EventEmitter();
    request.on('error', () => {});
    if (typeof args[1] === 'function') request.on('response', args[1]);
    calls.push({ receiver: this, args, request });
    return request;
  } };
  const original = transport.request;
  const observer = installControlObserver({ transport, getControlEvidence: () => control, now: () => time, ...options });
  observer.begin(0);
  const dispatch = () => {
    const sequence = calls.filter(call => call.args[0]?.path === '/slots').length + 1;
    control.records.push({ phase: sequence === 1 ? 'readiness' : 'settlement', sequence, event: 'dispatch', elapsedMs: time, remainingMs: 5000 });
    return transport.request({ path: '/slots', headers: { authorization: 'SECRET_HEADER' } }, () => {});
  };
  const reply = (request, socket = {}) => {
    request.emit('socket', socket); request.emit('finish');
    const response = new EventEmitter(); response.headers = { secret: 'SECRET_HEADER' };
    request.emit('response', response);
    assert.equal(response.listenerCount('data'), 0);
    response.emit('end'); response.emit('close'); request.emit('close');
    control.records.push({ phase: 'readiness', sequence: control.records.filter(r => r.event === 'dispatch').length, event: 'idle', elapsedMs: time, remainingMs: 5000 });
    return response;
  };
  return { observer, transport, original, control, calls, dispatch, reply, tick: value => { time = value; } };
}

test('observer delegates unchanged once and distinguishes socket, write, headers and end timing without reading content', () => {
  const f = setup();
  const request = f.dispatch(); assert.equal(request, f.calls[0].request);
  assert.equal(f.calls[0].receiver, f.transport); assert.equal(f.calls.length, 1);
  const response = new EventEmitter();
  f.tick(10); request.emit('socket', {});
  f.tick(20); request.emit('finish');
  f.tick(40); request.emit('response', response);
  assert.equal(response.listenerCount('data'), 0);
  f.tick(60); response.emit('end'); response.emit('close'); request.emit('close');
  const result = f.observer.end(f.control);
  assert.equal(result.valid, true); assert.equal(result.requests, 1);
  for (const [event, elapsedMs] of [['socket', 10], ['write-finish', 20], ['headers', 40], ['response-end', 60]]) {
    assert.equal(result.records.find(r => r.event === event).elapsedMs, elapsedMs);
  }
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(f.observer.restore(), true); assert.equal(f.transport.request, f.original);
});

test('observer records retained and changed sockets and resets retention only between operations', () => {
  const f = setup(), socket = {};
  f.reply(f.dispatch(), socket); f.reply(f.dispatch(), socket); f.reply(f.dispatch(), {});
  const first = f.observer.end(f.control);
  assert.equal(first.valid, true);
  assert.deepEqual(first.records.filter(r => r.event === 'socket').map(r => r.retainedMatch), [null, true, false]);
  f.calls.length = 0; f.control.records.length = 0; f.observer.begin(1);
  f.reply(f.dispatch(), {});
  const second = f.observer.end(f.control);
  assert.equal(second.records.find(r => r.event === 'socket').retainedMatch, null);
  assert.equal(f.observer.restore(), true);
});

test('a missing response is a valid observed stall when close and existing timeout evidence are present', () => {
  const f = setup(), request = f.dispatch();
  request.emit('socket', {}); request.emit('finish');
  f.tick(5000); f.control.records.push({ phase: 'settlement', sequence: 1, event: 'timeout', elapsedMs: 5000, remainingMs: 0 });
  request.emit('error', new Error('SECRET_FAILURE')); request.emit('close'); f.control.state = 'unavailable';
  const result = f.observer.end(f.control);
  assert.equal(result.valid, true);
  assert.equal(result.records.some(r => r.event === 'headers'), false);
  assert.equal(result.records.at(-1).event, 'request-close');
  assert.ok(!JSON.stringify(result).includes('SECRET')); f.observer.restore();
});

test('observer rejects ambiguous dispatch correlation without changing request behavior', () => {
  const f = setup();
  const request = f.transport.request({ path: '/slots' });
  f.reply(request);
  assert.equal(f.calls.length, 1); assert.equal(f.observer.end(f.control).valid, false);
  assert.equal(f.observer.restore(), true);
});

test('observer ignores non-control traffic and preserves original arguments and returned object', () => {
  const f = setup(), input = { path: '/completion', body: 'SECRET_BODY' }, callback = () => {};
  const request = f.transport.request(input, callback);
  assert.equal(f.calls[0].args[0], input); assert.equal(f.calls[0].args[1], callback);
  assert.equal(request, f.calls[0].request); assert.equal(request.listenerCount('socket'), 0);
  f.calls.length = 0; f.reply(f.dispatch());
  assert.equal(f.observer.end(f.control).valid, true); f.observer.restore();
});

test('overflow and observer exceptions invalidate evidence without throwing into transport callbacks', () => {
  for (const options of [{ maxRecords: 2 }, { maxBytes: 200 }, { now: () => { throw new Error('SECRET_CLOCK'); } }]) {
    const f = setup(options);
    assert.doesNotThrow(() => f.reply(f.dispatch()));
    const result = f.observer.end(f.control);
    assert.equal(result.valid, false); assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.equal(f.observer.restore(), true);
  }
});

test('missing request close and changed final sequence invalidate evidence; restoration removes only observer listeners', () => {
  const f = setup(), request = f.dispatch();
  request.emit('socket', {}); request.emit('finish');
  const callback = () => {}; request.on('finish', callback);
  f.control.records[0].sequence = 2;
  assert.equal(f.observer.end(f.control).valid, false);
  assert.equal(request.listenerCount('socket'), 0); assert.equal(request.listenerCount('finish'), 1);
  assert.equal(f.observer.restore(), true);
});

test('accepted idle control evidence cannot hide missing socket/write/response instrumentation', () => {
  const f = setup(), request = f.dispatch();
  request.emit('close');
  f.control.records.push({ phase: 'readiness', sequence: 1, event: 'idle', elapsedMs: 0, remainingMs: 5000 });
  assert.equal(f.observer.end(f.control).valid, false); f.observer.restore();
});

test('discard projection checks split secrets and sentinel on each stream before discarding', () => {
  for (const secret of ['API_KEY_VALUE', 'STEP06_PRIVATE_SENTINEL']) {
    for (let split = 1; split < secret.length; split++) {
      const projection = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
      assert.equal(projection.push('stderr', Buffer.from('prefix' + secret.slice(0, split))).length, 0);
      assert.throws(() => projection.push('stderr', Buffer.from(secret.slice(split) + 'tail')), /^Error: Diagnostic output invalid$/);
      const result = projection.snapshot(); assert.equal(result.leakDetected, true); assert.equal(result.complete, false);
      assert.ok(!JSON.stringify(result).includes(secret));
    }
  }
});

test('discard projection never combines streams, counts discarded bytes and requires both EOFs', () => {
  const p = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
  assert.equal(p.push('stdout', Buffer.from('API_')).length, 0);
  assert.equal(p.push('stderr', Buffer.from('KEY_VALUE')).length, 0);
  assert.throws(() => p.finish(), /^Error: Diagnostic output invalid$/);
  const q = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
  q.push('stdout', Buffer.from('API_')); q.push('stderr', Buffer.from('KEY_VALUE'));
  q.end('stdout'); q.end('stderr');
  assert.deepEqual(q.finish(), { complete: true, invalid: false, leakDetected: false, stdoutBytes: 4, stderrBytes: 9, rawBytes: 13 });
});

test('discard projection bounds raw bytes and never publishes a successful leak audit after overflow', () => {
  const p = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
  assert.throws(() => p.push('stdout', Buffer.alloc(512 * 1024 + 1, 120)), /^Error: Diagnostic output invalid$/);
  assert.equal(p.snapshot().invalid, true); assert.equal(p.snapshot().complete, false);
});

test('owned native-style output is discarded on disk and overflow reaps the exact unresponsive child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-discard-test-'));
  let child;
  try {
    const projection = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
    child = await spawnOwned({ command: process.execPath, args: ['-e', 'process.stdout.write("PRIVATE_PROMPT");process.stderr.write("PRIVATE_PATH")'], cwd: root, logPath: join(root, 'discard.log'), projection });
    await child.exited; assert.equal(child.running, false); assert.equal(child.projectionResult.complete, true);
    assert.equal((await readFile(join(root, 'discard.log'))).length, 0);
    const overflow = new DiagnosticOutput({ apiKey: 'API_KEY_VALUE' });
    child = await spawnOwned({ command: process.execPath, args: ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("x".repeat(600000));setInterval(()=>{},1000)'], cwd: root, logPath: join(root, 'overflow.log'), projection: overflow, overflowGraceMs: 30 });
    const result = await child.exited;
    assert.equal(result.signal, 'SIGKILL'); assert.equal(child.logOverflow, true); assert.equal(child.running, false);
    assert.throws(() => child.projectionResult); assert.equal((await readFile(join(root, 'overflow.log'))).length, 0);
  } finally { await child?.stop({ graceMs: 30 }); await rm(root, { recursive: true, force: true }); }
});
