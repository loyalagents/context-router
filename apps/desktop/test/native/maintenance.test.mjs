import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';
const cli=(f,args)=>spawnSync(f.executable,['--root',f.envelope,...args],{env:{},encoding:'utf8',timeout:8000});
async function ready(t,variant){const f=await fixture(t,variant),run=f.launch(),r=await run.event('ready');run.send('quit',r.generation);assert.equal((await ended(run.child))[0],0);return f;}
for(const [variant,expected,outcome] of [['normal',0,'ok'],['maintenance-failure',2,'failed'],['maintenance-mismatch',1,'uncertain'],['maintenance-eof',1,'uncertain']])test(`native installed CLI requires matching completion and actual exit (${variant})`,async t=>{
  const f=await ready(t,variant),result=cli(f,['mcp','list']);assert.equal(result.status,expected,result.stderr);assert.equal(JSON.parse(result.stdout).operation,'admin');
  const j=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));assert.equal(j.lifecycle,'quiescent');assert.equal(j.outcome,outcome);
  f.acceptQuiescent(j);
});
test('native CLI excludes a running application and refuses missing pending selection',async t=>{
  const f=await fixture(t),run=f.launch(),r=await run.event('ready');assert.equal(cli(f,['mcp','list']).status,1);run.send('quit',r.generation);await ended(run.child);
  assert.equal(cli(f,['--pending-store','e'.repeat(32),'mcp','list']).status,1);
});
test('native restore preserves selection until explicit verified activation; pending admin is explicit',async t=>{
  const f=await ready(t),file=path.join(f.envelope,'installation.json'),original=JSON.parse(await readFile(file)),source=path.join(f.top,'backup');await mkdir(source,{mode:0o700});await writeFile(path.join(source,'complete.json'),'{}',{mode:0o600});
  const restored=cli(f,['restore','--from',source]);assert.equal(restored.status,0,restored.stderr);const pending=JSON.parse(await readFile(file));assert.equal(pending.selectedStore,original.selectedStore);assert.equal(pending.pendingRestore.status,'complete');
  assert.equal(cli(f,['mcp','list']).status,1);assert.equal(cli(f,['--pending-store',pending.pendingRestore.storeId,'mcp','list']).status,0);
  assert.equal(cli(f,['activate-restore',pending.pendingRestore.storeId]).status,1);
  assert.equal(cli(f,['activate-restore',pending.pendingRestore.storeId,'--acknowledge-restored-authority']).status,0);
  const active=JSON.parse(await readFile(file));assert.equal(active.selectedStore,pending.pendingRestore.storeId);assert.equal(active.pendingRestore,null);f.acceptQuiescent(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))));
});
