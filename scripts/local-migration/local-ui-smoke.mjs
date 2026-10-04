import assert from 'node:assert/strict';
import { readFile, realpath, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { runLocalMcpSmoke, requestMcpSmoke } from './local-mcp-smoke.mjs';
import {
  createGatedNodeChild,
  activateJournaledNodeChild,
  terminateAndReapJournaledNodeChild,
} from './local-identity-smoke.mjs';
import { hasLiveProcessGroupMembers } from './gate-runner.mjs';
import { localUiBrowserPrerequisite } from './local-ui-browser.mjs';
const directory = import.meta.dirname;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function withLocalUiSmokeDeadline(promise, ms = 30000, stage) {
  const label = [
    'raw-protocol',
    'browser-ready',
    'websocket-control',
    'context-close',
    'browser-disconnect',
    'browser-exit',
    'browser-group-exit',
    'cleanup-browser-disconnect',
  ].includes(stage)
    ? stage
    : 'operation';
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Local UI smoke deadline: ${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const mapId = (value) => value.replace(/^local-mcp-/, 'local-ui-');
function mappedJournal(journal) {
  return {
    acquiring: (record) =>
      journal.acquiring({
        ...record,
        id: mapId(record.id),
        type: mapId(record.type),
      }),
    acquired: (id, record) => journal.acquired(mapId(id), record),
    cleanupFinished: (id, record) => journal.cleanupFinished(mapId(id), record),
    addCanary: (value) => journal.addCanary(value),
  };
}
async function rawProtocolClosed(port, request) {
  await withLocalUiSmokeDeadline(
    new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () =>
        socket.write(request),
      );
      let bytes = 0;
      socket.on('data', (chunk) => {
        bytes += chunk.length;
      });
      socket.on('error', (error) => {
        if (error.code !== 'ECONNRESET') reject(error);
      });
      socket.on('close', () => {
        try {
          assert.equal(bytes, 0);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      socket.setTimeout(3000, () => {
        socket.destroy();
        reject(new Error('Raw browser protocol remained open'));
      });
    }),
    5000,
    'raw-protocol',
  );
}
export async function cleanupLocalUiBrowserResources(
  { handle, reaped, temporaryDirectory, temporaryCreated, retain = false },
  { terminate = terminateAndReapJournaledNodeChild, remove = rm } = {},
) {
  if (handle && !reaped) {
    const errors = await terminate(handle, 'local UI browser');
    if (errors.length)
      throw new AggregateError(errors, 'Browser cleanup failed');
  }
  if (!temporaryCreated)
    throw new Error('Browser temporary directory ownership not established');
  if (retain) throw new Error('Browser journal failed; retain recovery state');
  await remove(temporaryDirectory, { recursive: true });
}
export function createLocalUiBrowserEnvironment(options, profile, executable) {
  return {
    PATH: options.environment?.PATH ?? process.env.PATH,
    // Keep browser-created caches within the profile's journaled cleanup boundary.
    HOME: profile,
    TMPDIR: options.temporaryDirectory,
    LOCAL_UI_BROWSER_PROFILE: profile,
    LOCAL_UI_BROWSER_EXECUTABLE: executable,
  };
}
export async function runLocalUiSmoke({
  webRoot,
  repositoryRoot = path.resolve(directory, '../..'),
  ...options
}) {
  webRoot = await realpath(webRoot);
  const webRequire = createRequire(path.join(webRoot, 'local-ui.mjs'));
  const entrypoint = webRequire.resolve('backend/dist/local-mcp.js');
  const browserPrerequisite = localUiBrowserPrerequisite(
    repositoryRoot,
    options.environment,
  );
  const { chromium } = createRequire(
    path.join(repositoryRoot, 'apps/web/package.json'),
  )('playwright');
  let previousSession,
    browserCleanupFailed = false;
  const verifyGeneration = async ({
    readiness,
    root,
    generation,
    identity,
    tokens,
    readMcp,
  }) => {
    const journal = options.journal,
      id = `local-ui-browser-${generation}`;
    const record = async (method, ...args) => {
      try {
        return await journal[method](...args);
      } catch (error) {
        browserCleanupFailed = true;
        throw error;
      }
    };
    const profile = path.join(root, `browser-${generation}`);
    const temporaryDirectory = path.join(
      options.temporaryDirectory,
      String(generation),
    );
    await mkdir(profile, { mode: 0o700 });
    await record('acquiring', {
      id,
      type: 'local-ui-browser-process',
      owned: true,
      identity: { generation, operation: 'browser', temporaryDirectory },
      recovery:
        'Reap only the recorded browser process group before removing its private profile and owned temporary directory.',
    });
    let handle,
      browser,
      reaped = false,
      temporaryCreated = false;
    try {
      await mkdir(temporaryDirectory, { mode: 0o700 });
      temporaryCreated = true;
      handle = createGatedNodeChild({
        entrypoint: path.join(directory, 'fixtures/local-ui-smoke/browser.cjs'),
        operation: 'browser',
        cwd: options.cwd,
        env: createLocalUiBrowserEnvironment(
          { ...options, temporaryDirectory },
          profile,
          browserPrerequisite.executable,
        ),
        signal: options.signal,
      });
      await activateJournaledNodeChild({
        handle,
        journal: { acquired: (...args) => record('acquired', ...args) },
        resourceId: id,
        identity: { generation, operation: 'browser', temporaryDirectory },
      });
      let ready;
      await withLocalUiSmokeDeadline(
        (async () => {
          for (;;) {
            const output = handle.output();
            if (
              output.overflow ||
              output.stderr ||
              handle.child.exitCode !== null ||
              handle.child.signalCode !== null
            ) {
              const reason =
                /^local-ui-browser-startup:(spawn|socket-path|exit|signal|deadline)\n$/.exec(
                  output.stderr,
                )?.[1] ?? 'unknown';
              throw new Error(`Browser driver failed: ${reason}`);
            }
            if (output.stdout.endsWith('\n')) {
              ready = JSON.parse(output.stdout);
              break;
            }
            await delay(10);
          }
        })(),
        30000,
        'browser-ready',
      );
      assert.equal(ready.type, 'local-ui-browser-ready');
      assert.match(
        ready.endpoint,
        /^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/devtools\/browser\/[a-f0-9-]{36}$/,
      );
      browser = await chromium.connectOverCDP(ready.endpoint, {
        timeout: 10000,
      });
      assert.equal(browser.version(), browserPrerequisite.version);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const errors = [],
        outbound = [],
        violations = [],
        sockets = [];
      context.on('page', (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (
            message.type() === 'error' &&
            /Content Security Policy|violates.*directive/i.test(message.text())
          )
            violations.push(message.text());
        });
      });
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin !== readiness.origin) {
          outbound.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await context.routeWebSocket('**/*', (socket) => {
        sockets.push(socket.url());
        socket.close();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await withLocalUiSmokeDeadline(
        page.evaluate(
          () =>
            new Promise((resolve) => {
              const socket = new WebSocket('ws://127.0.0.1:1/smoke-control');
              socket.onclose = () => resolve();
            }),
        ),
        5000,
        'websocket-control',
      );
      assert.deepEqual(sockets, ['ws://127.0.0.1:1/smoke-control']);
      sockets.length = 0;
      const response = await page.goto(
        readiness.origin + '/dashboard/preferences',
      );
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-security-policy'], /nonce-/);
      const bootstrap = (await readFile(readiness.unlockFile, 'utf8')).trim();
      journal.addCanary(bootstrap);
      const shell = await response.text();
      for (const secret of [
        bootstrap,
        identity.credential,
        identity.principalId,
        ...tokens,
      ])
        assert.equal(shell.includes(secret), false);
      const post = (route, token, body = {}) =>
        page.evaluate(
          async ({ route, token, body }) => {
            const response = await fetch(route, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-context-router-ui': '1',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
          },
          { route, token, body },
        );
      for (const token of [
        identity.credential,
        tokens[1],
        ...(previousSession ? [previousSession] : []),
      ])
        assert.equal(
          (await post('/graphql', token, { query: '{ me { userId } }' }))
            .status,
          401,
        );
      await page.getByLabel('Unlock token').fill(bootstrap);
      await page
        .getByRole('button', { name: 'Unlock local dashboard' })
        .click();
      await page.getByRole('button', { name: 'Lock dashboard' }).waitFor();
      const session = await page.evaluate(() =>
        sessionStorage.getItem('context-router.browser-session.v1'),
      );
      journal.addCanary(session);
      assert.equal(
        (await post('/api/local/unlock', undefined, { bootstrap })).status,
        401,
      );
      assert.equal(
        (await post('/graphql', session, { query: '{ me { userId } }' })).body
          .data.me.userId,
        identity.principalId,
      );
      const mcpPort = Number(new URL(readiness.mcpOrigin).port);
      const mcpBody = { jsonrpc: '2.0', id: 99, method: 'tools/list' };
      assert.equal(
        (await requestMcpSmoke(mcpPort, session, mcpBody)).status,
        401,
      );
      assert.equal(
        (
          await requestMcpSmoke(mcpPort, tokens[1], mcpBody, {
            origin: readiness.origin,
          })
        ).status,
        403,
      );
      await page.getByLabel('Search query', { exact: true }).fill('persisted');
      await page
        .getByLabel('Literal search results')
        .getByText('"persisted"', { exact: false })
        .waitFor();
      await page
        .getByRole('button', { name: 'Smart search', exact: true })
        .click();
      await page
        .getByLabel('Smart search results')
        .getByText('"persisted"', { exact: false })
        .waitFor();
      if (generation === 1) {
        await page.getByTitle('Edit', { exact: true }).click();
        await page.locator('textarea').fill('"from-browser"');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByTitle('Edit', { exact: true }).waitFor();
        assert.equal(
          (await readMcp()).structuredContent.active.preferences[0].value,
          'from-browser',
        );
        await page.goto(readiness.origin + '/dashboard/history');
        await page
          .getByRole('button', { name: 'Clear both history streams' })
          .click();
        await page
          .getByLabel('Type CLEAR HISTORY to confirm')
          .fill('CLEAR HISTORY');
        await page
          .getByRole('button', { name: 'Clear history permanently' })
          .click();
        await page
          .getByText('Both history streams cleared.', { exact: false })
          .waitFor();
        const cleared = (
          await post('/graphql', session, {
            query:
              '{ preferenceAuditHistory(input:{first:20}) { items { id } } mcpAccessHistory(input:{first:20}) { items { id } } activePreferences { value } }',
          })
        ).body.data;
        assert.deepEqual(cleared.preferenceAuditHistory.items, []);
        assert.deepEqual(cleared.mcpAccessHistory.items, []);
        assert.equal(cleared.activePreferences[0].value, 'from-browser');
        await page.goto(readiness.origin + '/dashboard/preferences');
        await page.getByTitle('Edit', { exact: true }).click();
        await page.locator('textarea').fill('"persisted"');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByTitle('Edit', { exact: true }).waitFor();
      }
      await page.goto(readiness.origin + '/dashboard/permissions');
      const clients = JSON.parse(
        await readFile(path.join(root, 'clients.json')),
      );
      await page
        .getByRole('button', { name: `Inspect ${clients[1]}`, exact: true })
        .click();
      await page
        .getByRole('region', { name: 'Selected client authority' })
        .getByText('synthetic.* · READ · ALLOW', { exact: true })
        .waitFor();
      assert.equal((await context.cookies()).length, 0);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      const port = Number(new URL(readiness.origin).port);
      await rawProtocolClosed(
        port,
        `GET /dashboard HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
      await rawProtocolClosed(
        port,
        `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
      );
      if (generation === 2) {
        await page.getByRole('button', { name: 'Lock dashboard' }).click();
        await page.getByLabel('Unlock token').waitFor();
        assert.equal(await page.evaluate(() => sessionStorage.length), 0);
      }
      previousSession = session;
      assert.deepEqual(errors, []);
      assert.deepEqual(outbound, []);
      assert.deepEqual(violations, []);
      assert.deepEqual(sockets, []);
      await withLocalUiSmokeDeadline(context.close(), 5000, 'context-close');
      await withLocalUiSmokeDeadline(browser.close(), 5000, 'browser-disconnect');
      browser = undefined;
      process.kill(-handle.child.pid, 'SIGTERM');
      const result = await withLocalUiSmokeDeadline(
        handle.result, 15000, 'browser-exit',
      );
      assert.equal(result.code, 143);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, '');
      assert.equal(result.overflow, false);
      await withLocalUiSmokeDeadline(
        (async () => {
          while (await hasLiveProcessGroupMembers(handle.child.pid))
            await delay(10);
        })(),
        5000,
        'browser-group-exit',
      );
      reaped = true;
      await record('acquired', id, {
        identity: {
          exitCode: 143,
          childSignal: null,
          groupGone: true,
          version: browserPrerequisite.version,
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
      });
    } finally {
      if (browser)
        await withLocalUiSmokeDeadline(
          browser.close(), 5000, 'cleanup-browser-disconnect',
        ).catch(() => {});
      try {
        await cleanupLocalUiBrowserResources({
          handle,
          reaped,
          temporaryDirectory,
          temporaryCreated,
          retain: browserCleanupFailed,
        });
        await record('acquired', id, {
          identity: { temporaryDirectoryRemoved: true },
        });
        await record('cleanupFinished', id, { status: 'exited' });
      } catch (error) {
        browserCleanupFailed = true;
        try {
          await record('cleanupFinished', id, { status: 'failed' });
        } catch (journalError) {
          throw new AggregateError(
            [error, journalError],
            'Browser cleanup failed',
          );
        }
        throw error;
      }
    }
  };
  const result = await runLocalMcpSmoke({
    ...options,
    entrypoint,
    journal: mappedJournal(options.journal),
    localUi: {
      webRoot,
      verifyGeneration,
      assertCleanup: () => {
        if (browserCleanupFailed)
          throw new Error('Browser cleanup unconfirmed; retain private root');
      },
      dependencies: await realpath(
        webRoot === path.join(repositoryRoot, 'apps/web')
          ? path.join(repositoryRoot, 'node_modules')
          : path.join(webRoot, 'node_modules'),
      ),
    },
  });
  return {
    ...result,
    authenticatedBrowserGenerations: 2,
    browser: browserPrerequisite.version,
    playwright: browserPrerequisite.playwright,
  };
}
