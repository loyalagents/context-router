import test from 'node:test';import assert from 'node:assert/strict';
import {clientLaunchSpec} from '../../backend/scripts/demo/clients.mjs';
import {codexCodingLaunchSpec,parseCodexAuthStatus,codexLoginSpec,validateCodexProject} from '../../backend/scripts/demo/codex-connect.mjs';
const base=clientLaunchSpec({command:'codex',agent:'a',root:'/demo',dataset:'demo001',mcpPort:8790},{executable:'/native/codex'});
test('Codex coding enables real tools and project instructions with ordinary approvals and isolated MCP/profile',()=>{
 const next=codexCodingLaunchSpec(base,'/project');
 assert.equal(next.cwd,'/project');assert.equal(next.env.CODEX_HOME,base.env.CODEX_HOME);assert.equal(next.args[next.args.indexOf('--sandbox')+1],'workspace-write');assert.equal(next.args[next.args.indexOf('--ask-for-approval')+1],'on-request');
 for(const feature of ['shell_tool','unified_exec','view_image'])assert.ok(next.args.includes(`features.${feature}=true`));
 assert.ok(next.args.includes('project_doc_max_bytes=32768'));assert.ok(next.args.includes('mcp_servers.context_router_demo.tools.mutatePreferences.approval_mode="prompt"'));assert.ok(next.args.includes('--strict-config'));assert.ok(next.args.includes('--no-daemon'));
 assert.ok(base.args.includes('features.shell_tool=false'));assert.ok(!next.args.includes('danger-full-access'));assert.ok(!next.args.includes('--dangerously-bypass-approvals-and-sandbox'));
 assert.ok(next.args.includes('project_root_markers=[]'));
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
