import assert from 'node:assert/strict';import test from 'node:test';
import {mkdtemp,realpath,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';import {createHash} from 'node:crypto';import path from 'node:path';import os from 'node:os';
import {downloadAsset,validateDownloadUrl} from '../runtime/download-engine.mjs';
import {MODEL} from '../runtime/model-assets.mjs';
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
for(const corrupt of [false,true])test(`production host policy follows the documented CDN redirect and verifies bytes (corrupt=${corrupt})`,async t=>{
  const root=await fixture(t),requested=[],closed=[];
  // Retain the shipped source URL and host policy; substitute only tiny fixture identity.
  const policy={...MODEL,name:asset.name,bytes:asset.bytes,sha256:asset.sha256};
  const target='https://us.aws.cdn.hf.co/model?public-signed-query=fixture';
  const operation=downloadAsset({root,generation:'a'.repeat(32),asset:policy,openResponse:async url=>{
    requested.push(url.href);
    if(requested.length===1)return {statusCode:302,headers:{location:target},body:Readable.from([]),close:async()=>{closed.push('redirect');}};
    assert.deepEqual(closed,['redirect']);
    return {...response(corrupt?Buffer.from('x'.repeat(bytes.length)):bytes),close:async()=>{closed.push('body');}};
  }});
  if(corrupt)await assert.rejects(operation,/Model download unavailable/);else await operation;
  assert.deepEqual(requested,[MODEL.url,target]);assert.deepEqual(closed,['redirect','body']);
  assert.deepEqual(await readdir(root),corrupt?[]:[asset.name]);
  if(!corrupt)assert.deepEqual(await readFile(path.join(root,asset.name)),bytes);
});
test('production CDN policy rejects unsafe redirects before contacting their destinations',async t=>{
  const root=await fixture(t),policy={...MODEL,name:asset.name,bytes:asset.bytes,sha256:asset.sha256};
  for(const target of [
    'https://us.aws.cdn.hf.co.evil.test/model','https://nested.us.aws.cdn.hf.co/model',
    'https://us-aws.cdn.hf.co/model','https://example.test/model',
    'http://us.aws.cdn.hf.co/model','https://u:p@us.aws.cdn.hf.co/model',
    'https://us.aws.cdn.hf.co:444/model','https://us.aws.cdn.hf.co/model#fragment'
  ]){
    const requested=[];let closed=false;
    await assert.rejects(downloadAsset({root,generation:'a'.repeat(32),asset:policy,openResponse:async url=>{
      requested.push(url.href);
      return {statusCode:302,headers:{location:target},body:Readable.from([]),close:async()=>{closed=true;}};
    }}),/Model download unavailable/);
    assert.deepEqual(requested,[MODEL.url],target);assert.equal(closed,true);assert.deepEqual(await readdir(root),[]);
  }
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
