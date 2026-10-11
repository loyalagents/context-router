import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
test('menu preserves sleep notifications across queued starting frames and coalesces cancellation',()=>{
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'desktop-menu-state-'))),driver=path.join(root,'driver'),native=path.resolve(import.meta.dirname,'../../native');
  try{
    for(const generation of ['a'.repeat(32),'b'.repeat(32)]){const dir=path.join(root,'exports',generation);mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(path.join(dir,'unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token'),'fixture',{mode:0o600});}
    const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','AppKit','-I',native,path.resolve(import.meta.dirname,'../fixtures/menu-state.m'),...['process','package','envelope','maintenance','model-cleanup'].map(name=>path.join(native,`${name}.m`)),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[root],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{initialSleep:true,restartSleep:true,cancelOnce:true});
  }finally{rmSync(root,{recursive:true,force:true});}
});
