import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalTransport } from '../lib/local-transport.ts';
const token = 'cr_ui_session_' + 'a'.repeat(43);

test('browser authority only reaches fixed same-origin destinations with explicit request policy', async () => {
  const calls = [];
  const transport = createLocalTransport(async (...args) => {
    calls.push(args);
    return new Response('{}');
  });
  transport.setSession(token);
  for (const destination of [
    'https://attacker.invalid/graphql',
    '//attacker.invalid/graphql',
    '/graphql?token=x',
    '/api/chat',
    '/api/local/issue',
  ]) {
    await assert.rejects(transport.request(destination, { method: 'POST' }));
  }
  assert.equal(calls.length, 0);
  await transport.request('/graphql', {
    method: 'POST',
    body: '{}',
    credentials: 'include',
    redirect: 'follow',
    headers: { authorization: 'Bearer hostile' },
  });
  assert.equal(calls[0][0], '/graphql');
  const options = calls[0][1];
  assert.equal(options.credentials, 'omit');
  assert.equal(options.mode, 'same-origin');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.get('authorization'), 'Bearer ' + token);
  assert.equal(options.headers.get('x-context-router-ui'), '1');
});

test('logout aborts pending work and rejects a response from an earlier generation, including its body', async () => {
  let release, requestSignal;
  const transport = createLocalTransport(async (_url, options) => {
    requestSignal = options.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          release = () => {
            controller.enqueue(new TextEncoder().encode('private'));
            controller.close();
          };
        },
      }),
    );
  });
  transport.setSession(token);
  const pending = transport.request('/graphql', { method: 'POST' });
  await Promise.resolve();
  transport.clear();
  release();
  assert.equal(requestSignal.aborted, true);
  await assert.rejects(pending, /session changed/);
});

test('401 expires the session once and never retries an uncertain mutation', async () => {
  let calls = 0,
    expired = 0;
  const transport = createLocalTransport(async () => {
    calls++;
    return new Response('{}', { status: 401 });
  });
  transport.setSession(token, () => {
    expired++;
  });
  await assert.rejects(
    transport.request('/graphql', { method: 'POST' }),
    /session expired/,
  );
  assert.equal(calls, 1);
  assert.equal(expired, 1);
  await assert.rejects(transport.request('/graphql', { method: 'POST' }));
  assert.equal(calls, 1);
});

test('locking clears local authority immediately while a bounded separate request revokes the captured session', async () => {
  let settle, captured;
  const transport = createLocalTransport(async (_route, options) => {
    captured = options;
    return new Promise((resolve) => {
      settle = () => resolve(new Response('{}'));
    });
  });
  transport.setSession(token);
  const pending = transport.lock();
  await assert.rejects(transport.request('/graphql', { method: 'POST' }));
  assert.equal(captured.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(captured.signal.aborted, false);
  settle();
  await pending;
});
