import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {once} from 'node:events';
import {ended} from '../fixtures/supervisor-fixture.mjs';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';

async function relaunch(f){const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);}
test('ready diagnostic failure is failed quiescence rather than malformed application evidence',async t=>{
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"await control.send('ready'", "fs.writeFileSync(path.join(cap.envelope,'diagnostics/events.json'),'invalid');await control.send('ready'"));
  const run=f.launch();assert.deepEqual(await ended(run.child),[1,null]);assert.equal((await journal(f)).outcome,'failed');
});
test('shell output saturation does not prevent child drain',async t=>{
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"if(cap.role==='application'", "if(command==='unlock')void(async()=>{for(let i=0;i<10000&&!control.signal.aborted;i++){await control.send('model-status',{state:'busy'});await new Promise(r=>setTimeout(r,1));}})();if(cap.role==='application'"));
  const run=f.launch(),ready=await run.event('ready'),exited=once(run.child,'exit');let timer;
  run.child.stdout.pause();run.send('unlock',ready.generation);
  // Buffer capacity/timer scheduling vary by host. Keep pressure until exit;
  // close waits for unread stdout, so observe exit before resuming the reader.
  try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('saturated guardian exit deadline')),15000);})]);}
  finally{clearTimeout(timer);run.child.stdout.resume();}
  assert.deepEqual(await ended(run.child),[1,null]);assert.equal((await journal(f)).outcome,'failed');await relaunch(f);
});
test('lost shell output does not discard a drained application while cancelling download',async t=>{
  const f=await editedFixture(t,'download',runtime=>replace(path.join(runtime,'application.mjs'),'await control.stopped;await control.send','await control.stopped;await new Promise(r=>setTimeout(r,200));await control.send'));
  const run=f.launch(),ready=await run.event('ready');run.send('download',ready.generation);await run.event('download-progress');
  run.child.stdout.destroy();run.child.stdin.end();assert.equal((await ended(run.child))[0],1);
  assert.equal((await journal(f)).outcome,'failed');await relaunch(f);
});
for(const malformed of [false,true])test(`late application record cannot discard a following drain (malformed=${malformed})`,async t=>{
  const f=await editedFixture(t,'normal',runtime=>replace(path.join(runtime,'application.mjs'),"await control.stopped;await control.send('drained');",
    `await control.stopped;fs.writeSync(6,[{version:1,generation:cap.generation,type:${JSON.stringify(malformed?'invalid':'unlock')},origin:'http://127.0.0.1:3210',unlockFile},{version:1,generation:cap.generation,type:'drained'}].map(r=>JSON.stringify(r)+'\\n').join(''));`));
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],malformed?1:0);
  assert.equal((await journal(f)).outcome,malformed?'uncertain':'ok');
  if(!malformed)await relaunch(f);
});
test('stale and repeated download cancellation preserve the ready application',async t=>{
  const f=await editedFixture(t,'download',async()=>{}),run=f.launch(),ready=await run.event('ready');
  run.send('cancel-download',ready.generation);run.send('download',ready.generation);await run.event('download-progress');
  run.send('cancel-download',ready.generation);run.send('cancel-download',ready.generation);await run.event('download-cancelled');
  run.send('cancel-download',ready.generation);run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);assert.equal((await journal(f)).outcome,'ok');
});
for(const commands of [['quit','restart'],['restart','quit']])test(`quit wins queued ${commands.join('/')} and late commands`,async t=>{
  const f=await editedFixture(t,'normal',async()=>{}),run=f.launch(),ready=await run.event('ready');
  run.child.stdin.write([...commands,'unlock','model-unavailable'].map(command=>JSON.stringify({version:1,generation:ready.generation,command})+'\n').join(''));
  assert.equal((await ended(run.child))[0],0);assert.equal(run.events.filter(e=>e.type==='ready').length,1);assert.equal((await journal(f)).outcome,'ok');
});
