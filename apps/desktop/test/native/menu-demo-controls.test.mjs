import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,realpathSync,mkdirSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
test('native setup buttons bind executable choice, exact Desktop confirmation, stale results and finite-operation transition/Quit ordering',()=>{
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'cr-native-controls-'))),native=path.resolve(import.meta.dirname,'../../native'),driver=path.join(root,'driver');mkdirSync(path.join(root,'demo'),{mode:0o700});
 try{
  const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','Security','-framework','AppKit','-I',native,path.resolve(import.meta.dirname,'../fixtures/menu-demo-controls.m'),...['process','package','envelope','maintenance','model-cleanup','demo-operation'].map(n=>path.join(native,n+'.m')),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
  const run=spawnSync(driver,[root],{encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{picker:true,savedRevalidation:true,staleRefusal:true,exactApply:true,transitionInterlock:true,doneLifetime:true,latestTerminalFeedback:true,quitOrder:true,uncertainQuit:true});
 }finally{rmSync(root,{recursive:true,force:true});}
});
