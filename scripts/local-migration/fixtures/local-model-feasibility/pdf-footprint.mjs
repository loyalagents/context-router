import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parsePdfReply } from './pdf-process.mjs';

const fail = () => new Error('PDF footprint measurement failed');
const memoryKeys = ['lifetimePeakPhysicalFootprintBytes', 'physicalFootprintBytes', 'pressure', 'residentBytes', 'swapUsedBytes'];
export async function measurePdfFootprint({ workerPath, bytes, sandboxProfile, sample }) {
  if (!isAbsolute(workerPath) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024 || typeof sample !== 'function') throw fail();
  const started = performance.now(); const end = started + 10000;
  let root; let child; let closed = false; let failed = false; let timer; let reapTimer; let phase = 'waiting'; let result;
  let resolveExit; const exited = new Promise((resolve) => { resolveExit = resolve; });
  const stop = () => {
    failed = true;
    if (!child || closed) return;
    child.stdin.destroy();
    try { child.kill('SIGKILL'); } catch { /* Exact owned handle only. */ }
    if (!reapTimer) reapTimer = setTimeout(() => resolveExit(null), Math.max(0, Math.min(1000, end - performance.now())));
  };
  try {
    root = await mkdtemp(join(tmpdir(), 'step06-pdf-footprint-'));
    const wrapper = join(root, 'wrapper.mjs');
    await copyFile(new URL('./pdf-footprint-wrapper.mjs', import.meta.url), wrapper);
    if (performance.now() >= end - 1000) throw fail();
    const args = ['--no-global-search-paths', '--max-old-space-size=256', '--unhandled-rejections=strict', wrapper, workerPath];
    child = spawn(sandboxProfile ? '/usr/bin/sandbox-exec' : process.execPath,
      sandboxProfile ? ['-p', sandboxProfile, process.execPath, ...args] : args,
      { cwd: root, env: { PATH: '/usr/bin:/bin', TMPDIR: root, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const control = child.stdio[3]; const output = []; let outputBytes = 0; let diagnosticBytes = 0; let memory;
    for (const stream of [child.stdin, child.stdout, child.stderr, control]) stream.on('error', stop);
    child.once('error', stop);
    child.once('close', (code, signal) => { closed = true; clearTimeout(timer); clearTimeout(reapTimer); resolveExit({ code, signal }); });
    child.stdout.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes > 128 * 1024 + 1024) stop(); else if (!failed) output.push(chunk); });
    child.stderr.on('data', (chunk) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 64 * 1024) stop(); });
    control.on('data', (chunk) => {
      if (failed) return;
      try {
        if (chunk.length !== 1) throw fail();
        if (phase === 'waiting' && chunk[0] === 1) {
          const budget = Math.min(500, end - 1000 - performance.now());
          if (budget <= 0) throw fail();
          const observed = sample(child.pid, budget);
          if (!observed || Object.keys(observed).sort().join() !== memoryKeys.join() ||
              memoryKeys.some((key) => !Number.isSafeInteger(observed[key]) || observed[key] < 0) ||
              observed.pressure !== 1 || observed.lifetimePeakPhysicalFootprintBytes < observed.physicalFootprintBytes ||
              performance.now() >= end - 1000) throw fail();
          memory = Object.fromEntries(memoryKeys.map((key) => [key, observed[key]]));
          phase = 'sampled'; control.write(Buffer.from([2]), (error) => { if (error) stop(); });
        } else if (phase === 'sampled' && chunk[0] === 3) phase = 'acknowledged';
        else throw fail();
      } catch { stop(); }
    });
    control.once('end', () => { if (phase !== 'acknowledged') stop(); });
    child.once('spawn', () => {
      if (performance.now() >= end - 1000) stop();
      if (!failed) child.stdin.end(bytes);
    });
    timer = setTimeout(stop, Math.max(0, end - 1000 - performance.now()));
    const outcome = await exited;
    if (!closed || !outcome || outcome.code !== 0 || outcome.signal !== null || failed || phase !== 'acknowledged') throw fail();
    const response = parsePdfReply(Buffer.concat(output));
    result = { memory, output: { bytes: response.bytes, pages: response.pages, items: response.items,
      textSha256: createHash('sha256').update(response.text).digest('hex'), canvasPresent: false },
    postSampleAcknowledged: true, ownedChildStoppedAndReaped: true, elapsedMs: performance.now() - started,
    includesWrapperOverhead: true, excludesPostSampleTeardownAllocations: true };
  } catch { failed = true; }
  finally {
    if (child && !closed) { stop(); await exited; }
    clearTimeout(timer); clearTimeout(reapTimer);
    if (!child || closed) { try { if (root) await rm(root, { recursive: true, force: true }); } catch { failed = true; } }
  }
  if (failed || !result || performance.now() >= end) {
    const error = fail(); error.cleanupConfirmed = !child || closed; throw error;
  }
  return { ...result, elapsedMs: performance.now() - started, ownedRootRemoved: true };
}
