import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
const require = createRequire(import.meta.url);
const {
  PreferenceService,
} = require('../../dist/modules/preferences/preference/preference.service.js');
const {
  PreferenceSearchWorkflow,
} = require('../../dist/modules/workflows/preferences/preference-search/preference-search.workflow.js');

async function mutate(client, operation, payload) {
  const result = await client.callTool({
    name: 'mutatePreferences',
    arguments: { operation, ...payload },
  });
  assert.equal(result.isError, false);
  return JSON.parse(result.content[0].text);
}

for (const name of ['searchPreferences', 'smartSearchPreferences']) {
  for (const status of ['active', 'suggested']) {
    test(`${name} discovery-first HTTP accepts unchanged null and numeric ${status} confidence`, async (t) => {
      const f = await fixture(t);
      f.store.permissions(f.a.id, {
        capabilities: ['preferences:write', 'preferences:define'],
        targets: ['synthetic.*'],
        allowSensitive: false,
      });
      const { client } = await f.connect();
      assert.ok(
        (await client.listTools()).tools.some((tool) => tool.name === name),
      );
      const expected = new Map();
      for (const confidence of [null, 0.8]) {
        const slug = `synthetic.${status}_${confidence === null ? 'null' : 'number'}`;
        await mutate(client, 'CREATE_DEFINITION', {
          definition: {
            slug,
            description: 'Synthetic schema fixture',
            valueType: 'STRING',
            scope: 'GLOBAL',
          },
        });
        const result = await mutate(
          client,
          status === 'active' ? 'SET_PREFERENCE' : 'SUGGEST_PREFERENCE',
          {
            preference: {
              slug,
              value: '"synthetic"',
              ...(confidence === null && status === 'active'
                ? {}
                : { confidence: confidence ?? 0.5 }),
            },
          },
        );
        if (confidence === null && status === 'suggested') {
          // Represent an existing nullable row; the MCP suggestion input still requires confidence.
          const connection = f.db.connect();
          try {
            connection.run(
              'UPDATE user_preferences SET confidence=NULL WHERE id=?',
              [result.preference.id],
            );
          } finally {
            connection.close();
          }
        }
        expected.set(slug, confidence);
      }
      let workflowCalls = 0;
      if (name === 'smartSearchPreferences') {
        const preferences = f.runtime.application.get(PreferenceService);
        const workflow = f.runtime.application.get(PreferenceSearchWorkflow);
        workflow.run = async (input) => {
          workflowCalls++;
          assert.equal(input.userId, f.identity.principalId);
          assert.equal(input.includeSuggestions, true);
          return {
            matchedDefinitions: [],
            matchedActivePreferences: await preferences.getActivePreferences(
              input.userId,
            ),
            matchedSuggestedPreferences:
              await preferences.getSuggestedPreferences(input.userId),
            queryInterpretation: 'Synthetic deterministic selection',
          };
        };
      }
      const result = await client.callTool({
        name,
        arguments: {
          ...(name === 'smartSearchPreferences' ? { query: 'Synthetic' } : {}),
          includeSuggestions: true,
        },
      });
      assert.notEqual(result.isError, true);
      const payload = result.structuredContent;
      assert.equal(payload.success, true);
      assert.deepEqual(
        JSON.parse(result.content.find((item) => item.type === 'text').text),
        payload,
      );
      const rows =
        name === 'searchPreferences'
          ? payload[status].preferences
          : payload[
              status === 'active'
                ? 'matchedActivePreferences'
                : 'matchedSuggestedPreferences'
            ];
      assert.equal(rows.length, expected.size);
      assert.deepEqual(
        new Map(rows.map((row) => [row.slug, row.confidence])),
        expected,
      );
      assert.equal(workflowCalls, name === 'smartSearchPreferences' ? 1 : 0);
    });
  }
}
