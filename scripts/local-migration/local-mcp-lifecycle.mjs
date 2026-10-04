import path from 'node:path';
import { MCP_ROOT_RECOVERY } from './local-mcp-smoke.mjs';
export function assertLocalMcpSmokeSuccessResources(state, label) {
  const fail = () => {
    throw new Error(`${label} requires complete MCP lifecycle evidence`);
  };
  const keys = (v, expected) =>
    v &&
    typeof v === 'object' &&
    Object.keys(v).sort().join() === expected.split(',').sort().join();
  const resources = state.resources.filter(
    (r) => r.id?.startsWith('local-mcp-') || r.type?.startsWith('local-mcp-'),
  );
  const expected = [
    'local-mcp-state',
    'local-mcp-initialize',
    'local-mcp-setup',
    'local-mcp-revoke',
    'local-mcp-recovery',
    'local-mcp-server-1',
    'local-mcp-server-2',
    'local-mcp-peer-1',
    'local-mcp-peer-2',
  ];
  if (
    resources.length !== expected.length ||
    new Set(resources.map((r) => r.id)).size !== expected.length
  )
    fail();
  const get = (id, type, status) => {
    const r = resources.find((r) => r.id === id);
    if (
      !r ||
      r.owned !== true ||
      r.type !== type ||
      r.cleanup?.status !== status
    )
      fail();
    return r;
  };
  const root = get('local-mcp-state', 'local-mcp-private-state', 'removed');
  if (
    !keys(
      root.identity,
      'root,generations,identityStable,persisted,revocationDurable',
    ) ||
    !keys(root.recovery, 'root,instruction') ||
    !path.isAbsolute(root.identity.root) ||
    !/^local-mcp-[0-9a-f-]{36}$/u.test(path.basename(root.identity.root)) ||
    root.recovery.root !== root.identity.root ||
    root.recovery.instruction !== MCP_ROOT_RECOVERY ||
    root.identity.generations !== 2 ||
    root.identity.identityStable !== true ||
    root.identity.persisted !== true ||
    root.identity.revocationDurable !== true
  )
    fail();
  const pids = [];
  for (const id of expected.filter((id) =>
    /(?:initialize|setup|revoke|recovery|server-\d)$/u.test(id),
  )) {
    const server = id.includes('-server-'),
      generation = id.endsWith('-1') ? 1 : 2;
    const r = get(
        id,
        server ? 'local-mcp-server-process' : 'local-mcp-admin-process',
        'exited',
      ),
      v = r.identity;
    if (
      !keys(
        v,
        `pid,operation,exitCode,childSignal,groupGone${server ? ',port,controls,connections,listenersClosed,sqliteThreads' : id === 'local-mcp-recovery' ? ',v1Restored,v2Restored,identityPreserved,authorityPreserved,dataPreserved,controls,sqliteThreads' : ''}`,
      ) ||
      v.operation !== (server ? 'serve-model' : id.split('-')[2]) ||
      !Number.isSafeInteger(v.pid) ||
      v.pid < 1 ||
      v.exitCode !== (server ? (generation === 1 ? 143 : 130) : 0) ||
      v.childSignal !== null ||
      v.groupGone !== true ||
      !keys(r.recovery, 'processGroupId,instruction') ||
      r.recovery.processGroupId !== v.pid ||
      r.recovery.instruction !==
        'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.'
    )
      fail();
    pids.push(v.pid);
    if (
      id === 'local-mcp-recovery' &&
      (v.v1Restored !== true ||
        v.v2Restored !== true ||
        v.identityPreserved !== true ||
        v.authorityPreserved !== true ||
        v.dataPreserved !== true ||
        v.controls !== 42 ||
        !Array.isArray(v.sqliteThreads) ||
        v.sqliteThreads.length !== 4 ||
        v.sqliteThreads.some(
          (t) =>
            !keys(t, 'threadId,controls,code,exited') ||
            !Number.isSafeInteger(t.threadId) ||
            t.threadId < 1 ||
            t.controls !== 42 ||
            t.code !== 0 ||
            t.exited !== true,
        ) ||
        new Set(v.sqliteThreads.map((t) => t.threadId)).size !==
          v.sqliteThreads.length)
    )
      fail();
    if (
      server &&
      (!Number.isSafeInteger(v.port) ||
        v.port < 1 ||
        v.port > 65535 ||
        v.controls !== 42 ||
        v.listenersClosed !== true ||
        !Number.isSafeInteger(v.connections) ||
        v.connections < 1 ||
        v.connections > 64 ||
        !Array.isArray(v.sqliteThreads) ||
        !v.sqliteThreads.length ||
        v.sqliteThreads.length > 8 ||
        v.sqliteThreads.some(
          (t) =>
            !keys(t, 'threadId,controls,code,exited') ||
            !Number.isSafeInteger(t.threadId) ||
            t.threadId < 1 ||
            t.controls !== 42 ||
            t.code !== 0 ||
            t.exited !== true,
        ) ||
        new Set(v.sqliteThreads.map((t) => t.threadId)).size !==
          v.sqliteThreads.length)
    )
      fail();
  }
  if (new Set(pids).size !== pids.length) fail();
  const certificates = [];
  for (const generation of [1, 2]) {
    const v = get(
      `local-mcp-peer-${generation}`,
      'local-mcp-fixture-server',
      'closed',
    ).identity;
    if (
      !keys(v, 'pid,port,generation,certificateSha256,completions,closed') ||
      !Number.isSafeInteger(v.pid) ||
      v.pid < 1 ||
      !Number.isSafeInteger(v.port) ||
      v.port < 1 ||
      v.port > 65535 ||
      v.generation !== generation ||
      !/^[a-f0-9]{64}$/u.test(v.certificateSha256) ||
      v.completions !== 1 ||
      v.closed !== true
    )
      fail();
    certificates.push(v.certificateSha256);
  }
  if (new Set(certificates).size !== 2) fail();
}
