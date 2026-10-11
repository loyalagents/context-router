import assert from 'node:assert/strict';import test from 'node:test';
import {spawnSync} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';
for(const variant of ['transient','persistent','inode','journal'])test(`final lock proof handles ${variant} independent contender`,async t=>{
  const top=await mkdtemp('/private/tmp/desktop-lock-contender-');t.after(()=>rm(top,{recursive:true,force:true}));
  const native=path.resolve(import.meta.dirname,'../../native'),object=path.join(top,'envelope.o'),exe=path.join(top,'driver'),root=path.join(top,'managed-v1');
  for(const args of [ ['-c','-Dflock=CRTestFlock',path.join(native,'envelope.m'),'-o',object], ['-framework','Foundation',object,path.resolve(import.meta.dirname,'../fixtures/lock-contender.m'),path.join(native,'package.m'),'-o',exe] ]){
    const r=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-I',native,...args],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);
  }
  const r=spawnSync(exe,[root,variant],{env:{},encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
  assert.equal(result.completed,variant==='transient');const journal=JSON.parse(await readFile(path.join(root,'owner.json')));assert.equal(journal.lifecycle,variant==='transient'?'quiescent':'active');
  if(variant==='transient')assert.ok(result.elapsed>=0.08&&result.elapsed<1);if(variant==='persistent')assert.ok(result.elapsed>=0.24&&result.elapsed<1);
});
