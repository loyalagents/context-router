import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repoRoot } from './cases.mjs';
import { digest } from './freeze.mjs';
import { cancellationTrial } from './cancellation.mjs';
import { completeControlEvidence } from './control-evidence.mjs';
const req=createRequire(resolve(repoRoot,'apps/backend/package.json'));
const {z}=req('zod');const {localJsonSchema}=req(resolve(repoRoot,'apps/backend/dist/infrastructure/local-model/schema.js'));
import { shortPrompt, longPrompt } from './cancellation-matrix.mjs';
export { shortPrompt, longPrompt };
const shortSchema=z.object({answer:z.literal('ok')}).strict();
export const productionCancellationInputs=()=>({longPromptSha256:digest(longPrompt),shortPromptSha256:digest(shortPrompt),shortSchemaSha256:digest(localJsonSchema(shortSchema)),outputTokenCap:2048,baselines:5,prefill:3,decode:3,followups:6});
/** Instance-local test observation only; production service owns every operation and native option. */
export function createProductionCancellationBridge(service){
 const complete=service.client.complete,probe=service.probe,records=[];let current;
 service.probe=async function(config,path,data,options){
  const record=current;
  const response=await probe.call(this,config,path,data,options);
  if(record&&path==='/apply-template'){
   record.templates++;assert.equal(digest(data.messages[0].content),record.messageSha256);
   record.renderedSha256=digest(response.value.prompt);
  }
  if(record&&path==='/tokenize'){
   record.tokenizations++;assert.equal(digest(data.content),record.renderedSha256);
   const tokens=response.value.tokens;assert.ok(Array.isArray(tokens)&&tokens.length>0&&tokens.every(t=>Number.isInteger(t)&&t>=0));record.inputTokens=tokens.length;
  }
  return response;
 };
 service.client.complete=async function(prompt,options){
  const record=current;assert.ok(record);assert.equal(record.templates,1);assert.equal(record.tokenizations,1);assert.equal(record.nativeCalls,0);
  assert.equal(digest(prompt),record.renderedSha256);assert.equal(digest(options.schema??null),record.schemaSha256);
  assert.ok(record.inputTokens>0&&record.inputTokens<=12000);if(record.kind==='long')assert.ok(record.inputTokens>=4096);
  assert.ok(options.deadline<=record.deadline);record.nativeCalls++;
  return complete.call(this,prompt,{...options,onProgress:record.hooks.onProgress,onTerminalObservation:record.hooks.onTerminalObservation});
 };
 const client={
  get state(){return service.closing||service.unavailable||service.parser?.state==='unavailable'||service.client.state==='unavailable'?'unavailable':service.active?'busy':service.client.state;},
  get controlEvidence(){return service.client.controlEvidence;},
  async complete(prompt,options){
   assert.ok(!current);assert.ok(prompt===shortPrompt||prompt===longPrompt);assert.ok(records.length<17);
   const record={kind:prompt===shortPrompt?'short':'long',messageSha256:digest(prompt),schemaSha256:digest(prompt===shortPrompt?localJsonSchema(shortSchema):null),templates:0,tokenizations:0,nativeCalls:0,inputTokens:null,deadline:options.deadline};
   // Hooks stay private, never serialized with the numeric/hash evidence.
   Object.defineProperty(record,'hooks',{value:{onProgress:options.onProgress,onTerminalObservation:options.onTerminalObservation}});
   current=record;records.push(record);
   try{
    const execution={signal:options.signal,deadline:options.deadline,retries:0};
    const value=record.kind==='short'?await service.generateStructured(prompt,shortSchema,execution):await service.generateText(prompt,execution);
    return{text:record.kind==='short'?JSON.stringify(value):value};
   }finally{current=undefined;}
  },
  settled:()=>service.settled(),
 };
 return{client,records,async restore(){await service.settled();service.client.complete=complete;service.probe=probe;}};
}
export async function runProductionCancellation(service,onProgress=()=>{}){
 assert.equal((await service.getStatus()).state,'available');await service.settled();
 const bridge=createProductionCancellationBridge(service),client=bridge.client;
 const baselines=[],shortControls=[],phases=['prefill','prefill','prefill','decode','decode','decode'];
 const trials=phases.map((phase,index)=>({phase,repetition:index%3,notRun:true,passed:false}));let baselineP95Ms=null;
 const short=async()=>{
  assert.equal(client.state,'ready');const start=performance.now();let response;
  try{response=await client.complete(shortPrompt,{deadline:start+120000});}finally{await client.settled();shortControls.push(client.controlEvidence);}
  assert.ok(completeControlEvidence(shortControls.at(-1)));assert.deepEqual(JSON.parse(response.text),{answer:'ok'});assert.equal(client.state,'ready');return performance.now()-start;
 };
 let passed=false;
 try{
  for(let repetition=0;repetition<5;repetition++){const elapsedMs=await short();baselines.push({repetition,elapsedMs,passed:elapsedMs<=60000});assert.ok(elapsedMs<=60000);onProgress({stage:'baseline',repetition,elapsedMs});}
  baselineP95Ms=Math.max(...baselines.map(b=>b.elapsedMs));
  for(const[index,phase]of phases.entries()){
   assert.equal(client.state,'ready');const recordIndex=bridge.records.length;
   const trial=await cancellationTrial({client,phase,prompt:longPrompt,followup:short,baselineP95Ms,deadline:performance.now()+120000});
   trials[index]={...trial,repetition:index%3,notRun:false,inputTokens:bridge.records[recordIndex].inputTokens};
   onProgress({stage:'cancellation',...trials[index]});if(!trial.passed)break;
  }
  passed=trials.every(t=>t.passed)&&bridge.records.length===17;
 }catch{passed=false;}finally{await bridge.restore();}
 return{passed,baselines,baselineP95Ms,trials,shortControls,inputs:productionCancellationInputs(),operations:bridge.records};
}
