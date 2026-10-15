import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { prepareDemo, readManifest, startServer, repoRoot, cleanEnvironment, verifyDemo } from './runtime.mjs';
import { prepareHome } from './home.mjs';
import { loadDemoPlan } from './records.mjs';
import { connect, call } from './mcp-import.mjs';
import { localUiBrowserPrerequisite } from '../../scripts/local-migration/local-ui-browser.mjs';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');

async function ready(child) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Owned demo server readiness timeout')), 30000);
    child.stdout.on('data', chunk => { text += chunk.toString(); for (const line of text.split('\n')) { try { const value = JSON.parse(line); if (value.type === 'context-router.local-ui.ready') { clearTimeout(timer); resolve(value); } } catch {} } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Owned demo server exited ${code}`)); });
    child.once('error', reject);
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  try { await closed; } finally { clearTimeout(timer); }
}

test('existing dashboard shows a durable generation, refreshed MCP change, A/B/C authority and persisted history', { timeout: 90000 }, async t => {
  const prerequisite = localUiBrowserPrerequisite(repoRoot);
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-browser-')));
  let child, browser, a, reader;
  t.after(async () => { await a?.close(); await reader?.close(); await browser?.close(); await stop(child); await fs.rm(parent, { recursive: true, force: true }); });
  const { root } = await prepareHome({ home: path.join(parent, 'demo') });
  const manifest = await readManifest(root);
  child = startServer(root, 0, 0, ['ignore', 'pipe', 'pipe']);
  child.stderr.resume();
  const server = await ready(child), origin = server.origin;
  assert.equal(server.modelConfigured, false);
  const profile = path.join(parent, 'browser'); await fs.mkdir(profile, { mode: 0o700 });
  browser = await chromium.launchPersistentContext(profile, { executablePath: prerequisite.executable, headless: true, serviceWorkers: 'block',
    env: { ...cleanEnvironment(), HOME: profile, TMPDIR: parent }, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps'] });
  const blocked = [];
  await browser.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); blocked.push(route.request().url()); return route.abort(); });
  await browser.routeWebSocket('**/*', socket => { if (new URL(socket.url()).origin === origin.replace('http:', 'ws:')) socket.connectToServer(); else { blocked.push(socket.url()); socket.close(); } });
  const page = await browser.newPage();
  await page.goto(origin + '/dashboard/preferences');
  await page.getByLabel('Unlock token').fill((await fs.readFile(server.unlockFile, 'utf8')).trim());
  await page.getByRole('button', { name: 'Unlock local dashboard', exact: true }).click();
  const plan = await loadDemoPlan();
  const entry = plan.entries.find(e => e.preference.value.includes('phone-free Sunday'));
  const original = JSON.parse(entry.preference.value);
  await page.getByText(JSON.stringify(original), { exact: true }).first().waitFor();
  a = await connect(Number(new URL(server.mcpOrigin).port), path.join(root, 'exports/agent-a.token'));
  reader = await connect(Number(new URL(server.mcpOrigin).port), path.join(root, 'exports/agent-b.token'));
  const value = original + ' Rehearsal change: dinner starts at 6 PM.';
  const update = await call(a, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug: entry.definition.slug, value: JSON.stringify(value) } });
  assert.equal((await call(reader, 'searchPreferences', { query: entry.definition.slug })).active.preferences[0].value, value);
  await page.reload(); await page.getByText(JSON.stringify(value), { exact: true }).first().waitFor();
  await page.goto(origin + '/dashboard/permissions');
  await page.getByRole('button', { name: `Inspect ${manifest.clients.agentA.id}`, exact: true }).click();
  const authority = page.getByRole('region', { name: 'Selected client authority' });
  await authority.getByText(/preferences:write/).waitFor();
  await authority.getByText(/preferences:define/).waitFor();
  await page.getByRole('button', { name: `Inspect ${manifest.clients.agentB.id}`, exact: true }).click();
  await authority.getByText(/preferences:read/).waitFor();
  const policy = await authority.textContent(); assert.equal(policy.includes('health.demo001.*'), false); assert.equal(policy.includes('finance.demo001.*'), false);
  await page.getByRole('button', { name: `Inspect ${manifest.clients.agentC.id}`, exact: true }).click();
  await authority.getByText(/preferences:read/).waitFor();
  await authority.getByText('health.* · READ · DENY', { exact: true }).first().waitFor();
  await page.goto(origin + '/dashboard/history');
  await page.getByLabel('Show sensitive values').check();
  await page.getByRole('button', { name: new RegExp(`local:${manifest.clients.agentA.id}`) }).first().click();
  await page.getByText(value, { exact: false }).first().waitFor();
  await page.getByText(update.audit.correlationId, { exact: false }).first().waitFor();
  await page.getByRole('tab', { name: 'MCP Access', exact: true }).click();
  await page.getByText(`local:${manifest.clients.agentB.id}`, { exact: true }).first().waitFor();
  await page.getByText('searchPreferences', { exact: true }).first().waitFor();
  assert.deepEqual(blocked, []);
  await a.close(); a = undefined; await reader.close(); reader = undefined;
  await browser.close(); browser = undefined; await stop(child); child = undefined;
  assert.equal((await verifyDemo(root)).modified.length, 1);
});

test('occupied dashboard port fails without disturbing its owner or unrelated files', { timeout: 60000 }, async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-conflict-'))), root = path.join(parent, 'demo');
  const owner = net.createServer(socket => socket.end('unrelated'));
  await new Promise(resolve => owner.listen(0, '127.0.0.1', resolve));
  let child;
  t.after(async () => { await stop(child); await new Promise(resolve => owner.close(resolve)); await fs.rm(parent, { recursive: true, force: true }); });
  await fs.writeFile(path.join(parent, 'unrelated.txt'), 'preserve');
  await prepareDemo({ out: root });
  child = startServer(root, owner.address().port, 0, ['ignore', 'pipe', 'pipe']); child.stderr.resume();
  await assert.rejects(ready(child), /exited 1/);
  assert.equal(owner.listening, true);
  assert.equal(await fs.readFile(path.join(parent, 'unrelated.txt'), 'utf8'), 'preserve');
  assert.equal((await verifyDemo(root)).modified.length, 0);
});
