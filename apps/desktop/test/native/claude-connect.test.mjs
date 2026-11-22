import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';
import {launchInstalledClient} from '../../../backend/scripts/demo/installed-clients.mjs';
import {readConnectProgress} from '../../../backend/scripts/demo/claude-connect.mjs';
test('installed connect signs in once, runs a real coding tool in the chosen nonempty project, reuses login, and refuses request replay',async t=>{
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready');const after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
 const installation=JSON.parse(await fs.readFile(path.join(f.envelope,'installation.json'))),dir=path.join(f.top,'project');await fs.mkdir(dir,{mode:0o700});await fs.writeFile(path.join(dir,'README.md'),'synthetic project');
 const executable=path.join(f.top,'claude'),build=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/claude-connect-client.c'),'-o',executable],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const exports=path.join(f.envelope,'demo',installation.demoStore,'exports');await fs.mkdir(exports,{mode:0o700,recursive:true});await fs.writeFile(path.join(exports,'agent-b.token'),'cr_mcp_'+ 'B'.repeat(22)+'.'+ 'T'.repeat(43)+'\n',{mode:0o600});
 const spec={root:f.envelope,store:installation.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin},options={role:'b',command:'claude',connect:true,project:dir,auth:'subscription',executable};
 for(const request of ['a'.repeat(32),'b'.repeat(32)]){
  assert.equal(await launchInstalledClient(spec,{...options,request}),0);
  assert.equal(await fs.readFile(path.join(dir,'coding-result.txt'),'utf8'),'demo coding works');
  assert.equal(await readConnectProgress({...spec,installationId:installation.installationId},request),'exited');
 }
 await assert.rejects(launchInstalledClient(spec,{...options,request:'a'.repeat(32)}),/already used/);
 await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b.json')));
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
});
