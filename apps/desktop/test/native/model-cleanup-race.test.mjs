import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';
for(const variant of ['normal','file','directory','interrupt'])test(`native-only cleanup preserves safety across ${variant} preflight/apply boundary`,async t=>{
  const top=await mkdtemp('/private/tmp/desktop-cleanup-race-');t.after(()=>rm(top,{recursive:true,force:true}));const exe=path.join(top,'driver'),root=path.join(top,'managed-v1'),native=path.resolve(import.meta.dirname,'../../native');
  const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,path.resolve(import.meta.dirname,'../fixtures/model-cleanup-race.m'),...['envelope','package','model-cleanup'].map(n=>path.join(native,n+'.m')),'-o',exe],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
  const result=spawnSync(exe,[root,variant],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,variant==='interrupt'?7:0,result.stderr);
  const journal=JSON.parse(await readFile(path.join(root,'owner.json')));assert.equal(journal.operation,'cleanup-downloads');assert.equal(journal.lifecycle,variant==='normal'?'quiescent':'active');
  const stage='.download-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.part';
  if(variant==='file'){assert.equal(await readFile(path.join(root,'retained-stage'),'utf8'),'retain');assert.equal(await readFile(path.join(root,'models',stage),'utf8'),'replacement');}
  if(variant==='directory'){const {readdir}=await import('node:fs/promises');assert.equal(await readFile(path.join(root,'retained-models',stage),'utf8'),'retain');assert.deepEqual(await readdir(path.join(root,'models')),[]);}
  if(variant==='interrupt'){assert.equal(await readFile(path.join(root,'models',stage),'utf8'),'retain');assert.equal(spawnSync(exe,[root,'admit'],{env:{},timeout:5000}).status,1);}
});
