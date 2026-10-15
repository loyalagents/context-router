import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fixture, ended } from '../fixtures/supervisor-fixture.mjs';
import { activeDemo } from '../../../backend/scripts/demo/active.mjs';

test('demo helper binds current store, runtime generation and endpoint and refuses persisted Ready after Quit',async t=>{
  const f=await fixture(t),r=f.launch();let ready=await r.event('ready');
  const after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
  const state=JSON.parse(await readFile(path.join(f.envelope,'installation.json')));
  const spec={root:f.envelope,store:state.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin};
  const active=await activeDemo(spec);assert.equal(active.endpoint,ready.mcpOrigin);
  const fragmented=await new Promise((resolve,reject)=>{const socket=net.connect(active.probePort,'127.0.0.1'),chunks=[];socket.once('error',reject);socket.once('connect',()=>{socket.write(active.challenge.slice(0,7));setTimeout(()=>socket.end(active.challenge.slice(7)+'\n'),5);});socket.on('data',bytes=>chunks.push(bytes));socket.once('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString())));});
  assert.deepEqual(fragmented,active);
  for(const wrong of [{store:'f'.repeat(32)},{generation:'e'.repeat(32)},{endpoint:'http://127.0.0.1:3222/mcp'}])await assert.rejects(activeDemo({...spec,...wrong}));
  r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
  await assert.rejects(activeDemo(spec));
});
