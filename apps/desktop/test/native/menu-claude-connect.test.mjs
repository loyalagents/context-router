import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,realpathSync,mkdirSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
for(const client of ['claude','codex'])test(`dashboard ${client} action remembers native project choice, binds Terminal request, handles cancellation and stale picker`,()=>{
 const top=realpathSync(mkdtempSync(path.join(os.tmpdir(),'cr-claude-menu-'))),root=path.join(top,'envelope'),project=path.join(top,"project with 'quotes'"),native=path.resolve(import.meta.dirname,'../../native'),driver=path.join(top,'driver');mkdirSync(root,{mode:0o700});mkdirSync(project,{mode:0o700});mkdirSync(path.join(root,'demo'),{mode:0o700});
 try{
 const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-framework','Security','-framework','AppKit','-I',native,path.resolve(import.meta.dirname,'../fixtures/menu-claude-connect.m'),...['process','package','envelope','maintenance','model-cleanup','demo-operation'].map(n=>path.join(native,n+'.m')),'-o',driver],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
 const run=spawnSync(driver,[root,project,client],{encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).projectRemembered,true);
 }finally{rmSync(top,{recursive:true,force:true});}
});
