import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
test('retained Terminal request exclusively writes exact quoted argv and a clean environment with Terminal type',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-terminal-request-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});
 const native=path.resolve(import.meta.dirname,'../../native'),driver=path.join(root,'driver'),client=path.join(root,"client's file");
 const built=spawnSync('/usr/bin/clang',['-fobjc-arc','-framework','Foundation','-framework','Security','-I',native,path.resolve(import.meta.dirname,'../fixtures/demo-launch-request.m'),...['demo-operation','package','envelope'].map(n=>path.join(native,n+'.m')),'-o',driver],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 await fs.writeFile(client,'#!/bin/sh\n/usr/bin/printf "%s\\n" "$@"\n/usr/bin/env\n',{mode:0o700});
 const create=()=>{const run=spawnSync(driver,[root,client],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);return run.stdout.trim();};
 const file=create(),second=create();assert.notEqual(file,second);assert.equal((await fs.stat(file)).mode&0o777,0o500);assert.equal((await fs.stat(path.dirname(file))).mode&0o777,0o700);
 const bytes=await fs.readFile(file,'utf8');assert.ok(bytes.length<16384);assert.equal(bytes.includes('secret'),false);
 const result=spawnSync('/bin/sh',[file],{env:{CR_DEMO_TOKEN:'secret',NODE_OPTIONS:'secret',ANTHROPIC_API_KEY:'secret'},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.split('\n').slice(0,7),['demo','--root',"/a root's path",'--executable',"/native;$(false)'s",'launch','A']);assert.equal(result.stdout.includes('secret'),false);assert.match(result.stdout,/TERM=xterm-256color/);
 assert.equal(await fs.readFile(file,'utf8'),bytes);await fs.rename(path.join(root,'demo/launch-requests'),path.join(root,'retained'));await fs.symlink(path.join(root,'retained'),path.join(root,'demo/launch-requests'));assert.equal(spawnSync(driver,[root,client]).status,1);
});
