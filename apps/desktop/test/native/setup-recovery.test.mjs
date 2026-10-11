import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,copyFile,rename,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createPackageManifest,inventoryPayload} from '../../src/package-manifest.mjs';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';

// Real native CLI, admission, SQLite/identity, preparation and drain. Only the
// web/model fixture payload and one explicit seed failure are synthetic.
async function setup(t,{absentIdentity=false,occupied=false,stage=false}={}){
  const f=await fixture(t),first=f.launch(),ready=await first.event('ready');first.send('quit',ready.generation);assert.equal((await ended(first.child))[0],0);
  const metadata=path.join(f.envelope,'installation.json'),installation=JSON.parse(await readFile(metadata));installation.setup='failed';await writeFile(metadata,JSON.stringify(installation));
  const pair=path.join(f.envelope,'stores',installation.selectedStore),bundle=path.dirname(path.dirname(path.dirname(f.executable))),runtime=path.join(bundle,'Contents/Resources/desktop/runtime'),dist=path.resolve(import.meta.dirname,'../../../backend/dist'),fault=path.join(f.top,'fault');
  await rm(path.join(pair,'data'),{recursive:true});await rm(path.join(pair,'identity'),{recursive:true});
  const outside=path.join(f.top,'seed-data'),outsideIdentity=path.join(f.top,'seed-identity');
  const seed=spawnSync(process.execPath,['-e',`const d=require(process.argv[1]).SqliteDatabase.bootstrap({databaseRoot:process.argv[2],identityRoot:process.argv[3]});console.log(d.targetId);`,path.join(dist,'infrastructure/storage/sqlite/sqlite-database.js'),outside,outsideIdentity],{env:{},encoding:'utf8',timeout:5000});assert.equal(seed.status,0,seed.stderr);const target=seed.stdout.trim();
  if(!absentIdentity){const identity=spawnSync(process.execPath,[path.join(dist,'local-identity.js'),'initialize'],{env:{LOCAL_DATABASE_ROOT:outside,LOCAL_IDENTITY_STATE_ROOT:outsideIdentity},encoding:'utf8',timeout:10000});assert.equal(identity.status,0,identity.stderr);await rename(outsideIdentity,path.join(pair,'identity'));}
  if(occupied){const r=spawnSync(process.execPath,['-e',`const d=new(require('node:sqlite').DatabaseSync)(process.argv[1]);d.prepare('INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?)').run('retained','fixture@example.test',1,1);d.close();`,path.join(outside,'database.sqlite')],{env:{},encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);}
  if(stage)await rename(path.join(outside,'database.sqlite'),path.join(outside,`bootstrap-${'e'.repeat(32)}.sqlite`));
  await rename(outside,path.join(pair,'data'));
  await writeFile(path.join(runtime,'managed.mjs'),`import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {openManagedControl} from './control.mjs';
const load=createRequire(import.meta.url),dist=${JSON.stringify(dist)};
export const backend=name=>load(path.join(dist,name.slice('backend/dist/'.length)));
export const authority=backend('backend/dist/infrastructure/managed/managed-admission.js'),nativeOwners=backend('backend/dist/infrastructure/storage/sqlite/sqlite-database.js');
const runtime=backend('backend/dist/infrastructure/storage/sqlite/sqlite-local-runtime.js'),seed=runtime.seedLocalCatalog;
runtime.seedLocalCatalog=(...args)=>{if(fs.existsSync(${JSON.stringify(fault)})&&fs.readFileSync(${JSON.stringify(fault)},'utf8')==='seed')throw new Error('controlled fixture seed failure');return seed(...args);};
export async function admit(role){const cap=await authority.admitManagedProcess(${JSON.stringify(f.executable)});if(cap.role!==role)throw new Error();const control=await openManagedControl(cap.generation,{onStop:()=>authority.revokeManagedAdmission(),onCommand(){}});const pair=path.join(cap.envelope,'stores',cap.storeId);
if(fs.existsSync(${JSON.stringify(fault)})&&fs.readFileSync(${JSON.stringify(fault)},'utf8')==='eof')control.end();
return {cap,control,configuration:{kind:'sqlite',databaseRoot:path.join(pair,'data'),stateRoot:path.join(pair,'identity')},exports:path.join(cap.envelope,'exports',cap.generation)};}
`);
  for(const name of ['prepare-store','maintenance'])await copyFile(path.resolve(import.meta.dirname,`../../runtime/${name}.mjs`),path.join(runtime,`${name}.mjs`));
  await writeFile(path.join(runtime,'prepare.mjs'),`import {admit,backend,authority,nativeOwners} from './managed.mjs';const {control}=await admit('prepare');try{const result=await backend('backend/dist/infrastructure/managed/managed-prepare.js').prepareManagedStore();await control.send('prepared',{...result,modelEnabled:false,modelPort:Number(process.argv[2])});}finally{authority.revokeManagedAdmission();await nativeOwners.waitForNativeOwners();await control.close();}`);
  await writeFile(path.join(bundle,'Contents/Resources/package-manifest.json'),JSON.stringify(createPackageManifest({source:'a'.repeat(64),files:await inventoryPayload(bundle)})));
  function command(args){const r=spawnSync(f.executable,['--root',f.envelope,...args],{env:{},encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);return r;}
  async function journal(){const j=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));f.acceptQuiescent(j);return j;}
  return {...f,pair,target,fault,command,journal,metadata};
}
for(const stage of [false,true])test(`named bootstrap recovery continues absent-identity setup through initialization and launch (stage=${stage})`,async t=>{
  const f=await setup(t,{absentIdentity:true,stage});assert.equal(f.command(['identity','recover-database-bootstrap']).status,0);assert.equal((await f.journal()).outcome,'ok');
  const initialized=f.command(['initialize-recovered']);await f.journal();assert.equal(initialized.status,0,initialized.stderr);
  assert.equal(JSON.parse(await readFile(path.join(f.pair,'identity/identity.json'))).databaseTargetId,f.target);
  const run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);
});
test('recovered initialization refuses existing principals before creating absent identity or changing database bytes',async t=>{
  const f=await setup(t,{absentIdentity:true,occupied:true});assert.equal(f.command(['identity','recover-database-bootstrap']).status,0);await f.journal();
  const database=path.join(f.pair,'data/database.sqlite'),before=await readFile(database);assert.equal(f.command(['initialize-recovered']).status,1);assert.equal((await f.journal()).outcome,'failed');assert.deepEqual(await readFile(database),before);await assert.rejects(lstat(path.join(f.pair,'identity')),{code:'ENOENT'});
});
test('drained offline seed failure is retryable only through explicit resume and retains identity/target',async t=>{
  const f=await setup(t),identity=path.join(f.pair,'identity/identity.json'),before=await readFile(identity);await writeFile(f.fault,'seed');
  assert.equal(f.command(['resume-setup']).status,1);assert.equal((await f.journal()).outcome,'failed');assert.deepEqual(await readFile(identity),before);
  await rm(f.fault);const resumed=f.command(['resume-setup']);await f.journal();assert.equal(resumed.status,0,resumed.stderr);assert.deepEqual(await readFile(identity),before);assert.equal(JSON.parse(await readFile(f.metadata)).setup,'ready');
});
test('offline preparation control loss still leaves uncertainty',async t=>{
  const f=await setup(t);await writeFile(f.fault,'eof');assert.equal(f.command(['resume-setup']).status,1);assert.equal((await f.journal()).outcome,'uncertain');assert.equal(f.command(['resume-setup']).status,1);
});
