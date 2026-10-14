import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';

for(const signal of ['SIGINT','SIGTERM','SIGHUP'])test(`interrupted synchronous preflight unwinds before profile mutation and releases its exact guard (${signal})`,async t=>{
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready');const after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
 const state=JSON.parse(await fs.readFile(path.join(f.envelope,'installation.json'))),directory=path.join(f.envelope,'demo/client-fixture');await fs.mkdir(directory,{mode:0o700});
 const executable=path.join(directory,'claude'),built=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/demo-preflight.c'),'-o',executable],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const spec={root:f.envelope,store:state.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin},module=path.resolve(import.meta.dirname,'../../../backend/scripts/demo/installed-clients.mjs');
 const launch=()=>{const child=spawn(process.execPath,['--input-type=module','-e',`import {launchInstalledClient} from ${JSON.stringify('file://'+module)};try{process.exitCode=await launchInstalledClient(${JSON.stringify(spec)},{role:'b',command:'claude',auth:'api-key',login:true,executable:${JSON.stringify(executable)}});}catch{process.exitCode=1;}`],{env:{},stdio:['ignore','pipe','pipe']});const closed=once(child,'close');let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return{child,closed,output:()=>output};};
 const first=launch(),deadline=performance.now()+3000;while(!await fs.access(path.join(directory,'preflight')).then(()=>true,()=>false)){assert.ok(performance.now()<deadline,first.output());await new Promise(resolve=>setTimeout(resolve,10));}
 first.child.kill(signal);await new Promise(resolve=>setTimeout(resolve,30));await fs.writeFile(path.join(directory,'continue'),'');
 assert.deepEqual(await first.closed,[1,null],first.output());await assert.rejects(fs.access(path.join(directory,'launched')));await assert.rejects(fs.access(path.join(f.envelope,'demo/profiles')));await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b.json')));
 assert.match(first.output(),/Checking.*client|preflight/i);const second=launch();assert.deepEqual(await second.closed,[0,null],second.output());await fs.access(path.join(directory,'launched'));await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b.json')));
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
});

test('reset during qualified native client preflight refuses the old command before profile creation or session spawn',async t=>{
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready');let after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
 const state=JSON.parse(await fs.readFile(path.join(f.envelope,'installation.json'))),directory=path.join(f.envelope,'demo/client-fixture');await fs.mkdir(directory,{mode:0o700});
 const executable=path.join(directory,'claude'),built=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/demo-preflight.c'),'-o',executable],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const spec={root:f.envelope,store:state.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin},module=path.resolve(import.meta.dirname,'../../../backend/scripts/demo/installed-clients.mjs');
 const helper=spawn(process.execPath,['--input-type=module','-e',`import {launchInstalledClient} from ${JSON.stringify('file://'+module)};try{await launchInstalledClient(${JSON.stringify(spec)},{role:'b',command:'claude',auth:'api-key',login:true,executable:${JSON.stringify(executable)}});process.exitCode=2;}catch{process.exitCode=0;}`],{env:{},stdio:['ignore','pipe','pipe']}),closed=once(helper,'close');let error='';helper.stderr.on('data',b=>error+=b);
 const deadline=performance.now()+3000;while(!await fs.access(path.join(directory,'preflight')).then(()=>true,()=>false)){assert.ok(performance.now()<deadline,error);await new Promise(resolve=>setTimeout(resolve,10));}
 after=r.events.length;r.send('reset-demo',ready.generation);ready=await r.event('ready',after);await fs.writeFile(path.join(directory,'continue'),'');
 assert.equal((await closed)[0],0,error);await assert.rejects(fs.access(path.join(directory,'launched')));await assert.rejects(fs.access(path.join(f.envelope,'demo/profiles')));await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards/b.json')));
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
});
