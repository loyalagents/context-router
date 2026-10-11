import assert from 'node:assert/strict';import test from 'node:test';
import {spawnSync} from 'node:child_process';import {readFile,writeFile,copyFile} from 'node:fs/promises';import path from 'node:path';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';import {ended} from '../fixtures/supervisor-fixture.mjs';
const name='Qwen3.5-9B-Q4_K_M.gguf';
for(const [variant,label] of [[0,'normal'],[1,'early-exit'],[2,'ignore-term']])test(`guardian owns model ${label}, descriptors and ordered shutdown`,async t=>{
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    const exe=path.resolve(runtime,'../../model/llama-server');const r=spawnSync('/usr/bin/clang',['-Wall','-Wextra',`-DMODEL_VARIANT=${variant}`,path.resolve(import.meta.dirname,'../fixtures/model-process.c'),'-o',exe],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);
    for(const entry of ['prepare','application'])await replace(path.join(runtime,`${entry}.mjs`),'modelEnabled:false','modelEnabled:true');
    await replace(path.join(runtime,'application.mjs'),"if(cap.role==='application'", "if(command==='model-unavailable')fs.writeFileSync(path.join(cap.envelope,'models','invalidated'),'yes');if(command==='unlock')void control.send('unlock',{origin:'http://127.0.0.1:3210',unlockFile});if(cap.role==='application'");
    await replace(path.join(runtime,'application.mjs'),"await control.stopped;await control.send('drained');",`await control.stopped;fs.writeFileSync(path.join(cap.envelope,'models',${JSON.stringify(name+'.app-drained')}),'yes');await control.send('drained');`);
  });
  const run=f.launch(),ready=await run.event('ready');
  if(variant===1){assert.equal((await run.event('model-status')).state,'unavailable');run.send('unlock',ready.generation);await run.event('unlock');assert.equal(await readFile(path.join(f.envelope,'models','invalidated'),'utf8'),'yes');}
  const start=performance.now();run.send('quit',ready.generation);
  let result;if(variant===2){let timer;try{result=await Promise.race([run.child.ended,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('model escalation deadline')),27000);})]);}finally{clearTimeout(timer);}}else result=await ended(run.child);
  assert.deepEqual(result,[0,null]);assert.equal((await journal(f)).outcome,'ok');const events=await readFile(path.join(f.envelope,'models',name+'.fixture-events'),'utf8');assert.ok(events.startsWith('fd3-only\n'));assert.ok(!events.includes('before-drain'));
  if(variant!==1)assert.ok(events.includes('term-after-drain'));if(variant===2)assert.ok(performance.now()-start>=19000&&performance.now()-start<27000);
});
test('actual application entrypoint invalidates model admission and preserves unlock service',async t=>{
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    await copyFile(path.resolve(import.meta.dirname,'../../runtime/application.mjs'),path.join(runtime,'application.mjs'));
    await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import path from 'node:path';import {openManagedControl} from './control.mjs';let cap;
export const authority={revokeManagedAdmission(){},invalidateManagedModel(){fs.writeFileSync(path.join(cap.envelope,'models','invalidated'),'yes');}};
export const nativeOwners={async waitForNativeOwners(){}};export const webRoot=import.meta.dirname;
export const readPrivate=()=>JSON.stringify({version:1,modelEnabled:false,port:3212});
export async function admit(role,onCommand){cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);return {configuration:{},session:'fixture',exports:'fixture',control:await openManagedControl(cap.generation,{onStop(){},onCommand})};}
export function backend(name){if(name==='next')return ()=>({async prepare(){},getRequestHandler(){return ()=>{};},async close(){}});return {async createLocalUiApplication(){return {port:3210,mcpPort:3211,issueUnlock(){const file=path.join(cap.envelope,'exports',cap.generation,'unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token');fs.writeFileSync(file,'fixture',{mode:0o600});return {path:file};},async close(){}};}};}`);
  });
  const run=f.launch(),ready=await run.event('ready');run.send('model-unavailable',ready.generation);run.send('unlock',ready.generation);await run.event('unlock');assert.equal(await readFile(path.join(f.envelope,'models','invalidated'),'utf8'),'yes');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);
});
