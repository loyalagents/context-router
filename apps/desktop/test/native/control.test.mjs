import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
const root=mkdtempSync(path.join(os.tmpdir(),'desktop-control-')),driver=path.join(root,'driver');
const fixture=path.resolve(import.meta.dirname,'../fixtures');
const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',path.join(fixture,'control-pipes.c'),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
let uncertain=false;
after(()=>{if(uncertain)throw new Error(`Fixture ownership uncertain; preserve ${root}`);rmSync(root,{recursive:true,force:true});});
for(const scenario of ['backpressure','timeout','malformed','start-quit'])test(`anonymous control ${scenario} revokes and exits with guardian writer retained`,()=>{
  const result=spawnSync(driver,[process.execPath,path.join(fixture,'control-pipes-child.mjs'),scenario],{env:{},encoding:'utf8',timeout:10000});
  if(result.error||result.status===93)uncertain=true;
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{stopped:true,responsive:true});
});
