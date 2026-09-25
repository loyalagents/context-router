import assert from 'node:assert/strict';
import test from 'node:test';
import { renderForCompletion } from './fixtures/local-model-feasibility/protocol.mjs';

test('rendering counts the final non-thinking template and rejects excess before inference', async () => {
  const calls = [];
  const probe = async (_configuration, path, body) => {
    calls.push({ path, body });
    return { value: path === '/apply-template' ? { prompt: '<|im_start|>assistant\n<think>\n\n</think>\n\n' } : { tokens: [1, 2, 3] } };
  };
  const result = await renderForCompletion({}, 'user text', undefined, performance.now() + 1000, probe);
  assert.equal(result.inputTokens, 3);
  assert.equal(calls[0].body.messages[0].content, 'user text');
  assert.equal(calls[1].body.content, result.prompt);
  await assert.rejects(renderForCompletion({}, 'text', undefined, performance.now() + 1000,
    async (_, path) => ({ value: path === '/apply-template' ? { prompt: '<think>' } : { tokens: [1] } })));
  await assert.rejects(renderForCompletion({}, 'text', undefined, performance.now() + 1000,
    async (_, path) => ({ value: path === '/apply-template' ? { prompt: '</think>' } : { tokens: new Array(12001).fill(1) } })));
});
