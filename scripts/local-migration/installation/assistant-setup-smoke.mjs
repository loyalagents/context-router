// Explicit artifact qualification in a new durable synthetic root. No personal
// provider/configuration, real Terminal, Keychain, login or model invocation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {captureTrustedArtifact,verifyCapturedArtifact} from './artifact-preflight.mjs';
const repository=path.resolve(import.meta.dirname,'../../..');
assert.equal(process.argv.length,4,'Expected APP NEW_DURABLE_ROOT');assert.equal(process.platform,'darwin');assert.equal(process.version,'v24.21.0');
const bundle=await fs.realpath(process.argv[2]),root=process.argv[3];
assert.ok(path.isAbsolute(root)&&path.resolve(root)===root&&!/[\x00-\x1f\x7f"\\]/.test(root));
assert.equal(await fs.realpath(path.dirname(root)),path.dirname(root));
assert.ok(!['/tmp','/private/tmp','/var/folders','/private/var/folders'].some(p=>root===p||root.startsWith(p+'/')),'Use a durable owned fixture root');
const source=await captureTrustedArtifact(bundle);await fs.mkdir(root,{mode:0o700});
const envelope=path.join(root,'managed-v1'),exe=path.join(bundle,'Contents/MacOS/context-router'),node=path.join(bundle,'Contents/Resources/bin/node'),client=path.join(root,'synthetic-claude'),driver=path.join(root,'request-driver'),profile=path.join(root,'offline.sb');
const receipt={version:1,status:'running',scope:'packaged-native-helper-assistant-setup',root,bundle,source,phases:[],limitations:['Synthetic offline native CLI; no real provider, login, Terminal LaunchServices or installed AppKit interaction.','Request writer is compiled from candidate source; request is executed by shell through the sealed installed native wrapper and packaged Node. Human native controls/Terminal/Desktop acceptance remains pending.']};
const hash=b=>createHash('sha256').update(b).digest('hex');
const phase=name=>{receipt.phases.push(name);console.log('Assistant artifact: '+name);};
const run=(file,args,options={})=>{const r=spawnSync(file,args,{env:{PATH:'',LC_ALL:'C'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024,...options});assert.equal(r.status,options.expected??0,r.stderr);if(options.expectedStderr)assert.match(r.stderr,options.expectedStderr);return r.stdout;};
const command=(args,expected=0)=>run('/usr/bin/sandbox-exec',['-f',profile,exe,...args],{expected});
const native=path.join(repository,'apps/desktop/native'),fixture=path.join(repository,'apps/desktop/test/fixtures');
run('/usr/bin/clang',['-Wall','-Wextra','-Werror',path.join(fixture,'demo-artifact-client.c'),'-o',client]);
run('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','Security','-I',native,path.join(fixture,'demo-artifact-request.m'),...['demo-operation','package','envelope'].map(n=>path.join(native,n+'.m')),'-o',driver]);
await fs.writeFile(profile,'(version 1)\n(allow default)\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n(deny process-exec)\n'+[exe,node,client,'/bin/sh','/bin/bash','/usr/bin/env'].map(p=>`(allow process-exec (literal ${JSON.stringify(p)}))\n`).join(''),{mode:0o600});
// macOS /bin/sh dispatches to this fixed system variant; other interpreters stay denied.
run('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','exit 0']);
run('/usr/bin/sandbox-exec',['-f',profile,'/bin/zsh','-c','exit 0'],{expected:71,expectedStderr:/Operation not permitted/});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
let owner,closed,events,pending,error,ready;
function launch(){owner=spawn('/usr/bin/sandbox-exec',['-f',profile,exe,'guardian','--root',envelope,'--ui-port','0','--mcp-port','0','--demo-mcp-port',String(port)],{env:{PATH:'',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});closed=once(owner,'close');events=[];pending='';error='';ready=undefined;
owner.stdin.on('error',()=>{});owner.stdout.on('data',b=>{pending+=b;assert.ok(pending.length<65536);let at;while((at=pending.indexOf('\n'))>=0){events.push(JSON.parse(pending.slice(0,at)));pending=pending.slice(at+1);}});owner.stderr.on('data',b=>{error+=b;assert.ok(error.length<65536);});}
launch();
const event=async(after=0)=>{const deadline=performance.now()+90000;while(!events.slice(after).some(e=>e.type==='ready')){assert.equal(owner.exitCode,null,error+JSON.stringify(events));assert.ok(performance.now()<deadline,JSON.stringify(events));await new Promise(r=>setTimeout(r,20));}return events.slice(after).find(e=>e.type==='ready');};
const send=(command)=>owner.stdin.write(JSON.stringify({version:1,generation:ready.generation,command})+'\n');
let stopped=false;
async function stop(){if(stopped)return;if(owner.exitCode===null&&owner.signalCode===null){if(ready)send('quit');else owner.stdin.end();}let timer;try{assert.equal((await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned guardian exit unobserved; retain root')),30000);})]))[0],0,error);stopped=true;}finally{clearTimeout(timer);}}
try{
 ready=await event();let after=events.length;send('enter-demo');ready=await event(after);assert.equal(ready.modelEnabled,false);
 const metadata=JSON.parse(await fs.readFile(path.join(envelope,'installation.json'))),binding=['demo','--root',envelope,'--store',metadata.demoStore,'--generation',ready.generation,'--endpoint',ready.mcpOrigin],helper=(args,expected=0)=>command([...binding,...args],expected);
 const inspected=JSON.parse(helper(['client','inspect','--client','claude','--executable',client]));assert.deepEqual(inspected,{path:client,sha256:hash(await fs.readFile(client)),version:'2.1.299'});
 await assert.rejects(fs.access(path.join(envelope,'demo/profiles')));await assert.rejects(fs.access(path.join(envelope,'demo/client-guards')));
 const wrapper=path.join(root,'untrusted-wrapper');await fs.writeFile(wrapper,'#!/bin/sh\nexit 99\n',{mode:0o700});helper(['client','inspect','--client','claude','--executable',wrapper],1);
 await fs.chmod(client,0o777);helper(['client','inspect','--client','claude','--executable',client],1);await fs.chmod(client,0o755);
 phase('packaged-inspect-canonical-identity-disposable-preflight-wrapper-and-changed-trust-refusal');
 const argumentsFile=path.join(root,'request-arguments.json');await fs.writeFile(argumentsFile,JSON.stringify([...binding,'launch','B','--client','claude','--auth','subscription','--executable',client]),{mode:0o600});
 const request=run(driver,[envelope,exe,argumentsFile]).trim(),script=await fs.readFile(request,'utf8');assert.ok(script.includes('--executable')&&!script.includes('CR_DEMO_TOKEN'));assert.equal((await fs.stat(request)).mode&0o777,0o500);
 const descriptor=openSync('/dev/null','r'),stdio=['ignore','pipe','pipe'];for(let i=3;i<24;i++)stdio[i]=descriptor;
 let output;try{output=run('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh',request],{stdio,env:{PATH:'',ANTHROPIC_API_KEY:'must-not-leak',NODE_OPTIONS:'--invalid-option',LOCAL_DATABASE_ROOT:'/personal'}});}finally{closeSync(descriptor);}
 assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)),{syntheticClient:true,closedDescriptors:true,cleanEnvironment:true,terminalType:true});await fs.access(request);await assert.rejects(fs.access(path.join(envelope,'demo/client-guards/b.json')));
 phase('native-request-shell-sealed-wrapper-packaged-node-synthetic-client-argv-and-fd-environment');
 const config=path.join(root,'owned-desktop.json'),original=Buffer.from('{"unrelated":{"synthetic":"private value"}}\n');await fs.writeFile(config,original,{mode:0o600});
 const prepare=()=>JSON.parse(helper(['desktop','prepare','--config',config]));const apply=(p,expected=0)=>helper(['desktop','apply','--proposal',p.proposal,'--proposal-sha256',p.proposalSha256,'--desktop-closed'],expected);
 let p=prepare();assert.equal(p.proposalSha256,hash(await fs.readFile(p.proposal)));assert.deepEqual(Object.keys(p.review).sort(),['backup','config','entry','entryName','operation']);assert.equal(p.review.config,config);assert.equal(p.review.operation,'create');assert.ok(!JSON.stringify(p).includes('private value'));assert.ok(!Object.hasOwn(p,'original'));
 await fs.appendFile(p.proposal,' ');apply(p,1);assert.deepEqual(await fs.readFile(config),original);
 p=prepare();helper(['desktop','apply','--proposal',p.proposal,'--proposal-sha256',p.proposalSha256],1);assert.deepEqual(await fs.readFile(config),original);
 const applied=JSON.parse(apply(p));assert.equal(applied.status,'applied');assert.deepEqual(await fs.readFile(applied.backup),original);assert.deepEqual(JSON.parse(await fs.readFile(config)).mcpServers[p.entryName],p.review.entry);assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(p.proposal),'applied.json'))).proposalSha256,p.proposalSha256);apply(p,1);
 const pendingProposal=prepare();assert.equal(pendingProposal.review.operation,'replace');await fs.appendFile(config,' ');const changed=await fs.readFile(config);apply(pendingProposal,1);assert.deepEqual(await fs.readFile(config),changed);
 phase('production-desktop-cli-safe-summary-exact-digest-confirmation-backup-no-replay-config-conflict');
 after=events.length;send('restart');ready=await event(after);helper(['client','inspect','--client','claude','--executable',client],1);apply(pendingProposal,1);
 phase('stale-runtime-refusal');await stop();receipt.firstOwner={pid:owner.pid,code:owner.exitCode,events};
 launch();stopped=false;ready=await event();assert.equal(JSON.parse(await fs.readFile(path.join(envelope,'installation.json'))).demoStore,metadata.demoStore);await fs.access(request);
 after=events.length;send('reset-demo');ready=await event(after);assert.notEqual(JSON.parse(await fs.readFile(path.join(envelope,'installation.json'))).demoStore,metadata.demoStore);await fs.access(request);
 phase('retained-launch-request-survives-quit-reopen-and-reset');await stop();await verifyCapturedArtifact(bundle,source);receipt.status='passed';
}catch(e){receipt.status='failed';receipt.failure=e.message;process.exitCode=1;}
finally{try{await stop();}catch(e){receipt.cleanupFailure=e.message;receipt.status='failed';process.exitCode=1;}receipt.owner={pid:owner.pid,code:owner.exitCode,signal:owner.signalCode,events};await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(`Assistant artifact: ${receipt.status}; ${path.join(root,'receipt.json')}`);}
