// Explicit synthetic artifact qualification. No default roots, provider sessions,
// personal configuration, downloads or model execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {captureTrustedArtifact,verifyCapturedArtifact} from './artifact-preflight.mjs';
import {localUiBrowserPrerequisite} from '../local-ui-browser.mjs';
import {connect,call} from '../../../apps/backend/scripts/demo/mcp-import.mjs';
const repository=path.resolve(import.meta.dirname,'../../..'),browserOnly=process.argv[3]==='--browser-only';
assert.ok(process.argv.length===3||(process.argv.length===4&&browserOnly),'Expected APP [--browser-only]');assert.equal(process.platform,'darwin');assert.equal(process.version,'v24.21.0');
const source=await fs.realpath(process.argv[2]);
const identity=await captureTrustedArtifact(source),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'context-router-demo-artifact-'))),bundle=path.join(root,'Context Router.app'),envelope=path.join(root,'managed-v1');
await fs.cp(source,bundle,{recursive:true,verbatimSymlinks:true});await verifyCapturedArtifact(bundle,identity);
const exe=path.join(bundle,'Contents/MacOS/context-router'),node=path.join(bundle,'Contents/Resources/bin/node'),profile=path.join(root,'offline.sb');
const {parse}=await import('yaml'),store=parse(await fs.readFile(path.join(repository,'node_modules/.modules.yaml'),'utf8')).storeDir;
await fs.writeFile(profile,'(version 1)\n(allow default)\n'+[repository,store,path.dirname(path.dirname(process.execPath))].map(p=>`(deny file-read* (subpath ${JSON.stringify(p)}))\n`).join('')+'(deny process-exec)\n'+[exe,node].map(p=>`(allow process-exec (literal ${JSON.stringify(p)}))\n`).join('')+`(allow process-exec (subpath ${JSON.stringify(path.join(envelope,'demo/desktop'))}))\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`,{mode:0o600});
const receipt={version:1,status:'running',scope:browserOnly?'browser-only':'full-demo-cycle',root,bundle,source:identity,phases:[],limitations:['Synthetic state with real packaged native/backend/browser/MCP. No AppKit interaction, provider login/session, real model retention/startup, distribution or human acceptance.','Desktop uses an injected test-only temporary-root context; human snapshots require a durable private envelope.',...(browserOnly?['Browser, rename and permissions scope only. It excludes the later A/B/C authority, immutable Desktop, reconnect, reset and personal-return proofs.']:[])]},owners=[],clients=[];let browser;
const phase=name=>{receipt.phases.push(name);console.log('Demo artifact: '+name);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const portProbe=net.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const demoPort=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const command=(args,expected=0)=>{const result=spawnSync('/usr/bin/sandbox-exec',['-f',profile,exe,...args],{env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(result.status,expected,result.stderr);return result.stdout;};
function launch(){
 const child=spawn('/usr/bin/sandbox-exec',['-f',profile,exe,'guardian','--root',envelope,'--ui-port','0','--mcp-port','0','--demo-mcp-port',String(demoPort)],{env:{PATH:'',LC_ALL:'C'},stdio:['pipe','pipe','pipe']}),owner={child,closed:once(child,'close'),events:[],pending:'',error:''};owners.push(owner);child.stdin.on('error',()=>{});
 child.stdout.on('data',b=>{owner.pending+=b;assert.ok(owner.pending.length<65536);let end;while((end=owner.pending.indexOf('\n'))>=0){owner.events.push(JSON.parse(owner.pending.slice(0,end)));owner.pending=owner.pending.slice(end+1);}});child.stderr.on('data',b=>{owner.error+=b;assert.ok(owner.error.length<65536);});
 owner.event=async(type,after=0)=>{const deadline=performance.now()+90000;while(!owner.events.slice(after).some(e=>e.type===type)){assert.equal(child.exitCode,null,owner.error+JSON.stringify(owner.events));assert.ok(performance.now()<deadline,JSON.stringify(owner.events));await pause();}return owner.events.slice(after).find(e=>e.type===type);};
 owner.send=(command,generation)=>child.stdin.write(JSON.stringify({version:1,generation,command})+'\n');return owner;
}
async function stop(owner,ready){if(owner.child.exitCode===null&&owner.child.signalCode===null){if(ready)owner.send('quit',ready.generation);else owner.child.stdin.end();}let timer;try{assert.equal((await Promise.race([owner.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native exact exit unobserved; retain fixture')),30000);})]))[0],0,owner.error);}finally{clearTimeout(timer);}assert.equal(owner.events.at(-1)?.outcome,'ok');}
const metadata=()=>fs.readFile(path.join(envelope,'installation.json'),'utf8').then(JSON.parse);
const helper=(spec,args,expected=0)=>command(['demo','--root',envelope,'--store',spec.store,'--generation',spec.generation,'--endpoint',spec.endpoint,...args],expected);
async function client(ready,file){const c=await connect(Number(new URL(ready.mcpOrigin).port),file);clients.push(c);return c;}
async function closeClients(){for(const c of clients.splice(0))await c.close();}
const hash=b=>createHash('sha256').update(b).digest('hex');
let current,ready;
try{
 const denied=spawnSync('/usr/bin/sandbox-exec',['-f',profile,node,'-e',`const f=require('node:fs'),a=require('node:assert/strict');a.throws(()=>f.readFileSync(${JSON.stringify(path.join(repository,'README.md'))}));a.throws(()=>f.readFileSync(${JSON.stringify(process.execPath)}));`],{env:{},encoding:'utf8'});assert.equal(denied.status,0,denied.stderr);phase('relocated-checkout-and-toolchain-denial');
 current=launch();ready=await current.event('ready');assert.equal(ready.modelEnabled,false);await stop(current,ready);
 const personal=(await metadata()).personalStore,personalToken=path.join(root,'personal.token');const provision=JSON.parse(command(['--root',envelope,'mcp','provision','--label','Synthetic personal','--out',personalToken]));
 command(['--root',envelope,'mcp','permissions','--id',provision.result.id,'--capabilities','preferences:read,preferences:write,preferences:define','--targets','synthetic.*']);
 current=launch();ready=await current.event('ready');const personalClient=await client(ready,personalToken);await call(personalClient,'mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug:'synthetic.personal',description:'Owned fixture',valueType:'STRING',scope:'GLOBAL',isSensitive:false}});await call(personalClient,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug:'synthetic.personal',value:'"retained personal"'}});await closeClients();await stop(current,ready);
 const pairPaths=['data/database.sqlite','identity/identity.json'].map(name=>path.join(envelope,'stores',personal,name)),personalBefore=await Promise.all(pairPaths.map(async p=>hash(await fs.readFile(p))));
 current=launch();ready=await current.event('ready');let after=current.events.length;current.send('enter-demo',ready.generation);ready=await current.event('ready',after);assert.equal(ready.modelEnabled,false);let state=await metadata();const firstStore=state.demoStore;assert.notEqual(firstStore,personal);
 const spec={store:firstStore,generation:ready.generation,endpoint:ready.mcpOrigin};assert.equal(JSON.parse(helper(spec,['status'])).status,'running');helper(spec,['verify'],1);helper(spec,['desktop','prepare','--config',path.join(root,'desktop.json')],1);
 assert.deepEqual(await Promise.all(pairPaths.map(async p=>hash(await fs.readFile(p)))),personalBefore);phase('native-first-entry-personal-byte-preservation-and-bound-status');
 // Rename through the real offline native wrapper in both store domains. Demo
 // receipt and authority verification must survive without rewriting exports.
 await stop(current,ready);
 const generationFile=path.join(envelope,'demo',firstStore,'generation.json'),generationBefore=await fs.readFile(generationFile),demoReceipt=JSON.parse(generationBefore);
 const demoToken=path.join(envelope,'demo',firstStore,'exports/agent-a.token'),tokenBefore=await fs.readFile(demoToken);
 const demoClientsBefore=JSON.parse(command(['--root',envelope,'--mode','demo','mcp','list'])).result;
 const demoClient=demoClientsBefore.find(client=>client.id===demoReceipt.clients.agentA);assert.ok(demoClient);
 command(['--root',envelope,'mcp','rename','--id',demoClient.id,'--label','Wrong store'],1);
 assert.deepEqual(await Promise.all(pairPaths.map(async p=>hash(await fs.readFile(p)))),personalBefore);
 const renamed=JSON.parse(command(['--root',envelope,'--mode','demo','mcp','rename','--id',demoClient.id,'--label','Artifact demo laptop'])).result;
 assert.equal(renamed.id,demoClient.id);assert.equal(renamed.label,'Artifact demo laptop');
 const demoClientsAfter=JSON.parse(command(['--root',envelope,'--mode','demo','mcp','list'])).result;
 assert.deepEqual(demoClientsAfter,demoClientsBefore.map(client=>client.id===demoClient.id?{...client,label:'Artifact demo laptop'}:client));
 assert.deepEqual(await fs.readFile(generationFile),generationBefore);assert.deepEqual(await fs.readFile(demoToken),tokenBefore);
 assert.deepEqual(await Promise.all(pairPaths.map(async p=>hash(await fs.readFile(p)))),personalBefore);
 helper(spec,['verify']);
 current=launch();ready=await current.event('ready');assert.equal((await metadata()).demoStore,firstStore);
 spec.generation=ready.generation;spec.endpoint=ready.mcpOrigin;assert.equal(JSON.parse(helper(spec,['status'])).status,'running');
 const renamedPeer=await client(ready,demoToken);assert.ok((await renamedPeer.listTools()).tools.some(tool=>tool.name==='mutatePreferences'));await closeClients();
 phase('native-demo-rename-domain-isolation-reopen-unchanged-token-authority-and-receipt');
 const prerequisite=localUiBrowserPrerequisite(repository,process.env),{chromium}=createRequire(path.join(repository,'apps/web/package.json'))('playwright');browser=await chromium.launch({headless:true,executablePath:prerequisite.executable,env:{PATH:'/usr/bin:/bin',HOME:root}});const context=await browser.newContext(),outbound=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==ready.origin){outbound.push('outside-active-origin');return route.abort();}return route.continue();});const page=await context.newPage();page.setDefaultTimeout(10000);
 await page.goto(ready.origin+'/dashboard');assert.equal(await page.getByRole('complementary',{name:'Demo mode'}).count(),0);await page.getByLabel('Unlock token').fill((await fs.readFile(ready.unlockFile,'utf8')).trim());await page.getByRole('button',{name:'Unlock local dashboard'}).click();
 for(const name of ['Dashboard','Account Information','Profile Memory'])await page.getByRole('heading',{name,exact:true}).waitFor();
 const navigation=[['Edit Profile','/dashboard/profile'],['Preferences','/dashboard/preferences'],['Form Fill','/dashboard/form-fill'],['Audit History','/dashboard/history'],['Preference Schema','/dashboard/schema'],['Permission Grants','/dashboard/permissions']];
 assert.deepEqual(await page.locator('a[href^="/dashboard/"]').evaluateAll(links=>links.map(a=>[a.textContent.trim(),a.getAttribute('href')])),navigation);
 const summary=page.getByText('Demo walkthrough (optional)',{exact:true}),guide=page.locator('details').filter({has:summary});assert.equal(await guide.getAttribute('open'),null);assert.equal(await guide.getByRole('button',{name:'Copy step 1 prompt',exact:true}).isVisible(),false);await page.screenshot({path:path.join(root,'demo-dashboard.png'),fullPage:true});
 await summary.click();assert.equal(await guide.getByRole('button',{name:/Copy step [1-5] prompt/}).count(),5);await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ready.origin});const prompt=await guide.locator('li p').first().innerText();await guide.getByRole('button',{name:'Copy step 1 prompt',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),prompt);await page.screenshot({path:path.join(root,'demo-walkthrough-expanded.png'),fullPage:true});await summary.click();assert.equal(await guide.getAttribute('open'),null);
 for(const [label,view,heading] of [['Edit Profile','profile','Edit Profile'],['Preferences','preferences','Preferences'],['Preference Schema','schema','Preference Schema'],['Permission Grants','permissions','MCP Clients'],['Audit History','history','Audit History']]){await page.goto(ready.origin+'/dashboard');await page.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(ready.origin+'/dashboard/'+view);await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.getByRole('complementary',{name:'Demo mode'}).waitFor();}
 await page.goto(ready.origin+'/dashboard/permissions');
 const authority=()=>page.evaluate(async()=>{const response=await fetch('/api/local/mcp/list',{method:'POST',headers:{'content-type':'application/json','x-context-router-ui':'1',authorization:'Bearer '+sessionStorage.getItem('context-router.browser-session.v1')},body:'{}'});if(!response.ok)throw new Error('Authority read failed');return (await response.json()).items;});
 const permissionBefore=await authority(),selectedId=demoReceipt.clients.agentB;
 await page.getByRole('button',{name:'Edit permissions '+selectedId,exact:true}).click();
 const permissionPanel=page.getByRole('region',{name:'Edit permissions',exact:true});
 await permissionPanel.getByLabel('Maximum value access').selectOption('Blocked');
 await permissionPanel.getByRole('button',{name:'Preview resulting access'}).click();
 await permissionPanel.getByRole('button',{name:'Save permissions',exact:true}).click();
 await permissionPanel.getByText('Permissions saved',{exact:true}).waitFor();
 const permissionAfter=await authority();
 assert.deepEqual(permissionAfter.filter(row=>row.id!==selectedId),permissionBefore.filter(row=>row.id!==selectedId));
 assert.deepEqual(permissionAfter.find(row=>row.id===selectedId).policy.capabilities,[]);
 const blockedReader=await client(ready,path.join(envelope,'demo',firstStore,'exports/agent-b.token'));
 assert.equal((await blockedReader.listTools()).tools.some(tool=>tool.name==='searchPreferences'),false);
 await closeClients();
 assert.deepEqual(await fs.readFile(generationFile),generationBefore);
 assert.deepEqual(await Promise.all(pairPaths.map(async p=>hash(await fs.readFile(p)))),personalBefore);
 await permissionPanel.getByLabel('Maximum value access').selectOption('Read');
 await permissionPanel.getByRole('button',{name:'Preview resulting access'}).click();
 await permissionPanel.getByRole('button',{name:'Save permissions',exact:true}).click();
 await permissionPanel.getByText('Permissions saved',{exact:true}).waitFor();
 assert.deepEqual((await authority()).map(({summary,ruleCount,...row})=>row),permissionBefore.map(({summary,ruleCount,...row})=>row));
 await permissionPanel.screenshot({path:path.join(root,'demo-permissions-save.png')});
 phase('installed-demo-permissions-save-selected-client-only-personal-receipt-preservation-and-real-mcp');
 assert.deepEqual(outbound,[]);await context.close();await browser.close();browser=undefined;phase('real-packaged-shared-dashboard-optional-guide-and-reused-views');
 if(browserOnly){await stop(current,ready);receipt.status='passed';}else{
 const exports=path.join(envelope,'demo',firstStore,'exports'),a=await client(ready,path.join(exports,'agent-a.token')),b=await client(ready,path.join(exports,'agent-b.token')),c=await client(ready,path.join(exports,'agent-c.token'));
 const slug='home.demo001.artifact_note';await call(a,'mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug,description:'Explicit synthetic artifact change',valueType:'STRING',scope:'GLOBAL',isSensitive:true}});await call(a,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug,value:'"fresh portable artifact"'}});
 for(const reader of [b,c]){assert.match(JSON.stringify(await call(reader,'searchPreferences',{query:slug})),/fresh portable artifact/);assert.equal((await reader.listTools()).tools.some(t=>t.name==='mutatePreferences'),false);await assert.rejects(call(reader,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug,value:'"denied"'}}));assert.equal((await call(reader,'searchPreferences',{query:'health.demo001.'})).active.preferences.length,0);}
 await closeClients();phase('real-mcp-A-write-B-C-fresh-read-denied-write-and-health');
 // Bundled C adapter, immutable snapshot Node and real SDK stdio transport. No
 // actual Desktop process/config is involved; fixture context is never CLI-exposed.
 const program=path.join(root,'desktop-proof.mjs');await fs.writeFile(program,`
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(${JSON.stringify(path.join(bundle,'Contents/Resources/app/local-ui.mjs'))}),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {prepareInstalledDesktop,applyInstalledDesktop}=await import(require.resolve('backend/scripts/demo/installed-desktop.mjs'));
const input=${JSON.stringify({...spec,root:envelope})},options={fixtureRoot:${JSON.stringify(root)}},config=${JSON.stringify(path.join(root,'desktop.json'))},proofFile=${JSON.stringify(path.join(root,'desktop-proof.json'))},mode=process.argv[2];
if(mode==='initial'){
 await fs.writeFile(config,'{"unrelated":true}',{mode:0o600});const proposal=await prepareInstalledDesktop({...input,config},options);
 await applyInstalledDesktop({...input,proposal:proposal.proposal,desktopClosed:true},options);await assert.rejects(applyInstalledDesktop({...input,proposal:proposal.proposal,desktopClosed:true},options));
 const p=JSON.parse(await fs.readFile(proposal.proposal)),pending=await prepareInstalledDesktop({...input,config},options);
 await fs.writeFile(proofFile,JSON.stringify({proposal:proposal.proposal,pending:pending.proposal,entryName:proposal.entryName,files:p.files,configHash:hash(await fs.readFile(config))}),{mode:0o600});
}
const proof=JSON.parse(await fs.readFile(proofFile));assert.equal(hash(await fs.readFile(config)),proof.configHash);
for(const file of proof.files)assert.equal(hash(await fs.readFile(path.join(path.dirname(proof.proposal),'snapshot',file.name))),file.sha256);
if(mode!=='initial')await assert.rejects(applyInstalledDesktop({...input,proposal:proof.pending,desktopClosed:true},options));
assert.equal(hash(await fs.readFile(config)),proof.configHash);const value=JSON.parse(await fs.readFile(config));assert.equal(value.unrelated,true);const entry=value.mcpServers[proof.entryName];
const backendRequire=createRequire(require.resolve('backend/package.json'));const {Client}=backendRequire('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=backendRequire('@modelcontextprotocol/sdk/client/stdio.js');const client=new Client({name:'artifact-c',version:'1'}),connectionAbort=new AbortController();
try{const connecting=client.connect(new StdioClientTransport({...entry,env:{...entry.env,PATH:'/usr/bin:/bin'},stderr:'pipe'}),{signal:connectionAbort.signal});if(mode==='refuse')await assert.rejects(connecting);else{await connecting;const result=await client.callTool({name:'searchPreferences',arguments:{query:${JSON.stringify(slug)}}});assert.match(JSON.stringify(result),/fresh portable artifact/);}}finally{await client.close();connectionAbort.abort();}
`,{mode:0o600});
 // The pinned SDK retains its initialize timer after an early transport close.
 // Dispose that request only after its assertion and awaited client close above.
 const desktop=mode=>{const result=spawnSync('/usr/bin/sandbox-exec',['-f',profile,node,'--no-global-search-paths',program,mode],{env:{NODE_TEST_CONTEXT:'artifact-fixture'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(result.status,0,JSON.stringify({proof:'desktop',mode,status:result.status,signal:result.signal,error:result.error?.code,stderr:result.stderr.slice(0,2048)}));};
 desktop('initial');phase('bundled-immutable-Desktop-snapshot-real-SDK-and-no-replay');
 await stop(current,ready);helper(spec,['status'],1);helper(spec,['verify'],1);current=launch();ready=await current.event('ready');state=await metadata();assert.equal(state.demoStore,firstStore);assert.equal(state.mode,'demo');helper(spec,['status'],1);const persisted=await client(ready,path.join(exports,'agent-b.token'));assert.match(JSON.stringify(await call(persisted,'searchPreferences',{query:slug})),/fresh portable artifact/);await closeClients();assert.equal(ready.mcpOrigin,spec.endpoint);desktop('reopen');phase('quit-reopen-preserves-edit-and-old-runtime-command-refusal');
 after=current.events.length;current.send('restart',ready.generation);ready=await current.event('ready',after);assert.equal(ready.mcpOrigin,spec.endpoint);desktop('restart');phase('bundled-C-new-process-same-endpoint-reopen-and-restart-with-unchanged-entry');
 after=current.events.length;current.send('reset-demo',ready.generation);ready=await current.event('ready',after);state=await metadata();assert.notEqual(state.demoStore,firstStore);desktop('refuse');await assert.rejects(connect(Number(new URL(ready.mcpOrigin).port),path.join(exports,'agent-a.token')));await fs.access(path.join(exports,'agent-a.token'));const resetSpec={store:state.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin};await stop(current,ready);helper(resetSpec,['verify']);phase('native-reset-fresh-identity-old-token-refusal-and-offline-baseline');
 current=launch();ready=await current.event('ready');after=current.events.length;current.send('leave-demo',ready.generation);ready=await current.event('ready',after);assert.equal((await metadata()).personalStore,personal);const restored=await client(ready,personalToken);assert.match(JSON.stringify(await call(restored,'searchPreferences',{query:'synthetic.personal'})),/retained personal/);await closeClients();await stop(current,ready);phase('return-personal-preserves-authority-and-sentinel');receipt.status='passed';}
}catch(error){receipt.status='failed';receipt.failure=error.message;process.exitCode=1;}
finally{await closeClients();await browser?.close();for(const owner of owners)if(owner.child.exitCode===null&&owner.child.signalCode===null)try{await stop(owner);}catch(error){receipt.status='failed';receipt.cleanupFailure=error.message;process.exitCode=1;}receipt.owners=owners.map(o=>({pid:o.child.pid,code:o.child.exitCode,signal:o.child.signalCode,events:o.events}));await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(`Demo artifact: ${receipt.status}; ${path.join(root,'receipt.json')}`);}
