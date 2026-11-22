import { createDemoClaude } from './demo-claude.mjs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { admit, backend, authority, nativeOwners, webRoot, readPrivate } from './managed.mjs';
let demoClaude, demoCodex, control, runtime, web, startup, statusTask, backendAttempted = false;
try {
  const ports=process.argv.slice(2);
  if(ports.length!==2||ports.some(p=>! /^(0|[1-9][0-9]{0,4})$/.test(p)||Number(p)>65535))throw new Error();
  const issue=async()=>{if(!runtime||control.signal.aborted)return;const delivery=runtime.issueUnlock();await control.send('unlock',{unlockFile:delivery.path,origin:`http://127.0.0.1:${runtime.port}`});};
  const state=await admit('application',(command,frame)=>{
    if(command==='demo-claude-status')demoClaude?.accept(frame);
    if(command==='demo-codex-status')demoCodex?.accept(frame);
    if(command==='unlock') void issue().catch(()=>control.fail());
    if(command==='model-unavailable')authority.invalidateManagedModel();
  });control=state.control;
  if(state.cap?.mode==='demo'){
    const {readConnectProgress}=await import(backend.resolve('backend/scripts/demo/claude-connect.mjs'));
    const {privateJson}=await import(backend.resolve('backend/scripts/demo/files.mjs'));
    const create=client=>createDemoClaude({client,cap:state.cap,assertActive:()=>{control.assertActive();authority.managedCapability();},send:(type,payload)=>control.send(type,payload),
      readProgress:request=>readConnectProgress({root:state.cap.envelope,installationId:state.cap.installationId,store:state.cap.storeId,generation:state.cap.generation,role:client==='codex'?'a':'b'},request),
      readClient:async()=>{const receipt=await privateJson(path.join(state.cap.envelope,'demo',state.cap.storeId,'generation.json'));if(receipt.installationId!==state.cap.installationId||receipt.storeId!==state.cap.storeId||receipt.status!=='complete'||typeof receipt.clients?.[client==='codex'?'agentA':'agentB']!=='string')throw new Error();return receipt.clients[client==='codex'?'agentA':'agentB'];},
    });
    demoClaude=create('claude');demoCodex=create('codex');
  }
  const session=JSON.parse(readPrivate(state.session,'session.json'));
  if(!session||Object.keys(session).sort().join()!=='modelEnabled,port,version'||session.version!==1||typeof session.modelEnabled!=='boolean'||!Number.isInteger(session.port)||session.port<1||session.port>65535)throw new Error();
  process.env.CONTEXT_ROUTER_WEB_MODE='local';process.env.NEXT_TELEMETRY_DISABLED='1';process.env.DO_NOT_TRACK='1';process.env.NODE_ENV='production';
  startup=(async()=>{
    const next=backend('next');web=next({dev:false,dir:webRoot,hostname:'127.0.0.1',port:Number(ports[0])});
    await web.prepare();control.assertActive();
    backendAttempted = true;
    runtime=await backend('backend/dist/bootstrap/local-ui.js').createLocalUiApplication(state.configuration,{
      port:Number(ports[0]),mcpPort:Number(ports[1]),exportRoot:state.exports,webHandler:web.getRequestHandler(),
      demoClaude,demoCodex,
      model:session.modelEnabled?{root:state.session,port:session.port}:undefined,
    });control.assertActive();
  })();
  await Promise.race([startup,control.stopped]);control.assertActive();
  const delivery=runtime.issueUnlock();
  await control.send('ready',{origin:`http://127.0.0.1:${runtime.port}`,mcpOrigin:`http://127.0.0.1:${runtime.mcpPort}/mcp`,unlockFile:delivery.path,modelEnabled:session.modelEnabled});
  if(session.modelEnabled){
    const ai=runtime.application.get(backend('backend/dist/domains/shared/ports/ai.tokens.js').AI_TEXT_GENERATOR_PORT);
    statusTask=(async()=>{let previous;while(!control.signal.aborted){const status=await ai.getManagedStatus({signal:control.signal});if(status.state!==previous){await control.send('model-status',{state:status.state});previous=status.state;}await delay(1000,undefined,{signal:control.signal});}})().catch(()=>{if(!control.signal.aborted){process.exitCode=1;control.fail();}});
  }
  await control.stopped;
}catch{process.exitCode=1;try{await control?.send('failed',{category:'application-failed'});}catch{}}
finally{
  authority.revokeManagedAdmission();
  await startup?.catch(()=>{});
  let drained=false;
  try{await runtime?.close();await web?.close();await statusTask;await nativeOwners.waitForNativeOwners();
    // A rejected backend constructor may have failed its own partial cleanup.
    // Without its returned runtime, no complete application drain is proved.
    drained=!backendAttempted||runtime!==undefined;}
  catch{process.exitCode=1;}
  if(drained)try{await control?.send('drained');}catch{process.exitCode=1;}
  await control?.close().catch(()=>{process.exitCode=1;});
}
