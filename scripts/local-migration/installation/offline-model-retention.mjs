import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';

const digest=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
/** Caller must already verify the complete pinned old/new artifacts. This uses a
 * second owned envelope, no existing installation. No guardian is started after
 * the real-weight clone is installed; only offline maintenance may execute. */
export async function offlineModelRetention({root,previous,current,source,model}){
 assert.equal(await fs.realpath(source),source);const original=await fs.lstat(source);assert.ok(original.isFile()&&original.nlink===1&&original.size===model.bytes&&original.uid===process.getuid()&&(original.mode&0o777)===0o600);
 const area=path.join(root,'offline-weight-retention');await fs.mkdir(area,{mode:0o700});const envelope=path.join(area,'managed-v1'),old=path.join(previous,'Contents/MacOS/context-router'),next=path.join(current,'Contents/MacOS/context-router');
 const child=spawn(old,['guardian','--root',envelope,'--ui-port','0','--mcp-port','0'],{env:{},stdio:['pipe','pipe','pipe']}),closed=once(child,'close');let pending='',error='',ready=false,finished=false,events=[];
 child.stdin.on('error',()=>{});child.stderr.on('data',bytes=>{error+=bytes;});child.stdout.on('data',bytes=>{pending+=bytes;let at;while((at=pending.indexOf('\n'))>=0){const event=JSON.parse(pending.slice(0,at));pending=pending.slice(at+1);events.push(event);if(event.type==='ready'){assert.equal(event.modelEnabled,false);ready=true;child.stdin.write(JSON.stringify({version:1,generation:event.generation,command:'quit'})+'\n');}}});
 let timer;try{const [code]=await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>{child.stdin.end();reject(new Error('Owned no-weight initialization did not settle; retain fixture'));},60000);})]);assert.equal(code,0,error);assert.equal(ready,true);assert.equal(events.at(-1)?.outcome,'ok');finished=true;}finally{clearTimeout(timer);if(!finished){child.stdin.end();child.unref();}}
 const before=JSON.parse(await fs.readFile(path.join(envelope,'installation.json'))),store=before.selectedStore;
 const target=path.join(envelope,'models',model.name),copy=spawnSync('/bin/cp',['-c',source,target],{env:{},encoding:'utf8',timeout:30000});assert.equal(copy.status,0,copy.stderr);const copied=await fs.lstat(target);assert.equal(copied.nlink,1);assert.equal(copied.size,model.bytes);assert.equal(await digest(target),model.sha256);
 const files=['identity/identity.json','data/database.sqlite'].map(name=>path.join(envelope,'stores',store,name)),pair=await Promise.all(files.map(digest));
 // After this point the only allowed product invocations are offline mcp list.
 for(const executable of [old,next]){const result=spawnSync(executable,['--root',envelope,'mcp','list'],{env:{},encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);}
 const after=JSON.parse(await fs.readFile(path.join(envelope,'installation.json')));assert.equal(after.version,2);assert.equal(after.minimumEpoch,2);assert.equal(after.personalStore,store);assert.deepEqual(await Promise.all(files.map(digest)),pair);assert.equal(await digest(target),model.sha256);
 const still=await fs.lstat(source);for(const key of ['dev','ino','size','mode','uid','nlink','mtimeMs','ctimeMs'])assert.equal(still[key],original[key]);
 return{status:'passed',root:area,weightBytes:model.bytes,weightSha256:model.sha256,personalStore:store,ownership:{pid:child.pid,exitCode:child.exitCode},scope:'Verified owned clone survives offline epoch metadata upgrade unchanged. No guardian, model process or inference ran after the clone was installed.'};
}
