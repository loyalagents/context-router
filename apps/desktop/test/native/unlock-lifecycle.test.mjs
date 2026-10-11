import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {copyFile,writeFile,stat} from 'node:fs/promises';
import {ended} from '../fixtures/supervisor-fixture.mjs';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';

async function actualApplication(runtime){
  await copyFile(path.resolve(import.meta.dirname,'../../runtime/application.mjs'),path.join(runtime,'application.mjs'));
  await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import path from 'node:path';import {openManagedControl} from './control.mjs';
let cap,current,issued=0;export const authority={revokeManagedAdmission(){},invalidateManagedModel(){}};
export const nativeOwners={async waitForNativeOwners(){}};export const webRoot=import.meta.dirname;
export const readPrivate=()=>JSON.stringify({version:1,modelEnabled:false,port:3212});
export async function admit(role,onCommand){cap=JSON.parse(fs.readFileSync(4));fs.closeSync(4);return {configuration:{},session:'fixture',exports:path.join(cap.envelope,'exports',cap.generation),control:await openManagedControl(cap.generation,{onStop(){},onCommand})};}
function forget(){if(current){fs.unlinkSync(current);current=undefined;}}
export function backend(name){if(name==='next')return ()=>({async prepare(){},getRequestHandler(){return ()=>{};},async close(){}});return {async createLocalUiApplication(){return {port:3210,mcpPort:3211,issueUnlock(){forget();current=path.join(cap.envelope,'exports',cap.generation,'unlock-aaaaaaaa-aaaa-4aaa-aaaa-'+String(++issued).padStart(12,'0')+'.token');fs.writeFileSync(current,'fixture',{mode:0o600});return {path:current};},async close(){forget();}};}};}`);
}
async function relaunch(f){const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);await journal(f);}
test('actual application unlock then quit survives deletion of the in-flight token during close',async t=>{
  const f=await editedFixture(t,'normal',actualApplication),run=f.launch(),ready=await run.event('ready');
  run.child.stdin.write(['unlock','quit'].map(command=>JSON.stringify({version:1,generation:ready.generation,command})+'\n').join(''));
  assert.deepEqual(await ended(run.child),[0,null]);assert.equal((await journal(f)).outcome,'ok');await relaunch(f);
});
test('actual application replacing queued unlock tokens preserves readiness and fresh delivery',async t=>{
  const f=await editedFixture(t,'normal',actualApplication),run=f.launch(),ready=await run.event('ready');
  run.child.stdin.write(['unlock','unlock'].map(command=>JSON.stringify({version:1,generation:ready.generation,command})+'\n').join(''));
  // The first delivery may precede its replacement; only the final token must remain.
  let received,after=0;do{received=await run.event('unlock',after);after=run.events.indexOf(received)+1;}while(!received.unlockFile.endsWith('000000000003.token'));
  await stat(received.unlockFile);
  run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);assert.equal((await journal(f)).outcome,'ok');
});
test('actual application unlock then restart drains the old generation and leaves administration available',async t=>{
  const f=await editedFixture(t,'normal',actualApplication),run=f.launch(),ready=await run.event('ready'),after=run.events.length;
  run.child.stdin.write(['unlock','restart'].map(command=>JSON.stringify({version:1,generation:ready.generation,command})+'\n').join(''));
  const restarted=await run.event('ready',after);assert.notEqual(restarted.generation,ready.generation);assert.ok(run.events.some(record=>record.type==='stopped'&&record.generation===ready.generation&&record.outcome==='ok'));
  run.send('quit',restarted.generation);assert.deepEqual(await ended(run.child),[0,null]);assert.equal((await journal(f)).outcome,'ok');
  const next=spawnSync(f.executable,['--root',f.envelope,'mcp','list'],{env:{},encoding:'utf8',timeout:6000});assert.equal(next.status,0,next.stderr);await journal(f);
});
for(const malformed of [false,'generation','origin','unlockFile'])test(`late ready with removed token preserves protocol validation (malformed=${malformed})`,async t=>{
  const bad=malformed==='generation'?'b'.repeat(32):malformed==='origin'?'http://localhost:3210':'/tmp/invalid.token';
  const injection=malformed?`control.send=async(type,payload={})=>{const record={version:1,generation:cap.generation,type,...payload};if(type==='ready')record[${JSON.stringify(malformed)}]=${JSON.stringify(bad)};fs.writeSync(6,JSON.stringify(record)+'\\n');};`:'';
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"await control.send('ready'",`fs.writeFileSync(${JSON.stringify(path.join(runtime,'waiting'))},'ready');await control.stopped;fs.unlinkSync(unlockFile);${injection}await control.send('ready'`));
  const run=f.launch(),starting=await run.event('starting'),deadline=Date.now()+5000;
  while(!await stat(path.join(f.runtime,'waiting')).catch(()=>false)){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
  run.send('quit',starting.generation);assert.deepEqual(await ended(run.child),[malformed?1:0,null]);assert.equal((await journal(f)).outcome,malformed?'uncertain':'ok');
  assert.equal(run.events.some(record=>record.type==='ready'),false);
});
test('readiness survives an initial token removed before delivery',async t=>{
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"await control.send('ready'","fs.unlinkSync(unlockFile);await control.send('ready'"));
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);assert.equal((await journal(f)).outcome,'ok');
});
for(const unsafe of ['mode','symlink','dangling-symlink','hardlink','directory','parent'])test(`existing unsafe ${unsafe} token is not treated as expired`,async t=>{
  const change={mode:"fs.chmodSync(unlockFile,0o644);",symlink:"fs.unlinkSync(unlockFile);fs.symlinkSync('/dev/null',unlockFile);",'dangling-symlink':"fs.unlinkSync(unlockFile);fs.symlinkSync(unlockFile+'.missing',unlockFile);",hardlink:"fs.linkSync(unlockFile,unlockFile+'.other');",directory:"fs.unlinkSync(unlockFile);fs.mkdirSync(unlockFile,{mode:0o700});",parent:"fs.chmodSync(path.dirname(unlockFile),0o755);"}[unsafe];
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"await control.send('ready'",change+"await control.send('ready'"));
  const run=f.launch();assert.deepEqual(await ended(run.child),[1,null]);assert.equal((await journal(f)).outcome,'uncertain');assert.equal(run.events.some(record=>record.type==='ready'),false);
});
