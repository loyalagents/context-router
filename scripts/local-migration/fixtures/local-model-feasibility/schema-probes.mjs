import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases, repoRoot } from './cases.mjs';
import { runConsumer, fixtureCapabilities, grammarSchema, fixtureReply } from './consumers.mjs';
import { digest } from './freeze.mjs';
import { renderForCompletion } from './protocol.mjs';

const manifestPath = resolve(repoRoot, 'docs/plans/active/local-migration/06-local-model/evidence/schema-probe-manifest.json');
const snippet = 'Preferred channels: email and phone.';
const jsonExpected = { documentSummary: 'Schema probe', suggestions: [{ slug: 'probe.payload', operation: 'CREATE',
  newValue: { code: '0012', count: 12, enabled: true, missing: null, items: ['x', 2, false, null, { nested: 'y' }] },
  confidence: 1, sourceSnippet: 'Synthetic JSON payload', sourceMeta: { page: null, line: null } }] };
const formExpected = { fillActions: [{ fieldName: 'Phone', action: 'SKIP', value: null }, { fieldName: 'Name', action: 'SET_TEXT', value: 'Elena' }] };
const duplicateSeed = { documentSummary: 'Schema probe', suggestions: ['email', 'phone'].map((value) => ({
  slug: 'probe.channels', operation: 'CREATE', newValue: [value], confidence: 1, sourceSnippet: snippet, sourceMeta: null })) };
const duplicateExpected = { suggestion: { slug: 'probe.channels', operation: 'CREATE', newValue: ['email', 'phone'], confidence: 1, sourceSnippet: snippet, sourceMeta: null } };
const duplicateEntry = { id: 'schema-duplicate', family: 'extraction', documentText: snippet,
  definitions: [{ slug: 'probe.channels', displayName: 'Preferred contact channels', description: 'Preferred contact channels such as email and phone.',
    valueType: 'ARRAY', namespace: 'GLOBAL', scope: 'GLOBAL', options: null }] };
const copyPrompt = (value) => `Return exactly this JSON object, preserving every field and JSON value type and adding no fields:\n${JSON.stringify(value)}`;

/** Capture actual private consumer schemas; never duplicate product schemas in the probe. */
export async function buildSchemaProbes() {
  const probes = [];
  for (const [entry, id, expected] of [[cases[0], 'arbitrary-json', jsonExpected], [cases.find((c) => c.family === 'form'), 'form-defaults', formExpected]]) {
    let captured; let count = 0;
    const capture = async (_, schema) => { captured = schema; count++; return schema.parse(fixtureReply(entry)); };
    await runConsumer(entry, { capabilities: fixtureCapabilities, generateStructured: capture, generateStructuredWithFile: (prompt, _, schema) => capture(prompt, schema) });
    assert.equal(count, 1);
    probes.push({ id, prompt: copyPrompt(expected), schema: captured, grammar: grammarSchema(captured), expected: structuredClone(expected) });
  }
  let captured; let count = 0;
  await runConsumer(duplicateEntry, { capabilities: fixtureCapabilities,
    generateStructuredWithFile: async (_, __, schema) => { count++; return schema.parse(duplicateSeed); },
    generateStructured: async (prompt, schema) => {
      count++; captured = { id: 'duplicate-literal', prompt, schema, grammar: grammarSchema(schema), expected: structuredClone(duplicateExpected) };
      return schema.parse(duplicateExpected);
    },
  });
  assert.equal(count, 2); assert.ok(captured);
  probes.push(captured);
  return probes;
}

export function validateProbeReply(probe, raw) {
  if (probe.id !== 'duplicate-literal') assert.deepEqual(raw, probe.expected);
  const parsed = probe.schema.parse(raw);
  if (probe.id === 'arbitrary-json') assert.deepEqual(parsed, probe.expected);
  else if (probe.id === 'form-defaults') {
    assert.equal(parsed.fillActions[0].value, undefined);
    assert.equal(parsed.fillActions[1].value, 'Elena');
    for (const action of parsed.fillActions) { assert.deepEqual(action.sourceSlugs, []); assert.equal(action.confidence, undefined); }
  } else {
    const value = parsed.suggestion;
    assert.equal(value.slug, 'probe.channels'); assert.equal(value.operation, 'CREATE');
    assert.ok(Array.isArray(value.newValue)); assert.deepEqual([...value.newValue].sort(), ['email', 'phone']);
    assert.ok(value.oldValue == null); assert.equal(value.sourceSnippet, snippet);
    assert.ok(value.sourceMeta?.page == null && value.sourceMeta?.line == null);
  }
  return parsed;
}

export async function buildSchemaProbeManifest() {
  const probes = await buildSchemaProbes();
  return { version: 1, repetitions: 1, qualityDenominatorContribution: 0,
    probes: probes.map((p) => ({ id: p.id, promptSha256: digest(p.prompt), schemaSha256: digest(p.grammar),
      expectedSha256: digest(p.id === 'duplicate-literal' ? {
        seed: duplicateSeed, entry: duplicateEntry, slug: 'probe.channels', operation: 'CREATE', valuesEachOnceEitherOrder: ['email', 'phone'],
        confidence: 'actual-zod-valid', sourceSnippet: snippet, sourceMeta: 'absent-or-null-page-and-line', oldValue: 'absent-or-null', consumerCalls: 2, nativeCalls: 1,
      } : p.expected) })),
    limit: { promptSha256: digest(probes[0].prompt), schemaSha256: digest(probes[0].grammar), maxTokens: 1,
      requiredObservation: 'one-validated-limit-marker-before-immediate-rejection', cleanEofClaim: false, requiredSettledState: 'ready' } };
}

/** Three schema calls and a final negative, with no retries and no quality score credit. */
export async function runSchemaProbes(configuration, client, { render = renderForCompletion, manifest, onProgress = () => {} } = {}) {
  const results = ['arbitrary-json', 'form-defaults', 'duplicate-literal', 'output-limit'].map((id) => ({ id, passed: false, notRun: true }));
  const output = { passed: false, probes: results };
  try {
    const expectedManifest = manifest ?? JSON.parse(await readFile(manifestPath, 'utf8'));
    const current = await buildSchemaProbeManifest();
    assert.deepEqual(current, expectedManifest); output.manifestSha256 = digest(current);
    const probes = await buildSchemaProbes();
    for (let index = 0; index < results.length; index++) {
      if (client.state !== 'ready') throw new Error('Schema probe unavailable');
      const result = results[index]; result.notRun = false;
      const probe = probes[index === 3 ? 0 : index]; const start = performance.now(); const deadline = start + 120000;
      const invoke = async (prompt, schema, maxTokens = 2048) => {
        const prepared = await render(configuration, prompt, undefined, deadline);
        result.inputTokens = prepared.inputTokens; result.nativeCalls = (result.nativeCalls ?? 0) + 1;
        const observations = []; let observationOverflow = false;
        try {
          const value = await client.complete(prepared.prompt, { deadline, schema, maxTokens,
            onTerminalObservation: (observation) => { if (observations.length) observationOverflow = true; else observations.push(observation); } });
          result.outputTokens = value.outputTokens;
          return JSON.parse(value.text);
        } finally {
          await client.settled(); result.state = client.state;
          if (index === 3) { result.terminalObservations = observations; result.observationOverflow = observationOverflow; }
        }
      };
      if (index < 2) validateProbeReply(probe, await invoke(probe.prompt, probe.grammar));
      else if (index === 2) {
        let fatal = false; result.consumerCalls = 0;
        const consumerResult = await runConsumer(duplicateEntry, { capabilities: fixtureCapabilities,
          generateStructuredWithFile: async (_, __, schema) => { result.consumerCalls++; return schema.parse(duplicateSeed); },
          generateStructured: async (prompt, schema) => {
            result.consumerCalls++;
            try {
              assert.equal(digest(prompt), digest(probe.prompt)); assert.equal(digest(grammarSchema(schema)), digest(probe.grammar));
              return validateProbeReply(probe, await invoke(prompt, grammarSchema(schema)));
            } catch (error) { fatal = true; throw error; }
          },
        });
        assert.equal(fatal, false); assert.equal(result.consumerCalls, 2); assert.equal(result.nativeCalls, 1);
        assert.equal(consumerResult.suggestions.length, 1);
        validateProbeReply(probe, { suggestion: consumerResult.suggestions[0] });
      } else {
        result.rejected = false;
        try { await invoke(probe.prompt, probe.grammar, 1); } catch { result.rejected = true; }
        assert.equal(result.rejected, true); assert.equal(result.observationOverflow, false);
        assert.deepEqual(result.terminalObservations, [{ stopType: 'limit', truncated: false, inputTokens: result.inputTokens, outputTokens: 1 }]);
      }
      assert.equal(client.state, 'ready'); assert.equal(result.nativeCalls, 1);
      result.elapsedMs = performance.now() - start; assert.ok(result.elapsedMs <= 120000);
      result.passed = true; onProgress({ id: result.id, passed: true, elapsedMs: result.elapsedMs });
    }
    output.passed = true;
  } catch { output.failure = 'Bounded schema probe failed'; }
  return output;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const manifest = await buildSchemaProbeManifest();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ schemaProbeManifestSha256: digest(manifest) }));
}
