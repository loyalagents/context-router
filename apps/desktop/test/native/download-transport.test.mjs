import assert from 'node:assert/strict';import test from 'node:test';
import {createServer,request} from 'node:https';import {once} from 'node:events';import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import os from 'node:os';
import {generateModelCertificate} from '../../runtime/certificate.mjs';
import {downloadAsset,openDownloadResponse} from '../../runtime/download-engine.mjs';
test('verified TLS transport cancels while awaiting the next body chunk and proves stage cleanup',async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'desktop-download-tls-'))),keys=await generateModelCertificate(),bytes=Buffer.from('tiny verified model transport'),stop=new AbortController();
  const server=createServer({key:keys.privateKey,cert:keys.certificate},(_,res)=>{res.writeHead(200,{'content-length':String(bytes.length)});res.write(bytes.subarray(0,4));});
  let timer;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');let progress=false;
    const operation=downloadAsset({root,generation:'a'.repeat(32),asset:{name:'fixture.gguf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://huggingface.co/immutable',redirectHosts:['huggingface.co']},signal:stop.signal,
      openResponse:(_,signal)=>openDownloadResponse(new URL(`https://127.0.0.1:${server.address().port}/model`),signal,(url,options,callback)=>request(url,{...options,ca:keys.certificate},callback)),
      onProgress:()=>{progress=true;timer=setTimeout(()=>stop.abort(),30);}});
    await assert.rejects(operation,{name:'DownloadCancelled'});assert.equal(progress,true);assert.deepEqual(await readdir(root),[]);
  }finally{clearTimeout(timer);stop.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
