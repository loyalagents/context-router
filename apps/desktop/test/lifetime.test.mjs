import assert from 'node:assert/strict';import test from 'node:test';
import * as lifetime from '../runtime/lifetime.mjs';
const generation='a'.repeat(32),boot='fixture-boot';
const manifest=()=>({version:1,installationId:'b'.repeat(32),selectedStore:'c'.repeat(32),minimumEpoch:1,setup:'ready',pendingRestore:null});
const journal=()=>({version:1,lifecycle:'active',outcome:'pending',generation,bootId:boot,installationId:'b'.repeat(32),storeId:'c'.repeat(32),role:'application',operation:'serve',nonceHash:'d'.repeat(64)});
test('downloader lifetime requires exact complete active application metadata',()=>{assert.doesNotThrow(()=>lifetime.validateDownloadMetadata(journal(),manifest(),generation,boot));});
for(const variant of ['installation-id','store-id','nonce','extra-journal','extra-installation','invalid-id','pending','wrong-generation'])test(`downloader rejects ${variant}`,()=>{
  const j=journal(),m=manifest();
  if(variant==='installation-id'){delete j.installationId;delete m.installationId;}
  if(variant==='store-id'){delete j.storeId;delete m.selectedStore;}
  if(variant==='nonce')delete j.nonceHash;
  if(variant==='extra-journal')j.extra=true;
  if(variant==='extra-installation')m.extra=true;
  if(variant==='invalid-id'){j.installationId='x';m.installationId='x';}
  if(variant==='pending')m.pendingRestore={};
  if(variant==='wrong-generation')j.generation='e'.repeat(32);
  assert.throws(()=>lifetime.validateDownloadMetadata(j,m,generation,boot),{message:'Managed lifetime unavailable'});
});
