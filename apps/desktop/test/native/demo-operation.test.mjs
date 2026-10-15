import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
test('finite setup helpers close descriptors and settle normal, silent/pipe descendants, overflow and cancellation before reaping',()=>{
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'cr-demo-operation-'))),native=path.resolve(import.meta.dirname,'../../native'),driver=path.join(root,'driver'),child=path.join(root,'child');
 try{
  let built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',path.resolve(import.meta.dirname,'../fixtures/demo-operation-child.c'),'-o',child],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','Security','-I',native,path.resolve(import.meta.dirname,'../fixtures/demo-operation.m'),...['package','envelope'].map(n=>path.join(native,n+'.m')),'-o',driver],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  for(const kind of ['normal','exit-race','silent','pipe','overflow','graceful','stubborn','inventory-empty','inventory-invalid','lost-wait']){
   const run=spawnSync(driver,[child,kind],{env:{CR_DEMO_TOKEN:'must-not-leak',LOCAL_DATABASE_ROOT:'/must-not-leak'},encoding:'utf8',timeout:10000});assert.equal(run.status,0,kind+': '+run.stderr);
   const value=JSON.parse(run.stdout);if(kind.startsWith('inventory-')||kind==='lost-wait'){assert.deepEqual(value,{ownershipLost:true,finished:false});continue;}assert.equal(value.finished,true);assert.equal(value.reaped,true);assert.equal(value.success,['normal','exit-race'].includes(kind));assert.equal(value.cancelled,!['normal','exit-race'].includes(kind));assert.ok(value.outputBytes<=65536);
   if(['silent','pipe'].includes(kind)){const pid=JSON.parse(value.output).descendant;assert.throws(()=>process.kill(pid,0));}
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
