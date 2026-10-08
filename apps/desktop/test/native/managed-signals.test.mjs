import assert from 'node:assert/strict';import test from 'node:test';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';
import {copyFile,writeFile,mkdir,readFile,stat,rm,rename,lstat} from 'node:fs/promises';import path from 'node:path';
import {editedFixture,replace,journal} from '../fixtures/revision-fixture.mjs';import {ended} from '../fixtures/supervisor-fixture.mjs';
const production=path.resolve(import.meta.dirname,'../../runtime');
async function moduleFile(modules,name,source){const file=path.join(modules,name+'.js');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,source);}
async function readyAndQuit(f){const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);await journal(f);}
async function waiting(file){const deadline=Date.now()+5000;while(!await stat(file).catch(()=>false)){assert.ok(Date.now()<deadline,'owned child readiness deadline');await new Promise(r=>setTimeout(r,10));}return Number(await readFile(file,'utf8'));}
for(const entry of ['maintenance','prepare-store'])for(const signal of ['SIGINT','SIGTERM','SIGHUP'])for(const paired of [false,true])test(`actual managed ${entry} ${signal}, CLI signalled=${paired}, acknowledges only after drain`,async t=>{
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    for(const name of ['managed',entry])await copyFile(path.join(production,name+'.mjs'),path.join(runtime,name+'.mjs'));
    const modules=path.resolve(runtime,'../../app/node_modules/backend/dist'),marker=path.join(f.top,'waiting'),drained=path.join(f.top,'drained');
    await moduleFile(modules,'infrastructure/managed/managed-admission',`const fs=require('node:fs');exports.admitManagedProcess=async()=>{const c=JSON.parse(fs.readFileSync(4));fs.closeSync(4);return c;};exports.revokeManagedAdmission=()=>{};`);
    await moduleFile(modules,'infrastructure/storage/sqlite/sqlite-database',`exports.waitForNativeOwners=async()=>{await new Promise(r=>setTimeout(r,50));require('node:fs').writeFileSync(${JSON.stringify(drained)},'drained');};`);
    const operation=`async()=>{await new Promise(resolve=>{process.once(${JSON.stringify(signal)},resolve);require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));});return ${entry==='maintenance'?'0':"{targetId:'A'.repeat(43)}"};}`;
    await moduleFile(modules,entry==='maintenance'?'local-mcp':'infrastructure/managed/managed-prepare',`exports.${entry==='maintenance'?'runLocalMcp':'prepareManagedStore'}=${operation};`);
    await replace(path.join(runtime,'control.mjs'),'async send(type, payload = {}) {',`async send(type, payload = {}) {if(['maintenance-complete','store-prepared','store-prepare-failed'].includes(type)&&!await import('node:fs').then(fs=>fs.existsSync(${JSON.stringify(drained)})))throw new Error('completion before drain');`);
  });
  await readyAndQuit(f);
  const cli=spawn(f.executable,['--root',f.envelope,...(entry==='maintenance'?['mcp','list']:['resume-setup'])],{env:{},stdio:['ignore','pipe','pipe']});cli.ended=once(cli,'close');cli.stderr.resume();cli.stdout.resume();
  const pid=await waiting(path.join(f.top,'waiting'));assert.ok(Number.isInteger(pid)&&pid>1);assert.equal(cli.exitCode,null);process.kill(pid,signal);if(paired)cli.kill(signal);
  assert.deepEqual(await ended(cli),[1,null]);assert.equal((await journal(f)).outcome,'failed');assert.equal(await readFile(path.join(f.top,'drained'),'utf8'),'drained');await readyAndQuit(f);
});
test('actual managed direct signal after real SQLite rotation publication preserves named recovery',async t=>{
  const dist=path.resolve(import.meta.dirname,'../../../backend/dist');
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    for(const name of ['managed','maintenance'])await copyFile(path.join(production,name+'.mjs'),path.join(runtime,name+'.mjs'));
    const modules=path.resolve(runtime,'../../app/node_modules/backend/dist');
    for(const name of ['infrastructure/managed/managed-admission','infrastructure/storage/sqlite/sqlite-database'])await moduleFile(modules,name,`module.exports=require(${JSON.stringify(path.join(dist,name+'.js'))});`);
    await moduleFile(modules,'modules/auth/local-identity-admin.cli',`const Store=require(${JSON.stringify(path.join(dist,'modules/auth/local-identity-filesystem.js'))}).LocalIdentityFileStore,publish=Store.prototype.publishOperation;
Store.prototype.publishOperation=async function(...args){await publish.apply(this,args);if(process.argv[3]==='rotate'){await new Promise(resolve=>{process.once('SIGTERM',resolve);require('node:fs').writeFileSync(${JSON.stringify(path.join(f.top,'waiting'))},String(process.pid));});}};
module.exports=require(${JSON.stringify(path.join(dist,'modules/auth/local-identity-admin.cli.js'))});`);
  });
  await readyAndQuit(f);
  const installation=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),pair=path.join(f.envelope,'stores',installation.selectedStore),data=path.join(f.top,'seed-data'),identity=path.join(f.top,'seed-identity');
  const initialized=spawnSync(process.execPath,[path.join(dist,'local-identity.js'),'initialize'],{env:{LOCAL_DATABASE_ROOT:data,LOCAL_IDENTITY_STATE_ROOT:identity},encoding:'utf8',timeout:15000});assert.equal(initialized.status,0,initialized.stderr);
  for(const name of ['data','identity'])await rm(path.join(pair,name),{recursive:true});await rename(data,path.join(pair,'data'));await rename(identity,path.join(pair,'identity'));
  const before=await readFile(path.join(pair,'identity/identity.json'));
  const cli=spawn(f.executable,['--root',f.envelope,'identity','rotate'],{env:{},stdio:['ignore','pipe','pipe']});cli.ended=once(cli,'close');cli.stderr.resume();cli.stdout.resume();process.kill(await waiting(path.join(f.top,'waiting')),'SIGTERM');
  assert.deepEqual(await ended(cli),[1,null]);assert.equal((await journal(f)).outcome,'failed');assert.ok(await lstat(path.join(pair,'identity/identity.operation.json')));assert.deepEqual(await readFile(path.join(pair,'identity/identity.json')),before);
  const recovered=spawnSync(f.executable,['--root',f.envelope,'identity','recover-rotation'],{env:{},encoding:'utf8',timeout:15000});assert.equal(recovered.status,0,recovered.stderr);assert.equal((await journal(f)).outcome,'ok');await assert.rejects(lstat(path.join(pair,'identity/identity.operation.json')),{code:'ENOENT'});assert.deepEqual(await readFile(path.join(pair,'identity/identity.json')),before);
});
