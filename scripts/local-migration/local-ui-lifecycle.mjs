import { assertLocalMcpSmokeSuccessResources } from './local-mcp-lifecycle.mjs';
import path from 'node:path';
export function assertLocalUiSmokeSuccessResources(state, label) {
  const fail = () => {
    throw new Error(
      `${label} requires complete authenticated local UI lifecycle evidence`,
    );
  };
  const all = state.resources.filter(
    (r) => r.id?.startsWith('local-ui-') || r.type?.startsWith('local-ui-'),
  );
  const browsers = all.filter((r) => /^local-ui-browser-[12]$/.test(r.id));
  if (all.length !== 11 || browsers.length !== 2) fail();
  const mapped = all
    .filter((r) => !browsers.includes(r))
    .map((r) => {
      const { uiPort, listeners, ...identity } = r.identity;
      if (r.id.startsWith('local-ui-server-')) {
        if (
          !Number.isSafeInteger(uiPort) ||
          uiPort < 1 ||
          uiPort > 65535 ||
          uiPort === identity.port ||
          !Array.isArray(listeners) ||
          listeners.length !== 2 ||
          listeners.some(
            (v) =>
              Object.keys(v).sort().join() !== 'closed,port' ||
              v.closed !== true,
          ) ||
          JSON.stringify(listeners.map((v) => v.port).sort()) !==
            JSON.stringify([uiPort, identity.port].sort())
        )
          fail();
      } else if (uiPort !== undefined || listeners !== undefined) fail();
      return {
        ...r,
        id: r.id.replace('local-ui-', 'local-mcp-'),
        type: r.type.replace('local-ui-', 'local-mcp-'),
        identity,
      };
    });
  assertLocalMcpSmokeSuccessResources({ resources: mapped }, label);
  const pids = new Set(mapped.map((r) => r.identity.pid).filter(Boolean));
  for (const generation of [1, 2]) {
    const r = browsers.find((r) => r.id === `local-ui-browser-${generation}`),
      v = r?.identity;
    if (
      !v ||
      r.owned !== true ||
      r.type !== 'local-ui-browser-process' ||
      r.cleanup?.status !== 'exited' ||
      Object.keys(v).sort().join() !==
        'authenticated,authoritySeparated,childSignal,exitCode,generation,groupGone,historyClear,nonceCsp,operation,pageRequestsConfined,pid,rawProtocolsClosed,restartSessionRejected,sharedState,smartSearch,temporaryDirectory,temporaryDirectoryRemoved,version' ||
      !Number.isSafeInteger(v.pid) ||
      v.pid < 1 ||
      pids.has(v.pid) ||
      v.generation !== generation ||
      v.operation !== 'browser' ||
      v.exitCode !== 143 ||
      v.childSignal !== null ||
      v.groupGone !== true ||
      typeof v.temporaryDirectory !== 'string' ||
      !path.isAbsolute(v.temporaryDirectory) ||
      path.normalize(v.temporaryDirectory) !== v.temporaryDirectory ||
      path.basename(v.temporaryDirectory) !== String(generation) ||
      v.temporaryDirectoryRemoved !== true ||
      v.version !== '153.0.8010.12' ||
      [
        'authenticated',
        'authoritySeparated',
        'sharedState',
        'smartSearch',
        'rawProtocolsClosed',
        'pageRequestsConfined',
        'nonceCsp',
      ].some((key) => v[key] !== true) ||
      v.historyClear !== (generation === 1) ||
      v.restartSessionRejected !== (generation === 2) ||
      r.recovery?.processGroupId !== v.pid ||
      r.recovery?.instruction !==
        'Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.'
    )
      fail();
    pids.add(v.pid);
  }
}

/** Ancestor deletion must not defeat the inner smoke's recovery retention. */
export function assertLocalUiParentCleanupSafe(state) {
  for (const resource of state.resources) {
    if (
      !resource.id?.startsWith('local-ui-') &&
      !resource.type?.startsWith('local-ui-')
    )
      continue;
    if (
      resource.owned !== true ||
      resource.recoveryRequired ||
      !['exited', 'closed', 'removed'].includes(resource.cleanup?.status)
    ) {
      throw new Error(
        'Local UI cleanup is unconfirmed; retain enclosing private root and journal recovery paths',
      );
    }
  }
}
