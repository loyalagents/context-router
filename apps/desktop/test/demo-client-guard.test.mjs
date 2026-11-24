import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withClientGuard, profileFor } from '../../backend/scripts/demo/installed-clients.mjs';
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-profile-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});return root;}
test('per-role guard refuses overlapping use and permits a different role',async t=>{
 const root=await fixture(t);await withClientGuard(root,'a',async guard=>{
   await assert.rejects(withClientGuard(root,'a',()=>{}));
   await withClientGuard(root,'b',async b=>b.settled());guard.settled();
 });await withClientGuard(root,'a',async guard=>guard.settled());
});
test('guard releases proven pre-mutation failure and retains uncertain profile mutation',async t=>{
 const root=await fixture(t);await assert.rejects(withClientGuard(root,'a',async()=>{throw new Error('no child');}));
 await withClientGuard(root,'a',async guard=>guard.settled());
 await assert.rejects(withClientGuard(root,'a',async guard=>{guard.mutating();throw new Error('unknown');}));
 await assert.rejects(withClientGuard(root,'a',()=>{}));
});
test('stable profile persists across generations and refuses foreign unmarked directories',async t=>{
 const root=await fixture(t),id='a'.repeat(32);
 let first;await withClientGuard(root,'a',async guard=>{first=await profileFor(root,id,'a',guard);guard.settled();});
 await fs.writeFile(path.join(first,'synthetic-login'),'retained');
 await withClientGuard(root,'a',async guard=>{assert.equal(await profileFor(root,id,'a',guard),first);guard.settled();});
 assert.equal(await fs.readFile(path.join(first,'synthetic-login'),'utf8'),'retained');
 await fs.mkdir(path.join(root,'demo','profiles','b'),{mode:0o700});
 await assert.rejects(withClientGuard(root,'b',guard=>profileFor(root,id,'b',guard)));
});
test('qualified Claude specs disable background tasks and agent-view sessions for both auth modes',async()=>{
 const {clientLaunchSpec}=await import('../../backend/scripts/demo/clients.mjs');
 for(const auth of ['api-key','subscription']){
   const spec=clientLaunchSpec({command:'claude',root:'/owned/demo',dataset:'demo001',auth},{executable:'/owned/native/claude'});
   assert.equal(spec.env.CLAUDE_CODE_DISABLE_AGENT_VIEW,'1');assert.equal(spec.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,'1');
 }
});
test('Homebrew executable exception is confined to exact pinned native Codex and privileged admin Caskroom',async()=>{
 const {administratorCaskroom}=await import('../../backend/scripts/demo/trusted-files.mjs');
 const stat={uid:process.getuid(),gid:80,mode:0o40775},context={command:'codex',executable:'/opt/homebrew/Caskroom/codex/0.160.0/bin/codex',platform:'darwin'};
 assert.equal(administratorCaskroom('/opt/homebrew/Caskroom',stat,context),true);
 for(const change of [{command:'claude'},{platform:'linux'},{executable:'/opt/homebrew/Caskroom/codex/0.160.1/bin/codex'}])assert.equal(administratorCaskroom('/opt/homebrew/Caskroom',stat,{...context,...change}),false);
 for(const change of [{gid:20},{mode:0o40777},{uid:process.getuid()+1}])assert.equal(administratorCaskroom('/opt/homebrew/Caskroom',{...stat,...change},context),false);
 assert.equal(administratorCaskroom('/opt/homebrew/Caskroom/other',stat,context),false);assert.equal(administratorCaskroom('/opt/homebrew/Caskroom',stat),false);
});

test('Claude setup serializes auth while distinct session guards overlap and retain only their own uncertainty',async t=>{
 const root=await fixture(t),session='b-session-'+ 'a'.repeat(32);
 await withClientGuard(root,'b',async()=>{
  await withClientGuard(root,'b-setup',async()=>{
   await assert.rejects(withClientGuard(root,'b-setup',()=>{}));
  });
  await assert.rejects(withClientGuard(root,session,async guard=>{
   await withClientGuard(root,'b-setup',()=>{});
   await withClientGuard(root,'b-session-'+ 'b'.repeat(32),()=>{});
   await assert.rejects(withClientGuard(root,session,()=>{}));
   guard.mutating();throw Error('uncertain session');
  }),/uncertain session/);
  await assert.rejects(withClientGuard(root,session,()=>{}));
  await withClientGuard(root,'b-setup',()=>{});
 });
 await assert.rejects(withClientGuard(root,'b-setup',async guard=>{guard.mutating();throw Error('uncertain setup');}),/uncertain setup/);
 await assert.rejects(withClientGuard(root,'b-setup',()=>{}),/active or uncertain/);
 await assert.rejects(withClientGuard(root,'b-session-../../escape',()=>{}));
});

test('cancellation during setup guard release prevents the following foreground chat',async t=>{
 const root=await fixture(t),unlink=fs.unlink;let started=false;
 fs.unlink=async file=>{await unlink(file);if(file===path.join(root,'demo/client-guards/b-setup.json'))process.emit('SIGINT');};
 try{
  await assert.rejects((async()=>{
   await withClientGuard(root,'b-setup',guard=>guard.settled());
   await withClientGuard(root,'b-session-'+ 'c'.repeat(32),()=>{started=true;});
  })(),/cancelled/);
  assert.equal(started,false);
 }finally{fs.unlink=unlink;}
});

test('uncertain Codex setup remains blocked while Claude setup stays independent',async t=>{
 const root=await fixture(t);
 await assert.rejects(withClientGuard(root,'a-setup',async guard=>{guard.mutating();throw Error('uncertain Codex login');}),/uncertain Codex login/);
 await assert.rejects(withClientGuard(root,'a-setup',()=>{}),/active or uncertain invocation/);
 await withClientGuard(root,'b-setup',()=>{});
});
