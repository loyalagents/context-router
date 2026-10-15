import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixture } from '../fixtures/supervisor-fixture.mjs';
test('native demo wrapper to Node to client excludes managed descriptors and injected environment',async t=>{
 const f=await fixture(t),fd=openSync('/dev/null','r'),stdio=['ignore','pipe','pipe'];for(let i=3;i<24;i++)stdio[i]=fd;
 try{
  const r=spawnSync(f.executable,['demo'],{env:{PATH:'/usr/bin:/bin',HOME:'/untrusted/home',NODE_OPTIONS:'--invalid-injected-option',NODE_DEBUG:'module',LOCAL_DATABASE_ROOT:'/personal/data',LOCAL_IDENTITY_STATE_ROOT:'/personal/identity',CR_DEMO_TOKEN:'must-not-forward',ANTHROPIC_API_KEY:'must-not-forward'},stdio,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.deepEqual(value.child.fds,[]);assert.deepEqual(value.fds,[]);
  for(const key of ['NODE_OPTIONS','NODE_DEBUG','LOCAL_DATABASE_ROOT','LOCAL_IDENTITY_STATE_ROOT','CR_DEMO_TOKEN','ANTHROPIC_API_KEY'])assert.equal(value.wrapper[key],undefined);
  assert.notEqual(value.wrapper.HOME,'/untrusted/home');assert.equal(value.child.env.PATH,'');assert.equal(value.child.env.CR_DEMO_TOKEN,'synthetic-demo-only');assert.ok(Object.keys(value.child.env).every(key=>['PATH','CR_DEMO_TOKEN','__CF_USER_TEXT_ENCODING'].includes(key)));
 }finally{closeSync(fd);}
});
