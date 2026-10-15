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
test('native rename forwards exact arguments, advertises help and retains running-app exclusion',async t=>{
  const f=await fixture(t),run=f.launch(),r=await run.event('ready');
  const args=['mcp','rename','--id','--'+'A'.repeat(20),'--label','My laptop'];
  assert.equal(cli(f,args).status,1);
  run.send('quit',r.generation);assert.equal((await ended(run.child))[0],0);
  const renamed=cli(f,args);assert.equal(renamed.status,0,renamed.stderr);
  assert.deepEqual(JSON.parse(renamed.stdout).args,args);
  assert.match(spawnSync(f.executable,['--help'],{env:{},encoding:'utf8'}).stdout,/rename/);
  assert.equal(cli(f,['mcp','renam']).status,1);
  f.acceptQuiescent(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))));
});
test('native rename rejects Unicode format characters before maintenance and forwards ordinary Unicode names',async t=>{
  const f=await ready(t),owner=path.join(f.envelope,'owner.json'),installation=path.join(f.envelope,'installation.json');
  const beforeOwner=await readFile(owner,'utf8'),beforeInstallation=await readFile(installation,'utf8');
  for(const label of ['👩\u200d💻 laptop','\u202Elaptop']){
    const result=cli(f,['mcp','rename','--id','A'.repeat(22),'--label',label]);
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(await readFile(owner,'utf8'),beforeOwner,'rejected label must not start a maintenance generation');
    assert.equal(await readFile(installation,'utf8'),beforeInstallation);
  }
  const args=['mcp','rename','--id','A'.repeat(22),'--label','Café 東京 💻'];
  const accepted=cli(f,args);assert.equal(accepted.status,0,accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout).args,args);
  f.acceptQuiescent(JSON.parse(await readFile(owner)));
});
test('offline admin defaults to personal even after demo selection and demo recovery is forbidden',async t=>{
  const f=await fixture(t),r=f.launch();let ready=await r.event('ready');
  r.send('enter-demo',ready.generation);ready=await r.event('ready',r.events.length);
  r.send('quit',ready.generation);await ended(r.child);
  const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));
  const personal=cli(f,['mcp','list']);assert.equal(personal.status,0,personal.stderr);assert.equal(JSON.parse(personal.stdout).store,state.personalStore);
  const demo=cli(f,['--mode','demo','mcp','list']);assert.equal(demo.status,0,demo.stderr);assert.equal(JSON.parse(demo.stdout).store,state.demoStore);
  assert.match(personal.stderr,/Managed mode: personal\n/);assert.match(demo.stderr,/Managed mode: demo\n/);
  const args=['mcp','rename','--id','A'.repeat(22),'--label','Demo laptop'];
  for(const [prefix,store] of [[[],state.personalStore],[['--mode','personal'],state.personalStore],[['--mode','demo'],state.demoStore]]){
    const renamed=cli(f,[...prefix,...args]);assert.equal(renamed.status,0,renamed.stderr);
    assert.equal(JSON.parse(renamed.stdout).store,store);assert.deepEqual(JSON.parse(renamed.stdout).args,args);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),state,'offline rename must not change active selection');
  for(const args of [['backup'],['identity','rotate'],['resume-setup'],['cleanup-downloads']])assert.equal(cli(f,['--mode','demo',...args]).status,1);
  f.acceptQuiescent(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))));
});
