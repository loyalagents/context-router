import {openManagedControl} from './control.mjs';
import {admitDownloadLifetime} from './lifetime.mjs';
import {downloadAsset,DownloadCancelled} from './download-engine.mjs';
import {MODEL} from './model-assets.mjs';
let control;const stop=new AbortController();
try{
  if(process.argv.length!==4)throw new Error();const [root,generation]=process.argv.slice(2);
  const lifetime=admitDownloadLifetime(root,generation);
  control=await openManagedControl(generation,{onStop:()=>stop.abort(),onCommand:command=>{if(command!=='quit')control.fail();}});
  for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>control.end());
  await downloadAsset({root,generation,asset:MODEL,signal:stop.signal,assertAccess:()=>{control.assertActive();lifetime.assertHeld();},
    onProgress:progress=>control.send('download-progress',progress)});
  control.assertActive();lifetime.assertHeld();await control.send('download-complete');
}catch(error){
  const cancelled=error instanceof DownloadCancelled&&stop.signal.aborted&&!control?.failed;process.exitCode=cancelled?0:1;
  try{await control?.send(cancelled?'download-cancelled':'download-failed');}catch{process.exitCode=1;}
}finally{stop.abort();await control?.close().catch(()=>{process.exitCode=1;});}
