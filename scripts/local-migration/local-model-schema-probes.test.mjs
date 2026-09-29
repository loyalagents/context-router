import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchemaProbes, buildSchemaProbeManifest, runSchemaProbes, validateProbeReply } from './fixtures/local-model-feasibility/schema-probes.mjs';

test('actual extraction/form/dynamic schemas preserve JSON types, null preprocessing and literal constraints', async () => {
  const probes = await buildSchemaProbes();
  assert.deepEqual(probes.map((p) => p.id), ['arbitrary-json', 'form-defaults', 'duplicate-literal']);
  const [json, form, duplicate] = probes;
  const parsed = validateProbeReply(json, structuredClone(json.expected));
  assert.equal(parsed.suggestions[0].newValue.code, '0012');
  assert.equal(parsed.suggestions[0].newValue.count, 12);
  assert.equal(parsed.suggestions[0].newValue.enabled, true);
  assert.equal(parsed.suggestions[0].newValue.missing, null);
  assert.deepEqual(json.grammar.properties.suggestions.items.properties.newValue, {});
  const actions = validateProbeReply(form, structuredClone(form.expected)).fillActions;
  assert.equal(actions[0].value, undefined);
  assert.deepEqual(actions[0].sourceSlugs, []);
  assert.equal(actions[0].confidence, undefined);
  assert.equal(actions[1].value, 'Elena');
  assert.deepEqual(form.grammar.properties.fillActions.items.properties.value.anyOf, [{ type: 'string' }, { type: 'null' }]);
  assert.ok(form.grammar.properties.fillActions.items.required.includes('value'));
  assert.ok(!form.grammar.properties.fillActions.items.required.includes('sourceSlugs'));
  assert.equal(duplicate.grammar.properties.suggestion.properties.slug.const, 'probe.channels');
  for (const wrong of [12, false]) {
    const raw = structuredClone(form.expected); raw.fillActions[0].value = wrong;
    assert.throws(() => form.schema.parse(raw));
  }
  for (const change of [{ slug: 'probe.other' }, { operation: 'DELETE' }, { confidence: 2 }]) {
    assert.throws(() => duplicate.schema.parse({ suggestion: { ...duplicate.expected.suggestion, ...change } }));
  }
  const reversed = structuredClone(duplicate.expected); reversed.suggestion.newValue.reverse();
  assert.doesNotThrow(() => validateProbeReply(duplicate, reversed));
});

async function harness(fault) {
  const probes = await buildSchemaProbes(); let calls = 0;
  const client = { state: 'ready', settled: async () => {}, complete: async (_, options) => {
    const index = calls++;
    if (fault === 'duplicate-transport' && index === 2) throw new Error('PRIVATE_FAILURE');
    if (index < 3) return { text: JSON.stringify(probes[index].expected), inputTokens: 100, outputTokens: 50 };
    assert.equal(options.maxTokens, 1);
    if (fault !== 'missing-limit') options.onTerminalObservation({ stopType: 'limit', truncated: false, inputTokens: 100, outputTokens: 1 });
    throw new Error('Local model unavailable');
  } };
  const result = await runSchemaProbes({}, client, { manifest: await buildSchemaProbeManifest(),
    render: async (_, prompt) => ({ prompt, inputTokens: 100 }) });
  return { result, calls };
}

test('three single-attempt actual-schema probes and one limit negative remain separate from quality', async () => {
  const { result, calls } = await harness();
  assert.equal(calls, 4);
  assert.equal(result.passed, true);
  assert.equal(result.probes.length, 4);
  assert.ok(result.probes.every((p) => p.passed && !p.notRun));
  assert.equal(result.probes[2].consumerCalls, 2);
  assert.equal(result.probes[2].nativeCalls, 1);
  assert.equal(result.probes[3].rejected, true);
});

test('actual duplicate fallback cannot conceal the failed native consolidation call', async () => {
  const { result, calls } = await harness('duplicate-transport');
  assert.equal(calls, 3);
  assert.equal(result.passed, false);
  assert.equal(result.probes[2].passed, false);
  assert.equal(result.probes[2].notRun, false);
  assert.equal(result.probes[3].notRun, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE_FAILURE'), false);
});

test('generic rejection cannot qualify native output-limit evidence', async () => {
  const { result, calls } = await harness('missing-limit');
  assert.equal(calls, 4);
  assert.equal(result.passed, false);
  assert.equal(result.probes[3].rejected, true);
  assert.equal(result.probes[3].passed, false);
});

test('a changed frozen schema-probe specification prevents all inference', async () => {
  let calls = 0;
  const manifest = await buildSchemaProbeManifest(); manifest.version++;
  const result = await runSchemaProbes({}, { complete: async () => { calls++; } }, { manifest });
  assert.equal(result.passed, false);
  assert.equal(calls, 0);
  assert.ok(result.probes.every((p) => p.notRun));
});
