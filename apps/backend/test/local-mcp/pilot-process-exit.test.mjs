import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { observePilotProcessExit } from '../../../../scripts/local-migration/installation/pilot-process-exit.mjs';

test('pilot observer handles asynchronous spawn failure before anyone awaits exit', async () => {
  const child = spawn('/context-router-qualification-absent-executable', [], { stdio: 'pipe' });
  const observation = observePilotProcessExit(child);
  // Waiting here must not turn the child error into an unhandled rejection.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observation.spawnFailed, true);
  assert.deepEqual(await observation.ended, { code: null, signal: null, spawnFailed: true });
});

test('pilot observer retains sanitized error evidence and normal/signal exit distinctions', async () => {
  for (const [code, signal] of [[0, null], [1, null], [null, 'SIGTERM']]) {
    const child = new EventEmitter(), observation = observePilotProcessExit(child);
    child.emit('close', code, signal);
    assert.deepEqual(await observation.ended, { code, signal, spawnFailed: false });
  }
  const child = new EventEmitter(), observation = observePilotProcessExit(child);
  child.emit('error', new Error('SENTINEL_PRIVATE_PROCESS_DIAGNOSTIC'));
  child.emit('close', -1, null);
  assert.equal(JSON.stringify(await observation.ended).includes('SENTINEL'), false);
  assert.equal(observation.spawnFailed, true);
});
