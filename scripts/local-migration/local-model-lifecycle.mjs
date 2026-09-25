import path from 'node:path';
import { MODEL_ROOT_RECOVERY } from './local-model-smoke.mjs';
export function assertLocalModelSmokeSuccessResources(state, label) {
  const fail = () => { throw new Error(`${label} requires complete model lifecycle evidence`); };
  const keys = (value, expected) => value && typeof value === 'object' && Object.keys(value).sort().join() === [...expected].sort().join();
  const resources = state.resources.filter((r) => r.id?.startsWith('local-model-') || r.type?.startsWith('local-model-'));
  const expected = ['local-model-state', 'local-model-admin-1', ...[1, 2].flatMap((g) =>
    [`local-model-fixture-${g}`, `local-model-preview-${g}`, `local-model-probe-${g}`, `local-model-parser-${g}-1`, `local-model-parser-${g}-2`])];
  if (resources.length !== expected.length || new Set(resources.map((r) => r.id)).size !== expected.length) fail();
  const get = (id, type, status) => {
    const r = resources.find((r) => r.id === id);
    if (!r || r.owned !== true || r.type !== type || r.cleanup?.status !== status) fail();
    return r;
  };
  const root = get('local-model-state', 'local-model-private-state', 'removed');
  if (!keys(root.identity, ['root', 'generations', 'parserChildren', 'identityStable', 'freshCredentials', 'missingWorkerRejected']) ||
      !keys(root.recovery, ['root', 'instruction']) || !/^local-model-[0-9a-f-]{36}$/u.test(path.basename(root.identity.root)) ||
      !path.isAbsolute(root.identity.root) || root.recovery?.root !== root.identity.root || root.recovery?.instruction !== MODEL_ROOT_RECOVERY ||
      root.identity.generations !== 2 || root.identity.parserChildren !== 4 || root.identity.identityStable !== true ||
      root.identity.freshCredentials !== true || root.identity.missingWorkerRejected !== true) fail();
  for (const id of expected.filter((id) => /(?:admin|preview|probe)-/u.test(id))) {
    const role = id.split('-')[2], r = get(id, `local-model-${role}-process`, 'exited'), v = r.identity;
    const code = id === 'local-model-preview-1' ? 143 : id === 'local-model-preview-2' ? 130 : 0;
    if (!keys(v, ['pid', 'operation', 'exitCode', 'childSignal', 'groupGone', ...(role === 'preview' ? ['listenerCount', 'requestedSignal'] : role === 'probe' ? ['controls', 'connections', 'missingWorkerRejected', 'identityDigest'] : [])]) ||
        v.operation !== (role === 'admin' ? 'initialize' : role === 'probe' ? 'probe' : 'preview-model') ||
        !keys(r.recovery, ['processGroupId', 'instruction']) ||
        r.recovery.instruction !== 'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.' ||
        !Number.isSafeInteger(v.pid) || v.pid < 1 || v.exitCode !== code || v.childSignal !== null || v.groupGone !== true || r.recovery?.processGroupId !== v.pid) fail();
    if (role === 'probe' && (v.controls !== 34 || !Number.isSafeInteger(v.connections) || v.connections < 1 || v.connections > 64 || v.missingWorkerRejected !== true || !/^[a-f0-9]{64}$/u.test(v.identityDigest))) fail();
    if (role === 'preview' && (v.operation !== 'preview-model' || v.listenerCount !== 0 || v.requestedSignal !== (code === 143 ? 'SIGTERM' : 'SIGINT'))) fail();
  }
  const pids = resources.filter((r) => r.type.endsWith('-process')).map((r) => r.identity.pid);
  if (new Set(pids).size !== pids.length) fail();
  if (resources.find((r) => r.id === 'local-model-fixture-1').identity.certificateSha256 === resources.find((r) => r.id === 'local-model-fixture-2').identity.certificateSha256 ||
      resources.find((r) => r.id === 'local-model-probe-1').identity.identityDigest !== resources.find((r) => r.id === 'local-model-probe-2').identity.identityDigest) fail();
  for (const g of [1, 2]) {
    const v = get(`local-model-fixture-${g}`, 'local-model-fixture-server', 'closed').identity;
    if (!keys(v, ['root', 'generation', 'pid', 'port', 'completions', 'denied', 'closed', 'previewRequests', 'pdfSeen', 'certificateSha256']) ||
        v.previewRequests !== 0 || v.pdfSeen !== true || !/^[a-f0-9]{64}$/u.test(v.certificateSha256) || v.root !== path.join(root.identity.root, `session-${g}`) || !Number.isSafeInteger(v.pid) || v.pid < 1 || v.generation !== g || !Number.isSafeInteger(v.port) || v.port < 1 || v.port > 65535 || v.completions !== 3 || v.denied !== 8 || v.closed !== true) fail();
    const owner = get(`local-model-probe-${g}`, 'local-model-probe-process', 'exited').identity;
    for (const i of [1, 2]) {
      const p = get(`local-model-parser-${g}-${i}`, 'local-model-parser-process', 'exited').identity;
      if (!keys(p, ['generation', 'ordinal', 'owner', 'pid', 'ownerPid', 'code', 'signal', 'closed']) ||
          p.owner !== `local-model-probe-${g}` || !Number.isSafeInteger(p.pid) || p.pid < 1 || p.ownerPid !== owner.pid || p.generation !== g || p.ordinal !== i || p.code !== 0 || p.signal !== null || p.closed !== true) fail();
    }
  }
}
