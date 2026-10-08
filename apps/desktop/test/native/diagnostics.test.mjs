import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,readFileSync,readdirSync,statSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
test('private fixed diagnostics rotate within two bounded files and reject raw categories',()=>{
  const top=realpathSync(mkdtempSync(path.join(os.tmpdir(),'desktop-diagnostics-'))),root=path.join(top,'managed-v1'),driver=path.join(top,'driver'),native=path.resolve(import.meta.dirname,'../../native');
  try{const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,path.resolve(import.meta.dirname,'../fixtures/diagnostics.m'),...['diagnostics','envelope','package'].map(name=>path.join(native,`${name}.m`)),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
    const result=spawnSync(driver,[root],{env:{},encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);const dir=path.join(root,'diagnostics');assert.deepEqual(readdirSync(dir).sort(),['events.json','previous.json']);
    for(const file of readdirSync(dir)){const full=path.join(dir,file),info=statSync(full),value=JSON.parse(readFileSync(full));assert.ok(info.size<=65536);assert.equal(info.mode&0o777,0o600);assert.ok(value.events.length<=256);assert.ok(value.events.every(event=>event.category==='starting'));assert.equal(readFileSync(full,'utf8').includes('secret'),false);}
    assert.equal(JSON.parse(readFileSync(path.join(root,'owner.json'))).lifecycle,'quiescent');
  }finally{rmSync(top,{recursive:true,force:true});}
});
