// Test tooling only: byte identity supplied by the reviewer/caller is separate
// from a self-consistent ad-hoc signature. Never execute bundle code here.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {MANIFEST_PATH,sealedByteReceipt,verifyPackage} from '../../../apps/desktop/src/package-manifest.mjs';
import {verifyLegacyPackage} from '../../../apps/desktop/src/legacy-package-manifest.mjs';
const fail=()=>{throw new Error('Pinned artifact verification failed');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
async function readBounded(file){
  const before=await lstat(file);
  if(!before.isFile()||before.nlink!==1||(before.mode&0o022)||before.size<1||before.size>32*1024**2)fail();
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),bytes=Buffer.alloc(before.size);
  try{
    if(!same(before,await fd.stat()))fail();
    let position=0;
    while(position<bytes.length){const {bytesRead}=await fd.read(bytes,position,bytes.length-position,position);if(!bytesRead)fail();position+=bytesRead;}
    if(!same(before,await fd.stat())||!same(before,await lstat(file)))fail();
  }finally{await fd.close();}
  return{bytes,stat:before};
}
function sameReceipt(actual,expected){
  if(!expected||Object.keys(expected).sort().join(',')!=='files,version'||expected.version!==1||
    JSON.stringify(actual.files)!==JSON.stringify(expected.files))fail();
}
export function assertLegacyLiveManifest(bytes){
  if(JSON.parse(bytes).version!==1)throw new Error('Legacy live proposal requires manifest v1; v2 needs separately approved final-byte pins');
}
/** The named source itself is the trust anchor for opt-in local-build smoke. */
export async function captureTrustedArtifact(bundle){
  const {bytes,stat}=await readBounded(path.join(bundle,MANIFEST_PATH)),manifest=JSON.parse(bytes);
  if(manifest.version===1){
    await verifyLegacyPackage(bundle,hash(bytes));
    return{version:1,files:[...manifest.files,{path:MANIFEST_PATH,kind:'file',size:bytes.length,sha256:hash(bytes),executable:!!(stat.mode&0o111)}].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
  }
  await verifyPackage(bundle,manifest);
  return{version:1,files:await sealedByteReceipt(bundle)};
}
export async function verifyCapturedArtifact(bundle,expected){
  sameReceipt(await captureTrustedArtifact(bundle),expected);
}
/** v2 must include an external receipt and its independently supplied raw digest. */
export async function verifyPinnedArtifact(bundle,{manifestSha256,sealedPayload,sealedPayloadSha256}={}){
  if(!digest(manifestSha256))fail();
  const {bytes}=await readBounded(path.join(bundle,MANIFEST_PATH));
  if(hash(bytes)!==manifestSha256)fail();
  const manifest=JSON.parse(bytes);
  if(manifest.version===1){
    if(sealedPayload!==undefined||sealedPayloadSha256!==undefined)fail();
    return await verifyLegacyPackage(bundle,manifestSha256);
  }
  if(manifest.version!==2||typeof sealedPayload!=='string'||!path.isAbsolute(sealedPayload)||
    await realpath(sealedPayload)!==sealedPayload||!digest(sealedPayloadSha256))fail();
  const canonicalBundle=await realpath(bundle);
  if(sealedPayload.startsWith(canonicalBundle+path.sep))fail();
  const external=await readBounded(sealedPayload);
  if(hash(external.bytes)!==sealedPayloadSha256)fail();
  const expected=JSON.parse(external.bytes);
  sameReceipt({version:1,files:await sealedByteReceipt(bundle)},expected);
  await verifyPackage(bundle,manifest);
  return manifest;
}
