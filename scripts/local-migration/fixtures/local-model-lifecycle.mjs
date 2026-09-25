import path from 'node:path';
import { MODEL_ROOT_RECOVERY } from '../local-model-smoke.mjs';
export function localModelLifecycleResources(parent) {
  const root = path.join(parent, 'local-model-00000000-0000-4000-8000-000000000001');
  const stamp = '2026-09-24T00:00:00.000Z';
  const record = (id, type, status, identity, recovery = {}) => ({ id, type, owned: true, status: 'acquired', acquiredAt: stamp,
    identity, recovery, cleanup: { status, finishedAt: stamp } });
  const resources = [record('local-model-state', 'local-model-private-state', 'removed', {
    root, generations: 2, parserChildren: 6, identityStable: true, freshCredentials: true, copiedLayoutParsed: true, missingWorkerRejected: true,
  }, { root, instruction: MODEL_ROOT_RECOVERY })];
  let pid = 6200;
  const child = (id, role, operation, extra = {}, exitCode = 0) => {
    const value = record(id, `local-model-${role}-process`, 'exited', { pid: ++pid, operation, exitCode, childSignal: null, groupGone: true, ...extra },
      { processGroupId: pid, instruction: 'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.' });
    resources.push(value); return value.identity.pid;
  };
  child('local-model-admin-1', 'admin', 'initialize');
  for (const generation of [1, 2]) {
    resources.push(record(`local-model-fixture-${generation}`, 'local-model-fixture-server', 'closed', {
      root: path.join(root, `session-${generation}`), generation, pid: 6000, port: 18000 + generation, completions: 3, denied: 8, closed: true, previewRequests: 0, pdfSeen: true, certificateSha256: String(generation).repeat(64),
    }, { root, instruction: MODEL_ROOT_RECOVERY }));
    child(`local-model-preview-${generation}`, 'preview', 'preview-model', { listenerCount: 0, requestedSignal: generation === 1 ? 'SIGTERM' : 'SIGINT' }, generation === 1 ? 143 : 130);
    const ownerPid = child(`local-model-probe-${generation}`, 'probe', 'probe', { controls: 46, connections: 20, copiedLayoutParsed: true, missingWorkerRejected: true, identityDigest: 'a'.repeat(64), sqliteThreads: [{ threadId: 1, controls: 46, code: 0, exited: true }] });
    for (const ordinal of [1, 2, 3]) resources.push(record(`local-model-parser-${generation}-${ordinal}`, 'local-model-parser-process', 'exited', {
      generation, ordinal, owner: `local-model-probe-${generation}`, pid: ++pid, ownerPid, code: 0, signal: null, closed: true,
    }, 'Parser belongs to the recorded probe process group; reap that exact group before root cleanup.'));
  }
  return resources;
}
