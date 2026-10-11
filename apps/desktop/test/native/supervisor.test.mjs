import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,realpath,mkdir,copyFile,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createPackageManifest,inventoryPayload} from '../../src/package-manifest.mjs';
import {createServer,createConnection} from 'node:net';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';
test('occupied requested loopback port refuses before creating an envelope and leaves its owner listening',async t=>{
  const f=await fixture(t),server=createServer(socket=>socket.end('still-owned'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=String(server.address().port),result=spawnSync(f.executable,['guardian','--root',f.envelope,'--ui-port','0','--mcp-port',port],{env:{},encoding:'utf8',timeout:6000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(server.listening,true);await assert.rejects(lstat(f.envelope),{code:'ENOENT'});
    const initial=f.launch(),ready=await initial.event('ready');initial.send('quit',ready.generation);assert.equal((await ended(initial.child))[0],0);
    const files=['installation.json','owner.json'],before=await Promise.all(files.map(name=>readFile(path.join(f.envelope,name),'utf8')));
    const second=spawnSync(f.executable,['guardian','--root',f.envelope,'--ui-port',port,'--mcp-port','0'],{env:{},encoding:'utf8',timeout:6000});assert.equal(second.status,1);assert.equal(second.stdout,'');assert.deepEqual(await Promise.all(files.map(name=>readFile(path.join(f.envelope,name),'utf8'))),before);
    const client=createConnection({host:'127.0.0.1',port:Number(port)});let received='';client.on('data',data=>{received+=data;});await once(client,'close');assert.equal(received,'still-owned');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('guardian prepares before app, excludes duplicates, drains and restarts with a fresh generation',async t=>{
  const f=await fixture(t),first=f.launch(),ready=await first.event('ready');
  const duplicate=f.launch();assert.equal((await duplicate.child.ended)[0],1);
  const count=first.events.length;first.send('restart',ready.generation);const next=await first.event('ready',count);
  assert.notEqual(next.generation,ready.generation);first.send('quit',next.generation);assert.equal((await first.child.ended)[0],0);
  const journal=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));assert.equal(journal.lifecycle,'quiescent');assert.equal(journal.outcome,'ok');
});
test('guardian shell EOF drains its actual application and leaves a quiescent outcome',async t=>{
  const f=await fixture(t),run=f.launch();await run.event('ready');run.child.stdin.end();assert.equal((await ended(run.child))[0],0);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).outcome,'ok');
});
test('application loss without drain remains uncertain and prevents restart',async t=>{
  const f=await fixture(t,'lost-app'),run=f.launch();await run.event('ready');assert.equal((await ended(run.child))[0],1);
  const journal=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));assert.equal(journal.outcome,'uncertain');
  assert.equal((await f.launch().child.ended)[0],1);
});
test('guardian rejects stale control generation and still drains exact children',async t=>{
  const f=await fixture(t),run=f.launch();await run.event('ready');run.send('restart','b'.repeat(32));assert.equal((await ended(run.child))[0],1);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).lifecycle,'quiescent');
});

test('actual application entrypoint refuses drain after failed partial backend startup',async t=>{
  const f=await fixture(t,'failed-startup'),run=f.launch();await run.event('starting');assert.equal((await ended(run.child))[0],1);
  const journal=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));assert.equal(journal.outcome,'uncertain');
});

for(const variant of ['status-eof','unsolicited-drain'])test(`guardian stops on live application ${variant}`,async t=>{
  const f=await fixture(t,variant),run=f.launch(),ready=await run.event('ready');if(variant==='status-eof')run.send('unlock',ready.generation);await run.event('stopped');assert.equal((await ended(run.child))[0],1);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).lifecycle,'quiescent');
});
test('drain followed by unsuccessful application exit cannot restart or report success',async t=>{
  const f=await fixture(t,'failed-exit'),run=f.launch(),ready=await run.event('ready');run.send('restart',ready.generation);
  assert.equal((await ended(run.child))[0],1);assert.equal(run.events.filter(e=>e.type==='ready').length,1);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).outcome,'failed');
});
test('download inherits lifetime and private control without storage admission; cancel preserves application',async t=>{
  const f=await fixture(t,'download'),run=f.launch(),ready=await run.event('ready');run.send('download',ready.generation);
  const progress=await run.event('download-progress');assert.equal(progress.received,1);run.send('cancel-download',ready.generation);
  await run.event('download-cancelled');assert.equal(run.child.exitCode,null);run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).outcome,'ok');
});
test('quit drains an active download before publishing quiescence',async t=>{
  const f=await fixture(t,'download'),run=f.launch(),ready=await run.event('ready');run.send('download',ready.generation);await run.event('download-progress');
  run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);assert.ok(run.events.some(event=>event.type==='download-cancelled'));
  assert.equal(JSON.parse(await readFile(path.join(f.envelope,'owner.json'))).outcome,'ok');
});
test('repeated explicit downloads release reaped child descriptors',async t=>{
  const f=await fixture(t,'download'),run=f.launch(),ready=await run.event('ready');
  const count=()=>{const r=spawnSync('/usr/sbin/lsof',['-n','-P','-a','-p',String(run.child.pid),'-Ff'],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);return r.stdout.split('\n').filter(line=>/^f[0-9]+$/.test(line)).length;};
  const original=count();
  for(let index=0;index<5;index++){
    const after=run.events.length;run.send('download',ready.generation);await run.event('download-progress',after);run.send('cancel-download',ready.generation);await run.event('download-cancelled',after);
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(count(),original);
  }
  run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);
});
test('valid busy AI status preserves application admission during inference',async t=>{
  const f=await fixture(t,'busy'),run=f.launch(),ready=await run.event('ready'),status=await run.event('model-status');assert.equal(status.state,'busy');assert.equal(run.child.exitCode,null);
  run.send('quit',ready.generation);assert.equal((await ended(run.child))[0],0);assert.equal(run.events.at(-1).outcome,'ok');
});
