import {constants} from 'node:fs';
import {lstat,realpath,open,statfs,link,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {request} from 'node:https';
import path from 'node:path';
const unavailable=()=>new Error('Model download unavailable');
export class DownloadCancelled extends Error {constructor(){super('Model download cancelled');this.name='DownloadCancelled';}}
const pin=s=>({dev:s.dev,ino:s.ino});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
async function directory(root){const s=await lstat(root);if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o7777)!==0o700||await realpath(root)!==root)throw unavailable();return pin(s);}
async function syncDirectory(root){const fd=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
export function validateDownloadUrl(value,asset){
  if(typeof value!=='string'||value.length>8192)throw unavailable();const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||!asset.redirectHosts.includes(url.hostname))throw unavailable();return url;
}
/** One request, no redirects/retries hidden in the transport. TLS uses bundled Node's public CA roots. */
export async function openDownloadResponse(url,signal,connect=request){
  signal.throwIfAborted();let req,body,idle,timerClose;
  let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
  const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>req.destroy(unavailable()),30000);};
  try{
    const response=await new Promise((resolve,reject)=>{
      req=connect(url,{method:'GET',agent:false,signal,rejectUnauthorized:true,headers:{'accept-encoding':'identity'}},res=>{body=res;reset();resolve(res);});
      req.once('close',()=>{clearTimeout(idle);resolveClosed();});req.once('error',reject);reset();req.end();
    });
    const chunks=(async function*(){try{for await(const chunk of response){reset();yield chunk;}}catch(error){signal.throwIfAborted();throw error;}})();
    return {statusCode:response.statusCode,headers:response.headers,body:chunks,close:async()=>{
      response.destroy();req.destroy();await Promise.race([closed,new Promise((_,reject)=>{timerClose=setTimeout(()=>reject(unavailable()),5000);})]).finally(()=>clearTimeout(timerClose));
    }};
  }catch{clearTimeout(idle);body?.destroy();req?.destroy();if(req)await Promise.race([closed,new Promise((_,reject)=>{timerClose=setTimeout(()=>reject(unavailable()),5000);})]).finally(()=>clearTimeout(timerClose));signal.throwIfAborted();throw unavailable();}
}
/** The executable passes the immutable MODEL policy; tiny policies/transports are test dependencies only. */
export async function downloadAsset(options){
  try{return await downloadOperation(options);}catch(error){
    // A cleanup error replaces the abort reason and must never count as cancellation.
    if(options.signal?.aborted&&error===options.signal.reason)throw new DownloadCancelled();throw error;
  }
}
async function downloadOperation({root,generation,asset,signal,onProgress=()=>{},openResponse=openDownloadResponse,
  writeChunk=(fd,...args)=>fd.write(...args),now=()=>performance.now(),assertAccess=()=>{},
  availableBytes=async root=>{const s=await statfs(root,{bigint:true});return s.bavail*s.bsize;}}){
  if(!/^[a-f0-9]{32}$/.test(generation)||!asset||! /^[A-Za-z0-9._-]{1,128}$/.test(asset.name)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||! /^[a-f0-9]{64}$/.test(asset.sha256))throw unavailable();
  const stop=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60*60*1000)]);stop.throwIfAborted();
  const rootPin=await directory(root),destination=path.join(root,asset.name);
  if(await availableBytes(root)<BigInt(asset.bytes)+1024n**3n)throw unavailable();
  try{await lstat(destination);throw unavailable();}catch(error){if(error.code!=='ENOENT')throw error;}
  const stage=path.join(root,`.download-${generation}-${randomBytes(16).toString('hex')}.part`);
  let fd,stagePin,response,published=false;
  const assertRoot=async()=>{stop.throwIfAborted();assertAccess();if(!same(rootPin,await directory(root)))throw unavailable();};
  try{
    await assertRoot();fd=await open(stage,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);stagePin=pin(await fd.stat());
    let url=validateDownloadUrl(asset.url,asset),redirects=0;
    while(true){
      stop.throwIfAborted();assertAccess();response=await openResponse(url,stop);
      if(![301,302,303,307,308].includes(response.statusCode))break;
      const location=response.headers.location;await response.close();response=undefined;
      if(redirects++>=5||typeof location!=='string'||location.length>8192)throw unavailable();url=validateDownloadUrl(new URL(location,url).href,asset);
    }
    if(response.statusCode!==200||(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'))throw unavailable();
    const length=response.headers['content-length'];if(length!==undefined&&(typeof length!=='string'||! /^[1-9][0-9]*$/.test(length)||Number(length)!==asset.bytes))throw unavailable();
    let received=0,lastProgress=-Infinity;const hash=createHash('sha256');
    for await(const chunk of response.body){
      stop.throwIfAborted();assertAccess();const bytes=Buffer.from(chunk);if(received+bytes.length>asset.bytes)throw unavailable();
      let offset=0;while(offset<bytes.length){const {bytesWritten}=await writeChunk(fd,bytes,offset,bytes.length-offset);if(!bytesWritten)throw unavailable();offset+=bytesWritten;}
      hash.update(bytes);received+=bytes.length;
      if(now()-lastProgress>=500){lastProgress=now();await onProgress({received,total:asset.bytes});}
    }
    if(received!==asset.bytes||hash.digest('hex')!==asset.sha256)throw unavailable();
    await fd.sync();await assertRoot();const before=await lstat(stage),held=await fd.stat();
    if(!same(stagePin,before)||!same(stagePin,held)||!before.isFile()||before.nlink!==1||(before.mode&0o7777)!==0o600||before.size!==asset.bytes)throw unavailable();
    await link(stage,destination);published=true;
    const final=await lstat(destination);if(!same(stagePin,final)||final.nlink!==2)throw unavailable();
    await unlink(stage);stagePin=undefined;await syncDirectory(root);
    if(!same(rootPin,await directory(root)))throw unavailable();
    // Completion is a separate terminal protocol event, not an unthrottled progress update.
  }finally{
    try{await response?.close();}finally{try{await fd?.close();}finally{
      if(stagePin){
        // Only this operation's exact stage may be removed. Never sweep unknown residue.
        if(!same(rootPin,await directory(root)))throw unavailable();
        const current=await lstat(stage);if(!same(stagePin,current)||!current.isFile()||current.uid!==process.getuid()||(current.mode&0o7777)!==0o600||current.nlink!==(published?2:1))throw unavailable();
        await unlink(stage);await syncDirectory(root);
      }
    }}
  }
}
