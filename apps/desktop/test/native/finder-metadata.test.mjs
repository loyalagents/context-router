import assert from 'node:assert/strict';import test from 'node:test';import {spawnSync} from 'node:child_process';import {readFile,writeFile,unlink,lstat} from 'node:fs/promises';import path from 'node:path';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';import {journal} from '../fixtures/revision-fixture.mjs';
for(const location of ['root','models'])test(`Finder metadata in ${location} refuses entry without changing recovery evidence`,async t=>{
  const f=await fixture(t),run=f.launch(),ready=await run.event('ready');run.send('quit',ready.generation);assert.deepEqual(await ended(run.child),[0,null]);await journal(f);
  const stage=path.join(f.envelope,'models',`.download-${'a'.repeat(32)}-${'b'.repeat(32)}.part`),metadata=path.join(f.envelope,...(location==='models'?['models']:[]),'.DS_Store');
  await writeFile(stage,'preserve stage',{mode:0o600});await writeFile(metadata,'owned Finder fixture',{mode:0o600});
  const before=await readFile(path.join(f.envelope,'owner.json')),args=location==='models'?['cleanup-downloads']:['mcp','list'],cli=()=>spawnSync(f.executable,['--root',f.envelope,...args],{env:{},encoding:'utf8',timeout:6000});
  assert.equal(cli().status,1);assert.deepEqual(await readFile(path.join(f.envelope,'owner.json')),before);assert.equal(await readFile(stage,'utf8'),'preserve stage');
  const info=await lstat(metadata);assert.ok(info.isFile());assert.equal(info.uid,process.getuid());assert.equal(info.nlink,1);await unlink(metadata);
  const result=cli();assert.equal(result.status,0,result.stderr);assert.equal((await journal(f)).outcome,'ok');
  if(location==='models')await assert.rejects(lstat(stage),{code:'ENOENT'});else assert.equal(await readFile(stage,'utf8'),'preserve stage');
});
