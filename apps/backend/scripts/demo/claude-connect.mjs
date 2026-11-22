import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {codexCodingLaunchSpec,codexLoginSpec} from './codex-connect.mjs';
import { safeError, privateJson } from './files.mjs';
import { trustedDirectory, trustedBytes, ensurePrivateDirectory, writeSyncedJson } from './trusted-files.mjs';

export const connectStates = ['checking', 'signing-in', 'starting', 'login-failed', 'failed', 'exited', 'interrupted'];
export function codingLaunchSpec(launch, project) {
  const args = launch.command==='codex'?[...codexCodingLaunchSpec(launch,project).args]:[...launch.args];
  if(launch.command==='claude'){
    // --restricted requires explicit tool names; its default alias omits Bash/WebFetch.
    args[args.indexOf('--tools') + 1] = 'Bash,Edit,Glob,Grep,NotebookEdit,Read,Task,WebFetch,WebSearch,Write,AskUserQuestion,EnterPlanMode,ExitPlanMode';
    args.push('--permission-mode','default');
  }
  return {...launch, args, cwd:project, env:{...launch.env,PATH:[launch.env.PATH,path.join(os.userInfo().homedir,'.nvm/versions/node/v24.21.0/bin'),path.join(os.userInfo().homedir,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin'].join(path.delimiter)}};
}
/** Retained for coding jobs that may outlive their foreground chat. */
export async function codingTemporaryDirectory() {
  const base=process.platform==='darwin'?'/private/tmp':await fs.realpath(os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'cr-code-'));
  await trustedDirectory(directory);
  return directory;
}
export async function validateDemoProject(project, root) {
  await trustedDirectory(project, false);
  if (project === '/' || project === root || project.startsWith(root + path.sep) || root.startsWith(project + path.sep))
    throw safeError('Choose a separate demo project folder outside Context Router data.');
}
export function claudeAuthStatus(launch, guard) {
  guard.mutating();
  const result=spawnSync(launch.executable,[...launch.args,'auth','status','--json'],{
    cwd:launch.cwd,env:launch.env,input:'',encoding:'utf8',timeout:15000,maxBuffer:65536,
  });
  if(result.error||result.signal!==null)throw safeError('Claude sign-in check was interrupted. Invocation evidence is retained.');
  guard.settled();
  let value;try{value=JSON.parse(result.stdout);}catch{}
  if(![0,1].includes(result.status)||typeof value?.loggedIn!=='boolean'||value.configDirectory!==launch.env.CLAUDE_CONFIG_DIR||value.apiProvider!=='firstParty'||value.analyticsDisabled!==true)
    throw safeError('Could not verify the separate demo sign-in. No conversation was started.');
  return value.loggedIn;
}
/** Serialized setup; a legacy invocation may reuse a verified login but never repeat it. */
export async function authenticateClient(launch,{check,authStatus,run,state,allowLogin=true}) {
  await check();
  if(!await authStatus(launch)) {
    if(!allowLogin)throw safeError('An earlier demo invocation is retained. Finish that invocation before signing in again.');
    await state('signing-in');
    process.stdout.write(`Sign in to the separate ${launch.command==='codex'?'Codex':'Claude'} demo profile. Your project will open automatically afterward.\n`);
    await check();
    const code=await run(launch.command==='codex'?codexLoginSpec(launch):{...launch,args:[...launch.args,'auth','login']});
    if(code!==0){await state('login-failed');return code;}
    await check();
    if(!await authStatus(launch)){await state('login-failed');return 1;}
  }
  return 0;
}
/** Each fresh foreground chat has its own invocation guard. */
export async function startClient(launch,{check,run,state,credential}) {
  await check();
  const session={...launch,env:{...launch.env,CR_DEMO_TOKEN:credential()}};
  await state('starting');
  process.stdout.write(`Opening ${launch.command==='codex'?'Codex':'Claude Code'} with Context Router configured. You can open another chat from Connections without closing this one.\n`);
  try{
    const code=await run(session);
    await state(code===0?'exited':'interrupted');
    return code;
  }catch(error){await state('interrupted');throw error;}
}

function progressDirectory(spec, request) {
  if(spec.role!==undefined&&!['a','b'].includes(spec.role))throw safeError('Invalid demo connection role.');
  if(!/^[a-f0-9]{32}$/.test(request))throw safeError('Invalid demo launch request.');
  return path.join(spec.root,'demo','connect-requests',request);
}
function binding(spec,request) {return {version:1,installationId:spec.installationId,store:spec.store,generation:spec.generation,request,role:spec.role??'b'};}
export async function beginConnectProgress(spec,request) {
  await trustedDirectory(path.join(spec.root,'demo'));
  const directory=progressDirectory(spec,request);
  await ensurePrivateDirectory(path.dirname(directory));
  // Exclusive request claim: retained Terminal commands cannot replay a launch.
  try{await fs.mkdir(directory,{mode:0o700});}catch{throw safeError('This launch request was already used. Open a new chat from Connections for a fresh request.');}
  const state=async value=>{
    if(!connectStates.includes(value))throw safeError('Invalid demo launch state.');
    await writeSyncedJson(path.join(directory,value+'.json'),{...binding(spec,request),state:value});
  };
  await state('checking');return state;
}
export async function readConnectProgress(spec,request) {
  const directory=progressDirectory(spec,request);
  // Each phase is an immutable private file; incomplete writes are ignored until
  // the next poll. No progress state grants launch, cleanup or retry authority.
  for(const state of [...connectStates].reverse()) {
    try{
      const file=path.join(directory,state+'.json');
      const value=JSON.parse((await trustedBytes(file,2048)).toString('utf8'));
      if(JSON.stringify(value)!==JSON.stringify({...binding(spec,request),state}))continue;
      await privateJson(file);return state;
    }catch{}
  }
  return null;
}
