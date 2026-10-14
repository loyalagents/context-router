import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { backend, prepareDemo, configuration, cleanEnvironment, history } from './runtime.mjs';
import { loadDemoPlan } from './records.mjs';
import { connect, call } from './mcp-import.mjs';

const cli = fileURLToPath(new URL('./desktop-bridge.mjs', import.meta.url));
const observer = fileURLToPath(new URL('../../apps/backend/test/local-mcp/fixtures/bridge-cli-observer.mjs', import.meta.url));
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const syntheticToken = `cr_mcp_${'a'.repeat(22)}.${'b'.repeat(43)}`;
async function temporary() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-desktop-')));
}

test('demo Desktop adapter uses real SDK stdio and role B authority against the selected owned MCP port', { timeout: 30000 }, async t => {
  const parent = await temporary(), input = path.join(parent, 'input'), root = path.join(parent, 'demo');
  let runtime, a, client;
  t.after(async () => {
    try { await client?.close(); } finally {
      try { await a?.close(); } finally { await runtime?.close(); await fs.rm(parent, { recursive: true, force: true }); }
    }
  });
  await fs.mkdir(input);
  const source = await loadDemoPlan();
  for (const category of ['home', 'health']) {
    const record = source.entries.find(e => e.definition.slug.startsWith(`${category}.`)).preference.evidence.sourceRecord;
    await fs.writeFile(path.join(input, `${category}.jsonl`), JSON.stringify(record) + '\n');
  }
  const manifest = await prepareDemo({ out: root, input });
  const b = backend(); runtime = await b.createLocalMcpApplication(configuration(root), { port: 0 });
  a = await connect(runtime.port, path.join(root, 'exports/agent-a.token'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, '--credential-file', path.join(root, 'exports/agent-b.token'), '--mcp-port', String(runtime.port)],
    env: { ...cleanEnvironment(), HOME: parent, TMPDIR: parent }, stderr: 'pipe', cwd: parent });
  let diagnostics = ''; transport.stderr.on('data', data => { diagnostics += data; });
  client = new Client({ name: 'demo-desktop-reader', version: '1' });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.some(tool => tool.name === 'mutatePreferences'), false);
  const found = await call(client, 'searchPreferences', { query: 'home.demo001.' });
  assert.equal(found.active.count, 1);
  assert.equal((await call(client, 'searchPreferences', { query: 'health.demo001.' })).active.count, 0);
  const memory = found.active.preferences[0], value = memory.value + ' Rehearsal change shared with Desktop.';
  await call(a, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug: memory.slug, value: JSON.stringify(value) } });
  assert.equal((await call(client, 'searchPreferences', { query: memory.slug })).active.preferences[0].value, value);
  const before = await history(runtime.application, b.PreferenceAuditQueryService, manifest.principalId);
  const denied = await client.callTool({ name: 'mutatePreferences', arguments: { operation: 'SET_PREFERENCE', preference: { slug: memory.slug, value: '"forbidden"' } } });
  assert.equal(denied.isError, true);
  assert.deepEqual(JSON.parse(denied.content[0].text), { error: `Client "local:${manifest.clients.agentB.id}" is not allowed to call tool "mutatePreferences"` });
  assert.equal((await call(client, 'searchPreferences', { query: memory.slug })).active.preferences[0].value, value);
  assert.equal((await history(runtime.application, b.PreferenceAuditQueryService, manifest.principalId)).length, before.length);
  const access = await history(runtime.application, b.McpAccessLogQueryService, manifest.principalId);
  assert.ok(access.some(e => e.clientKey === `local:${manifest.clients.agentB.id}` && e.operationName === 'mutatePreferences' && e.outcome === 'DENY'));
  await client.close(); client = undefined;
  assert.equal(diagnostics, '');
});

test('demo Desktop adapter rejects invalid args, unsupported Node and debugging before credential or HTTP access', async t => {
  const root = await temporary(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'client.token'); await fs.writeFile(file, syntheticToken, { mode: 0o600 });
  const valid = ['--credential-file', file];
  const input = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } } }) + '\n';
  const cases = [
    { args: [] }, { args: ['--token', syntheticToken] }, { args: [...valid, '--url', 'https://example.invalid'] },
    ...['0', '65536', '-1', 'abc', '08788'].map(port => ({ args: [...valid, '--mcp-port', port] })),
    { args: [...valid, '--mcp-port'] }, { args: [...valid, '--mcp-port', '8788', '--mcp-port', '8787'] },
    ...[{ NODE_DEBUG: 'http' }, { NODE_DEBUG_NATIVE: 'NET' }, { NODE_OPTIONS: '--trace-sync-io' }].map(env => ({ args: valid, env })),
    { args: valid, preload: ['--import', 'data:text/javascript,Object.defineProperty(process.versions,%22node%22,{value:%2222.0.0%22})'] },
  ];
  for (const entry of cases) {
    const result = spawnSync(process.execPath, ['--import', observer, ...(entry.preload ?? []), cli, ...entry.args], {
      env: { ...cleanEnvironment(), ...entry.env, HOME: root, CR_TEST_CREDENTIAL_FILE: file }, input, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.match(result.stderr, /Demo Desktop bridge: startup unavailable/);
    for (const secret of [syntheticToken, file, 'TEST_CREDENTIAL_READ', 'TEST_HTTP_ATTEMPT']) assert.equal(result.stderr.includes(secret), false);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { env: cleanEnvironment(), encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /default 8788/);
});

test('demo Desktop adapter drains EOF and owned termination without starting an app', async t => {
  const root = await temporary(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'client.token'); await fs.writeFile(file, syntheticToken, { mode: 0o600 });
  for (const signal of [null, 'SIGINT', 'SIGTERM', 'SIGHUP']) {
    const child = spawn(process.execPath, [cli, '--mcp-port', '1', '--credential-file', file], { env: { ...cleanEnvironment(), HOME: root }, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(child, 'close'); let diagnostics = '';
    child.stderr.on('data', data => { diagnostics += data; });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const reply = once(child.stdout, 'data');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }) + '\n');
      assert.match(String((await reply)[0]), /Initialize the connection/);
      if (signal) child.kill(signal); else child.stdin.end();
      assert.deepEqual(await closed, [0, null]); assert.equal(diagnostics, '');
    } finally { clearTimeout(deadline); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
  }
});
