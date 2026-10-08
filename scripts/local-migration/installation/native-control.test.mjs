import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { NativeProbeControl } from './native-control.mjs';

function owner() {
  const stdin = new EventEmitter();
  let writes = 0, ends = 0;
  stdin.write = () => { assert.equal(ends, 0); writes++; };
  stdin.end = () => { stdin.writableEnded = true; ends++; };
  return { stdin, writes: () => writes, ends: () => ends };
}
test('stop during asynchronous credential setup prevents native launch', async () => {
  let time = 0, launched = false;
  const control = new NativeProbeControl({ now: () => time });
  control.admitGeneration();
  await Promise.resolve().then(() => control.stop('interrupted'));
  assert.throws(() => { control.admitGeneration(); launched = true; }, /stopped/);
  assert.equal(launched, false);
});
test('memory failure aborts qualification and cannot write after control EOF', async () => {
  const control = new NativeProbeControl({ now: () => 0 });
  const child = owner(); control.attach(child);
  await Promise.resolve().then(() => control.stop('resource-bound'));
  assert.equal(control.signal.aborted, true);
  assert.throws(() => control.check(), /stopped/);
  assert.throws(() => control.sendRelease(), /stopped/);
  control.stop('again');
  assert.equal(child.writes(), 0); assert.equal(child.ends(), 1);
});
test('one monotonic deadline reserves cleanup and refuses a late new generation', () => {
  let time = 0;
  const control = new NativeProbeControl({ now: () => time });
  const child = owner(); control.attach(child);
  time = 200_000;
  assert.throws(() => control.admitGeneration(), /budget/);
  time = 339_999;
  assert.equal(control.activeBudget(20_000), 1);
  time = 340_000;
  assert.throws(() => control.check(), /stopped/);
  assert.equal(control.signal.aborted, true); assert.equal(child.ends(), 1);
  assert.equal(control.cleanupBudget(6000), 6000);
  time += 6000;
  assert.equal(control.cleanupBudget(12000), 12000);
  time = 360_000;
  assert.equal(control.cleanupBudget(12000), 0);
});
test('control stream failures stop admission and are handled without an uncaught error', () => {
  const control = new NativeProbeControl({ now: () => 0 });
  const child = owner(); control.attach(child);
  child.stdin.emit('error', new Error('closed'));
  assert.equal(control.signal.aborted, true);
  assert.throws(() => control.sendRelease(), /stopped/);
});
