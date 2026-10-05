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
