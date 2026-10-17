import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareInstalledDesktop, applyInstalledDesktop } from '../../backend/scripts/demo/installed-desktop.mjs';
import { createHash } from 'node:crypto';
const uuid='a'.repeat(32);
async function fixture(t){const top=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-installed-desktop-')));t.after(()=>fs.rm(top,{recursive:true,force:true}));const root=path.join(top,'managed-v1');await fs.mkdir(root,{mode:0o700});await fs.mkdir(path.join(root,'demo'),{mode:0o700});const dir=path.join(root,'demo',uuid);await fs.mkdir(dir,{mode:0o700});await fs.mkdir(path.join(dir,'exports'),{mode:0o700});await fs.writeFile(path.join(dir,'generation.json'),JSON.stringify({installationId:uuid,storeId:uuid,clients:{agentC:'C'.repeat(22)}}),{mode:0o600});await fs.writeFile(path.join(dir,'exports/agent-c.token'),'cr_mcp_'+'C'.repeat(22)+'.'+'T'.repeat(43),{mode:0o600});const config=path.join(top,'desktop.json');await fs.writeFile(config,JSON.stringify({theme:'dark',mcpServers:{unrelated:{command:'/known/tool'}}}),{mode:0o600});const spec={root,store:uuid,generation:'b'.repeat(32),endpoint:'http://127.0.0.1:3213/mcp'};return{top,root,config,spec,context:{fixtureRoot:top,checkActive:async()=>({installationId:uuid,...spec})}};}
test('packaged Desktop preparation snapshots bundled Node and bridge; apply preserves unrelated configuration and cannot replay',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.config);
 const p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);assert.deepEqual(await fs.readFile(f.config),before);
 const proposal=JSON.parse(await fs.readFile(p.proposal));assert.ok(proposal.entry.command.startsWith(f.root));assert.equal(proposal.entry.env.NODE_OPTIONS,'');
 assert.equal(proposal.entry.args.includes('--generation'),false);assert.equal(proposal.entry.args[proposal.entry.args.indexOf('--installation-id')+1],uuid);assert.equal(proposal.entry.args[proposal.entry.args.indexOf('--client-id')+1],'C'.repeat(22));assert.match(proposal.entry.args[proposal.entry.args.indexOf('--credential-sha256')+1],/^[a-f0-9]{64}$/);
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

test('Desktop prepare exposes only the exact nonsecret owned change and binds reviewed bytes',async t=>{
 const f=await fixture(t);await fs.writeFile(f.config,JSON.stringify({secret:'unrelated-secret',mcpServers:{unrelated:{env:{TOKEN:'not-for-review'}}}}),{mode:0o600});
 const p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context),bytes=await fs.readFile(p.proposal),proposal=JSON.parse(bytes);
 assert.equal(p.proposalSha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(p.review,{operation:'create',config:f.config,entryName:p.entryName,entry:proposal.entry,backup:'Exact original configuration will be saved privately before replacement.'});
 assert.equal(JSON.stringify(p).includes('unrelated-secret'),false);assert.equal(JSON.stringify(p).includes('not-for-review'),false);assert.equal(Object.hasOwn(p,'original'),false);
});
for(const kind of ['whitespace','config-path'])test(`Desktop refuses changed reviewed proposal bytes (${kind}) before configuration/backup mutation`,async t=>{
 const f=await fixture(t),before=await fs.readFile(f.config),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);
 const bytes=await fs.readFile(p.proposal),changed=JSON.parse(bytes);changed.config=path.join(f.top,'different.json');
 await fs.writeFile(p.proposal,kind==='whitespace'?Buffer.concat([bytes,Buffer.from(' ')]):JSON.stringify(changed));
 await assert.rejects(applyInstalledDesktop({...f.spec,proposal:p.proposal,proposalSha256:p.proposalSha256,desktopClosed:true},f.context),/reviewed proposal changed/i);
 assert.deepEqual(await fs.readFile(f.config),before);await assert.rejects(fs.access(path.join(path.dirname(p.proposal),'backup.json')));
});
test('Desktop applies and receipts the once-read reviewed proposal bytes despite a later file edit',async t=>{
 const f=await fixture(t),p=await prepareInstalledDesktop({...f.spec,config:f.config},f.context),bytes=await fs.readFile(p.proposal);
 const applied=await applyInstalledDesktop({...f.spec,proposal:p.proposal,proposalSha256:p.proposalSha256,desktopClosed:true},{...f.context,checkpoint:async point=>{if(point==='before-rename')await fs.writeFile(p.proposal,Buffer.concat([bytes,Buffer.from(' ')]));}});
 assert.equal(applied.status,'applied');assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(p.proposal),'applied.json'))).proposalSha256,createHash('sha256').update(bytes).digest('hex'));
 const next=await prepareInstalledDesktop({...f.spec,config:f.config},f.context);assert.equal(next.review.operation,'replace');
});
test('Desktop prerequisites explain missing installation and private 0600 config without changing paths or permissions',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.config),missing=path.join(f.top,'missing/desktop.json');
 await assert.rejects(prepareInstalledDesktop({...f.spec,config:missing},f.context),e=>/install or open Claude Desktop once/i.test(e.demoSafeMessage));await assert.rejects(fs.access(path.dirname(missing)));
 await fs.chmod(f.config,0o644);await assert.rejects(prepareInstalledDesktop({...f.spec,config:f.config},f.context),e=>/0600/.test(e.demoSafeMessage)&&/owned/i.test(e.demoSafeMessage));assert.equal((await fs.stat(f.config)).mode&0o777,0o644);assert.deepEqual(await fs.readFile(f.config),before);
});
