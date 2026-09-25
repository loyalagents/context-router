import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { cases } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/cases.mjs';
import { scoreQuality } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/quality.mjs';
import { buildProductionManifest, requireFrozenManifest, acceptAmendmentE, observeService } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/production-quality.mjs';

test('production manifest preserves all original expectations and rejects changed build/prompt/schema inputs', async () => {
  const original = JSON.parse(await readFile(new URL('../../../../docs/plans/active/local-migration/06-local-model/evidence/quality-manifest.json', import.meta.url)));
  const manifest = await buildProductionManifest();
  assert.equal(manifest.cases.length, 16); assert.equal(manifest.repetitions, 3);
  for (const [i, entry] of manifest.cases.entries()) {
    for (const key of ['id','family','fixtureSha256','expectedUnits','criticalPolicy','oracleAlternatives']) assert.deepEqual(entry[key], original.cases[i][key]);
  }
  requireFrozenManifest(manifest, structuredClone(manifest));
  for (const mutate of [(m) => m.buildSha256 = 'wrong', (m) => m.cases[0].calls[0].promptSha256 = 'wrong', (m) => m.cases[0].calls[0].schemaSha256 = 'wrong']) {
    const changed = structuredClone(manifest); mutate(changed); assert.throws(() => requireFrozenManifest(manifest, changed));
  }
});
test('E allows only the known omitted email and cannot excuse a missing trial, failure, wrong unit or another omission', async () => {
  const manifest = await buildProductionManifest();
  const trials = cases.flatMap((c) => [0,1,2].map((repetition) => ({ caseId:c.id, repetition, structureValid:true, failed:false, criticalViolations:0, proposalUnits:c.expectedUnits, validatedUnits:c.expectedUnits })));
  assert.equal(acceptAmendmentE(manifest,trials),true);
  const reordered=structuredClone(trials); for(const t of reordered) t.validatedUnits.reverse();
  assert.equal(acceptAmendmentE(manifest,reordered),true);
  const known = structuredClone(trials); for (const t of known.filter((t) => t.caseId === 'extraction-instruction-injection')) t.validatedUnits=[];
  assert.equal(scoreQuality(manifest,known).passed,false); assert.equal(acceptAmendmentE(manifest,known),true);
  assert.throws(() => acceptAmendmentE(manifest,known.slice(1)));
  for (const mutate of [(t) => t[0].validatedUnits=[], (t) => t[0].failed=true, (t) => t[0].criticalViolations=1, (t) => t.find((v) => v.caseId==='extraction-instruction-injection').validatedUnits=[{slug:'wrong',value:'wrong'}]]) {
    const bad=structuredClone(known); mutate(bad); assert.equal(acceptAmendmentE(manifest,bad),false);
  }
});
test('attempt observer preserves malformed initial output, correction and failed calls without changing execution', async () => {
  const replies=['invalid','{"answer":"ok"}']; let index=0;
  const service={ client:{complete:async (_prompt,opts) => { assert.equal(opts.deadline,123); if(index===2) throw new Error('fixed'); return {text:replies[index++],inputTokens:1,outputTokens:2}; }}, probe:async () => ({value:{}}) };
  const observer=observeService(service); observer.begin();
  assert.equal((await service.client.complete('a',{deadline:123})).text,'invalid');
  assert.equal((await service.client.complete('b',{deadline:123})).text,'{"answer":"ok"}');
  await assert.rejects(service.client.complete('c',{deadline:123}));
  assert.deepEqual(observer.current.calls.map((c) => c.failed),[false,false,true]);
  assert.equal(observer.current.firstRaw,'invalid'); assert.equal(observer.current.calls.length,3); observer.restore();
});
