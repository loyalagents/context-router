import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

for(const mode of ['personal','demo'])for(const available of [false,true])test(`${mode} preparation checks retained assets and creates credentials only for a verified model (${available})`,async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'demo-model-prepare-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await copyFile(new URL('../runtime/prepare.mjs',import.meta.url),path.join(root,'prepare.mjs'));
 await writeFile(path.join(root,'domain.mjs'),'export async function readDemoGeneration(){}');
 await writeFile(path.join(root,'managed.mjs'),`import fs from 'node:fs';import path from 'node:path';
 const events=[];const record=value=>{events.push(value);fs.writeFileSync(new URL('./events.json',import.meta.url),JSON.stringify(events));};
 export async function admit(){return {cap:{storeId:"demo-fixture",installationId:"installation-fixture",mode:${JSON.stringify(mode)},envelope:${JSON.stringify(root)}},session:${JSON.stringify(root)},configuration:{},control:{signal:new AbortController().signal,assertActive(){},async send(type,value){record({type,...value});},async close(){}}};}
 export function backend(){return {async prepareManagedStore(){return {targetId:'fixture'};}};}backend.resolve=()=>new URL('./domain.mjs',import.meta.url).pathname;
 export const nativeOwners={async waitForNativeOwners(){}};
 export function writePrivate(session,name,value){record({name,value});}
 `);
 await writeFile(path.join(root,'model-assets.mjs'),`import fs from 'node:fs';export async function inspectModel(root,signal){if(root!==${JSON.stringify(path.join(root,'models'))}||!(signal instanceof AbortSignal))throw Error();fs.writeFileSync(new URL('./inspected',import.meta.url),'yes');return ${available};}`);
 await writeFile(path.join(root,'certificate.mjs'),`import {randomUUID} from 'node:crypto';export async function generateModelCertificate(){return {certificate:randomUUID(),privateKey:randomUUID(),apiKey:randomUUID()};}`);
 const run=()=>spawnSync(process.execPath,[path.join(root,'prepare.mjs'),'3212'],{env:{},encoding:'utf8',timeout:5000});
 assert.equal(run().status,0);assert.equal(await readFile(path.join(root,'inspected'),'utf8'),'yes');
 const first=JSON.parse(await readFile(path.join(root,'events.json')));
 assert.equal(first.find(e=>e.type==='prepared').modelEnabled,available);
 assert.equal(JSON.parse(first.find(e=>e.name==='session.json').value).modelEnabled,available);
 assert.equal(first.filter(e=>/pem|api-key/.test(e.name)).length,available?3:0);
 if(available){assert.equal(run().status,0);const second=JSON.parse(await readFile(path.join(root,'events.json')));for(const name of ['server-cert.pem','server-key.pem','api-key.txt'])assert.notEqual(first.find(e=>e.name===name).value,second.find(e=>e.name===name).value);}
});

test('retained model inspection refuses absent, short, linked and public assets without changing them',async t=>{
 const {inspectModel,MODEL}=await import('../runtime/model-assets.mjs');
 const {mkdir,chmod,symlink,link,stat}=await import('node:fs/promises');
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'demo-model-assets-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const models=path.join(root,'models'),file=path.join(models,MODEL.name);await mkdir(models,{mode:0o700});
 assert.equal(await inspectModel(models),false);
 await writeFile(file,'owned invalid model',{mode:0o600});assert.equal(await inspectModel(models),false);assert.equal(await readFile(file,'utf8'),'owned invalid model');
 await chmod(file,0o644);assert.equal(await inspectModel(models),false);assert.equal((await stat(file)).mode&0o777,0o644);
 await chmod(file,0o600);await link(file,path.join(root,'linked'));assert.equal(await inspectModel(models),false);assert.equal((await stat(file)).nlink,2);
 await symlink(models,path.join(root,'alias'));assert.equal(await inspectModel(path.join(root,'alias')),false);
});
