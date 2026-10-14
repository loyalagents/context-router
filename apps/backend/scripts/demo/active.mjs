import path from 'node:path';
import net from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { privateJson, privatePath, safeError } from './files.mjs';
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const exact = (value, keys) => value && Object.keys(value).sort().join() === [...keys].sort().join();
const failure = () => safeError('This demo command is stale or the native demo runtime is unavailable. Open CR → Demo setup for current commands.');
export async function activeDemo(spec) {
  const {root,store,generation,endpoint}=spec;
  if(!id(store)||!id(generation)||typeof endpoint!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/mcp$/.test(endpoint)||Number(new URL(endpoint).port)>65535||path.basename(root)!=='managed-v1')throw failure();
  await privatePath(root,true);await privatePath(path.join(root,'sessions'),true);await privatePath(path.join(root,'sessions',generation),true);
  const metadata=await privateJson(path.join(root,'installation.json')),journal=await privateJson(path.join(root,'owner.json'));
  if(metadata.version!==2||metadata.minimumEpoch!==2||metadata.setup!=='ready'||metadata.mode!=='demo'||metadata.demoStore!==store||metadata.selectedStore!==store||metadata.pendingDemo!==null||metadata.pendingRestore!==null||
     journal.version!==2||journal.lifecycle!=='active'||journal.outcome!=='pending'||journal.mode!=='demo'||journal.role!=='application'||journal.operation!=='serve'||journal.storeId!==store||journal.generation!==generation||journal.installationId!==metadata.installationId)throw failure();
  const receipt=await privateJson(path.join(root,'sessions',generation,'demo-connection.json'));
  if(!exact(receipt,['version','installationId','storeId','generation','endpoint','probePort','challenge'])||receipt.version!==1||receipt.installationId!==metadata.installationId||receipt.storeId!==store||receipt.generation!==generation||receipt.endpoint!==endpoint||!Number.isInteger(receipt.probePort)||receipt.probePort<1||receipt.probePort>65535||!/^[a-f0-9]{64}$/.test(receipt.challenge))throw failure();
  const response=await new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port:receipt.probePort}),chunks=[];let count=0;
    socket.setTimeout(1500,()=>socket.destroy(failure()));
    socket.once('connect',()=>socket.end(receipt.challenge+'\n'));
    socket.on('data',bytes=>{count+=bytes.length;if(count>2048)socket.destroy(failure());else chunks.push(bytes);});
    socket.once('error',()=>reject(failure()));socket.once('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(failure());}});
  });
  if(!isDeepStrictEqual(response,receipt)||!isDeepStrictEqual(metadata,await privateJson(path.join(root,'installation.json')))||!isDeepStrictEqual(journal,await privateJson(path.join(root,'owner.json'))))throw failure();
  return receipt;
}
