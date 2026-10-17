import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,ended} from '../fixtures/supervisor-fixture.mjs';
import * as clients from '../../../backend/scripts/demo/installed-clients.mjs';

test('inspect qualifies a native executable without stable profile, credential or login access; saved choices are revalidated',async t=>{
 assert.equal(typeof clients.inspectInstalledClient,'function');
 const f=await fixture(t),r=f.launch();let ready=await r.event('ready');const after=r.events.length;r.send('enter-demo',ready.generation);ready=await r.event('ready',after);
 const state=JSON.parse(await fs.readFile(path.join(f.envelope,'installation.json'))),dir=path.join(f.envelope,'demo/client-fixture');await fs.mkdir(dir,{mode:0o700});
 const executable=path.join(dir,'claude'),built=spawnSync('/usr/bin/clang',[path.resolve(import.meta.dirname,'../fixtures/demo-preflight.c'),'-o',executable],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);await fs.writeFile(path.join(dir,'continue'),'');
 const spec={root:f.envelope,store:state.demoStore,generation:ready.generation,endpoint:ready.mcpOrigin};
 const result=await clients.inspectInstalledClient(spec,{command:'claude',auth:'api-key',executable});
 assert.deepEqual(Object.keys(result).sort(),['path','sha256','version']);assert.equal(result.path,executable);assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(result.version,'2.1.299');
 await assert.rejects(fs.access(path.join(f.envelope,'demo/profiles')));await assert.rejects(fs.access(path.join(dir,'launched')));await assert.rejects(fs.access(path.join(f.envelope,'demo/client-guards')));
 const wrapper=path.join(dir,'wrapper');await fs.writeFile(wrapper,'#!/bin/sh\ntouch "'+path.join(dir,'wrapper-ran')+'"\n',{mode:0o700});
 await assert.rejects(clients.inspectInstalledClient(spec,{command:'claude',auth:'api-key',executable:wrapper}),/native arm64/);await assert.rejects(fs.access(path.join(dir,'wrapper-ran')));
 await fs.chmod(executable,0o777);await assert.rejects(clients.inspectInstalledClient(spec,{command:'claude',auth:'api-key',executable}),/Untrusted/);
 r.send('quit',ready.generation);assert.equal((await ended(r.child))[0],0);
 await assert.rejects(clients.inspectInstalledClient(spec,{command:'claude',auth:'api-key',executable}),/stale|unavailable/);
});
