import test from 'node:test';import assert from 'node:assert/strict';
import {createDemoClaude} from '../runtime/demo-claude.mjs';
const cap={mode:'demo',generation:'a'.repeat(32),storeId:'b'.repeat(32),envelope:'/owned'};
test('one fixed native request; duplicate clicks and stale results cannot replace it',async()=>{
 const sent=[];let progress=null;const flow=createDemoClaude({cap,send:async(...args)=>sent.push(args),readProgress:async()=>progress,readClient:async()=> 'exact-b'});
 const first=await flow.open(false);assert.equal(first.clientId,'exact-b');await flow.open(true);assert.equal(sent.length,1);assert.equal(sent[0][0],'demo-claude-open');assert.deepEqual(Object.keys(sent[0][1]).sort(),['chooseProject','request']);
 flow.accept({request:'c'.repeat(32),state:'failed'});assert.equal((await flow.status()).state,'checking');
 flow.accept({request:first.request,state:'terminal-opened'});assert.equal((await flow.status()).state,'terminal-opened');
 progress='signing-in';assert.equal((await flow.status()).state,'signing-in');progress='exited';assert.equal((await flow.status()).state,'exited');await flow.open(false);assert.equal(sent.length,2);
});
test('personal mode cannot create a native launch capability',()=>{assert.throws(()=>createDemoClaude({cap:{...cap,mode:'personal'}}));});
test('a delayed old progress read cannot overwrite a newer launch',async()=>{
 let delayed=false,release;const gate=new Promise(resolve=>release=resolve);let progress=null;
 const flow=createDemoClaude({cap,send:async()=>{},readClient:async()=> 'exact-b',readProgress:async()=>{if(delayed){delayed=false;return gate;}return progress;}});
 const first=await flow.open(false);delayed=true;const oldPoll=flow.status();
 progress='exited';await flow.status();progress=null;const second=await flow.open(false);assert.notEqual(second.request,first.request);
 release('exited');await oldPoll;assert.equal((await flow.status()).state,'checking');
});
