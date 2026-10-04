'use strict';
// The already-journaled Node gate owns the Chromium process group. Chromium is
// spawned without detaching, so timeout/cancellation reaps the complete group.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.runLocalIdentityEntrypoint = async ({ argv: [operation] }) => {
  if (operation !== 'browser')
    throw new Error('Unsupported browser fixture operation');
  const root = process.env.LOCAL_UI_BROWSER_PROFILE;
  const child = spawn(
    process.env.LOCAL_UI_BROWSER_EXECUTABLE,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-default-apps',
      '--no-default-browser-check',
      '--metrics-recording-only',
      '--disable-features=MediaRouter,OptimizationHints',
      '--password-store=basic',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${root}`,
      'about:blank',
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
      },
      detached: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let signal,
    spawnFailed = false,
    socketPathFailure = false,
    stderrTail = '';
  let port, endpoint;
  // Keep only enough transient text to recognize a split diagnostic. Never
  // forward Chromium stderr, which can contain private paths or page data.
  child.stderr.on('data', (chunk) => {
    if (endpoint) return;
    const text = stderrTail + chunk.toString('utf8');
    socketPathFailure ||= text.includes('Socket path too long');
    stderrTail = text.slice(-128);
  });
  const closed = new Promise((resolve) => {
    child.once('error', () => {
      spawnFailed = true;
    });
    child.once('close', resolve);
  });
  const stop = (name) => {
    signal ??= name;
    child.kill(name);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  const deadline = Date.now() + 10000;
  while (
    Date.now() < deadline &&
    child.exitCode === null &&
    child.signalCode === null &&
    !spawnFailed &&
    !signal
  ) {
    try {
      const lines = (
        await fs.readFile(path.join(root, 'DevToolsActivePort'), 'utf8')
      ).split('\n');
      port = Number(lines[0]);
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port < 65536 &&
        /^\/devtools\/browser\/[a-f0-9-]{36}$/.test(lines[1])
      )
        endpoint = `ws://127.0.0.1:${port}${lines[1]}`;
    } catch {}
    if (endpoint) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stderrTail = '';
  if (!endpoint) {
    const reason = spawnFailed
      ? 'spawn'
      : socketPathFailure
        ? 'socket-path'
        : child.signalCode !== null || signal
          ? 'signal'
          : child.exitCode !== null
            ? 'exit'
            : 'deadline';
    child.kill('SIGKILL');
    await closed;
    process.stderr.write(`local-ui-browser-startup:${reason}\n`);
    return 70;
  }
  process.stdout.write(
    JSON.stringify({ type: 'local-ui-browser-ready', port, endpoint }) + '\n',
  );
  await closed;
  return signal === 'SIGTERM' ? 143 : signal === 'SIGINT' ? 130 : 0;
};
