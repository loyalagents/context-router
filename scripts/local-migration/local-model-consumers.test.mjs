import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './fixtures/local-model-feasibility/cases.mjs';
import { runConsumer, grammarSchema, semanticUnits, fixtureReply } from './fixtures/local-model-feasibility/consumers.mjs';

test('frozen sixteen-case fixture oracle is attainable through actual application validators', async () => {
  assert.equal(cases.length, 16);
  for (const entry of cases) {
    let calls = 0;
    const call = async (_prompt, schema) => { calls++; grammarSchema(schema); return schema.parse(fixtureReply(entry)); };
    const result = await runConsumer(entry, { generateStructured: call,
      generateStructuredWithFile: (prompt, _file, schema) => call(prompt, schema) });
    assert.equal(calls, 1, entry.id);
    assert.deepEqual(semanticUnits(entry, result, 'validated'), entry.expectedUnits, entry.id);
  }
});

test('consolidation equivalence requires exact tuple membership and preserves duplicate penalties', () => {
  const entry = cases.find((value) => value.id === 'consolidation-channel-alias');
  const group = { slugs: entry.definitions.map((d) => d.slug), suggestion: 'DELETE_ONE' };
  assert.deepEqual(semanticUnits(entry, { consolidationGroups: [group] }, 'proposal'), entry.expectedUnits);
  assert.notDeepEqual(semanticUnits(entry, { consolidationGroups: [{ ...group, recommendedSlug: 'foreign' }] }, 'proposal'), entry.expectedUnits);
  assert.notDeepEqual(semanticUnits(entry, { consolidationGroups: [{ ...group, suggestion: 'REVIEW' }] }, 'proposal'), entry.expectedUnits);
  assert.equal(semanticUnits(entry, { consolidationGroups: [group, group] }, 'proposal').length, 2);
});
