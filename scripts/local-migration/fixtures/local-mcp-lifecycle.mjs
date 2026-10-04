import path from 'node:path';
export function localMcpLifecycleResources(parent) {
  const root = path.join(
    parent,
    'local-mcp-00000000-0000-4000-8000-000000000001',
  );
  const stamp = '2026-09-29T00:00:00.000Z';
  const record = (id, type, status, identity, recovery = {}) => ({
    id,
    type,
    owned: true,
    status: 'acquired',
    acquiredAt: stamp,
    identity,
    recovery,
    cleanup: { status, finishedAt: stamp },
  });
  const resources = [
    record(
      'local-mcp-state',
      'local-mcp-private-state',
      'removed',
      {
        root,
        generations: 2,
        identityStable: true,
        persisted: true,
        revocationDurable: true,
      },
      {
        root,
        instruction:
          'Reap recorded MCP process groups and close owned fixture listeners before removing only this private root.',
      },
    ),
  ];
  let pid = 7200;
  for (const operation of ['initialize', 'setup', 'revoke', 'recovery'])
    resources.push(
      record(
        `local-mcp-${operation}`,
        'local-mcp-admin-process',
        'exited',
        {
          pid: ++pid,
          operation,
          exitCode: 0,
          childSignal: null,
          groupGone: true,
          ...(operation === 'recovery'
            ? {
                v1Restored: true,
                v2Restored: true,
                identityPreserved: true,
                authorityPreserved: true,
                dataPreserved: true,
                controls: 42,
                sqliteThreads: [1, 2, 3, 4].map((threadId) => ({
                  threadId,
                  controls: 42,
                  exited: true,
                  code: 0,
                })),
              }
            : {}),
        },
        {
          processGroupId: pid,
          instruction:
            'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.',
        },
      ),
    );
  for (const generation of [1, 2]) {
    resources.push(
      record(
        `local-mcp-peer-${generation}`,
        'local-mcp-fixture-server',
        'closed',
        {
          pid: 7000,
          port: 28000 + generation,
          generation,
          certificateSha256: String(generation).repeat(64),
          completions: 1,
          closed: true,
        },
      ),
    );
    resources.push(
      record(
        `local-mcp-server-${generation}`,
        'local-mcp-server-process',
        'exited',
        {
          pid: ++pid,
          operation: 'serve-model',
          exitCode: generation === 1 ? 143 : 130,
          childSignal: null,
          groupGone: true,
          port: 29000 + generation,
          controls: 42,
          connections: 10,
          listenersClosed: true,
          sqliteThreads: [{ threadId: 1, controls: 42, exited: true, code: 0 }],
        },
        {
          processGroupId: pid,
          instruction:
            'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.',
        },
      ),
    );
  }
  return resources;
}
