import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureTiming } from './fixture-timing.mjs';

test('browser fixture timing emits one fixed redacted setup/body/cleanup record', () => {
  let clock = 10;
  const rows = [];
  const timer = createFixtureTiming({ enabled: true, model: true, now: () => clock, report: row => rows.push(row) });
  clock = 30; timer.setupComplete();
  clock = 90; timer.cleanupStarted();
  clock = 110; timer.finish();
  clock = 200; timer.finish();
  assert.deepEqual(rows, [{ type: 'context-router.browser-fixture-timing', version: 1, mode: 'model', setupMs: 20, bodyMs: 60, cleanupMs: 20 }]);
});

test('failed setup still records setup and cleanup without claiming a test body', () => {
  let clock = 0;
  const rows = [];
  const timer = createFixtureTiming({ enabled: true, demo: true, now: () => clock, report: row => rows.push(row) });
  clock = 20; timer.cleanupStarted();
  clock = 25; timer.finish();
  assert.deepEqual(rows, [{ type: 'context-router.browser-fixture-timing', version: 1, mode: 'demo', setupMs: 20, bodyMs: null, cleanupMs: 5 }]);
});

test('disabled timing and failed reporting cannot change fixture outcomes', () => {
  const disabled = createFixtureTiming({ enabled: false, now: () => { throw new Error('clock read'); }, report: () => { throw new Error('reported'); } });
  disabled.setupComplete(); disabled.cleanupStarted(); disabled.finish();
  const timer = createFixtureTiming({ enabled: true, model: true, demo: true, now: () => 0, report: () => { throw new Error('diagnostics unavailable'); } });
  timer.setupComplete(); timer.cleanupStarted();
  assert.doesNotThrow(() => timer.finish());
});
