import { setTimeout as delay } from 'node:timers/promises';
import { runtimeArgs, vacantPort } from './native.mjs';
import { createTlsFixture } from './tls-fixture.mjs';
import { spawnOwned } from './process.mjs';
import { AllocationProjection } from './allocation-projection.mjs';
import { probeJson } from './client.mjs';

const failed = () => new Error('Startup allocation capture failed');
export function allocationArgs(configuration) {
  const args = runtimeArgs(configuration);
  args[args.indexOf('--log-verbosity') + 1] = '4';
  return args;
}

/** CP1 startup-only diagnostic. Raw trace output never reaches a file or caller. */
export async function runAllocationStartup({ binary, model, logPath, sandboxProfile }) {
  const started = performance.now(); const until = started + 120000;
  let credentials; let child; let readyMs; let healthRequests = 0;
  try {
    credentials = await createTlsFixture();
    const port = await vacantPort();
    const args = allocationArgs({ model, port, ...credentials });
    child = await spawnOwned({ command: sandboxProfile ? '/usr/bin/sandbox-exec' : binary,
      args: sandboxProfile ? ['-p', sandboxProfile.replaceAll('PORT', String(port)), binary, ...args] : args,
      cwd: credentials.root, logPath, projection: new AllocationProjection() });
    while (performance.now() < until && child.running && !child.logOverflow) {
      try {
        healthRequests++;
        await probeJson({ port, certificate: credentials.cert }, '/health', undefined,
          { key: null, timeoutMs: Math.min(1000, until - performance.now()) });
        readyMs = performance.now() - started;
        break;
      } catch { await delay(Math.max(0, Math.min(200, until - performance.now()))); }
    }
    if (readyMs === undefined || performance.now() >= until || !child.running || child.logOverflow) throw failed();
    const outcome = await child.stop();
    if (child.running || child.logOverflow || (outcome.code !== 0 && outcome.signal !== 'SIGTERM')) throw failed();
    const allocation = child.projectionResult;
    return { allocation, startupReadyMs: readyMs, publicHealthRequests: healthRequests,
      protectedRequests: 0, clientInferenceRequests: 0, ownedChildStoppedAndReaped: true,
      diagnosticVerbosity: 4, supportedWorkloadVerbosity: 3, nativeStartupWarmup: true };
  } catch { throw failed(); }
  finally {
    try {
      if (child) { await child.stop(); if (child.running) throw failed(); }
      await credentials?.remove();
    } catch { throw failed(); }
  }
}
