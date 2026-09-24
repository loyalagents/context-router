import { spawn } from 'node:child_process';
import { openSync, writeSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const failed = () => new Error('Owned probe process failed');

/** Retains the exact child handle; no PID lookup, process-name matching or foreign cleanup. */
export async function spawnOwned({ command, args, cwd, logPath, logLimit = 512 * 1024, overflowGraceMs = 3000 }) {
  const descriptor = openSync(logPath, 'wx', 0o600);
  const child = spawn(command, args, { cwd, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin',
    TMPDIR: cwd, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false; let outcome; let captured = ''; let bytes = 0; let overflow = false;
  let stopPromise;
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closed = true; outcome = { code, signal }; closeSync(descriptor); resolve(outcome);
    });
  });
  const capture = (chunk) => {
    if (closed) return;
    const remaining = Math.max(0, logLimit - bytes);
    if (remaining > 0) {
      const bounded = chunk.subarray(0, remaining);
      try { writeSync(descriptor, bounded); }
      catch { overflow = true; void api.stop({ graceMs: overflowGraceMs }).catch(() => {}); }
      captured += bounded.toString('utf8'); bytes += bounded.length;
    }
    if (chunk.length > remaining) { overflow = true; void api.stop({ graceMs: overflowGraceMs }).catch(() => {}); }
  };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(failed())); });
  } catch {
    await exited;
    throw failed();
  }
  const api = {
    pid: child.pid,
    exited,
    get running() { return !closed && child.exitCode === null && child.signalCode === null; },
    get logOverflow() { return overflow; },
    async waitForLog(marker, timeoutMs) {
      const until = performance.now() + timeoutMs;
      while (!captured.includes(marker)) {
        if (closed || performance.now() >= until) throw failed();
        await delay(10);
      }
    },
    stop({ graceMs = 3000 } = {}) {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (closed) return outcome;
        if (api.running) child.kill('SIGTERM');
        const stopped = await Promise.race([exited.then(() => true), delay(graceMs, undefined, { ref: false }).then(() => false)]);
        if (!stopped && api.running) child.kill('SIGKILL');
        const reaped = await Promise.race([exited.then(() => true), delay(3000, undefined, { ref: false }).then(() => false)]);
        if (!reaped) throw failed();
        return outcome;
      })();
      return stopPromise;
    },
  };
  return api;
}
