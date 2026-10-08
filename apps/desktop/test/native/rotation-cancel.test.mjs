import assert from 'node:assert/strict';import test from 'node:test';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';
import {readFile,writeFile,copyFile,rm,rename,lstat} from 'node:fs/promises';import path from 'node:path';
import {editedFixture,journal} from '../fixtures/revision-fixture.mjs';import {ended} from '../fixtures/supervisor-fixture.mjs';
test('interrupted real SQLite rotation leaves named recovery reachable after published operation',async t=>{
  const dist=path.resolve(import.meta.dirname,'../../../backend/dist');
  const f=await editedFixture(t,'normal',async(runtime,f)=>{
    await copyFile(path.resolve(import.meta.dirname,'../../runtime/maintenance.mjs'),path.join(runtime,'maintenance.mjs'));
    await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {openManagedControl} from './control.mjs';
const load=createRequire(import.meta.url),dist=${JSON.stringify(dist)};let control;
export const backend=name=>load(path.join(dist,name.slice('backend/dist/'.length)));
export const authority=backend('backend/dist/infrastructure/managed/managed-admission.js'),nativeOwners=backend('backend/dist/infrastructure/storage/sqlite/sqlite-database.js');
const Store=backend('backend/dist/modules/auth/local-identity-filesystem.js').LocalIdentityFileStore,publish=Store.prototype.publishOperation;
Store.prototype.publishOperation=async function(...args){await publish.apply(this,args);if(process.argv[3]==='rotate'){process.stdout.write('operation-published\\n');await control.stopped;}};
export async function admit(role){const cap=await authority.admitManagedProcess(${JSON.stringify(f.executable)});if(cap.role!==role)throw new Error();control=await openManagedControl(cap.generation,{onStop:()=>authority.revokeManagedAdmission(),onCommand(){}});const pair=path.join(cap.envelope,'stores',cap.storeId);return {cap,control,configuration:{kind:'sqlite',databaseRoot:path.join(pair,'data'),stateRoot:path.join(pair,'identity')},exports:path.join(cap.envelope,'exports',cap.generation)};}`);
  });
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);await ended(run.child);
  const installation=JSON.parse(await readFile(path.join(f.envelope,'installation.json'))),pair=path.join(f.envelope,'stores',installation.selectedStore),data=path.join(f.top,'seed-data'),identity=path.join(f.top,'seed-identity');
  const initialized=spawnSync(process.execPath,[path.join(dist,'local-identity.js'),'initialize'],{env:{LOCAL_DATABASE_ROOT:data,LOCAL_IDENTITY_STATE_ROOT:identity},encoding:'utf8',timeout:15000});assert.equal(initialized.status,0,initialized.stderr);
  for(const name of ['data','identity'])await rm(path.join(pair,name),{recursive:true});await rename(data,path.join(pair,'data'));await rename(identity,path.join(pair,'identity'));
  const before=await readFile(path.join(pair,'identity/identity.json'));
  const child=spawn(f.executable,['--root',f.envelope,'identity','rotate'],{env:{},stdio:['ignore','pipe','pipe']});child.ended=once(child,'close');child.stderr.resume();
  const [bytes]=await once(child.stdout,'data');assert.match(bytes.toString(),/operation-published/);child.stdout.resume();child.kill('SIGINT');assert.deepEqual(await ended(child),[1,null]);assert.equal((await journal(f)).outcome,'failed');
  assert.ok(await lstat(path.join(pair,'identity/identity.operation.json')));assert.deepEqual(await readFile(path.join(pair,'identity/identity.json')),before);
  const recovered=spawnSync(f.executable,['--root',f.envelope,'identity','recover-rotation'],{env:{},encoding:'utf8',timeout:15000});assert.equal(recovered.status,0,recovered.stderr);assert.equal((await journal(f)).outcome,'ok');await assert.rejects(lstat(path.join(pair,'identity/identity.operation.json')),{code:'ENOENT'});assert.deepEqual(await readFile(path.join(pair,'identity/identity.json')),before);
});
