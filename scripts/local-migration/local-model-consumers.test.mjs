import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './fixtures/local-model-feasibility/cases.mjs';
import { scoreQuality } from './fixtures/local-model-feasibility/quality.mjs';
import * as consumers from './fixtures/local-model-feasibility/consumers.mjs';
const { runConsumer, grammarSchema, semanticUnits, fixtureReply } = consumers;

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

test('accepted wrong sensitive extraction and form values are critical even when utility could pass', async () => {
  assert.equal(typeof consumers.criticalViolations, 'function');
  for (const id of ['extraction-work-authorization', 'form-permanent-resident']) {
    const entry = cases.find((value) => value.id === id);
    const units = structuredClone(entry.expectedUnits);
    units[1].value = '999999999';
    assert.equal(consumers.criticalViolations(entry, units), 1, id);
    assert.equal(consumers.criticalViolations(entry, entry.expectedUnits), 0, id);
  }
  const entry = cases.find((value) => value.id === 'extraction-work-authorization');
  const reply = fixtureReply(entry); reply.suggestions[1].newValue = '999999999';
  const result = await runConsumer(entry, { generateStructuredWithFile: async (_prompt, _file, schema) => schema.parse(reply) });
  const units = semanticUnits(entry, result, 'validated');
  assert.equal(consumers.criticalViolations(entry, units), 1);
  const trials = cases.flatMap((item) => [0, 1, 2].map((repetition) => ({ caseId: item.id, repetition, failed: false, structureValid: true,
    criticalViolations: item === entry && repetition === 0 ? consumers.criticalViolations(entry, units) : 0,
    proposalUnits: item.expectedUnits, validatedUnits: item === entry && repetition === 0 ? units : item.expectedUnits })));
  const score = scoreQuality({ version: 1, repetitions: 3, cases }, trials);
  assert.ok(score.families.extraction.validated.precision >= 0.95);
  assert.ok(score.families.extraction.validated.recall >= 0.9);
  assert.equal(score.passed, false);
});

test('consolidation equivalence requires exact tuple membership and preserves duplicate penalties', () => {
  const entry = cases.find((value) => value.id === 'consolidation-channel-alias');
  const group = { slugs: entry.definitions.map((d) => d.slug), suggestion: 'DELETE_ONE' };
  assert.deepEqual(semanticUnits(entry, { consolidationGroups: [group] }, 'proposal'), entry.expectedUnits);
  assert.notDeepEqual(semanticUnits(entry, { consolidationGroups: [{ ...group, recommendedSlug: 'foreign' }] }, 'proposal'), entry.expectedUnits);
  assert.notDeepEqual(semanticUnits(entry, { consolidationGroups: [{ ...group, suggestion: 'REVIEW' }] }, 'proposal'), entry.expectedUnits);
  assert.equal(semanticUnits(entry, { consolidationGroups: [group, group] }, 'proposal').length, 2);
});
