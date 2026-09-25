import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnOwned } from './fixtures/local-model-feasibility/process.mjs';

test('owns a bounded child handle and awaits exit before caller root cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-owned-test-'));
  let child;
  try {
    child = await spawnOwned({ command: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'],
      cwd: root, logPath: join(root, 'runtime.log') });
    await child.waitForLog('ready', 1000);
    assert.equal(child.running, true);
    const outcome = await child.stop({ graceMs: 100 });
    assert.equal(child.running, false);
    assert.ok(outcome.code !== null || outcome.signal !== null);
    assert.deepEqual(await child.stop(), outcome);
  } finally { await child?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('escalates only the owned unresponsive child and bounds captured diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-owned-test-'));
  let child;
  try {
    child = await spawnOwned({ command: process.execPath,
      args: ['-e', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'],
      cwd: root, logPath: join(root, 'runtime.log') });
    await child.waitForLog('ready', 1000);
    const result = await child.stop({ graceMs: 30 });
    assert.equal(result.signal, 'SIGKILL');
    child = await spawnOwned({ command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'],
      cwd: root, logPath: join(root, 'overflow.log'), logLimit: 128 });
    await child.exited;
    assert.equal(child.logOverflow, true);
    assert.ok((await readFile(join(root, 'overflow.log'))).length <= 128);
  } finally { await child?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('spawn failure is bounded and does not claim an unrelated process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-owned-test-'));
  try {
    await assert.rejects(spawnOwned({ command: join(root, 'missing'), args: [], cwd: root,
      logPath: join(root, 'runtime.log') }), /Owned probe process failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('diagnostic overflow reaps even a child that ignores graceful termination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-owned-test-'));
  let child;
  try {
    child = await spawnOwned({ command: process.execPath,
      args: ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'],
      cwd: root, logPath: join(root, 'overflow.log'), logLimit: 128, overflowGraceMs: 30 });
    const result = await Promise.race([child.exited, new Promise((resolve) => setTimeout(() => resolve(null), 200))]);
    assert.equal(result?.signal, 'SIGKILL');
    assert.equal(child.logOverflow, true);
  } finally { await child?.stop({ graceMs: 30 }); await rm(root, { recursive: true, force: true }); }
});

test('projects before any persistence and validates only after both streams end and child reaping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-projected-test-')); let child;
  const events = [];
  const projection = {
    push(name, chunk) { events.push(`data:${name}`); return Buffer.from(JSON.stringify({ bytes: chunk.length }) + '\n'); },
    end(name) { events.push(`end:${name}`); },
    finish() { assert.ok(events.includes('end:stdout') && events.includes('end:stderr')); events.push('finish'); return { complete: true }; },
  };
  try {
    child = await spawnOwned({ command: process.execPath,
      args: ['-e', 'process.on("SIGTERM",()=>{process.stderr.write("late SECRET_PATH\\n");process.exit(0)});console.log("SECRET_TAIL");setInterval(()=>{},1000)'],
      cwd: root, logPath: join(root, 'numbers.jsonl'), projection });
    await child.waitForLog('bytes', 1000);
    assert.throws(() => child.projectionResult, /Owned probe process failed/);
    await child.stop();
    assert.equal(child.running, false);
    assert.deepEqual(child.projectionResult, { complete: true });
    assert.equal(events.at(-1), 'finish');
    assert.ok(events.includes('data:stderr'));
    const content = await readFile(join(root, 'numbers.jsonl'), 'utf8');
    assert.ok(!content.includes('SECRET'));
    assert.ok(content.trim().split('\n').every((line) => Number.isInteger(JSON.parse(line).bytes)));
  } finally { await child?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('projection exceptions and shutdown failures never fall back to raw diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-projected-test-'));
  try {
    for (const phase of ['push', 'end', 'finish']) {
      const projection = { push() { return Buffer.from('{"fixed":true}\n'); }, end() {}, finish() { return {}; } };
      projection[phase] = () => { throw new Error('SECRET_EXCEPTION'); };
      const path = join(root, `${phase}.jsonl`);
      const child = await spawnOwned({ command: process.execPath,
        args: ['-e', 'process.stdout.write("SECRET_RAW\\n");process.stderr.write("SECRET_PATH\\n")'],
        cwd: root, logPath: path, projection, overflowGraceMs: 30 });
      try {
        await child.exited;
        assert.equal(child.logOverflow, true);
        assert.equal(child.running, false);
        assert.throws(() => child.projectionResult, /^Error: Owned probe process failed$/);
        assert.ok(!(await readFile(path, 'utf8')).includes('SECRET'));
      } finally { await child.stop({ graceMs: 30 }); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
