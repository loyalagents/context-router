import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fixture, ended } from '../fixtures/supervisor-fixture.mjs';
async function unavailable(r,after=0){let starting;do{starting=await r.event('starting',after);after=r.events.indexOf(starting)+1;}while(starting.phase!=='demo-unavailable');return starting;}

test('native switch persists demo selection, returns the same personal pair, and reset retains old demo files', async t => {
  const f = await fixture(t), r = f.launch();
  let ready = await r.event('ready');
  const metadata = () => readFile(path.join(f.envelope,'installation.json'),'utf8').then(JSON.parse);
  const personal = (await metadata()).personalStore;
  const transition = async command => { const after=r.events.length; r.send(command,ready.generation); ready=await r.event('ready',after); };
  await transition('enter-demo');
  const demo = await metadata(); assert.equal(demo.mode,'demo'); assert.notEqual(demo.selectedStore,personal);
  const sentinel=path.join(f.envelope,'demo',demo.demoStore,'presenter-edit'); await writeFile(sentinel,'retained');
  await transition('leave-demo'); assert.equal((await metadata()).selectedStore,personal);
  await transition('enter-demo'); assert.equal((await metadata()).demoStore,demo.demoStore);
  await transition('reset-demo'); assert.notEqual((await metadata()).demoStore,demo.demoStore);
  assert.equal(await readFile(sentinel,'utf8'),'retained');
  r.send('quit',ready.generation); assert.equal((await ended(r.child))[0],0);
});

test('settled seed failure keeps prior selection until explicit return and retains the candidate', async t => {
  const f=await fixture(t,'demo-failure'),r=f.launch(),ready=await r.event('ready');
  const before=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));
  r.send('enter-demo',ready.generation); const failed=await r.event('demo-failed');
  const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));
  assert.equal(state.selectedStore,before.selectedStore); assert.equal(state.pendingDemo.status,'failed');
  assert.equal(r.events.filter(e=>e.type==='ready').length,1);
  const after=r.events.length; r.send('return-previous',failed.generation);
  const resumed=await r.event('ready',after);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'installation.json'))).pendingDemo,null);
  r.send('quit',resumed.generation); assert.equal((await ended(r.child))[0],0);
});

for(const variant of ['demo-slow','demo-late'])test(`cancellation retains prior selection and never publishes candidate (${variant})`,async t=>{
 const f=await fixture(t,variant),r=f.launch(),ready=await r.event('ready');
 const before=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),after=r.events.length;
 r.send('enter-demo',ready.generation);const preparing=await r.event('starting',after+1);
 assert.equal(preparing.phase,'preparing-demo');
 if(variant==='demo-late'){
  const deadline=performance.now()+3000;let found=false;
  while(!found){const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));try{await readFile(path.join(f.envelope,'demo',state.pendingDemo.storeId,'generation.json'));found=true;}catch{assert.ok(performance.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}}
 }
 r.send('cancel-demo',preparing.generation);const failed=await r.event('demo-failed');
 const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));assert.equal(state.selectedStore,before.selectedStore);assert.equal(state.demoStore,null);assert.equal(state.pendingDemo.status,'failed');
 r.send('quit',failed.generation);assert.equal((await ended(r.child))[0],0);
});

test('Quit queued with the prior displayed generation during transition settles finite preparation',async t=>{
 const f=await fixture(t,'demo-slow'),r=f.launch(),ready=await r.event('ready'),after=r.events.length;
 r.send('enter-demo',ready.generation);await r.event('starting',after+1);
 // The shell can still have the old generation until it consumes starting.
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
 const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));assert.equal(state.mode,'personal');assert.equal(state.demoStore,null);assert.equal(state.pendingDemo.status,'failed');
});

test('quiescent selected demo with occupied port offers explicit personal return without touching occupant',async t=>{
 const f=await fixture(t),first=f.launch();let ready=await first.event('ready'),after=first.events.length;first.send('enter-demo',ready.generation);ready=await first.event('ready',after);first.send('quit',ready.generation);assert.equal((await ended(first.child))[0],0);
 const before=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),occupied=net.createServer();await new Promise(resolve=>occupied.listen(3213,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
 const reopened=f.launch(),unavailable=await reopened.event('starting');assert.equal(unavailable.phase,'demo-unavailable');assert.equal((await readFile(path.join(f.envelope,'installation.json'),'utf8')).includes(before.demoStore),true);
 assert.equal(occupied.listening,true);reopened.send('leave-demo',unavailable.generation);ready=await reopened.event('ready');assert.equal(occupied.listening,true);
 const current=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));assert.equal(current.mode,'personal');assert.equal(current.selectedStore,before.personalStore);assert.equal(current.demoStore,before.demoStore);
 reopened.send('quit',ready.generation);assert.equal((await ended(reopened.child))[0],0);
});

for(const variant of ['demo-prepare-failure','demo-drained-failure'])test(`controlled selected demo failure offers personal return after quiescence (${variant})`,async t=>{
 const f=await fixture(t,variant),r=f.launch(),personalReady=await r.event('ready'),after=r.events.length;
 r.send('enter-demo',personalReady.generation);const stopped=await unavailable(r,after);
 const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),journal=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));assert.equal(journal.lifecycle,'quiescent');assert.equal(journal.outcome,'failed');assert.equal(state.mode,'demo');
 const before=r.events.length;r.send('leave-demo',stopped.generation);const ready=await r.event('ready',before);assert.equal(JSON.parse(await readFile(path.join(f.envelope,'installation.json'))).selectedStore,state.personalStore);
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
});

test('selected demo receipt failure preserves receipt and returns only after acknowledged prepare exit',async t=>{
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready'),after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);r.send('quit',ready.generation);await ended(r.child);
 const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),file=path.join(f.envelope,'demo',state.demoStore,'generation.json'),bytes=JSON.stringify({status:'invalid'});await writeFile(file,bytes);
 const reopened=f.launch(),stopped=await unavailable(reopened);reopened.send('leave-demo',stopped.generation);ready=await reopened.event('ready');assert.equal(await readFile(file,'utf8'),bytes);
 reopened.send('quit',ready.generation);assert.equal((await ended(reopened.child))[0],0);
});

test('unacknowledged selected demo application failure offers no personal return',async t=>{
 const f=await fixture(t,'demo-undrained-failure'),r=f.launch(),ready=await r.event('ready');r.send('enter-demo',ready.generation);assert.equal((await ended(r.child))[0],1);assert.equal(r.events.some(e=>e.phase==='demo-unavailable'),false);assert.equal(JSON.parse(await readFile(path.join(f.envelope,'installation.json'))).mode,'demo');
});
