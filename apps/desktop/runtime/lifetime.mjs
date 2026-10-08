import {constants,lstatSync,realpathSync,fstatSync,openSync,closeSync,readSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const fail=()=>{throw new Error('Managed lifetime unavailable');};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const matches=(value,pattern)=>typeof value==='string'&&pattern.test(value);
export function validateDownloadMetadata(j,m,generation,boot){
  if(!exact(m,['version','installationId','selectedStore','minimumEpoch','setup','pendingRestore'])||
    !exact(j,['version','lifecycle','outcome','generation','bootId','installationId','storeId','role','operation','nonceHash'])||
    !matches(generation,/^[a-f0-9]{32}$/)||!matches(boot,/^[A-Za-z0-9-]{1,64}$/)||
    !matches(m.installationId,/^[a-f0-9]{32}$/)||!matches(m.selectedStore,/^[a-f0-9]{32}$/)||!matches(j.nonceHash,/^[a-f0-9]{64}$/)||
    j.version!==1||j.lifecycle!=='active'||j.outcome!=='pending'||j.generation!==generation||j.bootId!==boot||j.role!=='application'||j.operation!=='serve'||j.installationId!==m.installationId||j.storeId!==m.selectedStore||m.version!==1||m.minimumEpoch!==1||m.setup!=='ready'||m.pendingRestore!==null)fail();
}
function pinned(file,directory){const s=lstatSync(file);if(s.uid!==process.getuid()||(s.mode&0o7777)!==(directory?0o700:0o600)||(directory?!s.isDirectory():!s.isFile()||s.nlink!==1)||realpathSync(file)!==file)fail();return s;}
function json(file){
  const before=pinned(file,false);if(before.size<2||before.size>16384)fail();
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const opened=fstatSync(fd),bytes=Buffer.alloc(before.size+1),count=readSync(fd,bytes,0,bytes.length,0),after=pinned(file,false);
    if(count!==before.size||[opened,after].some(s=>!same(before,s)||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs))fail();return {value:JSON.parse(bytes.subarray(0,count).toString('utf8')),pin:before};
  }finally{closeSync(fd);}
}
/** Downloader has lifetime/model-write authority only; it never consumes storage FD4. */
export function admitDownloadLifetime(models,generation){
  if(typeof models!=='string'||path.resolve(models)!==models||path.basename(models)!=='models'||path.basename(path.dirname(models))!=='managed-v1'||! /^[a-f0-9]{32}$/.test(generation))fail();
  const envelope=path.dirname(models),rootPin=pinned(envelope,true),modelsPin=pinned(models,true),lock=path.join(envelope,'owner.lock'),lockPin=pinned(lock,false);
  if(!same(fstatSync(3),lockPin))fail();
  const guardian=path.resolve(import.meta.dirname,'../../../MacOS/context-router');
  const boot=execFileSync(guardian,['verify-inherited'],{env:{},stdio:['ignore','pipe','ignore',3],encoding:'utf8',timeout:2000,maxBuffer:1024}).trim();
  const original=json(path.join(envelope,'owner.json')),installation=json(path.join(envelope,'installation.json'));
  const assertHeld=()=>{
    if(!same(rootPin,pinned(envelope,true))||!same(modelsPin,pinned(models,true))||!same(lockPin,pinned(lock,false))||!same(lockPin,fstatSync(3)))fail();
    const current=json(path.join(envelope,'owner.json')),manifest=json(path.join(envelope,'installation.json')),j=current.value,m=manifest.value;
    if(!same(original.pin,current.pin)||!same(installation.pin,manifest.pin)||JSON.stringify(j)!==JSON.stringify(original.value)||JSON.stringify(m)!==JSON.stringify(installation.value))fail();
    validateDownloadMetadata(j,m,generation,boot);
  };
  assertHeld();return {assertHeld};
}
