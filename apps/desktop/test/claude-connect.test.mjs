import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateClient, startClient, codingLaunchSpec } from '../../backend/scripts/demo/claude-connect.mjs';
import { clientLaunchSpec } from '../../backend/scripts/demo/clients.mjs';

const connectClaude=async(launch,options)=>{const code=await authenticateClient(launch,options);return code===0?startClient(launch,options):code;};
const launch = clientLaunchSpec({command:'claude',auth:'subscription',agent:'b',root:'/demo',mcpPort:8790,dataset:'demo001'},{executable:'/native/claude'});
for (const signedIn of [true,false]) test(`connect checks isolated auth, ${signedIn?'reuses login':'signs in once'}, then opens coding session`,async()=>{
  const events=[];let authenticated=signedIn;
  const result=await connectClaude(launch,{check:async()=>events.push('check'),authStatus:async()=>authenticated,run:async spec=>{events.push(spec.args.includes('login')?'login':'coding');authenticated=true;return 0;},state:async value=>events.push(value),credential:()=> 'fixture-token'});
  assert.equal(result,0);assert.equal(events.filter(e=>e==='login').length,signedIn?0:1);assert.equal(events.at(-2),'coding');assert.equal(events.at(-1),'exited');assert.ok(events.lastIndexOf('check')>events.indexOf('login'));
});
test('cancelled login never starts a conversation or reads the MCP credential',async()=>{
  let reads=0;const states=[];
  assert.equal(await connectClaude(launch,{check:async()=>{},authStatus:async()=>false,run:async()=>1,state:async s=>states.push(s),credential:()=>reads++}),1);
  assert.equal(reads,0);assert.equal(states.at(-1),'login-failed');
});
test('generation change after sign-in prevents launch',async()=>{
  let signedIn=false,calls=0;
  await assert.rejects(connectClaude(launch,{check:async()=>{if(signedIn)throw Error('stale');},authStatus:async()=>signedIn,run:async()=>{calls++;signedIn=true;return 0;},state:async()=>{},credential:()=>{throw Error('must not read');}}),/stale/);
  assert.equal(calls,1);
});
test('coding explicitly exposes shell and web tools with ordinary permissions and isolated MCP',()=>{
  const coding=codingLaunchSpec(launch,'/chosen/project');
  assert.equal(coding.cwd,'/chosen/project');assert.deepEqual(coding.args[coding.args.indexOf('--tools')+1].split(','),['Bash','Edit','Glob','Grep','NotebookEdit','Read','Task','WebFetch','WebSearch','Write','AskUserQuestion','EnterPlanMode','ExitPlanMode']);assert.equal(coding.args[coding.args.indexOf('--permission-mode')+1],'default');assert.ok(coding.args.includes('--strict-mcp-config'));assert.ok(!coding.args.includes('--dangerously-skip-permissions'));assert.equal(coding.env.CLAUDE_CONFIG_DIR,launch.env.CLAUDE_CONFIG_DIR);assert.equal(launch.args[launch.args.indexOf('--tools')+1],'');
});

test('progress is private, request-bound, immutable and cannot replay a retained launch request',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {beginConnectProgress,readConnectProgress}=await import('../../backend/scripts/demo/claude-connect.mjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-connect-progress-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});
 const spec={root,installationId:'a'.repeat(32),store:'b'.repeat(32),generation:'c'.repeat(32)},id='d'.repeat(32);
 const state=await beginConnectProgress(spec,id);assert.equal(await readConnectProgress(spec,id),'checking');await state('signing-in');assert.equal(await readConnectProgress(spec,id),'signing-in');
 await assert.rejects(beginConnectProgress(spec,id),/already used/);assert.equal(await readConnectProgress({...spec,generation:'e'.repeat(32)},id),null);
 await fs.writeFile(path.join(root,'demo/connect-requests',id,'starting.json'),'{',{mode:0o600});assert.equal(await readConnectProgress(spec,id),'signing-in');
 await fs.symlink(path.join(root,'demo/connect-requests',id,'signing-in.json'),path.join(root,'demo/connect-requests',id,'exited.json'));assert.equal(await readConnectProgress(spec,id),'signing-in');
});

test('a retained legacy invocation can reuse login but cannot initiate sign-in',async()=>{
 let runs=0;
 await assert.rejects(authenticateClient(launch,{check:async()=>{},authStatus:async()=>false,run:async()=>runs++,state:async()=>{},allowLogin:false}),/earlier demo invocation/);
 assert.equal(runs,0);
 assert.equal(await authenticateClient(launch,{check:async()=>{},authStatus:async()=>true,run:async()=>runs++,state:async()=>{},allowLogin:false}),0);
 assert.equal(runs,0);
});

for(const command of ['claude','codex'])test(`${command} chat interruption is distinct from setup failure and never claims confirmed exit`,async()=>{
 const states=[];
 await assert.rejects(startClient({...launch,command},{check:async()=>{},run:async()=>{throw Error('lost child');},state:async s=>states.push(s),credential:()=> 'fixture-token'}),/lost child/);
 assert.deepEqual(states,['starting','interrupted']);
 const ended=[];assert.equal(await startClient({...launch,command},{check:async()=>{},run:async()=>129,state:async s=>ended.push(s),credential:()=> 'fixture-token'}),129);
 assert.deepEqual(ended,['starting','interrupted']);
});
test('confirmed exit progress outranks a late generic helper failure',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {beginConnectProgress,readConnectProgress}=await import('../../backend/scripts/demo/claude-connect.mjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-connect-exit-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});
 const spec={root,installationId:'a'.repeat(32),store:'b'.repeat(32),generation:'c'.repeat(32)},id='d'.repeat(32),state=await beginConnectProgress(spec,id);
 await state('starting');await state('exited');await state('failed');assert.equal(await readConnectProgress(spec,id),'exited');
});

test('coding temporary directories are private, unique and short enough for Unix sockets',async t=>{
 const fs=await import('node:fs/promises'),net=await import('node:net'),path=await import('node:path');
 const {codingTemporaryDirectory}=await import('../../backend/scripts/demo/claude-connect.mjs');
 const directories=[await codingTemporaryDirectory(),await codingTemporaryDirectory()];t.after(()=>Promise.all(directories.map(dir=>fs.rm(dir,{recursive:true,force:true}))));assert.notEqual(...directories);
 for(const directory of directories){assert.equal((await fs.stat(directory)).mode&0o777,0o700);assert.equal(await fs.realpath(directory),directory);const socket=path.join(directory,'tsx-501','12345678901234567890.pipe');await fs.mkdir(path.dirname(socket));assert.ok(Buffer.byteLength(socket)<104);const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await new Promise(resolve=>server.close(resolve));}
});
