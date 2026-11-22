import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';
import {launchInstalledClient,withClientGuard} from '../../../backend/scripts/demo/installed-clients.mjs';
import {readConnectProgress} from '../../../backend/scripts/demo/claude-connect.mjs';
test('installed connect overlaps two coding chats, preserves a legacy guard, signs in once, and refuses request replay',async t=>{
 let dir;const attempts=[],pids=[];t.after(async()=>{if(!dir)return;await fs.rm(path.join(dir,'hold-chats'),{force:true});await Promise.allSettled(attempts);for(const file of await fs.readdir(dir).catch(()=>[])){if(!/^chat-\d+\.tmp$/.test(file))continue;const temporary=await fs.readFile(path.join(dir,file),'utf8');assert.match(temporary,/^\/private\/tmp\/cr-code-[A-Za-z0-9]{6}$/);await fs.rm(temporary,{recursive:true,force:true});}});
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready');const after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
 const installation=JSON.parse(await fs.readFile(path.join(f.envelope,'installation.json')));dir=path.join(f.top,'project');await fs.mkdir(dir,{mode:0o700});await fs.writeFile(path.join(dir,'README.md'),'synthetic project');
 const executable=path.join(f.top,'claude'),build=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/claude-connect-client.c'),'-o',executable],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const exports=path.join(f.envelope,'demo',installation.demoStore,'exports');await fs.mkdir(exports,{mode:0o700,recursive:true});await fs.writeFile(path.join(exports,'agent-b.token'),'cr_mcp_'+ 'B'.repeat(22)+'.'+ 'T'.repeat(43)+'\n',{mode:0o600});
 const spec={root:f.envelope,store:installation.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin},options={role:'b',command:'claude',connect:true,project:dir,auth:'subscription',executable};
 await withClientGuard(f.envelope,'b',async()=>{
  await assert.rejects(launchInstalledClient(spec,{...options,request:'d'.repeat(32)}),/earlier demo setup/);
 });
 assert.equal(await launchInstalledClient(spec,{...options,request:'c'.repeat(32)}),0);
 for(const name of (await fs.readdir(dir)).filter(name=>/^chat-\d+\.ready$/.test(name)))await fs.rm(path.join(dir,name));
 await fs.writeFile(path.join(dir,'hold-chats'),'');

 async function waitForChats(count){const deadline=Date.now()+20000;while((await fs.readdir(dir)).filter(name=>/^chat-\d+\.ready$/.test(name)).length<count){assert.ok(Date.now()<deadline,'both foreground chats must start before either exits');await new Promise(resolve=>setTimeout(resolve,30));}}
 // An old-version chat may still own b.json. Never delete or reclaim it.
 await withClientGuard(f.envelope,'b',async()=>{
  const legacy=await fs.readFile(path.join(f.envelope,'demo/client-guards/b.json'),'utf8');
  for(const request of ['a'.repeat(32),'b'.repeat(32)]){
   const attempt=launchInstalledClient(spec,{...options,request});attempt.catch(()=>{});attempts.push(attempt);await waitForChats(attempts.length);
   const pid=(await fs.readdir(dir)).filter(name=>/^chat-\d+\.ready$/.test(name)).map(name=>Number(name.slice(5,-6))).find(pid=>!pids.includes(pid));pids.push(pid);
   assert.equal(await readConnectProgress({...spec,installationId:installation.installationId},request),'starting');
   await fs.access(path.join(f.envelope,'demo/client-guards',`b-session-${request}.json`));
   await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b-setup.json')));
  }
  assert.equal(await fs.readFile(path.join(f.envelope,'demo/client-guards/b.json'),'utf8'),legacy);
  for(const name of (await fs.readdir(dir)).filter(name=>/^chat-\d+\.ready$/.test(name)))process.kill(Number(name.slice(5,-6)),0);
  await fs.writeFile(path.join(dir,`chat-${pids[0]}.release`),'');assert.equal(await attempts[0],0);
  process.kill(pids[1],0);assert.equal(await readConnectProgress({...spec,installationId:installation.installationId},'b'.repeat(32)),'starting');
  await fs.rm(path.join(dir,'hold-chats'));assert.equal(await attempts[1],0);
 });
 for(const request of ['a'.repeat(32),'b'.repeat(32)]){
  assert.equal(await readConnectProgress({...spec,installationId:installation.installationId},request),'exited');
  await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards',`b-session-${request}.json`)));
 }
 assert.equal(await fs.readFile(path.join(dir,'coding-result.txt'),'utf8'),'demo coding works');
 await assert.rejects(launchInstalledClient(spec,{...options,request:'a'.repeat(32)}),/already used/);
 await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b.json')));
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
});
