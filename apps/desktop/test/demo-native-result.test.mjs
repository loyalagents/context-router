import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const fallback='Demo command unavailable. Copy current commands from CR → Demo setup; state is retained.';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cr-native-result-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const entry=path.join(root,'desktop/runtime/demo.mjs'),backend=path.join(root,'app/node_modules/backend');
 await fs.mkdir(path.dirname(entry),{recursive:true});await fs.mkdir(path.join(backend,'scripts/demo'),{recursive:true});
 await fs.copyFile(new URL('../runtime/demo.mjs',import.meta.url),entry);await fs.writeFile(path.join(backend,'package.json'),'{}');
 const binding={root:path.join(root,'managed'),store:'a'.repeat(32),generation:'b'.repeat(32),endpoint:'http://127.0.0.1:3213/mcp'};
 return {binding,async helper(body){for(const name of ['installed-clients','installed-desktop'])await fs.writeFile(path.join(backend,`scripts/demo/${name}.mjs`),`const fail=()=>{${body}};export const inspectInstalledClient=fail,prepareInstalledDesktop=fail,applyInstalledDesktop=fail,launchInstalledClient=fail;`);},run(action,native=true){return spawnSync(process.execPath,[entry,...Object.entries(binding).flatMap(([k,v])=>['--'+k,v]),...action,...(native?['--native-result']:[])],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000});}};
}
test('finite native failures return only a safe bound envelope while ordinary CLI stderr is preserved',async t=>{
 const f=await fixture(t),message='Desktop config changed; prepare a new proposal.';
 await f.helper(`throw Object.assign(new Error('private exception'),{demoSafeMessage:${JSON.stringify(message)}});`);
 for(const [action,args] of [['inspect',['client','inspect','--client','codex']],['prepare',['desktop','prepare']],['apply',['desktop','apply','--proposal','/owned/proposal.json','--desktop-closed']]]){
  const r=f.run(args);assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),{version:1,status:'failed',action,binding:f.binding,message});assert.equal(r.stderr,message+'\n');assert.doesNotMatch(r.stdout+r.stderr,/private exception/);
 }
 const cli=f.run(['desktop','prepare'],false);assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.equal(cli.stderr,message+'\n');
});
test('native diagnostics reject unsafe messages and never substitute exception text',async t=>{
 const f=await fixture(t);
 for(const value of [undefined,17,'secret\nline','secret\u001b[31m','secret\u202e','\ud800', 'é'.repeat(401)]){
  await f.helper(`throw Object.assign(new Error('private exception'),{demoSafeMessage:${JSON.stringify(value)??'undefined'}});`);
  const r=f.run(['desktop','prepare']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).message,fallback);assert.equal(r.stderr,fallback+'\n');
 }
 await f.helper(`throw Object.assign(new Error(),{demoSafeMessage:'é'.repeat(400)});`);assert.equal(JSON.parse(f.run(['desktop','prepare']).stdout).message,'é'.repeat(400));
});
test('native-result is restricted to fully classified finite commands and successful payloads remain compatible',async t=>{
 const f=await fixture(t);await f.helper(`return {path:'/native/client',sha256:'c'.repeat(64),version:'0.160.0'};`);
 for(const args of [['status'],['verify'],['login','A'],['launch','B'],['desktop','prepare','--auth','subscription'],['client','inspect','--client','other']]){const r=f.run(args);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,fallback+'\n');}
 const r=f.run(['client','inspect','--client','codex']);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{path:'/native/client',sha256:'c'.repeat(64),version:'0.160.0'});
});
