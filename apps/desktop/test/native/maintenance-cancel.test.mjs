import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';
import {ended} from '../fixtures/supervisor-fixture.mjs';

test('completion racing a queued quit survives command EPIPE with matching normal exit',async t=>{
  const f=await editedFixture(t,'normal',runtime=>writeFile(path.join(runtime,'maintenance.mjs'),`import fs from 'node:fs';const cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);const bytes=Buffer.alloc(16384);const n=fs.readSync(5,bytes);if(JSON.parse(bytes.subarray(0,n)).command!=='start')throw new Error();fs.closeSync(5);process.stdout.write('control-closed\\n');await new Promise(r=>setTimeout(r,200));fs.writeSync(6,JSON.stringify({version:1,generation:cap.generation,type:'maintenance-complete',exitCode:0})+'\\n');fs.closeSync(6);`));
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);await ended(run.child);
  const child=spawn(f.executable,['--root',f.envelope,'mcp','list'],{env:{},stdio:['ignore','pipe','pipe']});child.ended=once(child,'close');child.stderr.resume();await once(child.stdout,'data');child.stdout.resume();child.kill('SIGINT');assert.deepEqual(await ended(child),[0,null]);assert.equal((await journal(f)).outcome,'ok');
});
for(const variant of ['signalled-after-ack','unresponsive'])test(`maintenance ${variant} cannot claim certain completion`,async t=>{
  const f=await editedFixture(t,'normal',runtime=>writeFile(path.join(runtime,'maintenance.mjs'),`import fs from 'node:fs';const cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);const bytes=Buffer.alloc(16384);fs.readSync(5,bytes);fs.closeSync(5);
${variant==='signalled-after-ack'?"fs.writeSync(6,JSON.stringify({version:1,generation:cap.generation,type:'maintenance-complete',exitCode:0})+'\\n');process.kill(process.pid,'SIGKILL');":"process.on('SIGTERM',()=>{});process.stdout.write('waiting\\n');setInterval(()=>{},1000);"}`));
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);await ended(run.child);
  const child=spawn(f.executable,['--root',f.envelope,'mcp','list'],{env:{},stdio:['ignore','pipe','pipe']});child.ended=once(child,'close');child.stderr.resume();
  if(variant==='unresponsive'){await once(child.stdout,'data');child.kill('SIGINT');}child.stdout.resume();
  let timer;try{assert.deepEqual(await Promise.race([child.ended,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('maintenance exact exit deadline')),28000);})]),[1,null]);}finally{clearTimeout(timer);}
  assert.equal((await journal(f)).outcome,'uncertain');
});

for(const signal of ['SIGINT','SIGTERM','SIGHUP'])test(`orderly installed CLI ${signal} leaves failed quiescence and permits subsequent administration`,async t=>{
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'maintenance.mjs'),"await control.send('maintenance-complete',{exitCode:0});await control.close();process.exitCode=0;", "if(process.argv[3]==='rotate'){await control.stopped;await control.send('maintenance-complete',{exitCode:1});await control.close();process.exitCode=1;}else{await control.send('maintenance-complete',{exitCode:0});await control.close();}"));
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);await ended(run.child);
  const child=spawn(f.executable,['--root',f.envelope,'identity','rotate'],{env:{},stdio:['ignore','pipe','pipe']});child.ended=once(child,'close');child.stderr.resume();
  await once(child.stdout,'data');child.stdout.resume();child.kill(signal);const result=await ended(child);
  // SIGHUP initially leaves an active journal: preserve that failed fixture for diagnosis.
  assert.deepEqual(result,[1,null]);assert.equal((await journal(f)).outcome,'failed');
  const next=spawnSync(f.executable,['--root',f.envelope,'mcp','list'],{env:{},encoding:'utf8',timeout:6000});assert.equal(next.status,0,next.stderr);await journal(f);
});
for(const entry of ['maintenance','prepare-store'])test(`actual ${entry} acknowledges explicit quit after native-owner drain`,async t=>{
  const f=await editedFixture(t,'normal',async runtime=>{
    await copyFile(path.resolve(import.meta.dirname,`../../runtime/${entry}.mjs`),path.join(runtime,`${entry}.mjs`));
    await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import {openManagedControl} from './control.mjs';
let control,drained=false;export const authority={revokeManagedAdmission(){}};
export const nativeOwners={async waitForNativeOwners(){drained=true;}};
export async function admit(){const cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);control=await openManagedControl(cap.generation,{onStop(){},onCommand(){}});const send=control.send.bind(control);control.send=(...args)=>{if(!drained)throw new Error('completion before drain');return send(...args);};return {cap,control,configuration:{}};}
export function backend(){return {async runLocalMcp(){process.stdout.write('waiting\\n');await control.stopped;return 0;},async prepareManagedStore(){fs.writeFileSync(${JSON.stringify(path.join(runtime,'waiting'))},'ready');await control.stopped;return {targetId:'A'.repeat(43)};}};}`);
  });
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);await ended(run.child);
  const args=entry==='maintenance'?['mcp','list']:['resume-setup'];
  const child=spawn(f.executable,['--root',f.envelope,...args],{env:{},stdio:['ignore','pipe','pipe']});child.ended=once(child,'close');child.stderr.resume();child.stdout.resume();
  if(entry==='maintenance')await once(child.stdout,'data');else{
    const {stat}=await import('node:fs/promises');const deadline=Date.now()+5000;
    while(!await stat(path.join(f.runtime,'waiting')).catch(()=>false)){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
  }
  child.kill('SIGINT');assert.deepEqual(await ended(child),[1,null]);assert.equal((await journal(f)).outcome,'failed');
});
