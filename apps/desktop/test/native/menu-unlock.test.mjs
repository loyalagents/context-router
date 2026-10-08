import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
test('menu preserves readiness for expired tokens and never reads or displays queued tokens while stopping',()=>{
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'desktop-menu-unlock-'))),driver=path.join(root,'driver'),native=path.resolve(import.meta.dirname,'../../native');
  try{
    mkdirSync(path.join(root,'exports','a'.repeat(32)),{recursive:true,mode:0o700});
    const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','AppKit','-I',native,path.resolve(import.meta.dirname,'../fixtures/menu-unlock.m'),...['process','package','envelope','maintenance','model-cleanup'].map(name=>path.join(native,`${name}.m`)),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[root],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'missing-token-ready-and-shutdown-safe');
  }finally{rmSync(root,{recursive:true,force:true});}
});
