import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,realpath,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {writeSignedFixture} from './signed-package.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function ended(child){let timer;try{return await Promise.race([child.ended,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('exact guardian exit deadline')),6000);})]);}finally{clearTimeout(timer);}}
export async function fixture(t,variant='normal') {
  const top=await realpath(await mkdtemp(path.join(os.tmpdir(),'desktop-supervisor-'))),bundle=path.join(top,'Fixture.app'),envelope=path.join(top,'managed-v1');
  const executable=path.join(bundle,'Contents/MacOS/context-router'),resources=path.join(bundle,'Contents/Resources'),runtime=path.join(resources,'desktop/runtime');
  for(const dir of [path.dirname(executable),runtime,path.join(resources,'bin'),path.join(resources,'model'),path.join(resources,'app')])await mkdir(dir,{recursive:true});
  await copyFile(path.resolve(import.meta.dirname,'../../build/context-router'),executable);
  await copyFile(process.execPath,path.join(resources,'bin/node'));
  await writeFile(path.join(resources,'model/llama-server'),'fixture not executed',{mode:0o755});
  await writeFile(path.join(resources,'app/local-ui.mjs'),'// fixture');
  await copyFile(path.resolve(import.meta.dirname,'../../runtime/control.mjs'),path.join(runtime,'control.mjs'));
  const common=`import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {openManagedControl} from './control.mjs';
const cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);
const guardian=path.resolve(import.meta.dirname,'../../../MacOS/context-router');
if(execFileSync(guardian,['verify-inherited'],{env:{},stdio:['ignore','pipe','ignore',3]}).toString().trim()!==cap.bootId)throw new Error();
const control=await openManagedControl(cap.generation,{onStop:()=>{},onCommand:command=>{if(cap.role==='application'&&${JSON.stringify(variant)}==='status-eof'&&command==='unlock')fs.closeSync(6);}},{allowOrderlyStopDuringStart:cap.role==='demo-prepare'});
const pair=path.join(cap.envelope,'stores',cap.storeId);`;
  await writeFile(path.join(runtime,'prepare.mjs'),common+`
if(cap.operation==='initialize'){for(const name of ['data','identity'])fs.mkdirSync(path.join(pair,name),{mode:0o700});fs.writeFileSync(path.join(pair,'identity/identity.json'),JSON.stringify({databaseTargetId:'A'.repeat(43),principalId:'P'.repeat(43)}),{mode:0o600});}
if(cap.mode==='demo'&&(${JSON.stringify(variant)}==='demo-prepare-failure'||JSON.parse(fs.readFileSync(path.join(cap.envelope,'demo',cap.storeId,'generation.json'))).status!=='complete')){await control.send('failed',{category:'prepare-failed'});await control.close();process.exit(1);}
await control.send('prepared',{targetId:cap.mode==='demo'?'D'.repeat(43):'A'.repeat(43),modelEnabled:false,modelPort:Number(process.argv[2])});await control.close();`);
  await writeFile(path.join(runtime,'application.mjs'),common+`
const unlockFile=path.join(cap.envelope,'exports',cap.generation,'unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token');fs.writeFileSync(unlockFile,'fixture',{mode:0o600});
await control.send('ready',{origin:'http://127.0.0.1:3210',mcpOrigin:'http://127.0.0.1:'+process.argv[3]+'/mcp',unlockFile,modelEnabled:false});
if(cap.mode==='demo'&&['demo-drained-failure','demo-undrained-failure'].includes(${JSON.stringify(variant)})){await control.send('failed',{category:'application-failed'});if(${JSON.stringify(variant)}==='demo-drained-failure')await control.send('drained');await control.close();process.exit(1);}
${variant==='busy'?"await control.send('model-status',{state:'busy'});":''}
${variant==='lost-app' ? 'process.exit(2);' : variant==='status-eof' ? 'await control.stopped;await control.close();' : variant==='unsolicited-drain' ? "await control.send('drained');await control.stopped;await control.close();" : "await control.stopped;await control.send('drained');await control.close();"+(variant==='failed-exit'?'process.exitCode=2;':'')}`);
  if(variant==='failed-startup') {
    // Actual product application cleanup around a backend whose partial cleanup failed.
    await copyFile(path.resolve(import.meta.dirname,'../../runtime/application.mjs'),path.join(runtime,'application.mjs'));
    await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import {openManagedControl} from './control.mjs';
export const authority={revokeManagedAdmission(){},invalidateManagedModel(){}};
export const nativeOwners={async waitForNativeOwners(){}};export const webRoot=import.meta.dirname;
export const readPrivate=()=>JSON.stringify({version:1,modelEnabled:false,port:3212});
export async function admit(role,onCommand){const cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);return {configuration:{},session:'fixture',exports:'fixture',control:await openManagedControl(cap.generation,{onStop(){},onCommand})};}
export function backend(name){if(name==='next')return ()=>({async prepare(){},getRequestHandler(){return ()=>{};},async close(){}});return {async createLocalUiApplication(){throw new Error('simulated failed partial cleanup');}};}`);
  }
  for(const name of ['maintenance','download','prepare-store'])await writeFile(path.join(runtime,`${name}.mjs`),'// fixture');
  await writeFile(path.join(runtime,'maintenance.mjs'),common+`
if(cap.operation==='backup'){if(fs.existsSync(path.join(cap.envelope,'exports',cap.generation)))throw new Error('backup destination exists');}
if(cap.operation==='restore'){fs.mkdirSync(pair,{mode:0o700});for(const name of ['data','identity'])fs.mkdirSync(path.join(pair,name),{mode:0o700});fs.writeFileSync(path.join(pair,'identity/identity.json'),JSON.stringify({databaseTargetId:'B'.repeat(43)}),{mode:0o600});}
process.stdout.write(JSON.stringify({operation:cap.operation,store:cap.storeId,args:process.argv.slice(2)})+'\\n');
${variant==='maintenance-eof'?'fs.closeSync(6);await control.stopped;':''}
await control.send('maintenance-complete',{exitCode:${variant==='maintenance-failure'?2:0}});await control.close();process.exitCode=${['maintenance-failure','maintenance-mismatch'].includes(variant)?2:0};`);
  await copyFile(path.resolve(import.meta.dirname,'../../runtime/lifetime.mjs'),path.join(runtime,'lifetime.mjs'));
  if(variant==='download')await writeFile(path.join(runtime,'download.mjs'),`import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {openManagedControl} from './control.mjs';import {admitDownloadLifetime} from './lifetime.mjs';
process.on('uncaughtException',error=>{fs.writeFileSync(${JSON.stringify(path.join(top,'fixture-error.json'))},JSON.stringify({message:error.message,stack:error.stack}),{mode:0o600});process.exitCode=1;});
const [models,generation]=process.argv.slice(2);if(path.basename(models)!=='models'||!fs.fstatSync(3).isFile())throw new Error();
const lifetime=admitDownloadLifetime(models,generation);lifetime.assertHeld();
execFileSync(path.resolve(import.meta.dirname,'../../../MacOS/context-router'),['verify-inherited'],{env:{},stdio:['ignore','pipe','ignore',3]});
const control=await openManagedControl(generation,{onStop(){},onCommand(){}});await control.send('download-progress',{received:1,total:5680522464});await control.stopped;await control.send('download-cancelled');await control.close();`);
  await writeFile(path.join(resources,'demo-seed.json'),JSON.stringify({version:'historical-2024-2025-v1',sha256:'a'.repeat(64)}));
  await writeFile(path.join(runtime,'demo-prepare.mjs'),common+`
for(const name of ['data','identity'])fs.mkdirSync(path.join(pair,name),{mode:0o700});
fs.writeFileSync(path.join(pair,'identity/identity.json'),JSON.stringify({databaseTargetId:'D'.repeat(43),principalId:'P'.repeat(43)}),{mode:0o600});
if(['demo-failure','demo-slow','demo-retry'].includes(${JSON.stringify(variant)})){if(${JSON.stringify(variant)}==='demo-slow')await control.stopped;if(${JSON.stringify(variant)}==='demo-retry'){const attempted=path.join(cap.envelope,'demo','fixture-attempted');if(fs.existsSync(attempted))await control.stopped;else fs.writeFileSync(attempted,'failed',{mode:0o600});}await control.send('demo-complete',{exitCode:1});await control.close();process.exitCode=1;}
else {fs.writeFileSync(path.join(cap.envelope,'demo',cap.storeId,'generation.json'),JSON.stringify({version:1,status:'complete',installationId:cap.installationId,storeId:cap.storeId,principalId:'P'.repeat(43),targetId:'D'.repeat(43),seedVersion:'historical-2024-2025-v1',seedSha256:'a'.repeat(64),planSha256:'b'.repeat(64),importerId:'I'.repeat(22),clients:{agentA:'A'.repeat(22),agentB:'B'.repeat(22),agentC:'C'.repeat(22)}}),{mode:0o600});await control.send('demo-complete',{exitCode:0});if(${JSON.stringify(variant)}==='demo-late')await control.stopped;await control.close();}
`);
  await writeFile(path.join(runtime,'demo.mjs'),`import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const code=\`const fs=require('node:fs');const fds=[];for(let i=20;i<24;i++){try{fs.fstatSync(i);fds.push(i);}catch{}}console.log(JSON.stringify({fds,env:process.env}));\`;
const child=spawnSync(process.execPath,['-e',code],{env:{PATH:'',CR_DEMO_TOKEN:'synthetic-demo-only'},stdio:['ignore','pipe','pipe'],encoding:'utf8'});
const fds=[];for(let i=20;i<24;i++){try{fs.fstatSync(i);fds.push(i);}catch{}}console.log(JSON.stringify({wrapper:process.env,fds,child:JSON.parse(child.stdout)}));`);
  await writeSignedFixture(bundle);
  const children=[],accepted=[];let retainEvidence=false;
  t.after(async()=>{
    let uncertain=false;
    for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.stdin.end();const deadline=performance.now()+28000;
      while(child.exitCode===null&&child.signalCode===null&&performance.now()<deadline)await wait(20);
      if(child.exitCode===null&&child.signalCode===null){uncertain=true;child.kill('SIGTERM');}
      else await child.ended;
    }
    if(uncertain)throw new Error(`Fixture ownership uncertain; preserve ${top}`);
    let journal;try{journal=JSON.parse(await readFile(path.join(envelope,'owner.json')));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(journal&&(journal.lifecycle!=='quiescent'||(!accepted.some(j=>JSON.stringify(j)===JSON.stringify(journal))&&!children.some(child=>child.events.some(event=>event.type==='stopped'&&event.generation===journal.generation&&event.outcome===journal.outcome)))))throw new Error(`Cohort quiescence unproved; preserve ${top}`);
    if(retainEvidence)t.diagnostic(`Expected uncertain control outcome retained: ${top}`);
    else await rm(top,{recursive:true,force:true});
  });
  function launch(){
    const child=spawn(executable,['guardian','--root',envelope,'--ui-port','3210','--mcp-port','3211','--demo-mcp-port','3213'],{env:{},stdio:['pipe','pipe','pipe']});children.push(child);child.ended=once(child,'close');
    const events=[];child.events=events;let pending='',diagnostic='';child.stdin.on('error',()=>{});child.stderr.on('data',bytes=>{diagnostic+=bytes;});child.stdout.on('data',bytes=>{pending+=bytes;let end;while((end=pending.indexOf('\n'))>=0){events.push(JSON.parse(pending.slice(0,end)));pending=pending.slice(end+1);}});
    const event=async(type,after=0)=>{const deadline=performance.now()+6000;while(!events.slice(after).some(e=>e.type===type)){assert.ok(child.exitCode===null&&child.signalCode===null,diagnostic);assert.ok(performance.now()<deadline,JSON.stringify(events)+(await readFile(path.join(top,'fixture-error.json'),'utf8').catch(()=>'')));await wait(10);}return events.slice(after).find(e=>e.type===type);};
    const send=(command,generation)=>child.stdin.write(JSON.stringify({version:1,generation,command})+'\n');
    return{child,event,events,send};
  }
  return{launch,envelope,executable,top,acceptQuiescent:journal=>{assert.equal(journal.lifecycle,'quiescent');accepted.push(journal);},retainQuiescent:journal=>{assert.equal(journal.lifecycle,'quiescent');assert.equal(journal.outcome,'uncertain');accepted.push(journal);retainEvidence=true;}};
}
