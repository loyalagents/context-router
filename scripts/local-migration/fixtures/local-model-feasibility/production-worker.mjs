import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { repoRoot } from './cases.mjs';
import { offlineControls } from './offline-controls.mjs';
import { runProductionQuality, observeService, assertNativeDuplicateChain } from './production-quality.mjs';
import { buildSchemaProbes, validateProbeReply } from './schema-probes.mjs';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const req = createRequire(resolve(repoRoot,'apps/backend/package.json'));
req('reflect-metadata'); req('@nestjs/common').Logger.overrideLogger(false);
const load = (name) => req(resolve(repoRoot,'apps/backend/dist',name+'.js'));
const { createSqliteIdentityRuntime } = load('infrastructure/storage/sqlite/sqlite-local-runtime');
const { createNestLocalIdentityApplication, configureLocalIdentityPreview } = load('bootstrap/local-identity-preview');
const { AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT } = load('domains/shared/ports/ai.tokens');
const { PreferenceExtractionService } = load('modules/preferences/document-analysis/preference-extraction.service');
const { FormFillService } = load('modules/preferences/form-fill/form-fill.service');
const { GraphQLSchemaHost } = req('@nestjs/graphql'); const { graphql } = req('graphql'); const { PDFDocument } = req('pdf-lib');
const root = await realpath(dirname(process.argv[2]));
const local = {kind:'sqlite',databaseRoot:join(root,'data'),stateRoot:join(root,'identity')};
let app; let model; let receipt={mode:'production-quality',passed:false}; let stage='offline';
try {
  receipt.offlineControls=await offlineControls(input.configuration.port);
  stage='application';
  await createSqliteIdentityRuntime(local,true).service.initialize();
  const identityBytes=await readFile(join(local.stateRoot,'identity.json'));
  const state=JSON.parse(identityBytes);
  app=await createNestLocalIdentityApplication(local,{root:input.credentialRoot,port:input.configuration.port});
  app.listen=()=>{throw new Error('No listeners');}; configureLocalIdentityPreview(app); await app.init();
  model=app.get(AI_TEXT_GENERATOR_PORT); assert.equal(model,app.get(AI_STRUCTURED_OUTPUT_PORT));
  stage='quality';
  receipt={...receipt,...await runProductionQuality(model,(event)=>console.log(JSON.stringify(event)))};
  stage='schemas';
  receipt.productionSchemas=[];
  for (const probe of await buildSchemaProbes()) {
    const start=performance.now(); const observer=observeService(model); observer.begin();
    try {
      const value=await model.generateStructured(probe.prompt,probe.schema,{deadline:start+120000,retries:0});
      await model.settled(); validateProbeReply(probe,JSON.parse(observer.current.firstRaw));
      receipt.productionSchemas.push({id:probe.id,passed:true,elapsedMs:performance.now()-start,calls:observer.current.calls});
    } finally {observer.restore();}
  }
  stage='duplicate-chain';
  const suggestion={slug:'profile.last_name',operation:'CREATE',newValue:'Lovelace',confidence:0.99,sourceSnippet:'Lovelace'};
  const generate=model.generateStructuredWithFile;
  let seeded=0; const observer=observeService(model); observer.begin();
  // Seed only the initial duplicate branch; actual Nest consumer performs the native dynamic-schema consolidation.
  model.generateStructuredWithFile=async (_prompt,_file,schema)=>{seeded++;return schema.parse({documentSummary:'Synthetic',suggestions:[suggestion,{...suggestion}]});};
  try {
    const result=await app.get(PreferenceExtractionService).extractPreferences(state.principalId,Buffer.from('Lovelace'),'text/plain','synthetic.txt',{deadline:performance.now()+180000});
    await model.settled(); assert.equal(model.client.state,'ready');
    receipt.duplicateChain=assertNativeDuplicateChain({result,seededInitialResponses:seeded,calls:observer.current.calls});
  } finally {model.generateStructuredWithFile=generate;observer.restore();}
  stage='editable-form';
  const schema=app.get(GraphQLSchemaHost).schema;
  const set=await graphql({schema,source:'mutation($input:SetPreferenceInput!){setPreference(input:$input){id value}}',variableValues:{input:{slug:'profile.first_name',value:'Ada'}},contextValue:{req:{headers:{authorization:`Bearer ${state.credential}`},rawHeaders:['Authorization',`Bearer ${state.credential}`]}}});
  assert.equal(set.errors,undefined);
  const pdf=await PDFDocument.create(),page=pdf.addPage();pdf.getForm().createTextField('first_name').addToPage(page);
  const start=performance.now();
  const result=await app.get(FormFillService).fillPdfForm(state.principalId,Buffer.from(await pdf.save()),'synthetic.pdf',undefined,{deadline:start+180000});
  await model.settled();assert.equal(result.status,'success');
  const filled=await PDFDocument.load(Buffer.from(result.filledPdfBase64,'base64'));
  assert.equal(filled.getForm().getTextField('first_name').getText(),'Ada');
  receipt.editableForm={passed:true,elapsedMs:performance.now()-start,retainsEditableValue:true};
  assert.ok(identityBytes.equals(await readFile(join(local.stateRoot,'identity.json')))); receipt.identityStable=true;
  stage='close'; await app.close(); app=undefined;receipt.applicationClosed=true;
} catch {receipt.passed=false;receipt.failureStage=stage;}
finally {if(app){try{await app.close();receipt.applicationClosed=true;}catch{receipt.passed=false;receipt.applicationClosed=false;}}}
await writeFile(input.outputPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
process.exitCode=receipt.passed?0:1;
