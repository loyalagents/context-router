import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export const PACKAGING_MILESTONES = Object.freeze([
  'context-prepared',
  'build-complete',
  'stage-sealed',
  'startup-probes-complete',
  'hosted-generation-1-complete',
  'hosted-generation-2-complete',
  'local-identity-complete',
  'local-database-complete',
  'local-model-complete',
  'local-mcp-complete',
  'local-ui-complete',
  'runtime-verified',
  'cleanup-started',
  'cleanup-complete',
  'finalization-complete',
  'failed',
]);

export const PACKAGING_TIMING_MAX_BYTES = 16_384;

export const PACKAGING_OPERATIONS = Object.freeze([
  'caller-snapshot', 'source-copy', 'dependency-clone', 'corepack-clone',
  'prisma-generate', 'backend-build', 'web-build', 'source-snapshot',
  'backend-deploy', 'local-ui-deploy', 'payload-copy', 'shared-file-exclusion',
  'native-inventory', 'stage-seal', 'stage-verify', 'source-verify', 'caller-verify',
]);

function parseOperationTimings(lines, unfinished, truncated) {
  const operations = [];
  let observed = unfinished.includes('packaging-smoke: operation');
  truncated ||= observed;
  let invalid = false;
  let terminal;
  let lastIndex = -1;
  for (const line of lines) {
    if (!line.includes('packaging-smoke: operation')) continue;
    observed = true;
    const marker = /^packaging-smoke: operations=(complete|partial)$/.exec(line);
    if (marker) {
      if (terminal) invalid = true;
      terminal = marker[1];
      continue;
    }
    const match = /^packaging-smoke: operation=([a-z0-9-]+) count=(0|[1-9][0-9]*) elapsedMs=(0|[1-9][0-9]*)$/.exec(line);
    const index = match ? PACKAGING_OPERATIONS.indexOf(match[1]) : -1;
    const count = match ? Number(match[2]) : NaN;
    const elapsedMs = match ? Number(match[3]) : NaN;
    if (terminal || index <= lastIndex || index < 0 || !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(elapsedMs) || (count === 0 && elapsedMs !== 0)) {
      invalid = true;
      continue;
    }
    lastIndex = index;
    operations.push({ operation: PACKAGING_OPERATIONS[index], count, elapsedMs });
  }
  if (!observed) return undefined;
  const complete = !truncated && !invalid && terminal === 'complete' &&
    operations.length === PACKAGING_OPERATIONS.length;
  return {
    schemaVersion: 1, availability: complete ? 'complete' : 'partial', operations,
    ...(!complete && { reason: truncated ? 'truncated' : invalid ? 'invalid-sequence' :
      terminal === 'partial' ? 'collection-failed' : 'incomplete-sequence' }),
  };
}

/** Project diagnostics only. Capture completeness never attests smoke success. */
export function parsePackagingTimings(input, { truncated = false } = {}) {
  truncated ||= input.length > PACKAGING_TIMING_MAX_BYTES;
  // Normalize runCommand's stream labels before inspecting milestone lines.
  const text = input.subarray(0, PACKAGING_TIMING_MAX_BYTES).toString('utf8')
    .replace(/\[(?:stdout|stderr)\] /g, '');
  const lines = text.split('\n');
  const unfinished = lines.pop();
  const milestones = [];
  const seen = new Set();
  let invalid = false;
  let earlyFailure = false;
  let lastIndex = -1;
  let lastElapsed = 0;
  if (unfinished.includes('milestone') && !unfinished.includes('packaging-smoke: operation')) truncated = true;
  for (const line of lines) {
    if (line.includes('packaging-smoke: operation')) continue;
    if (!line.includes('milestone')) continue;
    const match = /^packaging-smoke: milestone=([a-z0-9-]+) elapsedMs=(0|[1-9][0-9]*)$/.exec(line);
    const index = match ? PACKAGING_MILESTONES.indexOf(match[1]) : -1;
    const elapsedMs = match ? Number(match[2]) : NaN;
    if (index < 0 || seen.has(match[1]) || !Number.isSafeInteger(elapsedMs) ||
        elapsedMs < lastElapsed || (match[1] !== 'failed' && index <= lastIndex)) {
      invalid = true;
      continue;
    }
    const milestone = PACKAGING_MILESTONES[index];
    if (milestone === 'failed') earlyFailure ||= !seen.has('finalization-complete');
    else lastIndex = index;
    seen.add(milestone);
    lastElapsed = elapsedMs;
    milestones.push({ milestone, elapsedMs });
  }
  const complete = !truncated && !invalid && !earlyFailure &&
    PACKAGING_MILESTONES.every((name) => name === 'failed' || seen.has(name));
  const availability = complete ? 'complete' :
    (truncated || invalid || milestones.length) ? 'partial' : 'unavailable';
  const operationTimings = parseOperationTimings(lines, unfinished, truncated);
  return {
    schemaVersion: 1, availability, milestones,
    ...(!complete && { reason: truncated ? 'truncated' : invalid ? 'invalid-sequence' :
      earlyFailure ? 'failed-before-finalization' : milestones.length ? 'incomplete-sequence' : 'no-milestones' }),
    ...(operationTimings && { operationTimings }),
  };
}

/** Constant-size diagnostics. Counts settled attempts, including failed operations. */
export function createPackagingOperationTimer({
  now = () => performance.now(),
  write = (line) => writeSync(process.stdout.fd, line),
} = {}) {
  const totals = new Map(PACKAGING_OPERATIONS.map((name) => [name, { count: 0, elapsedMs: 0 }]));
  let failed = false;
  let finished = false;
  let active = 0;
  let lastNow = 0;
  const readClock = () => {
    try {
      const value = now();
      if (!Number.isFinite(value) || value < lastNow || value > Number.MAX_SAFE_INTEGER) {
        failed = true;
        return null;
      }
      lastNow = value;
      return value;
    } catch { failed = true; return null; }
  };
  readClock();
  return {
    async measure(name, operation) {
      const total = totals.get(name);
      if (!total || finished) failed = true;
      const startedAt = readClock();
      active++;
      try {
        return await operation();
      } finally {
        const endedAt = readClock();
        active--;
        if (total) {
          const count = total.count + 1;
          const elapsedMs = startedAt === null || endedAt === null ? null :
            total.elapsedMs + Math.floor(endedAt - startedAt);
          if (Number.isSafeInteger(count)) total.count = count;
          else failed = true;
          if (Number.isSafeInteger(elapsedMs) && elapsedMs >= 0) total.elapsedMs = elapsedMs;
          else failed = true;
        }
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      if (active) failed = true;
      for (const [name, { count, elapsedMs }] of totals) {
        try { write(`packaging-smoke: operation=${name} count=${count} elapsedMs=${elapsedMs}\n`); }
        catch { failed = true; }
      }
      try { write(`packaging-smoke: operations=${failed ? 'partial' : 'complete'}\n`); }
      catch { failed = true; }
    },
  };
}

/** Diagnostics only: at most sixteen bounded lines; never interrupt cleanup. */
export function createPackagingProgressReporter({
  now = () => performance.now(),
  // Tiny bounded diagnostics use the descriptor directly so pipe errors throw
  // inside the guard below instead of becoming asynchronous stream errors.
  write = (line) => writeSync(process.stdout.fd, line),
} = {}) {
  const startedAt = now();
  const seen = new Set();
  let lastElapsed = 0;
  return (milestone) => {
    if (!PACKAGING_MILESTONES.includes(milestone) || seen.has(milestone))
      return false;
    try {
      const elapsedMs = Math.floor(now() - startedAt);
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < lastElapsed)
        return false;
      lastElapsed = elapsedMs;
      seen.add(milestone);
      write(`packaging-smoke: milestone=${milestone} elapsedMs=${elapsedMs}\n`);
      return true;
    } catch {
      return false;
    }
  };
}
