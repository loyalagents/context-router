import test from 'node:test';import assert from 'node:assert/strict';
import {codingLaunchSpec} from '../../backend/scripts/demo/claude-connect.mjs';
import {clientLaunchSpec} from '../../backend/scripts/demo/clients.mjs';
import {codexCodingLaunchSpec,parseCodexAuthStatus,codexLoginSpec,validateCodexProject} from '../../backend/scripts/demo/codex-connect.mjs';
const base=clientLaunchSpec({command:'codex',agent:'a',root:'/demo',dataset:'demo001',mcpPort:8790},{executable:'/native/codex'});
test('Codex coding enables real tools and project instructions with ordinary approvals and isolated MCP/profile',()=>{
 const next=codingLaunchSpec(base,'/project');
 assert.deepEqual(next.args,codexCodingLaunchSpec(base,'/project').args);assert.ok(!next.args.includes('--tools'));assert.ok(!next.args.includes('--permission-mode'));assert.ok(!next.args.includes('--allowedTools'));
 assert.equal(next.cwd,'/project');assert.equal(next.env.CODEX_HOME,base.env.CODEX_HOME);assert.equal(next.args[next.args.indexOf('--sandbox')+1],'workspace-write');assert.equal(next.args[next.args.indexOf('--ask-for-approval')+1],'on-request');
 for(const feature of ['shell_tool','unified_exec','view_image'])assert.ok(next.args.includes(`features.${feature}=true`));
 assert.ok(next.args.includes('project_doc_max_bytes=32768'));assert.ok(next.args.includes('mcp_servers.context_router_demo.tools.mutatePreferences.approval_mode="prompt"'));assert.ok(next.args.includes('--strict-config'));assert.ok(next.args.includes('--no-daemon'));
 assert.ok(base.args.includes('features.shell_tool=false'));assert.ok(!next.args.includes('danger-full-access'));assert.ok(!next.args.includes('--dangerously-bypass-approvals-and-sandbox'));
 assert.ok(next.args.includes('project_root_markers=[]'));assert.ok(next.args.includes('shell_environment_policy.exclude=["CR_DEMO_TOKEN"]'));
 assert.deepEqual(codexLoginSpec(next).args,['-c','cli_auth_credentials_store="file"','-c','project_root_markers=[]','login']);assert.equal(codexLoginSpec(next).cwd,next.env.HOME);
});
test('only known Codex auth status permits reuse or login; unknown failures never trigger login',()=>{
 assert.equal(parseCodexAuthStatus({status:0,stdout:'',stderr:'Logged in using ChatGPT\n'}),true);
 assert.equal(parseCodexAuthStatus({status:1,stdout:'',stderr:'Not logged in\n'}),false);
 for(const result of [{status:1,stderr:'config error'},{status:0,stderr:'unexpected'},{status:1,stderr:'Logged in using ChatGPT'},{status:0,stderr:'Not logged in'},{status:0,stderr:'Logged in using ChatGPT',stdout:'unexpected'},{status:0,stderr:'Logged in using an API key - secret'}])assert.throws(()=>parseCodexAuthStatus({stdout:'',...result}));
});

test('selected Codex project config is refused without modifying it, including symlinks',async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cr-codex-project-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await validateCodexProject(root);await fs.mkdir(path.join(root,'.codex'));const file=path.join(root,'.codex/config.toml');
 await fs.writeFile(file,'[mcp_servers.unrelated]');await assert.rejects(validateCodexProject(root),/project.*Codex config/);assert.equal(await fs.readFile(file,'utf8'),'[mcp_servers.unrelated]');
 await fs.unlink(file);await fs.symlink(path.join(root,'missing'),file);await assert.rejects(validateCodexProject(root),/project.*Codex config/);
});

for(const interrupted of [false,true])test(`Codex status ${interrupted?'signal retains':'unknown completed output releases'} its setup guard`,async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const {withClientGuard}=await import('../../backend/scripts/demo/installed-clients.mjs');
 const {codexAuthStatus}=await import('../../backend/scripts/demo/codex-connect.mjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-codex-status-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'demo'),{mode:0o700});
 const executable=path.join(root,'fake-codex');await fs.writeFile(executable,interrupted?'#!/bin/sh\nkill -TERM $$\n':'#!/bin/sh\necho "Extra warning" >&2\necho "Logged in using ChatGPT" >&2\nexit 0\n',{mode:0o700});
 const launch={...base,executable,env:{...base.env,HOME:root,CODEX_HOME:path.join(root,'config')}};
 const run=()=>withClientGuard(root,'a-setup',guard=>codexAuthStatus(launch,guard));
 await assert.rejects(run(),interrupted?/interrupted/:/Could not verify/);
 const record=path.join(root,'demo/client-guards/a-setup.json');
 if(interrupted){assert.ok(await fs.stat(record));await assert.rejects(run(),/active or uncertain/);}
 else{await assert.rejects(fs.stat(record),{code:'ENOENT'});await assert.rejects(run(),/Could not verify/);await assert.rejects(fs.stat(record),{code:'ENOENT'});}
});
