import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LocalUiSessions } = require('../../dist/local-ui/local-ui-sessions.js');

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ui-session-')),
  );
  fs.chmodSync(root, 0o700);
  const exports = path.join(root, 'exports');
  fs.mkdirSync(exports, { mode: 0o700 });
  let now = 0;
  const sessions = new LocalUiSessions({
    principalId: 'synthetic-principal',
    exportRoot: exports,
    excludedRoots: [
      path.join(root, 'identity'),
      path.join(root, 'database'),
      path.join(root, 'model'),
    ],
    now: () => now,
  });
  t.after(() => {
    sessions.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const issue = () => {
    const receipt = sessions.issue();
    return { ...receipt, token: fs.readFileSync(receipt.path, 'utf8').trim() };
  };
  return {
    root,
    exports,
    sessions,
    issue,
    setNow: (value) => {
      now = value;
    },
  };
}

test('private one-use bootstrap exchanges for an independent browser authority', (t) => {
  const f = fixture(t);
  const bootstrap = f.issue();
  assert.match(bootstrap.token, /^cr_ui_unlock_[A-Za-z0-9_-]{43}$/);
  assert.equal(fs.statSync(bootstrap.path).mode & 0o777, 0o600);
  assert.equal(bootstrap.expiresInSeconds, 300);
  assert.equal(JSON.stringify(bootstrap).includes('credential'), false);
  const token = f.sessions.exchange(bootstrap.token);
  assert.match(token, /^cr_ui_session_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(
    token.slice('cr_ui_session_'.length),
    bootstrap.token.slice('cr_ui_unlock_'.length),
  );
  assert.equal(f.sessions.authenticate(token), 'synthetic-principal');
  assert.equal(f.sessions.authenticate(bootstrap.token), null);
  assert.equal(f.sessions.exchange(bootstrap.token), null);
  assert.equal(fs.existsSync(bootstrap.path), false);
  assert.equal(JSON.stringify(f.sessions).includes(token), false);
  assert.equal(JSON.stringify(f.sessions).includes(bootstrap.token), false);
  for (const wrong of [
    '',
    'Bearer ' + token,
    token + ' ',
    'cr_mcp_' + token,
    'A'.repeat(43),
    null,
    {},
  ]) {
    assert.equal(f.sessions.authenticate(wrong), null);
    assert.equal(f.sessions.exchange(wrong), null);
  }
});

test('reissue invalidates only prior bootstrap and failed export preserves it', (t) => {
  const f = fixture(t);
  const active = f.sessions.exchange(f.issue().token);
  const old = f.issue();
  fs.chmodSync(f.exports, 0o755);
  assert.throws(() => f.sessions.issue(), /Local UI session unavailable/);
  fs.chmodSync(f.exports, 0o700);
  assert.equal(f.sessions.authenticate(active), 'synthetic-principal');
  assert.ok(f.sessions.exchange(old.token));
  const a = f.issue();
  const b = f.issue();
  assert.equal(f.sessions.exchange(a.token), null);
  assert.ok(f.sessions.exchange(b.token));
  assert.equal(f.sessions.authenticate(active), 'synthetic-principal');
});

test('bootstrap expiry and server-authoritative session expiry abort owned work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const expired = f.issue();
  f.setNow(300000);
  assert.equal(f.sessions.exchange(expired.token), null);
  const token = f.sessions.exchange(f.issue().token);
  const work = new AbortController();
  f.sessions.track(token, work);
  f.setNow(300000 + 8 * 60 * 60 * 1000);
  t.mock.timers.tick(8 * 60 * 60 * 1000);
  assert.equal(work.signal.aborted, true);
  assert.equal(f.sessions.authenticate(token), null);
});

test('logout revokes only one session and disconnect tracking is scoped', (t) => {
  const f = fixture(t);
  const a = f.sessions.exchange(f.issue().token);
  const b = f.sessions.exchange(f.issue().token);
  const workA = new AbortController(),
    workB = new AbortController(),
    completed = new AbortController();
  f.sessions.track(a, workA);
  f.sessions.track(b, workB);
  f.sessions.track(a, completed)();
  assert.equal(f.sessions.logout(a), true);
  assert.equal(f.sessions.logout(a), false);
  assert.equal(workA.signal.aborted, true);
  assert.equal(completed.signal.aborted, false);
  assert.equal(workB.signal.aborted, false);
  assert.equal(f.sessions.authenticate(b), 'synthetic-principal');
  assert.throws(
    () => f.sessions.track(a, new AbortController()),
    /Local UI session unavailable/,
  );
  f.sessions.close();
  assert.equal(workB.signal.aborted, true);
  assert.equal(f.sessions.authenticate(b), null);
});

test('bounded session capacity does not evict active authority or consume retryable bootstrap', (t) => {
  const f = fixture(t);
  const tokens = Array.from({ length: 32 }, () =>
    f.sessions.exchange(f.issue().token),
  );
  const waiting = f.issue();
  assert.throws(
    () => f.sessions.exchange(waiting.token),
    /Local UI session capacity/,
  );
  for (const token of tokens)
    assert.equal(f.sessions.authenticate(token), 'synthetic-principal');
  f.sessions.logout(tokens[0]);
  assert.ok(f.sessions.exchange(waiting.token));
});

test('restart invalidates sessions, export roots cannot overlap secrets or follow links', (t) => {
  const f = fixture(t);
  const old = f.sessions.exchange(f.issue().token);
  const next = new LocalUiSessions({
    principalId: 'synthetic-principal',
    exportRoot: f.exports,
    excludedRoots: [],
  });
  t.after(() => next.close());
  assert.equal(next.authenticate(old), null);
  for (const exportRoot of [
    f.root,
    path.join(f.root, 'identity'),
    path.join(f.root, 'identity', 'exports'),
  ]) {
    const unsafe = new LocalUiSessions({
      principalId: 'synthetic-principal',
      exportRoot,
      excludedRoots: [path.join(f.root, 'identity')],
    });
    t.after(() => unsafe.close());
    assert.throws(() => unsafe.issue(), /Local UI session unavailable/);
  }
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.exports, alias);
  const linked = new LocalUiSessions({
    principalId: 'synthetic-principal',
    exportRoot: alias,
    excludedRoots: [],
  });
  t.after(() => linked.close());
  assert.throws(() => linked.issue(), /Local UI session unavailable/);
});

test('an early timer cannot disable active expiry or expire a session early', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const token = f.sessions.exchange(f.issue().token);
  const work = new AbortController();
  f.sessions.track(token, work);
  f.setNow(8 * 60 * 60 * 1000 - 0.5);
  t.mock.timers.tick(8 * 60 * 60 * 1000);
  assert.equal(work.signal.aborted, false);
  f.setNow(8 * 60 * 60 * 1000);
  t.mock.timers.tick(1);
  assert.equal(work.signal.aborted, true);
});

test('remaining browser lifetime decreases across reloads without extending server authority', (t) => {
  const f = fixture(t);
  const token = f.sessions.exchange(f.issue().token);
  assert.equal(f.sessions.remainingMilliseconds(token), 8 * 60 * 60 * 1000);
  f.setNow(12345);
  assert.equal(
    f.sessions.remainingMilliseconds(token),
    8 * 60 * 60 * 1000 - 12345,
  );
  f.setNow(8 * 60 * 60 * 1000);
  assert.equal(f.sessions.remainingMilliseconds(token), null);
});
