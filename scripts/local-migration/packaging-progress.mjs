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
  if (unfinished.includes('milestone')) truncated = true;
  for (const line of lines) {
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
  return {
    schemaVersion: 1, availability, milestones,
    ...(!complete && { reason: truncated ? 'truncated' : invalid ? 'invalid-sequence' :
      earlyFailure ? 'failed-before-finalization' : milestones.length ? 'incomplete-sequence' : 'no-milestones' }),
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
