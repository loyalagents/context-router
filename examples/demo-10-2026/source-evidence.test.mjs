import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
test('source importer receipt binds promoted helpers independently from legacy example-only evidence',async t=>{
 const {importerEvidence}=await import('./runtime.mjs');assert.equal(typeof importerEvidence,'function');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'demo-source-evidence-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['examples/demo-10-2026','apps/backend/scripts/demo','apps/backend/scripts/mcp-bridge']){await fs.mkdir(path.join(root,name),{recursive:true});await fs.writeFile(path.join(root,name,'fixture.mjs'),'original');}
 const before=await importerEvidence(root);await fs.writeFile(path.join(root,'apps/backend/scripts/demo/fixture.mjs'),'changed mapper');const after=await importerEvidence(root);
 assert.equal(before.importerEvidenceVersion,2);assert.equal(after.importerSha256,before.importerSha256);assert.notEqual(after.importerClosureSha256,before.importerClosureSha256);assert.deepEqual(Object.keys(after.importerInputs),['examples/demo-10-2026','apps/backend/scripts/demo','apps/backend/scripts/mcp-bridge']);
});
