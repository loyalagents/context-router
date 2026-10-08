import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
test('lost exact wait ownership permanently disables later signaling',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'desktop-wait-loss-')),driver=path.join(root,'driver'),native=path.resolve(import.meta.dirname,'../../native');
  try{const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,path.resolve(import.meta.dirname,'../fixtures/wait-loss.m'),path.join(native,'process.m'),path.join(native,'package.m'),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[path.join(root,'owner.lock')],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{ownershipLost:true,signalDenied:true});
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('native output backpressure preserves event-loop progress and enforces queue/deadline bounds',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'desktop-output-queue-')),driver=path.join(root,'driver'),native=path.resolve(import.meta.dirname,'../../native');
  try{const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,path.resolve(import.meta.dirname,'../fixtures/output-queue.m'),path.join(native,'process.m'),path.join(native,'package.m'),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{responsive:true,bounded:true});
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('downloader receives FD3 and control but FD4 is absent before a JS runtime can reuse it',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'desktop-download-fds-')),driver=path.join(root,'driver'),probe=path.join(root,'probe'),native=path.resolve(import.meta.dirname,'../../native');
  try{
    const c=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',path.resolve(import.meta.dirname,'../fixtures/download-fds.c'),'-o',probe],{encoding:'utf8',timeout:20000});assert.equal(c.status,0,c.stderr);
    const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,path.resolve(import.meta.dirname,'../fixtures/download-fds.m'),path.join(native,'process.m'),path.join(native,'package.m'),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[probe,path.join(root,'owner.lock')],{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{lifetime:true,storageAbsent:true,control:true});
  }finally{rmSync(root,{recursive:true,force:true});}
});
