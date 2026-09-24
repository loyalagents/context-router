import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as native from './fixtures/local-model-feasibility/native.mjs';
const { runtimeArgs, summarizeProps } = native;

test('pinned native invocation fixes the manual candidate and exposes no credential value', () => {
  const args = runtimeArgs({ model: '/private/model.gguf', port: 12345,
    keyPath: '/private/key.pem', certPath: '/private/cert.pem', apiKeyPath: '/private/api-key.txt' });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value('--host'), '127.0.0.1');
  assert.equal(value('--ctx-size'), '16384');
  assert.equal(value('--parallel'), '1');
  assert.equal(value('--batch-size'), '512');
  assert.equal(value('--ubatch-size'), '512');
  assert.equal(value('--cache-ram'), '0');
  assert.equal(value('--fit'), 'off');
  assert.equal(value('--chat-template-kwargs'), '{"enable_thinking":false}');
  for (const flag of ['--offline', '--no-webui', '--no-context-shift', '--no-cache-idle-slots', '--no-cache-prompt', '--slots']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--api-key'));
  assert.throws(() => runtimeArgs({ port: 0 }));
});

test('final diagnostic audit rejects late overflow, unavailable logs and credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-audit-test-'));
  try {
    const path = join(root, 'runtime.log');
    await writeFile(path, 'safe counters only', { mode: 0o600 });
    assert.equal(typeof native.auditDiagnostics, 'function');
    await native.auditDiagnostics(path, 'private-test-key', false);
    await assert.rejects(native.auditDiagnostics(path, 'private-test-key', true), /Native probe diagnostic audit failed/);
    await assert.rejects(native.auditDiagnostics(join(root, 'missing'), 'private-test-key', false), /Native probe diagnostic audit failed/);
    await writeFile(path, 'private-test-key');
    await assert.rejects(native.auditDiagnostics(path, 'private-test-key', false), /Native probe diagnostic audit failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('readiness requires fixed context, slot count and a nonempty template', () => {
  const props = { total_slots: 1, default_generation_settings: { n_ctx: 16384 }, chat_template: 'template', model_path: 'private-path' };
  assert.equal(summarizeProps(props).templateSha256.length, 64);
  assert.ok(!JSON.stringify(summarizeProps(props)).includes('private-path'));
  for (const changed of [{ total_slots: 2 }, { chat_template: '' }, { default_generation_settings: { n_ctx: 8192 } }]) {
    assert.throws(() => summarizeProps({ ...props, ...changed }));
  }
});
