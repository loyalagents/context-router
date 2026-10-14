import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, ended } from '../fixtures/supervisor-fixture.mjs';

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
