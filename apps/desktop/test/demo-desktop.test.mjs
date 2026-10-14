import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareInstalledDesktop, applyInstalledDesktop } from '../../backend/scripts/demo/installed-desktop.mjs';
const uuid='a'.repeat(32);
async function fixture(t){const top=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-installed-desktop-')));t.after(()=>fs.rm(top,{recursive:true,force:true}));const root=path.join(top,'managed-v1');await fs.mkdir(root,{mode:0o700});await fs.mkdir(path.join(root,'demo'),{mode:0o700});const dir=path.join(root,'demo',uuid);await fs.mkdir(dir,{mode:0o700});await fs.mkdir(path.join(dir,'exports'),{mode:0o700});await fs.writeFile(path.join(dir,'generation.json'),JSON.stringify({installationId:uuid,storeId:uuid,clients:{agentC:'C'.repeat(22)}}),{mode:0o600});await fs.writeFile(path.join(dir,'exports/agent-c.token'),'cr_mcp_'+'C'.repeat(22)+'.'+'T'.repeat(43),{mode:0o600});const config=path.join(top,'desktop.json');await fs.writeFile(config,JSON.stringify({theme:'dark',mcpServers:{unrelated:{command:'/known/tool'}}}),{mode:0o600});const spec={root,store:uuid,generation:'b'.repeat(32),endpoint:'http://127.0.0.1:3213/mcp'};return{top,root,config,spec,context:{fixtureRoot:top,checkActive:async()=>({installationId:uuid,...spec})}};}
test('packaged Desktop preparation snapshots bundled Node and bridge; apply preserves unrelated configuration and cannot replay',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.config);
 const p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);assert.deepEqual(await fs.readFile(f.config),before);
 const proposal=JSON.parse(await fs.readFile(p.proposal));assert.ok(proposal.entry.command.startsWith(f.root));assert.equal(proposal.entry.env.NODE_OPTIONS,'');
 const result=await applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},f.context);assert.equal(result.status,'applied');
 const after=JSON.parse(await fs.readFile(f.config));assert.equal(after.theme,'dark');assert.deepEqual(after.mcpServers.unrelated,{command:'/known/tool'});assert.ok(after.mcpServers[p.entryName]);
 assert.deepEqual(await fs.readFile(result.backup),before);await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},f.context));
});
test('Desktop apply rejects changed config, unclosed Desktop and substituted proposal executable without executing it',async t=>{
 const f=await fixture(t),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal},f.context));
 const proposal=JSON.parse(await fs.readFile(p.proposal));proposal.entry.command='/untrusted/run';await fs.writeFile(p.proposal,JSON.stringify(proposal));
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},f.context));
 assert.equal(JSON.parse(await fs.readFile(f.config)).theme,'dark');
});
test('Desktop preparation refuses malformed UTF-8 without normalizing or changing config',async t=>{
 const f=await fixture(t),bytes=Buffer.concat([Buffer.from('{"label":"'),Buffer.from([0xff]),Buffer.from('"}')]);await fs.writeFile(f.config,bytes);
 await assert.rejects(prepareInstalledDesktop({...f.spec,config:f.config},f.context),/valid JSON/);assert.deepEqual(await fs.readFile(f.config),bytes);
});
test('Desktop apply refuses config edits since preparation before any replacement',async t=>{
 const f=await fixture(t),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context),changed=Buffer.from('{"theme":"light"}');await fs.writeFile(f.config,changed);
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},f.context),/config changed/);assert.deepEqual(await fs.readFile(f.config),changed);
});
test('Desktop config race retains evidence and refuses replay without replacing intervening edits',async t=>{
 const f=await fixture(t),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context),changed=Buffer.from('{"external":"edit"}');
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},{...f.context,checkpoint:async point=>{if(point==='before-rename')await fs.writeFile(f.config,changed);}}),/immediately before/);
 assert.deepEqual(await fs.readFile(f.config),changed);await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},f.context),/uncertain invocation/);
});
test('Desktop apply refuses a stale runtime receipt before touching configuration',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.config),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,desktopClosed:true},{...f.context,checkActive:async()=>{throw new Error('stale runtime');}}),/stale runtime/);assert.deepEqual(await fs.readFile(f.config),before);
});
