import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplyClient } from '../src/server/apply-client';
import { RequestError } from '../src/server/request-error';

test('ApplyClient sends GraphQL payload and reconciles partial success by slug', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let seenBody = '';
  globalThis.fetch = (async (_input, init) => {
    seenBody = String(init?.body);
    return new Response(
      JSON.stringify({
        data: {
          applyPreferenceSuggestions: [
            {
              id: 'pref-1',
              slug: 'food.dietary_restrictions',
              value: ['nuts'],
              status: 'ACTIVE',
              sourceType: 'INFERRED',
            },
          ],
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;

  const client = new ApplyClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  const result = await client.applySuggestions({
    analysisId: 'analysis-1',
    suggestions: [
      {
        suggestionId: 'analysis-1:candidate:1',
        slug: 'food.dietary_restrictions',
        operation: 'CREATE',
        newValue: ['nuts'],
        confidence: 0.91,
        evidence: { snippet: 'Avoid nuts' },
      },
      {
        suggestionId: 'analysis-1:candidate:2',
        slug: 'system.response_tone',
        operation: 'CREATE',
        newValue: 'brief',
      },
    ],
  });

  const parsedBody = JSON.parse(seenBody) as {
    variables: { analysisId: string; input: Array<{ suggestionId: string }> };
  };

  assert.equal(parsedBody.variables.analysisId, 'analysis-1');
  assert.equal(parsedBody.variables.input[0].suggestionId, 'analysis-1:candidate:1');
  assert.deepEqual(result.matchedSuggestionIds, ['analysis-1:candidate:1']);
  assert.deepEqual(result.unmatchedSuggestionIds, ['analysis-1:candidate:2']);
  assert.equal(result.appliedPreferences[0].slug, 'food.dietary_restrictions');
});

test('ApplyClient converts GraphQL errors into request errors', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        errors: [{ message: 'GraphQL exploded' }],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )) as typeof fetch;

  const client = new ApplyClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  await assert.rejects(
    () =>
      client.applySuggestions({
        analysisId: 'analysis-1',
        suggestions: [],
      }),
    (error: unknown) =>
      error instanceof RequestError && error.kind === 'graphql',
  );
});
