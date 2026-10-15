import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
const resources=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(resources,'app/local-ui.mjs'));
try{
  const {values,positionals}=parseArgs({strict:true,allowPositionals:true,options:{root:{type:'string'},store:{type:'string'},generation:{type:'string'},endpoint:{type:'string'},client:{type:'string'},auth:{type:'string'},executable:{type:'string'},config:{type:'string'},proposal:{type:'string'},'desktop-closed':{type:'boolean'}}});
  if(['root','store','generation','endpoint'].some(key=>!values[key])||process.versions.node!=='24.21.0')throw new Error();
  const spec={root:values.root,store:values.store,generation:values.generation,endpoint:values.endpoint};
  const [command,role]=positionals;
  if(command==='verify'&&positionals.length===1&&Object.keys(values).length===4){
    const result=spawnSync(path.resolve(resources,'../MacOS/context-router'),['--root',spec.root,'--mode','demo','verify-demo',spec.store],{env:{},stdio:['inherit','inherit','inherit']});
    process.exitCode=result.error?1:result.status??1;
  }else if(command==='status'&&positionals.length===1&&Object.keys(values).length===4){
    const {activeDemo}=await import(require.resolve('backend/scripts/demo/active.mjs'));
    const {privateJson}=await import(require.resolve('backend/scripts/demo/files.mjs'));
    const active=await activeDemo(spec),receipt=await privateJson(path.join(spec.root,'demo',spec.store,'generation.json'));
    if(receipt.installationId!==active.installationId||receipt.storeId!==spec.store||receipt.status!=='complete')throw new Error();
    console.log(JSON.stringify({status:'running',mode:'demo',store:spec.store,generation:spec.generation,endpoint:spec.endpoint,seed:receipt.seedVersion,clients:receipt.clients,observation:'Native readiness and seed receipts only; current content and grants may contain presenter edits. Quit the app before offline verify.'},null,2));
  }else if(['login','launch'].includes(command)&&positionals.length===2&&['A','B'].includes(role)&&Object.keys(values).every(key=>['root','store','generation','endpoint','client','executable','auth'].includes(key))){
    const {launchInstalledClient}=await import(require.resolve('backend/scripts/demo/installed-clients.mjs'));
    process.exitCode=await launchInstalledClient(spec,{role:role.toLowerCase(),command:values.client??'codex',login:command==='login',executable:values.executable,auth:values.auth});
  }else if(command==='desktop'&&positionals.length===2&&['prepare','apply'].includes(role)){
    const {prepareInstalledDesktop,applyInstalledDesktop}=await import(require.resolve('backend/scripts/demo/installed-desktop.mjs'));
    let result;
    if(role==='prepare'&&Object.keys(values).every(key=>['root','store','generation','endpoint','config'].includes(key)))result=await prepareInstalledDesktop({...spec,config:values.config});
    else if(role==='apply'&&Object.keys(values).every(key=>['root','store','generation','endpoint','proposal','desktop-closed'].includes(key))&&values.proposal)result=await applyInstalledDesktop({...spec,proposal:values.proposal,desktopClosed:values['desktop-closed']});
    else throw new Error();
    if(role==='prepare'){const quote=value=>"'"+String(value).replaceAll("'","'\"'\"'")+"'";result.applyCommand=[path.resolve(resources,'../MacOS/context-router'),'demo','--root',spec.root,'--store',spec.store,'--generation',spec.generation,'--endpoint',spec.endpoint,'desktop','apply','--proposal',result.proposal,'--desktop-closed'].map(quote).join(' ');}
    console.log(JSON.stringify(result,null,2));
  }else throw new Error();
}catch(error){process.stderr.write((error?.demoSafeMessage??'Demo command unavailable. Copy current commands from CR → Demo setup; state is retained.')+'\n');process.exitCode=1;}
