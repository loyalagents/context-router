import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { privateJson, privateBytes, safeError } from './files.mjs';
import { trustedDirectory, trustedBytes, ensurePrivateDirectory, writeSynced, writeSyncedJson, syncDirectory, exists, durable } from './trusted-files.mjs';
import { withClientGuard } from './installed-clients.mjs';
import { activeDemo } from './active.mjs';
import { readCredential } from '../mcp-bridge/credential.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['desktop-bridge.mjs','active.mjs','files.mjs','mcp-bridge/bridge.mjs','mcp-bridge/credential.mjs','mcp-bridge/cli.mjs'];
import { parsedConfig as parsed, sameConfigBytes as same } from './desktop-config.mjs';
const defaultConfig=()=>path.join(os.userInfo().homedir,'Library/Application Support/Claude/claude_desktop_config.json');
async function context(spec,config,options){
  await trustedDirectory(spec.root);await trustedDirectory(path.dirname(config),false);
  if(!path.isAbsolute(config)||path.resolve(config)!==config||/[\x00-\x1f\x7f]/.test(config))throw safeError('Config must be canonical.');
  if(options.fixtureRoot!==undefined){
    await trustedDirectory(options.fixtureRoot);
    if(!process.env.NODE_TEST_CONTEXT||![spec.root,config].every(file=>file.startsWith(options.fixtureRoot+path.sep)))throw safeError('Invalid fixture context.');
  }else{if(options.checkActive||options.checkpoint)throw safeError('Fixture hooks are unavailable.');await durable(spec.root);await durable(config);}
  return (options.checkActive??activeDemo)(spec);
}
async function sources(){
  if(process.versions.node!=='24.21.0')throw safeError('Pinned Node24.21.0 required.');
  const files=[];
  for(const name of names){const source=name.startsWith('mcp-bridge/')?path.join(import.meta.dirname,'..',name):path.join(import.meta.dirname,name);files.push({name,bytes:await trustedBytes(await fs.realpath(source))});}
  files.push({name:'node',bytes:await trustedBytes(await fs.realpath(process.execPath))});
  return files;
}
async function configBytes(file){if(!await exists(file))return null;const bytes=await privateBytes(file);if(bytes.length>2*1024*1024)throw safeError('Desktop config exceeds bound.');return bytes;}

function entryFor(directory,spec){return{command:path.join(directory,'snapshot/node'),args:['--no-global-search-paths',path.join(directory,'snapshot/desktop-bridge.mjs'),'--root',spec.root,'--store',spec.store,'--generation',spec.generation,'--endpoint',spec.endpoint,'--credential-file',path.join(spec.root,'demo',spec.store,'exports/agent-c.token')],env:{NODE_OPTIONS:'',NODE_DEBUG:'',NODE_DEBUG_NATIVE:''}};}
async function generation(spec,installationId){
 const receipt=await privateJson(path.join(spec.root,'demo',spec.store,'generation.json'));
 if(receipt.installationId!==installationId||receipt.storeId!==spec.store||!/^[A-Za-z0-9_-]{22}$/.test(receipt.clients?.agentC))throw safeError('Demo generation mismatch.');
 const token=readCredential(path.join(spec.root,'demo',spec.store,'exports/agent-c.token'));
 if(token.slice(7,29)!==receipt.clients.agentC)throw safeError('Demo Desktop credential mismatch.');
 return receipt;
}
async function collision(root,installationId,config,entryName){
 if(!Object.hasOwn(config.mcpServers??{},entryName))return;
 const file=path.join(root,'demo/desktop/installed.json');
 if(!await exists(file))throw safeError('Desktop entry collision; config unchanged.');
 const receipt=await privateJson(file);
 if(receipt.installationId!==installationId||receipt.entryName!==entryName||!isDeepStrictEqual(receipt.entry,config.mcpServers[entryName]))throw safeError('Desktop entry is unrecognized or edited.');
}
export async function prepareInstalledDesktop(input,options={}){
 const spec={root:input.root,store:input.store,generation:input.generation,endpoint:input.endpoint},config=input.config??defaultConfig();
 const active=await context(spec,config,options);
 return withClientGuard(spec.root,'desktop',async guard=>{
  await generation(spec,active.installationId);const original=await configBytes(config),value=parsed(original),entryName=`context-router-demo-${active.installationId}`;
  await collision(spec.root,active.installationId,value,entryName);const files=await sources();
  await context(spec,config,options);
  const base=path.join(spec.root,'demo/desktop');await ensurePrivateDirectory(base);
  const id=randomBytes(16).toString('hex'),directory=path.join(base,id),snapshot=path.join(directory,'snapshot');
  guard.mutating();await fs.mkdir(directory,{mode:0o700});await fs.mkdir(snapshot,{mode:0o700});await fs.mkdir(path.join(snapshot,'mcp-bridge'),{mode:0o700});
  for(const file of files)await writeSynced(path.join(snapshot,file.name),file.bytes,file.name==='node'?0o500:0o400);
  await syncDirectory(snapshot);await syncDirectory(directory);await syncDirectory(base);
  const entry=entryFor(directory,spec),proposal=path.join(directory,'proposal.json');
  await writeSyncedJson(proposal,{version:1,id,installationId:active.installationId,spec,config,entryName,entry,files:files.map(({name,bytes})=>({name,sha256:hash(bytes)})),original:original?.toString('base64')??null});
  guard.settled();return{status:'proposed',proposal,entryName,config,store:spec.store,generation:spec.generation,endpoint:spec.endpoint,snapshot,next:'Close Desktop and config editors. Review this proposal, then explicitly apply with --desktop-closed. No config has changed.'};
 });
}
export async function applyInstalledDesktop(input,options={}){
 if(input.desktopClosed!==true)throw safeError('Close Desktop and config editors, then explicitly pass --desktop-closed.');
 const spec={root:input.root,store:input.store,generation:input.generation,endpoint:input.endpoint},proposal=input.proposal;
 if(typeof proposal!=='string'||path.basename(proposal)!=='proposal.json'||path.dirname(path.dirname(proposal))!==path.join(spec.root,'demo/desktop')||!/^[a-f0-9]{32}$/.test(path.basename(path.dirname(proposal))))throw safeError('Proposal must be inside this demo installation.');
 await trustedDirectory(path.dirname(proposal));
 return withClientGuard(spec.root,'desktop',async guard=>{
  const p=await privateJson(proposal),directory=path.dirname(proposal);
  if(Object.keys(p).sort().join()!=='config,entry,entryName,files,id,installationId,original,spec,version'||p.version!==1||p.id!==path.basename(directory)||!isDeepStrictEqual(p.spec,spec)||await exists(path.join(directory,'applied.json')))throw safeError('Invalid or already applied proposal.');
  const active=await context(spec,p.config,options);await generation(spec,active.installationId);
  if(p.installationId!==active.installationId||p.entryName!==`context-router-demo-${active.installationId}`)throw safeError('Proposal identity mismatch.');
  // Validation derives executable and source from the currently sealed bundle.
  // The proposal cannot nominate any process for execution during validation.
  const files=await sources(),expected=files.map(({name,bytes})=>({name,sha256:hash(bytes)}));
  if(!isDeepStrictEqual(p.files,expected)||!isDeepStrictEqual(p.entry,entryFor(directory,spec)))throw safeError('Proposal source or executable mismatch.');
  for(const file of expected)if(hash(await trustedBytes(path.join(directory,'snapshot',file.name)))!==file.sha256)throw safeError('Snapshot changed.');
  if(p.original!==null&&(typeof p.original!=='string'||Buffer.from(p.original,'base64').toString('base64')!==p.original))throw safeError('Invalid original config receipt.');
  const original=await configBytes(p.config),prior=p.original===null?null:Buffer.from(p.original,'base64');if(!same(original,prior))throw safeError('Desktop config changed; prepare a new proposal.');
  const value=parsed(original);await collision(spec.root,active.installationId,value,p.entryName);
  const replacement=Buffer.from(JSON.stringify({...value,mcpServers:{...value.mcpServers,[p.entryName]:p.entry}},null,2)+'\n');
  const backup=original===null?null:path.join(directory,'backup.json'),temporary=path.join(path.dirname(p.config),`.context-router-demo-${p.id}.json`);
  await context(spec,p.config,options);guard.mutating();
  if(backup)await writeSynced(backup,original);
  await writeSynced(temporary,replacement);await options.checkpoint?.('before-rename');
  await context(spec,p.config,options);if(!same(await configBytes(p.config),prior))throw safeError('Config changed immediately before replacement.');
  await fs.rename(temporary,p.config);await syncDirectory(path.dirname(p.config));await options.checkpoint?.('after-rename');
  if(!same(await configBytes(p.config),replacement))throw safeError('Desktop config readback mismatch; inspect retained evidence, do not replay.');
  const installed={installationId:active.installationId,entryName:p.entryName,entry:p.entry,proposalSha256:hash(await privateBytes(proposal))};
  await writeSyncedJson(path.join(directory,'applied.json'),installed);
  const stage=path.join(spec.root,'demo/desktop',`installed-${p.id}.json`);await writeSyncedJson(stage,installed);await fs.rename(stage,path.join(spec.root,'demo/desktop/installed.json'));await syncDirectory(path.dirname(stage));
  guard.settled();return{status:'applied',config:p.config,backup,entryName:p.entryName,store:spec.store,generation:spec.generation,next:'Restart Desktop normally. Human provider acceptance remains pending.'};
 });
}
