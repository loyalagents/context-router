// Diagnostics only: no test names, paths, URLs, state or failure text.
export function createFixtureTiming({ enabled, model = false, demo = false, now = () => performance.now(), report }) {
  const noop = () => {};
  if (!enabled) return { setupComplete: noop, cleanupStarted: noop, finish: noop };
  const started = now();
  let setupEnded, cleanupBegan, finished = false;
  const elapsed = (from, to) => Math.max(0, Math.round(to - from));
  return {
    setupComplete() { setupEnded = now(); },
    cleanupStarted() { cleanupBegan = now(); },
    finish() {
      if (finished) return;
      finished = true;
      const ended = now();
      try {
        report({ type: 'context-router.browser-fixture-timing', version: 1,
          mode: demo ? model ? 'demo-model' : 'demo' : model ? 'model' : 'manual',
          setupMs: elapsed(started, setupEnded ?? cleanupBegan ?? ended),
          bodyMs: setupEnded === undefined ? null : elapsed(setupEnded, cleanupBegan ?? ended),
          cleanupMs: cleanupBegan === undefined ? null : elapsed(cleanupBegan, ended) });
      } catch { /* Optional reporting must not change test or teardown outcomes. */ }
    },
  };
}
