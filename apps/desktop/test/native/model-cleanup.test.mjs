import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';
import {writeFile,readFile,open,link,lstat,symlink,chmod} from 'node:fs/promises';import path from 'node:path';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';import {journal} from '../fixtures/revision-fixture.mjs';
const name='Qwen3.5-9B-Q4_K_M.gguf',stage=`.download-${'a'.repeat(32)}-${'b'.repeat(32)}.part`;
const cli=(f,args=['cleanup-downloads'])=>spawnSync(f.executable,['--root',f.envelope,...args],{env:{},encoding:'utf8',timeout:6000});
async function setup(t){const f=await fixture(t),run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);return {...f,models:path.join(f.envelope,'models')};}
async function sparse(file,size=5680522464){const fd=await open(file,'wx',0o600);try{await fd.truncate(size);}finally{await fd.close();}}
test('offline cleanup removes only owned single-link leftovers and is idempotent',async t=>{
  const f=await setup(t),installation=await readFile(path.join(f.envelope,'installation.json'));const files=[stage,stage.replace('b'.repeat(32),'c'.repeat(32))];for(const file of files)await writeFile(path.join(f.models,file),'partial',{mode:0o600});
  for(let i=0;i<2;i++){const result=cli(f);assert.equal(result.status,0,result.stderr);assert.equal((await journal(f)).operation,'cleanup-downloads');}
  for(const file of files)await assert.rejects(lstat(path.join(f.models,file)),{code:'ENOENT'});assert.deepEqual(await readFile(path.join(f.envelope,'installation.json')),installation);assert.equal(cli(f,['mcp','list']).status,0);await journal(f);
});
test('offline cleanup completes exact two-link publication without deleting the model',async t=>{
  const f=await setup(t),source=path.join(f.models,stage),destination=path.join(f.models,name);await sparse(source);await link(source,destination);const before=await lstat(destination);
  const result=cli(f);assert.equal(result.status,0,result.stderr);assert.equal((await journal(f)).outcome,'ok');const after=await lstat(destination);assert.equal(after.ino,before.ino);assert.equal(after.size,before.size);assert.equal(after.nlink,1);await assert.rejects(lstat(source),{code:'ENOENT'});
});
for(const variant of ['malformed','symlink','unrelated-link','third-link','wrong-mode','wrong-size'])test(`cleanup refuses ${variant} before deleting any valid stage or changing the journal`,async t=>{
  const f=await setup(t),valid=path.join(f.models,stage),other=path.join(f.models,stage.replace('b'.repeat(32),'c'.repeat(32)));await writeFile(valid,'retain',{mode:0o600});
  if(variant==='malformed')await writeFile(path.join(f.models,'.download-not-owned.part'),'retain',{mode:0o600});
  if(variant==='symlink')await symlink(valid,other);
  if(variant==='unrelated-link'){await writeFile(other,'retain',{mode:0o600});await link(other,path.join(f.top,'outside'));}
  if(['third-link','wrong-size'].includes(variant)){await sparse(other,variant==='wrong-size'?10:5680522464);await link(other,path.join(f.models,name));if(variant==='third-link')await link(other,path.join(f.top,'outside'));}
  if(variant==='wrong-mode'){await writeFile(other,'retain',{mode:0o600});await chmod(other,0o644);}
  const before=await readFile(path.join(f.envelope,'owner.json'));assert.equal(cli(f).status,1);assert.equal(await readFile(valid,'utf8'),'retain');assert.deepEqual(await readFile(path.join(f.envelope,'owner.json')),before);
});
for(const variant of ['not-ready','pending','active','uncertain'])test(`cleanup refuses ${variant} installation and preserves recovery evidence`,async t=>{
  const f=await setup(t),file=path.join(f.envelope,['active','uncertain'].includes(variant)?'owner.json':'installation.json'),record=JSON.parse(await readFile(file));
  if(variant==='not-ready')record.setup='failed';if(variant==='pending')record.pendingRestore={storeId:'e'.repeat(32),sourceDigest:'f'.repeat(64),expectedSelection:record.selectedStore,status:'reserved'};
  if(variant==='active'){record.lifecycle='active';record.outcome='pending';}if(variant==='uncertain')record.outcome='uncertain';
  const original=await readFile(file);await writeFile(file,JSON.stringify(record));const ownerBefore=await readFile(path.join(f.envelope,'owner.json'));try{assert.equal(cli(f).status,1);assert.deepEqual(JSON.parse(await readFile(file)),record);assert.deepEqual(await readFile(path.join(f.envelope,'owner.json')),ownerBefore);}finally{await writeFile(file,original);}
});
test('cleanup excludes a running guardian',async t=>{
  const f=await fixture(t),run=f.launch(),ready=await run.event('ready');assert.equal(cli(f).status,1);run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);
});
