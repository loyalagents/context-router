import path from 'node:path';
import { admit, backend, nativeOwners, writePrivate } from './managed.mjs';
import { generateModelCertificate } from './certificate.mjs';
import { inspectModel } from './model-assets.mjs';
let control;
try {
  const port=process.argv[2];
  if(process.argv.length!==3||! /^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw new Error();
  const state=await admit('prepare');control=state.control;
  const prepared=await backend('backend/dist/infrastructure/managed/managed-prepare.js').prepareManagedStore();
  control.assertActive();
  const modelEnabled=await inspectModel(path.join(state.cap.envelope,'models'),control.signal);
  control.assertActive();
  if(modelEnabled){
    const keys=await generateModelCertificate();control.assertActive();
    for(const [name,value] of [['server-cert.pem',keys.certificate],['server-key.pem',keys.privateKey],['api-key.txt',keys.apiKey+'\n']])writePrivate(state.session,name,value);
  }
  writePrivate(state.session,'session.json',JSON.stringify({version:1,modelEnabled,port:Number(port)}));
  await nativeOwners.waitForNativeOwners();control.assertActive();
  await control.send('prepared',{targetId:prepared.targetId,modelEnabled,modelPort:Number(port)});
}catch{process.exitCode=1;try{await control?.send('failed',{category:'prepare-failed'});}catch{}}
finally{await nativeOwners.waitForNativeOwners();await control?.close().catch(()=>{process.exitCode=1;});}
