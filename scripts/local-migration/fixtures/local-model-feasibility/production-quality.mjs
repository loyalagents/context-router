import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cases, repoRoot } from './cases.mjs';
import { runConsumer, fixtureReply, semanticUnits, criticalViolations } from './consumers.mjs';
import { digest, userMessage } from './freeze.mjs';
import { scoreQuality } from './quality.mjs';
const req = createRequire(resolve(repoRoot, 'apps/backend/package.json'));
const dist = resolve(repoRoot, 'apps/backend/dist');
const { localJsonSchema } = req(join(dist, 'infrastructure/local-model/schema.js'));
const { LOCAL_AI_CAPABILITIES } = req(join(dist, 'domains/shared/ports/ai-execution.js'));
export const productionManifestPath = resolve(repoRoot, 'docs/plans/active/local-migration/06-local-model/evidence/production-quality-manifest.json');
const correction = '\n\nThe previous response did not satisfy the required JSON schema. Return valid JSON only.';
async function buildDigest(directory = dist, prefix = '') {
  const values = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name, file = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await buildDigest(file, name + '/'));
    else if (entry.isFile() && /\.(?:js|mjs|json)$/u.test(name)) values.push([name, digest(await readFile(file, 'utf8'))]);
    else if (entry.isSymbolicLink()) throw new Error('Unexpected compiled symlink');
  }
  return values;
}
export async function buildProductionManifest() {
  const original = JSON.parse(await readFile(resolve(repoRoot, 'docs/plans/active/local-migration/06-local-model/evidence/quality-manifest.json'), 'utf8'));
  const entries = [];
  for (const entry of cases) {
    const calls = [];
    const invoke = async (prompt, schema, file) => {
      const message = userMessage(prompt, file);
      calls.push({ promptSha256: digest(prompt), messageSha256: digest(message), correctionMessageSha256: digest(message + correction), schemaSha256: digest(localJsonSchema(schema)),
        ...(file ? { fileSha256: digest(file.buffer.toString('utf8')), mimeType: file.mimeType } : {}) });
      return schema.parse(fixtureReply(entry));
    };
    await runConsumer(entry, { capabilities: LOCAL_AI_CAPABILITIES, generateStructured: (p,s) => invoke(p,s), generateStructuredWithFile: (p,f,s) => invoke(p,s,f) });
    assert.equal(calls.length, 1);
    const old = original.cases.find((c) => c.id === entry.id);
    assert.equal(old.fixtureSha256, digest(entry)); assert.deepEqual(old.expectedUnits, entry.expectedUnits);
    entries.push({ ...old, calls });
  }
  return { ...original, production: true, originalManifestSha256: digest(original), buildSha256: digest(await buildDigest()), correctionSuffixSha256: digest(correction), cases: entries };
}
export function requireFrozenManifest(expected, actual) { assert.deepEqual(actual, expected, 'Frozen production inputs changed'); }
export function acceptAmendmentE(manifest, trials) {
  const scored = scoreQuality(manifest, trials); // Requires all unique trials and uses original order-independent units.
  return scored.trials.every((trial) => !trial.failed && trial.criticalViolations === 0 && trial.validated.falsePositive === 0 &&
    (trial.validated.falseNegative === 0 || (trial.caseId === 'extraction-instruction-injection' && trial.validated.falseNegative === 1 && trial.validated.truePositive === 0)));
}
/** Test-only transparent observation below Zod parsing. Never retries or replaces a result. */
export function observeService(service) {
  const complete = service.client.complete, probe = service.probe;
  let current;
  service.client.complete = async function(prompt, options) {
    const call = { renderedSha256: digest(prompt), schemaSha256: digest(options.schema ?? null), failed: true }; const start = performance.now();
    current?.calls.push(call);
    try {
      const result = await complete.call(this, prompt, options);
      if (current?.calls.length === 1) current.firstRaw = result.text;
      Object.assign(call, { failed: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      return result;
    } finally { call.elapsedMs = performance.now() - start; }
  };
  service.probe = async function(config, path, data, options) {
    if (path === '/apply-template') current?.messages.push(digest(data.messages[0].content));
    return probe.call(this, config, path, data, options);
  };
  return { begin() { current = { calls: [], messages: [], firstRaw: undefined }; }, get current() { return current; },
    restore() { service.client.complete = complete; service.probe = probe; } };
}
export async function runProductionQuality(service, onProgress = () => {}) {
  const manifest = JSON.parse(await readFile(productionManifestPath, 'utf8'));
  requireFrozenManifest(manifest, await buildProductionManifest());
  assert.equal((await service.getStatus()).state, 'available'); await service.settled();
  const observer = observeService(service), trials = [], measurements = [];
  try {
    for (const entry of cases) for (const repetition of [0,1,2]) {
      const start = performance.now(), options = { deadline: start + 180000 };
      const frozen = manifest.cases.find((c) => c.id === entry.id).calls[0];
      const trial = { caseId:entry.id, repetition, structureValid:false, failed:false, criticalViolations:0, proposalUnits:[], validatedUnits:[] };
      let initialSchema; let calls = 0; let fatalBinding = false;
      observer.begin();
      const invoke = async (prompt, schema, file, controls) => {
        calls++; if (!initialSchema) initialSchema = schema;
        if (calls === 1) {
          assert.equal(digest(prompt), frozen.promptSha256); assert.equal(digest(localJsonSchema(schema)), frozen.schemaSha256);
          assert.equal(digest(userMessage(prompt,file)), frozen.messageSha256);
        }
        const beforeCalls = observer.current.calls.length, beforeMessages = observer.current.messages.length;
        const message = userMessage(prompt,file), grammarHash = digest(localJsonSchema(schema));
        try { return await (file ? service.generateStructuredWithFile(prompt,file,schema,controls) : service.generateStructured(prompt,schema,controls)); }
        finally {
          try {
          const attempts = observer.current.calls.slice(beforeCalls), messages = observer.current.messages.slice(beforeMessages);
          assert.ok(attempts.length >= 1 && attempts.length <= 2);
          assert.equal(messages.length, attempts.length);
          for (const [attempt, call] of attempts.entries()) {
            assert.equal(call.schemaSha256, grammarHash);
            assert.equal(messages[attempt], digest(message + (attempt === 0 ? '' : correction)));
          }
          } catch (error) { fatalBinding = true; throw error; }
        }
      };
      try {
        const value = await runConsumer(entry, { capabilities:service.capabilities,
          generateStructured: (p,s,o) => invoke(p,s,undefined,o), generateStructuredWithFile: (p,f,s,o) => invoke(p,s,f,o) }, options);
        assert.ok(performance.now() < options.deadline);
        trial.validatedUnits = semanticUnits(entry,value,'validated');
        trial.criticalViolations = criticalViolations(entry,trial.validatedUnits); trial.structureValid = true;
      } catch { trial.failed = true; }
      await service.settled();
      let initialProposalValid = false;
      try { const parsed = initialSchema.parse(JSON.parse(observer.current.firstRaw)); initialProposalValid = true; trial.proposalUnits = semanticUnits(entry,parsed,'proposal'); } catch {}
      if (fatalBinding || observer.current.messages[0] !== frozen.messageSha256 || observer.current.calls.some((c) => c.failed)) trial.failed = true;
      const measured = { caseId:entry.id,repetition,workflowMs:performance.now()-start,calls:observer.current.calls,messages:observer.current.messages,initialProposalValid,state:service.client.state };
      trials.push(trial); measurements.push(measured); onProgress({caseId:entry.id,repetition,failed:trial.failed});
    }
  } finally { observer.restore(); }
  const score = scoreQuality(manifest,trials), amendmentEAccepted = acceptAmendmentE(manifest,trials);
  const times = measurements.flatMap((m) => m.calls.map((c) => c.elapsedMs)).sort((a,b) => a-b);
  const oneCallTimes = measurements.filter((m) => m.calls.length === 1).map((m) => m.workflowMs).sort((a,b) => a-b);
  const warmOneCallP95Ms = oneCallTimes[Math.ceil(oneCallTimes.length*.95)-1];
  const limitsPassed = measurements.every((m) => m.workflowMs <= 180000 && m.state === 'ready') && times.every((t) => t <= 120000) && warmOneCallP95Ms <= 60000;
  return { score, amendmentEAccepted, limitsPassed, warmOneCallP95Ms, measurements, passed:amendmentEAccepted && limitsPassed };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const manifest = await buildProductionManifest(); await writeFile(productionManifestPath, JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({manifestSha256:digest(manifest),cases:manifest.cases.length}));
}
