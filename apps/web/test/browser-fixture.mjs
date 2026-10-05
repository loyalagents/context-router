import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const webRoot = path.resolve(import.meta.dirname, '..');
export async function browserFixture(t, { model = false } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ui-browser-')),
  );
  fs.chmodSync(root, 0o700);
  const exportRoot = path.join(root, 'exports');
  fs.mkdirSync(exportRoot, { mode: 0o700 });
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    LOCAL_DATABASE_ROOT: path.join(root, 'data'),
    LOCAL_IDENTITY_STATE_ROOT: path.join(root, 'identity'),
    NODE_OPTIONS: `--require=${path.join(import.meta.dirname, 'deny-egress.cjs')}`,
  };
  const cli = (file, ...args) => {
    const result = spawnSync(
      process.execPath,
      [
        '--no-global-search-paths',
        path.resolve(webRoot, '../backend/dist', file),
        ...args,
      ],
      { env, cwd: root, encoding: 'utf8', timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  let child,
    browser,
    closed,
    peer,
    peerCleanup,
    stdout = '',
    stderr = '';
  const outbound = [],
    errors = [],
    policyViolations = [];
  t.after(async () => {
    try {
      await browser?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        let timer;
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Local UI shutdown deadline')),
                12000,
              );
            }),
          ]);
        } catch (error) {
          child.kill('SIGKILL');
          await closed;
          throw error;
        } finally {
          clearTimeout(timer);
        }
      }
      assert.equal(
        stderr.includes('LOCAL_UI_TEST_FORBIDDEN_EGRESS'),
        false,
        'backend attempted external network',
      );
      assert.equal(fs.existsSync(root), true);
      assert.deepEqual(outbound, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(policyViolations, []);
    } finally {
      try {
        await peerCleanup?.();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
  cli('local-identity.js', 'initialize');
  cli('local-mcp.js', 'upgrade');
  cli(
    'local-mcp.js',
    'provision',
    '--label',
    'synthetic-browser-peer',
    '--out',
    path.join(root, 'mcp.token'),
  );
  if (model) {
    const { fixture } = await import(
      '../../backend/test/local-model/fixtures/session-fixture.mjs'
    );
    peer = await fixture({
      after: (cleanup) => {
        peerCleanup = cleanup;
      },
    });
    env.LOCAL_MODEL_SESSION_ROOT = peer.config.root;
    env.LOCAL_MODEL_PORT = String(peer.config.port);
  }
  child = spawn(
    process.execPath,
    [
      '--no-global-search-paths',
      path.join(webRoot, 'local-ui.mjs'),
      model ? 'serve-model' : 'serve',
      '--unlock-dir',
      exportRoot,
      '--port',
      '0',
      '--mcp-port',
      '0',
    ],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  closed = once(child, 'close');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let timer, tick;
  const ready = await Promise.race([
    new Promise((resolve, reject) => {
      tick = setInterval(() => {
        const line = stdout
          .split('\n')
          .find((line) =>
            line.startsWith('{"type":"context-router.local-ui.ready"'),
          );
        if (line) resolve(JSON.parse(line));
      }, 25);
      timer = setTimeout(
        () => reject(new Error('Local UI readiness timed out: ' + stderr)),
        20000,
      );
    }),
    closed.then(([code]) => {
      throw new Error('Local UI exited before ready: ' + code + ' ' + stderr);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    clearInterval(tick);
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.LOCAL_UI_BROWSER_EXECUTABLE
      ? { executablePath: process.env.LOCAL_UI_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== ready.origin) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Content Security Policy|violates.*directive/i.test(message.text())
      )
        policyViolations.push(message.text());
    });
  });
  const page = await context.newPage();
  const bootstrap = fs.readFileSync(ready.unlockFile, 'utf8').trim();
  const identity = JSON.parse(
    fs.readFileSync(path.join(env.LOCAL_IDENTITY_STATE_ROOT, 'identity.json')),
  );
  const require = createRequire(path.join(webRoot, '../backend/package.json'));
  const {
    SqliteDatabase,
  } = require('../backend/dist/infrastructure/storage/sqlite/sqlite-database.js');
  const database = SqliteDatabase.open({
    databaseRoot: env.LOCAL_DATABASE_ROOT,
    identityRoot: env.LOCAL_IDENTITY_STATE_ROOT,
  });
  async function graphql(query, variables, target = page) {
    const result = await target.evaluate(
      async ({ query, variables }) => {
        const token = sessionStorage.getItem(
          'context-router.browser-session.v1',
        );
        const response = await fetch('/graphql', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-context-router-ui': '1',
          },
          body: JSON.stringify({ query, variables }),
        });
        return response.json();
      },
      { query, variables },
    );
    assert.equal(result.errors, undefined, JSON.stringify(result.errors));
    return result.data;
  }
  return {
    root,
    peer,
    page,
    context,
    ready,
    bootstrap,
    identity,
    cli,
    child,
    database,
    graphql,
    stdout: () => stdout,
    stderr: () => stderr,
    outbound,
    errors,
    policyViolations,
  };
}
