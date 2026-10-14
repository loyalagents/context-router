import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync,spawn} from 'node:child_process';import {once} from 'node:events';
import {withClientGuard,runForeground} from '../../../backend/scripts/demo/installed-clients.mjs';
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-foreground-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});const executable=path.join(root,'client');const c=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/demo-foreground.c'),'-o',executable],{encoding:'utf8'});assert.equal(c.status,0,c.stderr);return{root,executable};}
for(const [kind,code]of[['success',0],['error',7]])test(`supported native foreground ${kind} waits for its child and permits profile reuse`,async t=>{const f=await fixture(t);for(let i=0;i<2;i++)assert.equal(await withClientGuard(f.root,'a',guard=>runForeground({executable:f.executable,args:[kind,path.join(f.root,'marker')],env:{},cwd:f.root},guard)),code);});
test('signal termination retains the invocation record',async t=>{const f=await fixture(t);await assert.rejects(withClientGuard(f.root,'a',guard=>runForeground({executable:f.executable,args:['signal',path.join(f.root,'marker')],env:{},cwd:f.root},guard)));await assert.rejects(withClientGuard(f.root,'a',()=>{}));});
test('replaced invocation record cannot be released by the old owner',async t=>{const f=await fixture(t);await assert.rejects(withClientGuard(f.root,'a',async guard=>{await fs.writeFile(path.join(f.root,'demo/client-guards/a.json'),'{}');guard.settled();}));assert.equal(await fs.readFile(path.join(f.root,'demo/client-guards/a.json'),'utf8'),'{}');});

test('abrupt helper loss retains its guard while the owned native client is still alive',async t=>{
 const f=await fixture(t),module=path.resolve(import.meta.dirname,'../../../backend/scripts/demo/installed-clients.mjs'),marker=path.join(f.root,'marker');
 const code=`import {withClientGuard,runForeground} from ${JSON.stringify('file://'+module)};await withClientGuard(${JSON.stringify(f.root)},'a',guard=>runForeground({executable:${JSON.stringify(f.executable)},args:['linger',${JSON.stringify(marker)}],env:{},cwd:${JSON.stringify(f.root)}},guard));`;
 const helper=spawn(process.execPath,['--input-type=module','-e',code],{env:{},stdio:['ignore','pipe','pipe']}),closed=once(helper,'close');
 const deadline=performance.now()+3000;while(!await fs.access(marker).then(()=>true,()=>false)){assert.ok(performance.now()<deadline);await new Promise(r=>setTimeout(r,10));}
 helper.kill('SIGKILL');assert.equal((await closed)[1],'SIGKILL');
 await assert.rejects(withClientGuard(f.root,'a',()=>{}));
});
