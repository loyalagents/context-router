import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/session-fixture.mjs';
import { createProductionCancellationBridge, shortPrompt, longPrompt } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/production-cancellation.mjs';

test('production cancellation bridge uses real readiness, rendering, tokenization and default output cap', async(t)=>{
 const f=await fixture(t);assert.equal((await f.service.getStatus()).state,'available');await f.service.settled();
 const original=f.service.client.complete,probe=f.service.probe;
 const bridge=createProductionCancellationBridge(f.service);
 try{
  const result=await bridge.client.complete(shortPrompt,{deadline:performance.now()+5000});await bridge.client.settled();
  assert.equal(result.text,'{"answer":"ok"}');assert.equal(bridge.records.length,1);
  assert.equal(bridge.records[0].tokenizations,1);assert.equal(bridge.records[0].nativeCalls,1);assert.equal(bridge.records[0].inputTokens,10);
  assert.equal(f.state.completionBodies[0].n_predict,2048);assert.equal(bridge.client.state,'ready');
  assert.equal(f.state.calls.filter(p=>p==='/apply-template').length,1);
 }finally{await bridge.restore();}
 assert.equal(f.service.client.complete,original);assert.equal(f.service.probe,probe);
});
for(const invalid of ['small','missing','mismatch'])test(`production cancellation blocks ${invalid} tokenizer evidence before native dispatch`,async(t)=>{
 const f=await fixture(t);assert.equal((await f.service.getStatus()).state,'available');await f.service.settled();
 if(invalid==='missing'){const old=f.service.render;f.service.render=async()=>'<think></think>unobserved';}
 if(invalid==='mismatch'){const old=f.service.probe;f.service.probe=async(...args)=>{const response=await old(...args);if(args[1]==='/apply-template')return{...response,value:{prompt:'<think></think>mismatch'}};return response;};const oldRender=f.service.render.bind(f.service);f.service.render=async(...args)=>(await oldRender(...args))+'changed';}
 const bridge=createProductionCancellationBridge(f.service);
 try{await assert.rejects(bridge.client.complete(longPrompt,{deadline:performance.now()+5000}));await bridge.client.settled();assert.equal(f.state.completionBodies.length,0);}finally{await bridge.restore();}
});
test('caller cancellation traverses service ownership and keeps long evidence after a short followup',async(t)=>{
 const f=await fixture(t);f.state.tokens=5000;assert.equal((await f.service.getStatus()).state,'available');await f.service.settled();
 const controller=new AbortController();
 f.state.hook=async(req,res)=>{if(req.url!=='/completion')return false;res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({index:0,stop:false,content:'',tokens_predicted:0,tokens_evaluated:5000,prompt_progress:{total:5000,cache:0,processed:0,time_ms:0}})+'\n\n');return true;};
 const bridge=createProductionCancellationBridge(f.service);
 try{
  await assert.rejects(bridge.client.complete(longPrompt,{signal:controller.signal,deadline:performance.now()+5000,onProgress:()=>controller.abort()}),e=>e.kind==='cancelled');
  await bridge.client.settled();assert.equal(bridge.client.state,'ready');
  f.state.hook=null;f.state.tokens=10;await bridge.client.complete(shortPrompt,{deadline:performance.now()+5000});await bridge.client.settled();
  assert.deepEqual(bridge.records.map(r=>r.inputTokens),[5000,10]);assert.ok(bridge.records.every(r=>r.nativeCalls===1));
 }finally{await bridge.restore();}
});
test('unknown native work latches the bridge unavailable and prevents all later preparation',async(t)=>{
 const f=await fixture(t);f.state.tokens=5000;assert.equal((await f.service.getStatus()).state,'available');await f.service.settled();
 f.state.hook=async(req,res)=>{if(req.url==='/completion'){res.destroy();return true;}return false;};
 const bridge=createProductionCancellationBridge(f.service);
 try{
  await assert.rejects(bridge.client.complete(longPrompt,{deadline:performance.now()+5000}));await bridge.client.settled();
  assert.equal(bridge.client.state,'unavailable');const before=f.state.calls.length;
  await assert.rejects(bridge.client.complete(shortPrompt,{deadline:performance.now()+5000}));await bridge.client.settled();assert.equal(f.state.calls.length,before);
 }finally{await bridge.restore();}
});
test('caller deadline covers application preparation before native dispatch',async(t)=>{
 const f=await fixture(t);assert.equal((await f.service.getStatus()).state,'available');await f.service.settled();
 f.state.hook=async(req)=>req.url==='/apply-template';const bridge=createProductionCancellationBridge(f.service);
 try{
  const start=performance.now();await assert.rejects(bridge.client.complete(shortPrompt,{deadline:start+50}),e=>e.kind==='deadline');await bridge.client.settled();
  assert.ok(performance.now()-start<1500);assert.equal(f.state.completionBodies.length,0);assert.equal(bridge.records[0].nativeCalls,0);
  const evidence=JSON.stringify(bridge.records);assert.ok(!evidence.includes(shortPrompt));assert.ok(!evidence.includes(f.credentials.apiKey));
 }finally{await bridge.restore();}
});
