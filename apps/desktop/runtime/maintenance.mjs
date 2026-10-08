import path from 'node:path';
import {admit,backend,authority,nativeOwners} from './managed.mjs';
let control,exitCode=1;
try{
  const state=await admit('maintenance');control=state.control;
  const [group,...args]=process.argv.slice(2),operation=state.cap.operation;
  process.env.LOCAL_DATABASE_ROOT=state.configuration.databaseRoot;process.env.LOCAL_IDENTITY_STATE_ROOT=state.configuration.stateRoot;
  if(group==='mcp'&&operation==='admin'&&['list','provision','rotate','revoke','permissions','grant','upgrade'].includes(args[0])){
    exitCode=await backend('backend/dist/local-mcp.js').runLocalMcp(args);
  }else if(group==='identity'&&args.length===1&&((operation==='admin'&&args[0]==='rotate')||
    (operation==='recover-identity'&&['recover-initialize','recover-rotation'].includes(args[0]))||
    (operation==='recover-bootstrap'&&args[0]==='recover-database-bootstrap'))){
    exitCode=await backend('backend/dist/modules/auth/local-identity-admin.cli.js').runLocalDatabaseAdminCli({argv:args});
  }else if(group==='backup'&&args.length===0&&operation==='backup'){
    exitCode=await backend('backend/dist/local-mcp.js').runLocalMcp(['backup','--out',state.exports]);
  }else if(group==='restore'&&args.length===2&&args[0]==='--from'&&operation==='restore'){
    exitCode=await backend('backend/dist/local-mcp.js').runLocalMcp(['restore','--from',args[1],'--out',path.join(state.cap.envelope,'stores',state.cap.storeId)]);
  }else if(group==='verify-pending'&&args.length===0&&operation==='admin'){
    const {database,service}=backend('backend/dist/infrastructure/storage/sqlite/sqlite-local-runtime.js').createSqliteIdentityRuntime(state.configuration);
    const ready=await service.verifyReadyState();new(backend('backend/dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js').SqliteMcpCredentials)(database,ready.state.principalId).list();exitCode=0;
  }else if(group==='inspect'&&args.length===1&&/^[A-Za-z0-9_-]{22}$/.test(args[0])&&operation==='admin'){
    const {database,service}=backend('backend/dist/infrastructure/storage/sqlite/sqlite-local-runtime.js').createSqliteIdentityRuntime(state.configuration);
    const ready=await service.verifyReadyState();const snapshot=new(backend('backend/dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js').SqliteMcpCredentials)(database,ready.state.principalId).inspectForUi(args[0]);
    if(snapshot.status!=='AVAILABLE')throw new Error();process.stdout.write(JSON.stringify(snapshot)+'\n');exitCode=0;
  }else exitCode=2;
  control.assertActive();
}catch{exitCode=1;}
finally{
  authority.revokeManagedAdmission();await nativeOwners.waitForNativeOwners();
  try{if(!control||control.failed||(control.signal.aborted&&!control.quitRequested))throw new Error();
    if(control.signal.aborted)exitCode=1;await control.send('maintenance-complete',{exitCode});}catch{exitCode=1;}
  await control?.close().catch(()=>{exitCode=1;});process.exitCode=exitCode;
}
