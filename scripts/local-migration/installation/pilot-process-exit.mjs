// Observe immediately: events.once(child, 'close') rejects on 'error' even when
// the caller is still waiting for readiness. Never retain raw process errors.
export function observePilotProcessExit(child) {
  let spawnFailed = false;
  const ended = new Promise(resolve => {
    child.once('error', () => {
      spawnFailed = true;
      resolve({ code: null, signal: null, spawnFailed: true });
    });
    child.once('close', (code, signal) => resolve({ code, signal, spawnFailed }));
  });
  return { ended, get spawnFailed() { return spawnFailed; } };
}
