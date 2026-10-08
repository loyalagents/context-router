import assert from 'node:assert/strict';import test from 'node:test';
import {mkdtemp,realpath,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';import {createHash} from 'node:crypto';import path from 'node:path';import os from 'node:os';
import {downloadAsset,validateDownloadUrl} from '../runtime/download-engine.mjs';
const bytes=Buffer.from('pinned tiny model fixture'),sha256=createHash('sha256').update(bytes).digest('hex');
const asset={name:'fixture.gguf',bytes:bytes.length,sha256,url:'https://huggingface.co/immutable',redirectHosts:['huggingface.co','cdn-lfs.huggingface.co']};
async function fixture(t){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'desktop-download-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const response=(value=bytes,headers={'content-length':String(value.length)})=>({statusCode:200,headers,body:Readable.from([value]),close:async()=>{}});
test('download publishes verified bytes exclusively and removes its owned staging file',async t=>{
  const root=await fixture(t),progress=[];await downloadAsset({root,generation:'a'.repeat(32),asset,openResponse:async()=>response(),onProgress:value=>progress.push(value)});
  assert.deepEqual(await readFile(path.join(root,asset.name)),bytes);assert.deepEqual(await readdir(root),[asset.name]);assert.equal(progress.at(-1).received,bytes.length);
});
for(const variant of ['digest','length','overflow','encoding','redirect','redirect-limit','existing','cancel','space'])test(`download ${variant} fails without replacing prior files or leaving owned staging`,async t=>{
  const root=await fixture(t),abort=new AbortController();let requests=0;
  if(variant==='existing')await writeFile(path.join(root,asset.name),'retained',{mode:0o600});
  const openResponse=async()=>{requests++;if(variant==='cancel'){abort.abort();return response();}if(variant.startsWith('redirect'))return {statusCode:302,headers:{location:variant==='redirect'?'https://example.test/untrusted':asset.url},body:Readable.from([]),close:async()=>{}};
    if(variant==='digest')return response(Buffer.from('x'.repeat(bytes.length)));
    if(variant==='length')return response(bytes,{'content-length':'1'});
    if(variant==='overflow')return response(Buffer.concat([bytes,Buffer.from('extra')]),{});
    if(variant==='encoding')return response(bytes,{'content-encoding':'gzip'});return response();};
  await assert.rejects(downloadAsset({root,generation:'a'.repeat(32),asset,signal:abort.signal,openResponse,availableBytes:variant==='space'?async()=>0n:undefined,onProgress:()=>{}}));
  assert.deepEqual(await readdir(root),variant==='existing'?[asset.name]:[]);
  if(variant==='existing')assert.equal(await readFile(path.join(root,asset.name),'utf8'),'retained');
  if(variant==='redirect-limit')assert.equal(requests,6);
});
test('download URL policy rejects credentials, non-HTTPS, ports and unknown hosts',()=>{
  for(const url of ['http://huggingface.co/a','https://u:p@huggingface.co/a','https://huggingface.co:444/a','https://example.test/a','https://huggingface.co/a#secret'])assert.throws(()=>validateDownloadUrl(url,asset));
});
test('mid-write ENOSPC removes only the owned partial download',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'retained'),'unrelated',{mode:0o600});let writes=0;
  await assert.rejects(downloadAsset({root,generation:'a'.repeat(32),asset,openResponse:async()=>({...response(),body:Readable.from([bytes.subarray(0,8),bytes.subarray(8)])}),
    writeChunk:async(fd,...args)=>{if(writes++)throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return fd.write(...args);}}),{code:'ENOSPC'});
  assert.equal(writes,2);assert.deepEqual(await readdir(root),['retained']);assert.equal(await readFile(path.join(root,'retained'),'utf8'),'unrelated');
});
test('completion does not emit an extra progress callback inside the half-second interval',async t=>{
  const root=await fixture(t),times=[0,500,510],observed=[];let clock=0,index=0;
  await downloadAsset({root,generation:'a'.repeat(32),asset,openResponse:async()=>({...response(),body:Readable.from([bytes.subarray(0,8),bytes.subarray(8,16),bytes.subarray(16)])}),
    now:()=>clock,writeChunk:async(fd,...args)=>{clock=times[index++];return fd.write(...args);},onProgress:()=>observed.push(clock)});
  assert.deepEqual(observed,[0,500]);
});
for(const replace of [false,true])test(`cancellation reports clean only after exact owned stage cleanup (replaced=${replace})`,async t=>{
  const root=await fixture(t),stop=new AbortController();
  await assert.rejects(downloadAsset({root,generation:'a'.repeat(32),asset,signal:stop.signal,openResponse:async()=>{
    if(replace){const [stage]=await readdir(root);await rename(path.join(root,stage),path.join(root,'retained-original'));await writeFile(path.join(root,stage),'retained-replacement',{mode:0o600});}
    stop.abort();return response();
  }}),error=>replace?error.name!=='DownloadCancelled':error.name==='DownloadCancelled');
  const files=await readdir(root);if(replace){assert.equal(files.length,2);assert.equal(await readFile(path.join(root,files.find(name=>name.startsWith('.download-'))),'utf8'),'retained-replacement');}else assert.deepEqual(files,[]);
});
