import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backend, configuration } from '../../../examples/demo-10-2026/runtime.mjs';
import { connect, call } from '../../backend/scripts/demo/mcp-import.mjs';
import { loadBundledSeed } from '../../backend/scripts/demo/seed.mjs';
const corpus = fileURLToPath(new URL('../../../examples/demo-10-2026/001_user_001', import.meta.url));

test('shared managed seed uses real MCP, revokes importer, preserves edits on reopen and rejects old tokens in a fresh store', async t => {
  const { seedDemo, readDemoGeneration, verifyDemoBaseline } = await import('../../backend/scripts/demo/domain.mjs');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-managed-demo-source-'))), b = backend();
  const seed = await loadBundledSeed(corpus), installationId = 'a'.repeat(32);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function prepare(name) {
    const store = path.join(root, name), directory = path.join(root, `${name}-evidence`);
    await fs.mkdir(store, { mode: 0o700 }); await fs.mkdir(directory, { mode: 0o700 }); await fs.mkdir(path.join(directory, 'exports'), { mode: 0o700 });
    const config = configuration(store), identity = b.createSqliteIdentityRuntime(config, true);
    await identity.service.initialize();
    const ready = await identity.service.verifyReadyState();
    new b.SqliteMcpCredentials(identity.database, ready.state.principalId).upgrade();
    const receipt = await seedDemo({ configuration: config, directory, seed, storeId: name.padEnd(32, '0'), installationId });
    return { config, directory, receipt };
  }
  const one = await prepare('b');
  assert.equal((await verifyDemoBaseline(one)).active, 189);
  let runtime = await b.createLocalMcpApplication(one.config, { port: 0 }), a, reader;
  try {
    a = await connect(runtime.port, path.join(one.directory, 'exports/agent-a.token'));
    reader = await connect(runtime.port, path.join(one.directory, 'exports/agent-b.token'));
    const slug = 'home.demo001.presenter_note';
    await call(a, 'mutatePreferences', { operation: 'CREATE_DEFINITION', definition: { slug, displayName: 'Presenter note', description: 'Explicit rehearsal addition', valueType: 'STRING', scope: 'GLOBAL', isSensitive: true } });
    await call(a, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: { slug, value: JSON.stringify('explicit rehearsal note') } });
    const fresh = await call(reader, 'searchPreferences', { query: slug });
    assert.ok(JSON.stringify(fresh).includes('explicit rehearsal note'));
    await assert.rejects(connect(runtime.port, path.join(one.directory, 'exports/importer.token')));
  } finally { await a?.close(); await reader?.close(); await runtime.close(); }
  await b.waitForNativeOwners?.();
  assert.deepEqual(await readDemoGeneration({ ...one, installationId }), one.receipt);
  await assert.rejects(verifyDemoBaseline(one), /membership/);
  const two = await prepare('c');
  runtime = await b.createLocalMcpApplication(two.config, { port: 0 });
  try { await assert.rejects(connect(runtime.port, path.join(one.directory, 'exports/agent-a.token'))); }
  finally { await runtime.close(); }
});

test('orderly seed cancellation settles one entry, revokes importer and retains a non-publishable candidate',async t=>{
 const {seedDemo}=await import('../../backend/scripts/demo/domain.mjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-demo-cancel-'))),b=backend();t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'evidence');await fs.mkdir(directory,{mode:0o700});await fs.mkdir(path.join(directory,'exports'),{mode:0o700});
 const config=configuration(root),identity=b.createSqliteIdentityRuntime(config,true);await identity.service.initialize();const ready=await identity.service.verifyReadyState();new b.SqliteMcpCredentials(identity.database,ready.state.principalId).upgrade();
 const controller=new AbortController();let completed=0;
 await assert.rejects(seedDemo({configuration:config,directory,seed:await loadBundledSeed(corpus),storeId:'c'.repeat(32),installationId:'a'.repeat(32)},{signal:controller.signal,onProgress:progress=>{completed=progress.completed;controller.abort();}}),/never be replayed/);
 assert.equal(completed,1);await assert.rejects(fs.access(path.join(directory,'generation.json')));
 const failed=JSON.parse(await fs.readFile(path.join(directory,'failed.json')));assert.equal(failed.importerRevoked,true);assert.equal(failed.partialStateRetained,true);
 const reopened=b.createSqliteIdentityRuntime(config),state=await reopened.service.verifyReadyState();const clients=new b.SqliteMcpCredentials(reopened.database,state.state.principalId).list();assert.equal(clients.length,1);assert.equal(clients[0].revoked,true);await b.waitForNativeOwners();
});
