// Opt-in reviewed series only. Never invoked by CI, the aggregate gate or the app.
import assert from 'node:assert/strict';import {createHash,X509Certificate} from 'node:crypto';
import {constants,createReadStream,writeFileSync} from 'node:fs';import {mkdtemp,realpath,readFile,writeFile,copyFile,chmod,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';import {once} from 'node:events';import path from 'node:path';import os from 'node:os';
const repository=path.resolve(import.meta.dirname,'../../..');assert.equal(process.argv.length,3);assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
const proposal=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.deepEqual(Object.keys(proposal).sort(),['artifact','manifestSha256','maxCompletionTokens','maxGenerations','maxRequests','series','totalSeconds'].sort());
assert.equal(proposal.series,'step09-installed-live-v1');assert.equal(proposal.maxGenerations,3);assert.equal(proposal.maxRequests,3);assert.equal(proposal.maxCompletionTokens,2048);assert.equal(proposal.totalSeconds,900);assert.match(proposal.manifestSha256,/^[a-f0-9]{64}$/);
const bundle=await realpath(proposal.artifact),manifest=await readFile(path.join(bundle,'Contents/Resources/package-manifest.json'));assert.equal(createHash('sha256').update(manifest).digest('hex'),proposal.manifestSha256);
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'context-router-installed-live-'))),envelope=path.join(root,'managed-v1'),exe=path.join(bundle,'Contents/MacOS/context-router'),node=path.join(bundle,'Contents/Resources/bin/node'),modelExe=path.join(bundle,'Contents/Resources/model/llama-server');
const began=Date.now(),signal=AbortSignal.timeout(780000),receipt={version:1,series:proposal.series,proposal,status:'running',root,phases:[],generations:[],requests:[],cleanup:[],limitations:['Synthetic local-host evidence only. No real sleep/wake, reboot, signing/notarization or support beyond the declared M1 Max/macOS pilot.']};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let current;
function detach(owner){owner.child.stdin.destroy();owner.child.stdout.destroy();owner.child.stderr.destroy();owner.child.unref();}
const finalDeadline=began+900000;
const watchdog=setTimeout(()=>{
  receipt.status='failed';receipt.cleanup.push('Absolute series deadline; exit and quiescence unobserved');
  if(current){receipt.uncertainOwner={pid:current.child.pid};detach(current);}
  receipt.elapsedMs=Date.now()-began;
  writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  process.exit(1);
},Math.max(1,finalDeadline-Date.now()));
const phase=name=>{receipt.phases.push({name,elapsedMs:Date.now()-began});console.log(`Installed live: ${name}`);};
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}}
const profile=path.join(root,'offline.sb');const {parse}=await import('yaml'),store=parse(await readFile(path.join(repository,'node_modules/.modules.yaml'),'utf8')).storeDir;
await writeFile(profile,`(version 1)\n(allow default)\n`+[repository,store,path.dirname(path.dirname(process.execPath))].map(p=>`(deny file-read* (subpath ${JSON.stringify(p)}))\n`).join('')+
 `(deny process-exec)\n`+[exe,node,modelExe].map(p=>`(allow process-exec (literal ${JSON.stringify(p)}))\n`).join('')+`(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`,{mode:0o600});
async function digest(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file)){signal.throwIfAborted();hash.update(bytes);}return hash.digest('hex');}
function launch(){
  signal.throwIfAborted();const child=spawn('/usr/bin/sandbox-exec',['-f',profile,exe,'guardian','--root',envelope,'--ui-port','0','--mcp-port','0'],{cwd:bundle,env:{PATH:'',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});
  const owner={child,ended:once(child,'close'),events:[],pending:'',error:false};owner.ended.catch(()=>{});current=owner;child.stdin.on('error',()=>{});
  const fail=()=>{owner.error=true;child.stdin.end();};child.stderr.on('data',fail);
  child.stdout.on('data',bytes=>{owner.pending+=bytes;if(owner.pending.length>65536)return fail();let end;while((end=owner.pending.indexOf('\n'))>=0){try{const record=JSON.parse(owner.pending.slice(0,end));owner.events.push(record);if(record.type==='starting'){receipt.generations.push(record.generation);if(receipt.generations.length>3)fail();}}catch{fail();}owner.pending=owner.pending.slice(end+1);}});
  owner.send=(command,generation)=>child.stdin.write(JSON.stringify({version:1,generation,command})+'\n');
  owner.event=async(type,after=0,state)=>{const deadline=performance.now()+125000;while(true){signal.throwIfAborted();assert.equal(owner.error,false,'Guardian private protocol failure');assert.equal(child.exitCode,null,'Guardian exited before expected record');assert.ok(performance.now()<deadline,'Native startup deadline');const found=owner.events.slice(after).find(record=>record.type===type&&(!state||record.state===state));if(found)return found;await wait(20);}};
  return owner;
}
async function stop(){
  if(!current)return;const owner=current;
  owner.stopping??=(async()=>{
    if(owner.child.exitCode===null&&owner.child.signalCode===null)owner.child.stdin.end();
    try{
      const [code]=await bounded(owner.ended,Math.max(1,Math.min(30000,finalDeadline-Date.now())),'Exact native guardian exit unobserved');
      assert.equal(code,0,'Native guardian did not prove clean shutdown');assert.equal(owner.error,false,'Guardian private protocol failure during cleanup');assert.equal(owner.pending,'','Incomplete final guardian frame');assert.equal(owner.events.at(-1)?.type,'stopped');assert.equal(owner.events.at(-1)?.outcome,'ok');
      const journal=JSON.parse(await readFile(path.join(envelope,'owner.json')));assert.equal(journal.lifecycle,'quiescent');assert.equal(journal.outcome,'ok');assert.equal(journal.generation,owner.events.at(-1).generation);receipt.lastOwner={pid:owner.child.pid,code,generation:journal.generation};current=undefined;
    }catch(error){receipt.uncertainOwner={pid:owner.child.pid,exitCode:owner.child.exitCode,signalCode:owner.child.signalCode};detach(owner);throw error;}
  })();
  return owner.stopping;
}
async function post(ready,route,token,body){
  signal.throwIfAborted();const res=await fetch(ready.origin+route,{method:'POST',headers:{'content-type':'application/json',origin:ready.origin,'x-context-router-ui':'1','x-context-router-timeout-ms':'60000',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
  assert.equal(res.status,200,`Public route ${route} rejected`);return await res.json();
}
async function unlock(ready){const bootstrap=(await readFile(ready.unlockFile,'utf8')).trim();const result=await post(ready,'/api/local/unlock',undefined,{bootstrap});assert.equal(typeof result.token,'string');return result.token;}
async function principal(ready,token){const response=await post(ready,'/graphql',token,{query:'query InstalledLiveIdentity { me { userId } }'});assert.equal(response.errors,undefined);assert.equal(typeof response.data?.me?.userId,'string');return response.data.me.userId;}
async function requestText(ready,token,expectedAvailable){
  assert.ok(receipt.requests.length<3);const entry={generation:ready.generation,expectedAvailable,startedMs:Date.now()-began};receipt.requests.push(entry);
  const response=await post(ready,'/graphql',token,{query:'query InstalledLiveText { askVertexAI(message: "Reply with exactly OK.") }'});
  entry.elapsedMs=Date.now()-began-entry.startedMs;
  if(expectedAvailable){assert.equal(response.errors,undefined);assert.equal(typeof response.data?.askVertexAI,'string');assert.match(response.data.askVertexAI,/\bOK\b/);entry.outputBytes=Buffer.byteLength(response.data.askVertexAI);assert.ok(entry.outputBytes<=16384);entry.status='completed';}
  else{assert.ok(Array.isArray(response.errors)&&response.errors.length);entry.status='rejected-after-invalidation';}
}
console.log(`Installed live evidence: ${root}`);
try{
  const cached='/private/tmp/context-router-step06-assets/Qwen3.5-9B-Q4_K_M.gguf';assert.equal((await stat(cached)).size,5680522464);assert.equal(await digest(cached),'03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8');
  const initial=launch(),first=await initial.event('ready');assert.equal(first.modelEnabled,false);await stop();phase('fresh-non-ai-installation');
  const installed=path.join(envelope,'models/Qwen3.5-9B-Q4_K_M.gguf');await copyFile(cached,installed,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);await chmod(installed,0o600);assert.equal((await stat(installed)).nlink,1);assert.equal(await digest(installed),'03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8');
  const installation=JSON.parse(await readFile(path.join(envelope,'installation.json'))),identityFile=path.join(envelope,'stores',installation.selectedStore,'identity/identity.json'),identity=await digest(identityFile);
  const run=launch(),ready=await run.event('ready');assert.equal(ready.modelEnabled,true);await run.event('model-status',0,'available');const token=await unlock(ready),originalPrincipal=await principal(ready,token);await requestText(ready,token,true);phase('actual-installed-ai-completion');
  const cert1=new X509Certificate(await readFile(path.join(envelope,'sessions',ready.generation,'server-cert.pem')));receipt.firstCertificateFingerprint=cert1.fingerprint256;
  const invalidatedAt=run.events.length;run.send('model-unavailable',ready.generation);await run.event('model-status',invalidatedAt,'unavailable');assert.equal(await principal(ready,token),originalPrincipal);await requestText(ready,token,false);assert.equal((await fetch(ready.origin+'/dashboard/preferences',{signal})).status,200);phase('explicit-invalidation-keeps-authenticated-non-ai-and-refuses-generation');
  const restartedAt=run.events.length;run.send('restart',ready.generation);const restarted=await run.event('ready',restartedAt);await run.event('model-status',restartedAt,'available');assert.notEqual(restarted.generation,ready.generation);
  const cert2=new X509Certificate(await readFile(path.join(envelope,'sessions',restarted.generation,'server-cert.pem')));assert.notEqual(cert1.fingerprint256,cert2.fingerprint256);receipt.secondCertificateFingerprint=cert2.fingerprint256;assert.equal(await digest(identityFile),identity);
  await requestText(restarted,await unlock(restarted),true);await stop();phase('fresh-native-restart-new-certificate-preserved-identity');receipt.status='passed';
}catch(error){receipt.status='failed';receipt.failure={message:error.message};process.exitCode=1;}
finally{
  try{await stop();}catch(error){receipt.cleanup.push(error.message);receipt.status='failed';process.exitCode=1;}
  receipt.elapsedMs=Date.now()-began;await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(`Installed live: ${receipt.status}; ${path.join(root,'receipt.json')}`);
  clearTimeout(watchdog);
}
