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
      stdio: 'ignore',
    },
  );
  let signal;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const stop = (name) => {
    signal ??= name;
    child.kill(name);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  let port, endpoint;
  for (
    let attempt = 0;
    attempt < 1000 && child.exitCode === null && !signal;
    attempt++
  ) {
    try {
      const lines = (
        await fs.readFile(path.join(root, 'DevToolsActivePort'), 'utf8')
      ).split('\n');
      port = Number(lines[0]);
      if (/^\/devtools\/browser\/[a-f0-9-]{36}$/.test(lines[1]))
        endpoint = `ws://127.0.0.1:${port}${lines[1]}`;
    } catch {}
    if (endpoint && Number.isInteger(port) && port > 0 && port < 65536) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!endpoint) {
    child.kill('SIGKILL');
    await closed;
    throw new Error('Browser readiness failed');
  }
  process.stdout.write(
    JSON.stringify({ type: 'local-ui-browser-ready', port, endpoint }) + '\n',
  );
  await closed;
  return signal === 'SIGTERM' ? 143 : signal === 'SIGINT' ? 130 : 0;
};
