import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { privateJson, privatePath, safeError } from './files.mjs';
import { trustedDirectory, trustedBytes, ensurePrivateDirectory, writeSyncedJson, syncDirectory, exists } from './trusted-files.mjs';
import { activeDemo } from './active.mjs';
import { clientLaunchSpec, loginSpec, preflightClient } from './clients.mjs';
import { readCredential } from '../mcp-bridge/credential.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function withClientGuard(root,role,action){
  if(!['a','b','desktop'].includes(role))throw safeError('Unknown demo role.');
  await trustedDirectory(root);await trustedDirectory(path.join(root,'demo'));
  const directory=path.join(root,'demo','client-guards');await ensurePrivateDirectory(directory);
  const file=path.join(directory,role+'.json'),record={version:1,invocation:randomBytes(16).toString('hex'),role,pid:process.pid};
  try{await writeSyncedJson(file,record);}catch(e){if(e.code==='EEXIST')throw safeError('This demo profile has an active or uncertain invocation. Retained guard requires inspection; no automatic reclaim.');throw e;}
  let mutated=false,settled=false;
  try{return await action({mutating(){mutated=true;settled=false;},settled(){settled=true;}});}
  finally{if(!mutated||settled){if(!isDeepStrictEqual(await privateJson(file),record))throw safeError('Invocation guard changed; retained for inspection.');await fs.unlink(file);await syncDirectory(directory);}}
}
export async function profileFor(root,installationId,role,guard){
  if(!/^[a-f0-9]{32}$/.test(installationId)||!['a','b'].includes(role))throw safeError('Invalid profile identity.');
  const profiles=path.join(root,'demo','profiles');await ensurePrivateDirectory(profiles);
  const directory=path.join(profiles,role),marker=path.join(directory,'profile.json'),expected={version:1,installationId,role};
  if(await exists(directory)){
    await trustedDirectory(directory);
    if(!isDeepStrictEqual(await privateJson(marker),expected))throw safeError('Unrecognized demo profile; personal profiles are never adopted.');
  }else{
    guard.mutating();await fs.mkdir(directory,{mode:0o700});await syncDirectory(profiles);
    for(const prefix of ['codex-a','codex','claude-a','claude'])for(const suffix of ['home','config','workspace'])await fs.mkdir(path.join(directory,`${prefix}-${suffix}`),{mode:0o700});
    await writeSyncedJson(marker,expected);guard.settled();
  }
  return directory;
}
const executableBytes=(file,command)=>trustedBytes(file,512*1024*1024,{command,executable:file});
export async function qualifiedExecutable(command,searchPath=process.env.PATH??'',explicit){
  if(!['codex','claude'].includes(command))throw safeError('Unknown client.');
  if(explicit&&(!path.isAbsolute(explicit)||path.resolve(explicit)!==explicit))throw safeError('Explicit client path must be absolute.');
  for(const candidate of explicit?[explicit]:searchPath.split(path.delimiter).filter(directory=>directory&&path.isAbsolute(directory)).map(directory=>path.join(directory,command))){
    if(!await exists(candidate))continue;
    const canonical=await fs.realpath(candidate),bytes=await executableBytes(canonical,command),s=await fs.stat(canonical);
    // Supported foreground lifetime is the pinned native CLI, never an arbitrary
    // executable shim. In particular, an npm wrapper's exit is not child settlement.
    if(!(s.mode&0o111)||bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)throw safeError('Use the qualified native arm64 CLI entry; script shims are not a supported lifetime boundary.');
    return {path:canonical,sha256:digest(bytes)};
  }
  throw safeError(`Install the qualified native ${command} CLI and place it on PATH.`);
}
export async function launchInstalledClient(spec,{role,command='codex',login=false,executable:explicit,auth=command==='claude'?'subscription':undefined}){
  if(!['a','b'].includes(role))throw safeError('Choose Agent A or B.');
  return withClientGuard(spec.root,role,async guard=>{
    const receipt=await activeDemo(spec),executable=await qualifiedExecutable(command,process.env.PATH,explicit);
    // Version/help/config probes use an empty disposable identity, never the
    // persisted demo login or MCP export, and cannot start a model session.
    const probe=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-installed-preflight-')));
    try{
      const probeSpec=clientLaunchSpec({command,root:probe,profileRoot:probe,mcpPort:Number(new URL(spec.endpoint).port),dataset:'demo001',agent:role,auth},{executable:executable.path});
      for(const value of new Set([probeSpec.cwd,probeSpec.env.TMPDIR,probeSpec.env.CODEX_HOME,probeSpec.env.CLAUDE_CONFIG_DIR].filter(Boolean)))await fs.mkdir(value,{mode:0o700});
      preflightClient(probeSpec);
    }finally{await fs.rm(probe,{recursive:true,force:true});}
    if(digest(await executableBytes(executable.path,command))!==executable.sha256)throw safeError('Client executable changed during preflight.');
    await activeDemo(spec);
    const profile=await profileFor(spec.root,receipt.installationId,role,guard);
    let launch=clientLaunchSpec({command,root:path.join(spec.root,'demo',spec.store),profileRoot:profile,mcpPort:Number(new URL(spec.endpoint).port),dataset:'demo001',agent:role,auth},{executable:executable.path});
    for(const value of new Set([launch.cwd,launch.env.TMPDIR,launch.env.CODEX_HOME,launch.env.CLAUDE_CONFIG_DIR].filter(Boolean)))await privatePath(value,true);
    if((await fs.readdir(launch.cwd)).length)throw safeError('Demo workspace must remain empty.');
    if(login){
      if(command==='codex')launch=loginSpec(launch);
      else launch={...launch,args:[...launch.args,'auth','login']};
    }else if(command==='codex')await privatePath(path.join(launch.env.CODEX_HOME,'auth.json'));
    else if(auth==='api-key'){if(!process.env.CR_DEMO_ANTHROPIC_API_KEY)throw safeError('Explicit api-key launch requires CR_DEMO_ANTHROPIC_API_KEY.');launch.env.ANTHROPIC_API_KEY=process.env.CR_DEMO_ANTHROPIC_API_KEY;}
    await activeDemo(spec);
    if(!login)launch.env.CR_DEMO_TOKEN=readCredential(launch.credentialFile);
    // Last check closes reset-during-preflight before external session start.
    await activeDemo(spec);
    if(digest(await executableBytes(executable.path,command))!==executable.sha256)throw safeError('Client executable changed before launch.');
    process.stdout.write(login?'Starting explicit login in the isolated demo profile.\n':'Starting a fresh demo client. Its provider may receive retrieved demo context.\n');
    return runForeground(launch,guard);
  });
}

export async function runForeground(launch,guard){
  guard.mutating();
  return await new Promise((resolve,reject)=>{
      let child;
      try{child=spawn(launch.executable,launch.args,{cwd:launch.cwd,env:launch.env,stdio:['inherit','inherit','inherit']});}
      catch{reject(safeError('Client launch outcome uncertain; guard retained.'));return;}
      const signals=['SIGINT','SIGTERM','SIGHUP'],handlers=signals.map(signal=>()=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);});
      signals.forEach((signal,i)=>process.on(signal,handlers[i]));
      child.once('error',()=>{if(child.pid===undefined)guard.settled();reject(safeError(child.pid===undefined?'Client did not start.':'Client launch outcome uncertain; guard retained.'));});
      child.once('close',(code,signal)=>{
        signals.forEach((name,i)=>process.off(name,handlers[i]));
        // Qualified foreground CLI normal exit settles its supported cohort.
        // Lost wait, abrupt helper loss, or signal termination retains evidence.
        if(signal||!Number.isInteger(code)){reject(safeError('Client lifetime uncertain; guard retained.'));return;}
        guard.settled();resolve(code);
      });
    });
}
