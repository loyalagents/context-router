import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {repoRoot} from './cases.mjs';
import {offlineControls} from './offline-controls.mjs';
import {buildProductionManifest} from './production-quality.mjs';
import {runProductionCancellation,productionCancellationInputs} from './production-cancellation.mjs';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
const req=createRequire(resolve(repoRoot,'apps/backend/package.json'));
req('reflect-metadata');req('@nestjs/common').Logger.overrideLogger(false);
const load=(name)=>req(resolve(repoRoot,'apps/backend/dist',name+'.js'));
const {createSqliteIdentityRuntime}=load('infrastructure/storage/sqlite/sqlite-local-runtime');
const {createNestLocalIdentityApplication,configureLocalIdentityPreview}=load('bootstrap/local-identity-preview');
const {AI_TEXT_GENERATOR_PORT,AI_STRUCTURED_OUTPUT_PORT}=load('domains/shared/ports/ai.tokens');
const root=await realpath(dirname(process.argv[2])),local={kind:'sqlite',databaseRoot:join(root,'data'),stateRoot:join(root,'identity')};
let app,receipt={mode:'production-cancellation',passed:false},stage='manifest';
try{
 const manifest=JSON.parse(await readFile(resolve(repoRoot,'docs/plans/active/local-migration/06-local-model/evidence/production-cancellation-manifest-review.json'),'utf8'));
 assert.deepEqual(manifest,{...productionCancellationInputs(),buildSha256:(await buildProductionManifest()).buildSha256});receipt.manifest=manifest;
 stage='offline';receipt.offlineControls=await offlineControls(input.configuration.port);
 stage='application';await createSqliteIdentityRuntime(local,true).service.initialize();const identity=await readFile(join(local.stateRoot,'identity.json'));
 app=await createNestLocalIdentityApplication(local,{root:input.credentialRoot,port:input.configuration.port});app.listen=()=>{throw new Error('No listeners');};configureLocalIdentityPreview(app);await app.init();
 const model=app.get(AI_TEXT_GENERATOR_PORT);assert.equal(model,app.get(AI_STRUCTURED_OUTPUT_PORT));
 stage='cancellation';receipt={...receipt,...await runProductionCancellation(model,event=>console.log(JSON.stringify(event)))};
 assert.ok(identity.equals(await readFile(join(local.stateRoot,'identity.json'))));receipt.identityStable=true;
 stage='close';await app.close();app=undefined;receipt.applicationClosed=true;
}catch{receipt.passed=false;receipt.failureStage=stage;}
finally{if(app){try{await app.close();receipt.applicationClosed=true;}catch{receipt.passed=false;receipt.applicationClosed=false;}}}
await writeFile(input.outputPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});process.exitCode=receipt.passed?0:1;
