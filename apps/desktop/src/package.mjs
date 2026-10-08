// Local-candidate packaging only. Publisher signing/notarization is deliberately separate.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,cp,readFile,writeFile,realpath,lstat,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareDisposableWorkspace} from '../../../scripts/local-migration/migration-gate.mjs';
import {runCommand,captureCallerIntegrity,assertCallerIntegrity} from '../../../scripts/local-migration/gate-runner.mjs';
import {strictToolEnvironment,copyLocalUiDeployment} from '../../../scripts/local-migration/packaging-smoke.mjs';
import {createPackageManifest,inventoryPayload} from './package-manifest.mjs';
const {values}=parseArgs({strict:true,options:{out:{type:'string'},'node-archive':{type:'string'},'model-archive':{type:'string'},'model-license':{type:'string'}}});
assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');assert.equal(process.version,'v24.21.0');
for(const value of Object.values(values))assert.ok(path.isAbsolute(value)&&path.resolve(value)===value&&!/[\x00-\x1f\x7f]/u.test(value));
for(const key of ['out','node-archive','model-archive','model-license'])assert.ok(values[key]);
const repository=path.resolve(import.meta.dirname,'../../..'),root=values.out,signal=AbortSignal.timeout(600000),began=Date.now();
assert.equal(await realpath(path.dirname(root)),path.dirname(root));await mkdir(root,{mode:0o700});
const receipt={version:1,distribution:'local-candidate',status:'building',source:null,phases:[],limitations:['Unsigned local candidate; no publisher authentication, notarization or Gatekeeper qualification.','Runtime and human acceptance are recorded separately; successful packaging is not qualification.']};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const phase=name=>{receipt.phases.push({name,elapsedMs:Date.now()-began});console.log(`Packaging: ${name}`);};
const command=(name,args,env,cwd,timeoutMs=120000)=>runCommand(args,{cwd,env,signal,timeoutMs,logPath:path.join(root,`${name}.log`),canaries:[]});
let caller;
try{
  caller=await captureCallerIntegrity(['node_modules','apps/backend/node_modules','apps/web/node_modules','apps/desktop/node_modules','apps/backend/dist','apps/web/.next','apps/desktop/build'].map(name=>path.join(repository,name)),{signal});
  const nodeArchive=await readFile(values['node-archive']),modelArchive=await readFile(values['model-archive']),license=await readFile(values['model-license']);
  assert.equal(hash(nodeArchive),'6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe');
  assert.equal(hash(modelArchive),'1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711');
  assert.equal(hash(license),'bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a');
  const workspace=await prepareDisposableWorkspace(root,signal,{onSourceCaptured:value=>{receipt.source=value;}});
  receipt.buildWorkspace=workspace.workspace;
  const home=path.join(root,'home');await mkdir(home,{mode:0o700});
  const {parse}=await import('yaml'),storeRoot=parse(await readFile(path.join(repository,'node_modules/.modules.yaml'),'utf8')).storeDir;
  const env={...strictToolEnvironment(process.env,{home,corepackHome:workspace.corepackHome,storeRoot,proxyOrigin:'http://127.0.0.1:1'}),LC_ALL:'C'};
  phase('isolated-source');
  for(const [name,args] of [['prisma',['--filter','backend','prisma:generate']],['backend',['--filter','backend','build']],['web',['--filter','web','build']],['native',['--filter','desktop','build:native']]])await command(name,['pnpm',...args],env,workspace.workspace);
  phase('fresh-builds');
  const bundle=path.join(root,'Context Router.app'),resources=path.join(bundle,'Contents/Resources');
  for(const dir of [path.join(bundle,'Contents/MacOS'),resources,path.join(resources,'licenses'),path.join(resources,'desktop'),path.join(root,'model-extract')])await mkdir(dir,{recursive:true});
  const webDeploy=path.join(root,'web-deploy'),desktopDeploy=path.join(root,'desktop-deploy');
  await command('web-deploy',['pnpm','--offline','--filter','web','deploy','--prod',webDeploy],env,workspace.workspace);
  await command('desktop-deploy',['pnpm','--offline','--filter','desktop','deploy','--prod',desktopDeploy],env,workspace.workspace);
  await copyLocalUiDeployment(webDeploy,path.join(resources,'app'));
  const next=path.join(workspace.workspace,'apps/web/.next');await cp(next,path.join(resources,'app/.next'),{recursive:true,verbatimSymlinks:true,filter:file=>!['cache','standalone'].includes(path.relative(next,file).split(path.sep)[0])});
  for(const name of ['node_modules','runtime'])await cp(path.join(desktopDeploy,name),path.join(resources,'desktop',name),{recursive:true,verbatimSymlinks:true});
  await copyFile(path.join(workspace.workspace,'apps/desktop/certificate-closure.json'),path.join(resources,'desktop/certificate-closure.json'));
  await copyFile(path.join(workspace.workspace,'apps/desktop/build/context-router'),path.join(bundle,'Contents/MacOS/context-router'));
  await command('node-extract',['/usr/bin/tar','-xJf',values['node-archive'],'--strip-components','1','-C',resources,'node-v24.21.0-darwin-arm64/bin/node','node-v24.21.0-darwin-arm64/LICENSE'],env,root);
  await command('model-extract',['/usr/bin/tar','-xzf',values['model-archive'],'-C',path.join(root,'model-extract')],env,root);
  const model=path.join(root,'model-extract/llama-b11146');await mkdir(path.join(resources,'model'));
  for(const name of await readdir(model))if(name==='llama-server'||name==='LICENSE'||name.endsWith('.dylib'))await cp(path.join(model,name),path.join(resources,'model',name),{verbatimSymlinks:true});
  await writeFile(path.join(resources,'licenses/Qwen3.5-9B-LICENSE'),license);
  await writeFile(path.join(bundle,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.context-router.pilot</string><key>CFBundleName</key><string>Context Router</string><key>CFBundleDisplayName</key><string>Context Router</string><key>CFBundleExecutable</key><string>context-router</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>15.1.1</string><key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
  const payloadRequire=createRequire(path.join(resources,'app/local-ui.mjs'));
  for(const entry of ['next','backend/dist/bootstrap/local-ui.js','backend/dist/infrastructure/managed/managed-prepare.js'])assert.ok((await realpath(payloadRequire.resolve(entry))).startsWith(resources+path.sep));
  const node=path.join(resources,'bin/node');assert.equal(hash(await readFile(node)),'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b');
  const files=await inventoryPayload(bundle),manifest=createPackageManifest({source:receipt.source.copiedInputsSha256,files});
  await writeFile(path.join(resources,'package-manifest.json'),JSON.stringify(manifest)+'\n');
  await command('preflight',[path.join(bundle,'Contents/MacOS/context-router'),'verify-package'],{PATH:'',LC_ALL:'C'},root,20000);
  receipt.bundle={path:bundle,files:files.length,bytes:files.reduce((total,file)=>total+(file.kind==='file'?file.size:0),0),manifestSha256:hash(await readFile(path.join(resources,'package-manifest.json')))};
  phase('complete-bundle-verified');
  const archive=path.join(root,'Context Router.local-candidate.zip');await command('archive',['/usr/bin/ditto','-c','-k','--keepParent',bundle,archive],env,root);
  receipt.archive={path:archive,bytes:(await lstat(archive)).size,sha256:hash(await readFile(archive))};
  await assertCallerIntegrity(caller,{signal});receipt.callerIntegrity=true;receipt.status='packaged';phase('archive-and-caller-integrity');
}catch(error){receipt.status='failed';receipt.failure={message:error.message,tail:error.outputTail};process.exitCode=1;}
finally{
  if(caller)try{await assertCallerIntegrity(caller);receipt.callerIntegrity=true;}catch{receipt.callerIntegrity=false;receipt.status='failed';process.exitCode=1;}
  receipt.elapsedMs=Date.now()-began;await writeFile(path.join(root,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(`Packaging: ${receipt.status}; receipt ${path.join(root,'build-receipt.json')}`);
}
