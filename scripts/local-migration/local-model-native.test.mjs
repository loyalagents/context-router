import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeArgs, summarizeProps } from './fixtures/local-model-feasibility/native.mjs';

test('pinned native invocation fixes the manual candidate and exposes no credential value', () => {
  const args = runtimeArgs({ model: '/private/model.gguf', port: 12345,
    keyPath: '/private/key.pem', certPath: '/private/cert.pem', apiKeyPath: '/private/api-key.txt' });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value('--host'), '127.0.0.1');
  assert.equal(value('--ctx-size'), '16384');
  assert.equal(value('--parallel'), '1');
  assert.equal(value('--cache-ram'), '0');
  assert.equal(value('--fit'), 'off');
  assert.equal(value('--chat-template-kwargs'), '{"enable_thinking":false}');
  for (const flag of ['--offline', '--no-webui', '--no-context-shift', '--no-cache-idle-slots', '--no-cache-prompt', '--slots']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--api-key'));
  assert.throws(() => runtimeArgs({ port: 0 }));
});

test('readiness requires fixed context, slot count and a nonempty template', () => {
  const props = { total_slots: 1, default_generation_settings: { n_ctx: 16384 }, chat_template: 'template', model_path: 'private-path' };
  assert.equal(summarizeProps(props).templateSha256.length, 64);
  assert.ok(!JSON.stringify(summarizeProps(props)).includes('private-path'));
  for (const changed of [{ total_slots: 2 }, { chat_template: '' }, { default_generation_settings: { n_ctx: 8192 } }]) {
    assert.throws(() => summarizeProps({ ...props, ...changed }));
  }
});
