import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';
import {ended} from '../fixtures/supervisor-fixture.mjs';

const native=path.resolve(import.meta.dirname,'../../native');
const fixtures=path.resolve(import.meta.dirname,'../fixtures');
function build(output,marker,entry) {
  const sources=entry
    ? [entry,...['package','envelope','process','maintenance','model-cleanup'].map(name=>path.join(native,`${name}.m`))]
    : ['guardian','package','envelope','process','supervisor','maintenance','model-cleanup','menu','diagnostics'].map(name=>path.join(native,`${name}.m`));
  const result=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','AppKit',
    '-I',native,'-Dclock_gettime=CRFixtureClockGettime',`-DCR_CLOCK_MARKER=${JSON.stringify(marker)}`,
    ...sources,path.join(fixtures,'sleep-clock.c'),'-o',output],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);
}

for (const command of ['quit','restart']) test(`sleep during ${command} preserves drain, quiescence and relaunch`,async t=>{
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    const marker=path.join(f.top,'clock');
    build(f.executable,marker);
    await replace(path.join(runtime,'application.mjs'),"await control.stopped;await control.send('drained');",
      `await control.stopped;fs.writeFileSync(${JSON.stringify(marker)},'s');await new Promise(r=>setTimeout(r,250));await control.send('drained');`);
  });
  const run=f.launch(),ready=await run.event('ready');run.send(command,ready.generation);
  if(command==='restart'){
    const stopped=await run.event('stopped');assert.equal(stopped.outcome,'ok');
    const next=await run.event('ready',run.events.indexOf(stopped)+1);assert.notEqual(next.generation,ready.generation);
    run.send('quit',next.generation);
  }
  const exit=await ended(run.child),outcome=await journal(f);
  assert.deepEqual(exit,[0,null]);assert.equal(outcome.outcome,'ok');
  const next=f.launch(),nextReady=await next.event('ready');next.send('quit',nextReady.generation);
  assert.deepEqual(await ended(next.child),[0,null]);assert.equal((await journal(f)).outcome,'ok');
});

test('elapsed awake shutdown budget still forces uncertain state and denies relaunch',async t=>{
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    const marker=path.join(f.top,'clock');build(f.executable,marker);
    await replace(path.join(runtime,'application.mjs'),"await control.stopped;await control.send('drained');",
      `await control.stopped;fs.writeFileSync(${JSON.stringify(marker)},'a');await new Promise(r=>setTimeout(r,250));await control.send('drained');`);
  });
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);
  assert.deepEqual(await ended(run.child),[1,null]);assert.equal((await journal(f)).outcome,'uncertain');
  const before=await readFile(path.join(f.envelope,'owner.json'));
  assert.deepEqual(await ended(f.launch().child),[1,null]);
  assert.deepEqual(await readFile(path.join(f.envelope,'owner.json')),before);
});

test('menu unlock expiry includes simulated sleep',async t=>{
  const f=await editedFixture(t,'normal',async()=>{}),marker=path.join(f.top,'clock'),driver=path.join(f.top,'menu-expiry');
  await mkdir(path.join(f.top,'exports','a'.repeat(32)),{recursive:true,mode:0o700});
  build(driver,marker,path.join(fixtures,'menu-sleep-expiry.m'));
  const result=spawnSync(driver,[f.top],{env:{},encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'sleep-expired-unlock');
});
