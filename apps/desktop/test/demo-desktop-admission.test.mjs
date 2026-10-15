import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createHash} from 'node:crypto';
import * as admission from '../../backend/scripts/demo/active.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const top=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cr-desktop-admission-'))),root=path.join(top,'managed-v1'),installationId='a'.repeat(32),store='b'.repeat(32),generation='c'.repeat(32),clientId='C'.repeat(22),credential='cr_mcp_'+clientId+'.'+'T'.repeat(43);
 await fs.mkdir(root,{mode:0o700});for(const directory of ['sessions','sessions/'+generation,'demo','demo/'+store,'demo/'+store+'/exports'])await fs.mkdir(path.join(root,directory),{mode:0o700});
 const write=(file,value)=>fs.writeFile(path.join(root,file),JSON.stringify(value),{mode:0o600});
 const metadata={version:2,minimumEpoch:2,installationId,setup:'ready',mode:'demo',demoStore:store,selectedStore:store,pendingDemo:null,pendingRestore:null},journal={version:2,lifecycle:'active',outcome:'pending',mode:'demo',role:'application',operation:'serve',storeId:store,generation,installationId};
 let duringProbe=async()=>{};const server=net.createServer({allowHalfOpen:true},socket=>{let bytes='';socket.on('data',chunk=>bytes+=chunk);socket.on('end',async()=>{assert.equal(bytes,receipt.challenge+'\n');await duringProbe();socket.end(JSON.stringify(receipt));});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:3213/mcp',receipt={version:1,installationId,storeId:store,generation,endpoint,probePort:server.address().port,challenge:'d'.repeat(64)};
 const credentialFile=path.join(root,'demo',store,'exports/agent-c.token'),spec={root,installationId,store,endpoint,clientId,credentialFile,credentialSha256:hash(credential)};
 await fs.writeFile(credentialFile,credential,{mode:0o600});await write('installation.json',metadata);await write('owner.json',journal);await write('sessions/'+generation+'/demo-connection.json',receipt);await write('demo/'+store+'/generation.json',{status:'complete',installationId,storeId:store,clients:{agentC:clientId}});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(top,{recursive:true,force:true});});
 return{spec,metadata,journal,receipt,write,duringProbe:action=>duringProbe=action};
}
test('C admission follows only a new active generation of its pinned installation/store/endpoint',async t=>{
 const f=await fixture(t);assert.equal((await admission.activeDesktop(f.spec)).generation,f.journal.generation);
 const old=f.journal.generation,next='e'.repeat(32);await fs.mkdir(path.join(f.spec.root,'sessions',next),{mode:0o700});f.journal.generation=next;f.receipt.generation=next;await f.write('owner.json',f.journal);await f.write('sessions/'+next+'/demo-connection.json',f.receipt);
 assert.equal((await admission.activeDesktop(f.spec)).generation,next);await assert.rejects(admission.activeDemo({root:f.spec.root,store:f.spec.store,endpoint:f.spec.endpoint,generation:old}));
});
test('C admission refuses installation, store, endpoint and credential substitution',async t=>{
 const f=await fixture(t);for(const wrong of [{installationId:'f'.repeat(32)},{store:'f'.repeat(32)},{endpoint:'http://127.0.0.1:3222/mcp'},{clientId:'X'.repeat(22)},{credentialFile:path.join(f.spec.root,'other.token')},{credentialSha256:'0'.repeat(64)}])await assert.rejects(admission.activeDesktop({...f.spec,...wrong}));
 await fs.writeFile(f.spec.credentialFile,'cr_mcp_'+f.spec.clientId+'.'+'U'.repeat(43));await assert.rejects(admission.activeDesktop(f.spec));
});
test('C admission refuses inactive, pending, personal and reset metadata',async t=>{
 const f=await fixture(t);for(const change of [{pendingDemo:{}},{pendingRestore:{}},{mode:'personal'},{demoStore:'f'.repeat(32)},{selectedStore:'f'.repeat(32)}]){await f.write('installation.json',{...f.metadata,...change});await assert.rejects(admission.activeDesktop(f.spec));}await f.write('installation.json',f.metadata);
 for(const change of [{lifecycle:'quiescent'},{outcome:'uncertain'},{role:'prepare'},{mode:'personal'}]){await f.write('owner.json',{...f.journal,...change});await assert.rejects(admission.activeDesktop(f.spec));}
});
test('C admission detects metadata, native receipt and credential changes during its probe',async t=>{
 for(const kind of ['metadata','owner','receipt','credential']){const f=await fixture(t);f.duringProbe(async()=>{if(kind==='metadata')await f.write('installation.json',{...f.metadata,pendingDemo:{}});else if(kind==='owner')await f.write('owner.json',{...f.journal,generation:'f'.repeat(32)});else if(kind==='receipt')f.receipt.challenge='e'.repeat(64);else await fs.writeFile(f.spec.credentialFile,'cr_mcp_'+f.spec.clientId+'.'+'U'.repeat(43));});await assert.rejects(admission.activeDesktop(f.spec));}
});
