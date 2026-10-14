import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { prepareHome } from './home.mjs';
import { prepareDesktop, applyDesktop } from './desktop-setup.mjs';
import { backend, configuration, cleanEnvironment } from './runtime.mjs';
import { loadDemoPlan, hash } from './records.mjs';
import { call } from './mcp-import.mjs';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function fixture(t) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-desktop-setup-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const input = path.join(parent, 'input'); await fs.mkdir(input);
  const source = await loadDemoPlan();
  for (const category of ['home', 'health']) await fs.writeFile(path.join(input, `${category}.jsonl`), JSON.stringify(source.entries.find(e => e.definition.slug.startsWith(category + '.')).preference.evidence.sourceRecord) + '\n');
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const mcpPort = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const selection = await prepareHome({ home: path.join(parent, 'home'), input, mcpPort });
  return { ...selection, parent, config: path.join(parent, 'claude.json'), testContext: { fixtureRoot: parent } };
}

test('Desktop proposal preserves config until explicit apply, binds C to immutable source snapshot and fixed generation', async t => {
  const f = await fixture(t), original = '{"mcpServers":{"existing":{"command":"/do/not/change"}},"theme":"dark"}\n';
  await fs.writeFile(f.config, original, { mode: 0o600 });
  await assert.rejects(prepareDesktop(f), /durable|temporary/i);
  const proposal = await prepareDesktop(f, f.testContext);
  assert.equal(await fs.readFile(f.config, 'utf8'), original);
  await assert.rejects(applyDesktop({ home: f.home, proposal: proposal.proposal }, f.testContext), /closed/i);
  const applied = await applyDesktop({ home: f.home, proposal: proposal.proposal, desktopClosed: true }, f.testContext);
  assert.equal(await fs.readFile(applied.backup, 'utf8'), original);
  const config = JSON.parse(await fs.readFile(f.config, 'utf8'));
  assert.equal(config.theme, 'dark'); assert.deepEqual(config.mcpServers.existing, { command: '/do/not/change' });
  const entry = config.mcpServers[proposal.entryName];
  assert.equal(entry.command, await fs.realpath(process.execPath));
  assert.equal(entry.args[0], '--no-global-search-paths');
  assert.equal(entry.args.includes(path.join(f.root, 'exports/agent-c.token')), true);
  assert.equal(JSON.stringify(entry).includes('current.json'), false);
  const runtime = await backend().createLocalMcpApplication(configuration(f.root), { port: f.mcpPort });
  const client = new Client({ name: 'snapshot-C', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args, env: { ...cleanEnvironment(), ...entry.env }, cwd: f.parent, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.some(x => x.name === 'mutatePreferences'), false);
    assert.equal((await call(client, 'searchPreferences', { query: 'home.demo001.' })).active.count, 1);
    assert.equal((await call(client, 'searchPreferences', { query: 'health.demo001.' })).active.count, 0);
  } finally { await client.close(); await runtime.close(); }
  const fresh = await prepareHome({ home: f.home, fresh: true });
  assert.notEqual(fresh.root, f.root);
  assert.deepEqual(JSON.parse(await fs.readFile(f.config, 'utf8')).mcpServers[proposal.entryName], entry);
  const next = await prepareDesktop({ ...fresh, config: f.config }, f.testContext);
  await applyDesktop({ home: f.home, proposal: next.proposal, desktopClosed: true }, f.testContext);
  assert.equal(JSON.parse(await fs.readFile(f.config, 'utf8')).mcpServers[next.entryName].args.includes(path.join(fresh.root, 'exports/agent-c.token')), true);
});

test('Desktop apply supports absent config and refuses stale bytes, collisions, unsafe aliases and modified snapshot hashes', async t => {
  const f = await fixture(t);
  const proposed = await prepareDesktop(f, f.testContext);
  const data = JSON.parse(await fs.readFile(proposed.proposal, 'utf8'));
  const marker = path.join(f.parent, 'must-not-execute'), forged = path.join(f.parent, 'forged-node');
  await fs.writeFile(forged, `#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');console.log('v24.21.0');\n`, { mode: 0o700 });
  await fs.writeFile(proposed.proposal, JSON.stringify({ ...data, node: { path: forged, sha256: hash(await fs.readFile(forged)) } }));
  await assert.rejects(applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, f.testContext));
  assert.equal(await fs.access(marker).then(() => true, () => false), false);
  await fs.writeFile(proposed.proposal, JSON.stringify(data));
  await fs.writeFile(f.config, '{}', { mode: 0o600 });
  await assert.rejects(applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, f.testContext), /changed|conflict/);
  await fs.unlink(f.config);
  const file = path.join(data.snapshot, 'examples/demo-10-2026/desktop-bridge.mjs');
  await fs.chmod(file, 0o600); const original = await fs.readFile(file); await fs.writeFile(file, 'modified');
  await assert.rejects(applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, f.testContext), /snapshot|hash/);
  await fs.writeFile(file, original); await fs.chmod(file, 0o400);
  await applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, f.testContext);
  const existing = JSON.parse(await fs.readFile(f.config, 'utf8')); existing.mcpServers[proposed.entryName] = { command: '/foreign' };
  await fs.writeFile(f.config, JSON.stringify(existing));
  await assert.rejects(prepareDesktop(f, f.testContext), /collision/);
  const alias = path.join(f.parent, 'alias'); await fs.symlink(f.config, alias);
  await assert.rejects(prepareDesktop({ ...f, config: alias }, f.testContext), /links|canonical/);
});

test('Desktop interruption preserves backup/temp/lock; never silently restores or reapplies', async t => {
  for (const phase of ['before-rename', 'after-rename']) {
    const f = await fixture(t); const original = '{"unrelated":true}\n'; await fs.writeFile(f.config, original, { mode: 0o600 });
    const proposed = await prepareDesktop(f, f.testContext);
    await assert.rejects(applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, { ...f.testContext, checkpoint: async at => { if (phase === at) throw new Error('interrupt'); } }), /uncertain|inspection/);
    const directory = path.dirname(proposed.proposal);
    assert.equal(await fs.readFile(path.join(directory, 'backup.json'), 'utf8'), original);
    if (phase === 'before-rename') assert.equal(await fs.readFile(f.config, 'utf8'), original);
    else assert.equal(JSON.parse(await fs.readFile(f.config, 'utf8')).unrelated, true);
    await assert.rejects(applyDesktop({ home: f.home, proposal: proposed.proposal, desktopClosed: true }, f.testContext), /lock/);
  }
});

test('Desktop prepare and apply refuse an actual pinned Node executable located in temporary storage', async t => {
  const f = await fixture(t), temporaryNode = path.join(f.parent, 'node');
  await fs.copyFile(process.execPath, temporaryNode); await fs.chmod(temporaryNode, 0o700);
  const proposed = await prepareDesktop(f, f.testContext);
  const original = await fs.readFile(proposed.proposal), data = JSON.parse(original);
  // Match the real copied executable so the existing identity comparison alone
  // cannot accidentally make this regression pass during apply.
  data.node = { path: temporaryNode, sha256: hash(await fs.readFile(temporaryNode)) };
  data.entry.command = temporaryNode;
  await fs.writeFile(proposed.proposal, JSON.stringify(data));
  const script = `import {prepareDesktop,applyDesktop} from ${JSON.stringify(new URL('./desktop-setup.mjs', import.meta.url).href)};
    const [mode,args,context]=JSON.parse(process.argv[1]);
    try { await (mode==='prepare'?prepareDesktop:applyDesktop)(args,context); console.log(JSON.stringify({accepted:true})); }
    catch(e) { console.log(JSON.stringify({accepted:false,message:e.message})); }`;
  const before = await fs.readdir(path.join(f.home, 'desktop'));
  const outcomes = [];
  for (const mode of ['prepare', 'apply']) {
    const args = mode === 'prepare' ? { home: f.home, root: f.root, config: f.config } : { home: f.home, proposal: proposed.proposal, desktopClosed: true };
    const result = spawnSync(temporaryNode, ['--input-type=module', '-e', script, JSON.stringify([mode, args, f.testContext])], { env: { ...cleanEnvironment(), NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    outcomes.push(JSON.parse(result.stdout));
  }
  assert.deepEqual(outcomes.map(x => x.accepted), [false, false]);
  for (const outcome of outcomes) assert.match(outcome.message, /Node.*durable|Node.*temporary/i);
  assert.deepEqual(await fs.readdir(path.join(f.home, 'desktop')), before);
  assert.equal(await fs.access(f.config).then(() => true, () => false), false);
});
