import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('egress denial handles direct and normalized Node socket argument shapes before connection', () => {
  let connected = 0;
  class Socket {
    connect() {
      connected++;
    }
  }
  const dns = { lookup() {} };
  vm.runInNewContext(
    fs.readFileSync(new URL('./deny-egress.cjs', import.meta.url), 'utf8'),
    {
      require: (id) => (id === 'node:net' ? { Socket } : dns),
      process: { stderr: { write() {} } },
    },
  );
  for (const args of [
    [443, '203.0.113.1'],
    [{ port: 443, host: '203.0.113.1' }],
    [[{ port: 443, host: '203.0.113.1' }, () => {}]],
  ]) {
    assert.throws(() => new Socket().connect(...args), /forbids/);
  }
  assert.equal(connected, 0);
  new Socket().connect([{ port: 1234, host: '127.0.0.1' }, () => {}]);
  assert.equal(connected, 1);
});
