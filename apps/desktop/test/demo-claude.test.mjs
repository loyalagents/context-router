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

test('a running chat allows a fresh request while setup still deduplicates and old chat completion is ignored',async()=>{
 const sent=[],progress=new Map();const flow=createDemoClaude({cap,send:async(_,value)=>sent.push(value),readProgress:async id=>progress.get(id),readClient:async()=> 'exact-b'});
 const first=await flow.open(false);progress.set(first.request,'signing-in');
 assert.equal((await flow.status()).busy,true);await flow.open(false);assert.equal(sent.length,1);
 progress.set(first.request,'starting');assert.equal((await flow.status()).busy,false);
 const second=await flow.open(false);assert.notEqual(second.request,first.request);assert.equal(sent.length,2);
 progress.set(first.request,'exited');flow.accept({request:first.request,state:'failed'});
 assert.equal((await flow.status()).state,'checking');assert.equal((await flow.status()).busy,true);
});

test('Codex and Claude launch/status stay separate while each supports multiple chats',async()=>{
 const sent=[],progress=new Map();const make=client=>createDemoClaude({cap,client,send:async(type,payload)=>sent.push({type,...payload}),readProgress:async id=>progress.get(id),readClient:async()=>client==='codex'?'exact-a':'exact-b'});
 const codex=make('codex'),claude=make('claude');const a=await codex.open(false),b=await claude.open(false);
 assert.equal(sent[0].type,'demo-codex-open');assert.equal(sent[1].type,'demo-claude-open');assert.equal(a.clientId,'exact-a');assert.equal(b.clientId,'exact-b');
 codex.accept({request:b.request,state:'failed'});assert.equal((await codex.status()).state,'checking');
 progress.set(a.request,'starting');await codex.status();await codex.open(false);assert.equal(sent.length,3);assert.equal((await claude.status()).busy,true);
 assert.throws(()=>make('unknown'));
});

for(const client of ['claude','codex'])test(`${client} native project picker never ages into a new overlapping request`,async()=>{
 const sent=[],now=Date.now;let time=now();Date.now=()=>time;
 try{
 const flow=createDemoClaude({cap,client,send:async(_,value)=>sent.push(value),readProgress:async()=>null,readClient:async()=> 'exact-b'});
 const first=await flow.open(false);flow.accept({request:first.request,state:'choosing-project'});time+=240000;
 assert.equal((await flow.status()).state,'choosing-project');assert.equal((await flow.status()).busy,true);await flow.open(false);assert.equal(sent.length,1);
 flow.accept({request:first.request,state:'terminal-opened'});assert.equal((await flow.status()).state,'terminal-opened');
 }finally{Date.now=now;}
});

for(const client of ['claude','codex'])test(`${client} unchanged helper progress cannot renew a timed-out launch on the next poll`,async()=>{
 const now=Date.now;let time=now();Date.now=()=>time;
 try{
 const flow=createDemoClaude({cap,client,send:async()=>{},readProgress:async()=> 'checking',readClient:async()=> 'exact-b'});
 await flow.open(false);time+=240000;
 for(let i=0;i<3;i++){const status=await flow.status();assert.equal(status.state,'unconfirmed');assert.equal(status.busy,false);}
 }finally{Date.now=now;}
});
