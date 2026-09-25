import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalModelSmoke, decodeLocalModelProbe } from './local-model-smoke.mjs';
import { assertLocalModelSmokeSuccessResources } from './local-model-lifecycle.mjs';

test('model probe rejects missing parser/connection controls and partial evidence', () => {
  for (const value of ['', '{}\n', '{"type":"context-router.local-model.probe","version":1}\n']) {
    assert.throws(() => decodeLocalModelProbe(value));
  }
});
test('model success cannot omit the exact lifecycle census', () => {
  assert.throws(() => assertLocalModelSmokeSuccessResources({ resources: [] }, 'fixture'));
});

import { localModelLifecycleResources } from './fixtures/local-model-lifecycle.mjs';
test('model lifecycle rejects missing, duplicate, foreign-owner, unclosed and unqualified generations', () => {
  const valid = { resources: localModelLifecycleResources('/owned') };
  assertLocalModelSmokeSuccessResources(valid, 'fixture');
  const mutations = [
    (s) => s.resources.pop(), (s) => s.resources.push(s.resources[1]),
    (s) => s.resources[0].identity.freshCredentials = false,
    (s) => s.resources[0].identity.identityStable = false,
    (s) => s.resources[0].cleanup.status = 'failed',
    (s) => s.resources.find((r) => r.id === 'local-model-preview-2').identity.listenerCount = 1,
    (s) => s.resources.find((r) => r.id === 'local-model-probe-1').identity.groupGone = false,
    (s) => s.resources.find((r) => r.id === 'local-model-parser-1-1').identity.ownerPid = 42,
    (s) => s.resources.find((r) => r.id === 'local-model-parser-1-1').identity.closed = false,
    (s) => s.resources.find((r) => r.id === 'local-model-fixture-2').identity.completions = 0,
    (s) => s.resources.find((r) => r.id === 'local-model-probe-1').identity.operation = 'preview',
    (s) => s.resources.find((r) => r.id === 'local-model-parser-1-1').identity.extra = true,
  ];
  for (const mutate of mutations) { const next = structuredClone(valid); mutate(next); assert.throws(() => assertLocalModelSmokeSuccessResources(next, 'fixture')); }
});
