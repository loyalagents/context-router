import { localMcpLifecycleResources } from './local-mcp-lifecycle.mjs';
export function localUiLifecycleResources(parent) {
  const records = localMcpLifecycleResources(parent).map((r) => ({
    ...r,
    id: r.id.replace('local-mcp-', 'local-ui-'),
    type: r.type.replace('local-mcp-', 'local-ui-'),
    identity: {
      ...r.identity,
      ...(r.id.startsWith('local-mcp-server-')
        ? {
            uiPort: r.identity.port + 10,
            listeners: [
              { port: r.identity.port, closed: true },
              { port: r.identity.port + 10, closed: true },
            ],
          }
        : {}),
    },
  }));
  for (const generation of [1, 2])
    records.push({
      id: `local-ui-browser-${generation}`,
      type: 'local-ui-browser-process',
      owned: true,
      status: 'acquired',
      acquiredAt: '2026-10-04T00:00:00.000Z',
      identity: {
        pid: 7500 + generation,
        generation,
        operation: 'browser',
        exitCode: 143,
        childSignal: null,
        groupGone: true,
        version: '153.0.8010.12',
        authenticated: true,
        authoritySeparated: true,
        sharedState: true,
        historyClear: generation === 1,
        restartSessionRejected: generation === 2,
        smartSearch: true,
        rawProtocolsClosed: true,
        pageRequestsConfined: true,
        nonceCsp: true,
      },
      recovery: {
        processGroupId: 7500 + generation,
        instruction:
          'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.',
      },
      cleanup: { status: 'exited', finishedAt: '2026-10-04T00:00:00.000Z' },
    });
  return records;
}
