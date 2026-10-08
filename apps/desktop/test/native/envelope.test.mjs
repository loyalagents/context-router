import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'desktop-envelope-')));
  const driver = path.join(root, 'driver'), envelope = path.join(root, 'managed-v1');
  const native = path.resolve(import.meta.dirname, '../../native');
  const built = spawnSync('/usr/bin/clang', ['-Wall','-Wextra','-Werror','-fobjc-arc','-framework','Foundation','-I',native,
    path.join(import.meta.dirname, '../fixtures/envelope-driver.m'), path.join(native,'envelope.m'), path.join(native,'package.m'),'-o',driver], { encoding:'utf8', timeout:20_000 });
  assert.equal(built.status,0,built.stderr);
  const children = [];
  t.after(async () => {
    let uncertain = false;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end();
      const observed = async ms => { let timer; try { return await Promise.race([child.ended.then(() => true),new Promise(resolve => {timer=setTimeout(()=>resolve(false),ms);})]); } finally {clearTimeout(timer);} };
      if (!await observed(3000)) { child.kill('SIGTERM'); if (!await observed(1000)) {child.kill('SIGKILL'); if (!await observed(1000)) uncertain = true;} }
    }
    if (uncertain) throw new Error(`Fixture ownership uncertain; preserve ${root}`);
    await rm(root,{recursive:true,force:true});
  });
  const launch = async (command = 'fresh') => {
    const child = spawn(driver,[command,envelope],{env:{},stdio:['pipe','pipe','pipe']});
    child.ended = once(child,'close'); children.push(child);
    let output = '', diagnostic = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { diagnostic += bytes; });
    const deadline = performance.now()+3000;
    while (!output.includes('\n') && child.exitCode === null && child.signalCode === null) {
      assert.ok(performance.now()<deadline); await new Promise(resolve=>setTimeout(resolve,10));
    }
    return {child,cap:output ? JSON.parse(output) : undefined, diagnostic, output:()=>output};
  };
  return {root,envelope,launch};
}
test('native owner durably reserves fresh state, excludes a second owner and publishes quiescence after lock extinction', async t => {
  const f=await fixture(t), first=await f.launch(); assert.ok(first.cap);
  assert.equal(first.cap.role,'prepare'); assert.equal(first.cap.operation,'initialize');
  assert.equal((await stat(f.envelope)).mode & 0o777,0o700);
  const active=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));
  assert.equal(active.lifecycle,'active'); assert.equal(active.outcome,'pending');
  assert.equal(JSON.stringify(active).includes(first.cap.nonce),false);
  const duplicate=await f.launch(); assert.equal(duplicate.cap,undefined); assert.equal((await duplicate.child.ended)[0],1);
  first.child.stdin.end(); assert.equal((await first.child.ended)[0],0);
  const quiet=JSON.parse(await readFile(path.join(f.envelope,'owner.json'))); assert.equal(quiet.lifecycle,'quiescent');
  const next=await f.launch('existing'); assert.ok(next.cap, next.diagnostic); assert.notEqual(next.cap.generation,first.cap.generation);
  assert.equal(next.cap.installationId,first.cap.installationId);
});
for (const variant of ['missing-metadata','floor','active-journal','impossible-role','wrong-mode','symlink']) test(`native envelope preserves and refuses ${variant}`,async t=>{
  const f=await fixture(t), first=await f.launch(); first.child.stdin.end(); await first.child.ended;
  const file=path.join(f.envelope,'installation.json');
  if(variant==='missing-metadata') await rm(file);
  if(variant==='floor'){const m=JSON.parse(await readFile(file));m.minimumEpoch=2;await writeFile(file,JSON.stringify(m));}
  if(variant==='active-journal'){const p=path.join(f.envelope,'owner.json'),m=JSON.parse(await readFile(p));m.lifecycle='active';m.outcome='pending';await writeFile(p,JSON.stringify(m));}
  if(variant==='impossible-role'){const p=path.join(f.envelope,'owner.json'),m=JSON.parse(await readFile(p));m.role='application';m.operation='initialize';await writeFile(p,JSON.stringify(m));}
  if(variant==='wrong-mode'){const {chmod}=await import('node:fs/promises');await chmod(file,0o644);}
  if(variant==='symlink'){const bytes=await readFile(file);await rm(file);const outside=path.join(f.root,'outside');await writeFile(outside,bytes,{mode:0o600});await symlink(outside,file);}
  const next=await f.launch('existing');assert.equal(next.cap,undefined);assert.equal((await next.child.ended)[0],1);
  assert.ok(await stat(f.envelope));
});
test('an existing nonempty envelope with missing metadata is never inferred fresh',async t=>{
  const f=await fixture(t);await mkdir(f.envelope,{mode:0o700});await writeFile(path.join(f.envelope,'retained'),'state',{mode:0o600});
  const result=await f.launch();assert.equal(result.cap,undefined);assert.equal((await result.child.ended)[0],1);
  assert.equal(await readFile(path.join(f.envelope,'retained'),'utf8'),'state');
});

test('failed holder-extinction proof permanently poisons the retained native owner', async t => {
  const f=await fixture(t), held=await f.launch('survivor'); assert.ok(held.cap);
  held.child.stdin.end(); assert.equal((await held.child.ended)[0],0);
  assert.equal(JSON.parse(held.output().trim().split('\n')[1]).denied,4);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).lifecycle,'active');
});
for (const operation of ['recover-identity','recover-bootstrap']) test(`native ${operation} delegates absent canonical identity to the named validator`,async t=>{
  const f=await fixture(t), first=await f.launch();first.child.stdin.end();await first.child.ended;
  const pair=path.join(f.envelope,'stores',first.cap.storeId);
  for (const name of ['data','identity']) await mkdir(path.join(pair,name),{mode:0o700});
  const recovery=await f.launch(operation);assert.ok(recovery.cap,recovery.diagnostic);
  assert.equal(recovery.cap.targetId,null);assert.ok(recovery.cap.dataPin);assert.ok(recovery.cap.identityPin);
  recovery.child.stdin.end();assert.equal((await recovery.child.ended)[0],0);
  const ordinary=await f.launch('admin');assert.equal(ordinary.cap,undefined);assert.equal((await ordinary.child.ended)[0],1);
  if(operation==='recover-identity') {
    const initialized=await f.launch('initialize-recovered');assert.ok(initialized.cap,initialized.diagnostic);
    assert.equal(initialized.cap.operation,'initialize-recovered'); assert.ok(initialized.cap.dataPin);
  }
});
test('existing empty directories cannot opt into initialization without named recovery',async t=>{
  const f=await fixture(t), first=await f.launch();first.child.stdin.end();await first.child.ended;
  const pair=path.join(f.envelope,'stores',first.cap.storeId);
  for (const name of ['data','identity']) await mkdir(path.join(pair,name),{mode:0o700});
  for (const op of ['initialize','initialize-recovered']) { const result=await f.launch(op);assert.equal(result.cap,undefined);assert.equal((await result.child.ended)[0],1); }
});

for(const variant of ['ready','failed-recovery']) test(`initialize-recovered refuses ${variant}`,async t=>{
  const f=await fixture(t),first=await f.launch();first.child.stdin.end();await first.child.ended;
  const pair=path.join(f.envelope,'stores',first.cap.storeId);
  for(const name of ['data','identity'])await mkdir(path.join(pair,name),{mode:0o700});
  const recovery=await f.launch('recover-identity');assert.ok(recovery.cap);recovery.child.stdin.end();await recovery.child.ended;
  const file=path.join(f.envelope,variant==='ready'?'installation.json':'owner.json'),record=JSON.parse(await readFile(file));
  if(variant==='ready')record.setup='ready';else record.outcome='failed';await writeFile(file,JSON.stringify(record));
  const result=await f.launch('initialize-recovered');assert.equal(result.cap,undefined);assert.equal((await result.child.ended)[0],1);
  assert.deepEqual(JSON.parse(await readFile(file)),record);
});
for(const variant of ['complete','reserved','failed-verify','wrong-store'])test(`native metadata activation requires completed restore and proved verification (${variant})`,async t=>{
  const f=await fixture(t),first=await f.launch();first.child.stdin.end();await first.child.ended;
  const file=path.join(f.envelope,'installation.json'),m=JSON.parse(await readFile(file));
  m.pendingRestore={storeId:'e'.repeat(32),expectedSelection:m.selectedStore,sourceDigest:'f'.repeat(64),status:variant==='reserved'?'reserved':'complete'};await writeFile(file,JSON.stringify(m));
  const journalFile=path.join(f.envelope,'owner.json'),j=JSON.parse(await readFile(journalFile));j.role='maintenance';j.operation='admin';j.storeId=variant==='wrong-store'?m.selectedStore:m.pendingRestore.storeId;j.outcome=variant==='failed-verify'?'failed':'ok';await writeFile(journalFile,JSON.stringify(j));
  const result=await f.launch('metadata-activate');
  if(variant==='complete'){assert.deepEqual(result.cap,{nativeOnly:true});result.child.stdin.end();assert.equal((await result.child.ended)[0],0);}
  else{assert.equal(result.cap,undefined);assert.equal((await result.child.ended)[0],1);}
  assert.deepEqual(JSON.parse(await readFile(file)),m);
});
test('native abandon permits partial pending destination without deleting it or requiring identity',async t=>{
  const f=await fixture(t),first=await f.launch();first.child.stdin.end();await first.child.ended;
  const file=path.join(f.envelope,'installation.json'),m=JSON.parse(await readFile(file));m.pendingRestore={storeId:'e'.repeat(32),expectedSelection:m.selectedStore,sourceDigest:'f'.repeat(64),status:'failed'};await writeFile(file,JSON.stringify(m));
  const result=await f.launch('metadata-abandon');assert.deepEqual(result.cap,{nativeOnly:true});result.child.stdin.end();assert.equal((await result.child.ended)[0],0);
  assert.deepEqual(JSON.parse(await readFile(file)),m);
});
