import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,mkdir,cp,rename,rm,lstat} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import {createHash} from 'node:crypto';
import path from 'node:path';import os from 'node:os';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {requestMcpSmoke} from '../local-mcp-smoke.mjs';
import {localUiBrowserPrerequisite} from '../local-ui-browser.mjs';
import {createGatedNodeChild,activateJournaledNodeChild,terminateAndReapJournaledNodeChild} from '../local-identity-smoke.mjs';
import {greekPdfFixture,standardFontPdfFixture} from '../../../apps/backend/test/local-model/fixtures/pdf-fixtures.mjs';
const repository=path.resolve(import.meta.dirname,'../../..'),sourceBundle=await realpath(process.argv[2]);
assert.equal(process.argv.length,3);assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'context-router-installed-'))),bundle=path.join(root,'Context Router.app'),envelope=path.join(root,'managed-v1'),exe=path.join(bundle,'Contents/MacOS/context-router'),node=path.join(bundle,'Contents/Resources/bin/node'),profile=path.join(root,'offline.sb');
await cp(sourceBundle,bundle,{recursive:true,verbatimSymlinks:true});
const signal=AbortSignal.timeout(240000),started=Date.now(),receipt={version:1,status:'running',bundle,root,manifestSha256:createHash('sha256').update(await readFile(path.join(bundle,'Contents/Resources/package-manifest.json'))).digest('hex'),phases:[],cleanup:[],limitations:['No live model, download, AppKit interaction, signing or human/platform acceptance in this smoke.']};
console.log(`Installed smoke evidence: ${root}`);
const phase=name=>{receipt.phases.push({name,elapsedMs:Date.now()-started});console.log(`Installed smoke: ${name}`);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}}
const {parse}=await import('yaml'),store=parse(await readFile(path.join(repository,'node_modules/.modules.yaml'),'utf8')).storeDir;
await writeFile(profile,`(version 1)\n(allow default)\n`+[repository,store,path.dirname(path.dirname(process.execPath))].map(p=>`(deny file-read* (subpath ${JSON.stringify(p)}))\n`).join('')+
  `(deny process-exec)\n(allow process-exec (literal ${JSON.stringify(exe)}))\n(allow process-exec (literal ${JSON.stringify(node)}))\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`,{mode:0o600});
const argv=args=>['-f',profile,exe,...args];const owners=[];const secrets=[];
const portReservation=createServer();await new Promise(resolve=>portReservation.listen(0,'127.0.0.1',resolve));const mcpPort=String(portReservation.address().port);await new Promise(resolve=>portReservation.close(resolve));
let browserHandle,browser,context;
async function startBrowser(){
  const prerequisite=localUiBrowserPrerequisite(repository,process.env),profileRoot=await realpath(await mkdtemp('/private/tmp/cr-installed-browser-'));
  const home=path.join(root,'browser-home');await mkdir(home,{mode:0o700});
  browserHandle=createGatedNodeChild({entrypoint:path.join(repository,'scripts/local-migration/fixtures/local-ui-smoke/browser.cjs'),operation:'browser',cwd:root,
    env:{PATH:'/usr/bin:/bin',HOME:home,TMPDIR:root,LOCAL_UI_BROWSER_PROFILE:profileRoot,LOCAL_UI_BROWSER_EXECUTABLE:prerequisite.executable},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  await activateJournaledNodeChild({handle:browserHandle,resourceId:'browser',identity:{profileRoot},journal:{acquired:async(id,record)=>{receipt.browserOwner={id,...record,profileRoot};await writeFile(path.join(root,'browser-owner.json'),JSON.stringify(receipt.browserOwner),{mode:0o600});}}});
  const deadline=performance.now()+10000;while(!browserHandle.output().stdout.endsWith('\n')){assert.ok(performance.now()<deadline&&!browserHandle.output().stderr&&!browserHandle.output().overflow);await wait(20);}
  const ready=JSON.parse(browserHandle.output().stdout);assert.equal(ready.type,'local-ui-browser-ready');const {chromium}=createRequire(path.join(repository,'apps/web/package.json'))('playwright');browser=await chromium.connectOverCDP(ready.endpoint,{timeout:5000});context=await browser.newContext({serviceWorkers:'block'});
}
async function browserProof(owner,ready){
  await startBrowser();const outbound=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==ready.origin){outbound.push('non-loopback-attempt');return route.abort();}return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(5000);const response=await page.goto(ready.origin+'/dashboard/preferences');assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/nonce-/);
  const bootstrap=(await readFile(ready.unlockFile,'utf8')).trim();secrets.push(bootstrap);assert.equal((await response.text()).includes(bootstrap),false);
  await page.getByLabel('Unlock token').fill(bootstrap);await page.getByRole('button',{name:'Unlock local dashboard'}).click();await page.getByRole('button',{name:'Lock dashboard'}).waitFor();
  const session=await page.evaluate(()=>sessionStorage.getItem('context-router.browser-session.v1'));assert.ok(session);secrets.push(session);
  const repeated=await page.evaluate(async bootstrap=>(await fetch('/api/local/unlock',{method:'POST',headers:{'content-type':'application/json','x-context-router-ui':'1'},body:JSON.stringify({bootstrap})})).status,bootstrap);assert.equal(repeated,401);
  await page.getByRole('button',{name:'Lock dashboard'}).click();const count=owner.events.length;owner.send('unlock',ready.generation);const next=await owner.event('unlock',count),replacement=(await readFile(next.unlockFile,'utf8')).trim();secrets.push(replacement);assert.notEqual(replacement,bootstrap);
  await page.getByLabel('Unlock token').fill(replacement);await page.getByRole('button',{name:'Unlock local dashboard'}).click();await page.getByRole('button',{name:'Lock dashboard'}).waitFor();assert.deepEqual(outbound,[]);
  await page.close();assert.equal(owner.child.exitCode,null);assert.equal((await fetch(ready.origin+'/dashboard/preferences',{signal})).status,200);
  await bounded(context.close(),5000,'Browser context close deadline');context=undefined;await bounded(browser.close(),5000,'Browser disconnect deadline');browser=undefined;
  assert.deepEqual(await terminateAndReapJournaledNodeChild(browserHandle,'installed browser'),[]);browserHandle=undefined;phase('browser-unlock-reunlock-close-persistence');
}
function command(args,expected=0){
  signal.throwIfAborted();const r=spawnSync('/usr/bin/sandbox-exec',argv(['--root',envelope,...args]),{cwd:bundle,env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(r.error,undefined);assert.equal(r.status,expected,`Installed CLI ${args[0]} failed: ${r.stderr}`);return r.stdout.trim()?r.stdout.trim().split('\n').map(line=>JSON.parse(line)):[];
}
const initializeMcp=(ready,token)=>requestMcpSmoke(Number(new URL(ready.mcpOrigin).port),token,{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'installed-smoke',version:'1'}}});
async function mcpClient(ready,token){
  const initialized=await initializeMcp(ready,token);assert.equal(initialized.status,200);const port=Number(new URL(ready.mcpOrigin).port),headers={'mcp-session-id':initialized.headers['mcp-session-id'],'mcp-protocol-version':'2025-11-25'};
  assert.equal((await requestMcpSmoke(port,token,{jsonrpc:'2.0',method:'notifications/initialized'},headers)).status,202);let id=1;
  return async(name,args={})=>{const response=await requestMcpSmoke(port,token,{jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}},headers);assert.equal(response.status,200);assert.equal(response.value.error,undefined);const result=response.value.result;assert.ok(result&&typeof result==='object'&&!Array.isArray(result));assert.ok(result.isError===undefined||result.isError===false);return result.structuredContent;};
}
function launch(){
  signal.throwIfAborted();const child=spawn('/usr/bin/sandbox-exec',argv(['guardian','--root',envelope,'--ui-port','0','--mcp-port',mcpPort]),{cwd:bundle,env:{PATH:'',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});
  const owner={child,ended:once(child,'close'),events:[],pending:'',diagnostic:'',overflow:false};owners.push(owner);child.stdin.on('error',()=>{});
  child.stdout.on('data',data=>{owner.pending+=data;if(owner.pending.length>65536){owner.overflow=true;child.stdin.end();return;}let end;while((end=owner.pending.indexOf('\n'))>=0){try{owner.events.push(JSON.parse(owner.pending.slice(0,end)));}catch{owner.overflow=true;child.stdin.end();}owner.pending=owner.pending.slice(end+1);}});
  child.stderr.on('data',data=>{owner.diagnostic+=data;if(owner.diagnostic.length>65536){owner.overflow=true;child.stdin.end();}});
  owner.event=async(type,after=0)=>{const deadline=performance.now()+125000;while(!owner.events.slice(after).some(e=>e.type===type)){signal.throwIfAborted();assert.equal(owner.overflow,false);assert.equal(child.exitCode,null,`Installed guardian exited: ${JSON.stringify(owner.events)} ${owner.diagnostic}`);assert.ok(performance.now()<deadline,'Installed guardian readiness deadline');await wait(20);}return owner.events.slice(after).find(e=>e.type===type);};
  owner.send=(name,generation)=>child.stdin.write(JSON.stringify({version:1,generation,command:name})+'\n');return owner;
}
async function stop(owner){
  owner.stopping??=(async()=>{
    if(owner.child.exitCode===null&&owner.child.signalCode===null)owner.child.stdin.end();
    try{
      const [code]=await bounded(owner.ended,30000,'Exact installed guardian exit unobserved');assert.equal(code,0,`Installed guardian cleanup failed: ${JSON.stringify(owner.events)}`);assert.equal(owner.overflow,false);assert.equal(owner.pending,'');assert.equal(owner.diagnostic,'');const last=owner.events.at(-1);assert.equal(last?.type,'stopped');assert.equal(last.outcome,'ok');
      const journal=JSON.parse(await readFile(path.join(envelope,'owner.json')));assert.equal(journal.lifecycle,'quiescent');assert.equal(journal.outcome,'ok');assert.equal(journal.generation,last.generation);
    }catch(error){owner.child.stdin.destroy();owner.child.stdout.destroy();owner.child.stderr.destroy();owner.child.unref();throw error;}
  })();return owner.stopping;
}
try{
  const proof=`const a=require('node:assert/strict'),f=require('node:fs'),c=require('node:child_process');a.throws(()=>f.readFileSync(${JSON.stringify(path.join(repository,'README.md'))}));a.throws(()=>f.readFileSync(${JSON.stringify(process.execPath)}));a.ok(c.spawnSync('/usr/bin/true').error);a.equal(process.execPath,${JSON.stringify(node)});`;
  const isolation=spawnSync('/usr/bin/sandbox-exec',['-f',profile,node,'--no-global-search-paths','-e',proof],{cwd:bundle,env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:5000});assert.equal(isolation.status,0,isolation.stderr);phase('source-toolchain-exec-denial');
  const payloadRequire=createRequire(path.join(bundle,'Contents/Resources/app/local-ui.mjs')),dist=path.dirname(payloadRequire.resolve('backend/dist/local-mcp.js')),greek=await greekPdfFixture(),pdf=path.join(root,'fixture.pdf'),unsupported=path.join(root,'unembedded.pdf');
  await writeFile(pdf,greek.bytes,{mode:0o600});await writeFile(unsupported,await standardFontPdfFixture(),{mode:0o600});
  const parserProof=path.join(root,'pdf-proof.mjs');await writeFile(parserProof,`import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PdfProcess} from ${JSON.stringify(path.join(dist,'infrastructure/local-model/engine/pdf-process.mjs'))};const parser=new PdfProcess({workerPath:${JSON.stringify(path.join(dist,'infrastructure/local-model/engine/pdf-worker.mjs'))}});await assert.rejects(parser.parse(await readFile(${JSON.stringify(unsupported)})),{message:'PDF_AUXILIARY'});const result=await parser.parse(await readFile(${JSON.stringify(pdf)}));assert.equal(result.text,${JSON.stringify(greek.expectedText)});assert.equal(parser.state,'ready');`,{mode:0o600});
  const parsed=spawnSync('/usr/bin/sandbox-exec',['-f',profile,node,'--no-global-search-paths',parserProof],{cwd:bundle,env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:10000});assert.equal(parsed.status,0,parsed.stderr);phase('installed-pdf-dependency-closure');
  const initial=launch(),first=await initial.event('ready');assert.equal(first.modelEnabled,false);assert.equal((await fetch(first.origin+'/dashboard/preferences',{signal})).status,200);command(['mcp','list'],1);await browserProof(initial,first);await stop(initial);phase('first-run-dashboard-cli-exclusion-clean-quit');
  const downloadStage=path.join(envelope,`models/.download-${'a'.repeat(32)}-${'b'.repeat(32)}.part`);await writeFile(downloadStage,'interrupted synthetic download',{mode:0o600});
  assert.equal(command(['cleanup-downloads'])[0].status,'model-download-cleanup-complete');await assert.rejects(lstat(downloadStage),{code:'ENOENT'});command(['cleanup-downloads']);phase('installed-native-download-cleanup-and-idempotence');
  const tokenFile=path.join(root,'mcp.token'),provision=command(['mcp','provision','--label','Installed fixture','--out',tokenFile])[0],token=(await readFile(tokenFile,'utf8')).trim();secrets.push(token);
  const editorFile=path.join(root,'editor.token'),editor=command(['mcp','provision','--label','Installed editor','--out',editorFile])[0],editorToken=(await readFile(editorFile,'utf8')).trim();secrets.push(editorToken);
  command(['mcp','permissions','--id',editor.result.id,'--capabilities','preferences:read,preferences:write,preferences:define','--targets','synthetic.*']);
  const listed=command(['mcp','list'])[0];assert.ok(JSON.stringify(listed).includes(provision.result.id));
  const run=launch(),ready=await run.event('ready');
  const mcp=await requestMcpSmoke(Number(new URL(ready.mcpOrigin).port),token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'installed-smoke',version:'1'}}});assert.equal(mcp.status,200);
  const edit=await mcpClient(ready,editorToken);await edit('mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug:'synthetic.shared',description:'Installed fixture',valueType:'STRING',scope:'GLOBAL',isSensitive:false}});await edit('mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug:'synthetic.shared',value:'"retained snapshot"'}});
  assert.equal((await edit('searchPreferences')).active.preferences.find(row=>row.slug==='synthetic.shared')?.value,'retained snapshot');
  const count=run.events.length;run.send('restart',ready.generation);const restarted=await run.event('ready',count);assert.notEqual(restarted.generation,ready.generation);assert.equal(restarted.mcpOrigin,ready.mcpOrigin);assert.equal((await fetch(restarted.origin+'/dashboard/preferences',{signal})).status,200);await stop(run);phase('installed-cli-mcp-and-explicit-fresh-restart');
  const backup=command(['backup']).find(record=>record.status==='backup-complete');assert.ok(backup?.path);const before=JSON.parse(await readFile(path.join(envelope,'installation.json')));
  command(['mcp','revoke','--id',provision.result.id]);const rotatedFile=path.join(root,'rotated-editor.token');command(['mcp','rotate','--id',editor.result.id,'--out',rotatedFile]);const rotatedToken=(await readFile(rotatedFile,'utf8')).trim();secrets.push(rotatedToken);command(['mcp','grant','--id',editor.result.id,'--target','synthetic.shared','--action','READ','--effect','DENY']);
  const changed=launch(),changedReady=await changed.event('ready');assert.equal((await initializeMcp(changedReady,token)).status,401);assert.equal((await initializeMcp(changedReady,editorToken)).status,401);const restricted=await mcpClient(changedReady,rotatedToken);assert.equal((await restricted('searchPreferences')).active.preferences.some(row=>row.slug==='synthetic.shared'),false);await stop(changed);phase('post-backup-revocation-rotation-and-grant-denial');
  const restored=command(['restore','--from',backup.path]).find(record=>record.status==='restore-pending');assert.ok(restored?.storeId);const pending=JSON.parse(await readFile(path.join(envelope,'installation.json')));assert.equal(pending.selectedStore,before.selectedStore);assert.equal(pending.pendingRestore.storeId,restored.storeId);
  command(['mcp','list'],1);command(['--pending-store',restored.storeId,'mcp','revoke','--id',provision.result.id]);command(['activate-restore',restored.storeId],1);command(['activate-restore',restored.storeId,'--acknowledge-restored-authority']);
  const after=JSON.parse(await readFile(path.join(envelope,'installation.json')));assert.equal(after.selectedStore,restored.storeId);assert.equal(after.pendingRestore,null);
  const restoredRun=launch(),restoredReady=await restoredRun.event('ready');assert.equal((await initializeMcp(restoredReady,token)).status,401);assert.equal((await initializeMcp(restoredReady,rotatedToken)).status,401);const restoredClient=await mcpClient(restoredReady,editorToken);assert.equal((await restoredClient('searchPreferences')).active.preferences.find(row=>row.slug==='synthetic.shared')?.value,'retained snapshot');await stop(restoredRun);phase('acknowledged-restore-credential-and-grant-cutover-with-pending-revocation');
  const marker=path.join(envelope,'models/preservation-marker');await writeFile(marker,'owned fixture retained across replacement\n',{mode:0o600});
  const durableNames=['installation.json',`stores/${after.selectedStore}/identity/identity.json`,`stores/${after.selectedStore}/data/database.sqlite`,'models/preservation-marker'];
  const durable=async()=>Promise.all(durableNames.map(async name=>createHash('sha256').update(await readFile(path.join(envelope,name))).digest('hex')));
  const originalDurable=await durable(),runtimeEntry=path.join(bundle,'Contents/Resources/desktop/runtime/prepare-store.mjs'),held=path.join(root,'held-runtime.mjs');
  await rename(runtimeEntry,held);command(['mcp','list'],1);assert.deepEqual(await durable(),originalDurable);await rename(held,runtimeEntry);phase('interrupted-replacement-refuses-before-durable-state');
  const old=path.join(root,'previous.app');await rename(bundle,old);await cp(sourceBundle,bundle,{recursive:true,verbatimSymlinks:true});command(['mcp','list']);assert.deepEqual(await durable(),originalDurable);phase('complete-compatible-replacement-preserves-pair-and-assets');
  await rm(bundle,{recursive:true});assert.deepEqual(await durable(),originalDurable);await cp(sourceBundle,bundle,{recursive:true,verbatimSymlinks:true});command(['mcp','list']);assert.deepEqual(await durable(),originalDurable);
  const reinstalled=launch(),reinstalledReady=await reinstalled.event('ready');assert.equal(reinstalledReady.mcpOrigin,ready.mcpOrigin);await stop(reinstalled);phase('app-only-uninstall-reinstall-preserves-durable-state');
  for(const owner of owners)for(const secret of secrets){assert.equal(owner.diagnostic.includes(secret),false);assert.equal(JSON.stringify(owner.events).includes(secret),false);}
  receipt.status='passed';
}catch(error){receipt.status='failed';receipt.failure={message:error.message};process.exitCode=1;}
finally{
  for(const cleanup of [()=>context?bounded(context.close(),5000,'Browser context cleanup deadline'):undefined,()=>browser?bounded(browser.close(),5000,'Browser cleanup deadline'):undefined])try{await cleanup();}catch(error){receipt.cleanup.push(error.message);}
  if(browserHandle)receipt.cleanup.push(...(await terminateAndReapJournaledNodeChild(browserHandle,'installed browser cleanup')).map(error=>error.message));
  for(const owner of owners)if(owner.child.exitCode===null&&owner.child.signalCode===null)try{await stop(owner);}catch(error){receipt.cleanup.push(error.message);}
  receipt.owners=owners.map(owner=>({pid:owner.child.pid,exitCode:owner.child.exitCode,signal:owner.child.signalCode,events:owner.events}));receipt.elapsedMs=Date.now()-started;
  if(receipt.cleanup.length){receipt.status='failed';process.exitCode=1;}
  await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(`Installed smoke: ${receipt.status}; ${path.join(root,'receipt.json')}`);
}
