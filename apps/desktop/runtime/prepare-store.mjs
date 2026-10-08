import {admit,backend,authority,nativeOwners} from './managed.mjs';
let control,prepared;
try{
  if(process.argv.length!==2)throw new Error();const state=await admit('prepare');control=state.control;
  prepared=await backend('backend/dist/infrastructure/managed/managed-prepare.js').prepareManagedStore();control.assertActive();
}catch{process.exitCode=1;}
finally{
  authority.revokeManagedAdmission();await nativeOwners.waitForNativeOwners();
  try{
    if(!control||control.failed||control.signal.aborted)throw new Error();
    if(prepared)await control.send('store-prepared',{targetId:prepared.targetId});
    else await control.send('store-prepare-failed',{exitCode:1});
  }catch{process.exitCode=1;}
  await control?.close().catch(()=>{process.exitCode=1;});
}
