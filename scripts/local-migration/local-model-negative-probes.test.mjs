import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInputLimit, runUnavailable, runMissingAsset } from './fixtures/local-model-feasibility/negative-probes.mjs';
const missingModelArgs = ({ model }) => ['-e', `process.stderr.write(${JSON.stringify("gguf_init_from_file: failed to open GGUF file '")} + ${JSON.stringify(model)} + ${JSON.stringify("' (No such file or directory)\n")}); process.exitCode=7`];

test('input overflow requires actual bounded template and valid over-limit tokenizer evidence', async () => {
  const probe = (count, extra = {}) => async (_configuration, path, body) => {
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 128 * 1024);
    return { value: path === '/apply-template' ? { prompt: '<think></think>' + '0\n'.repeat(6500) } : { tokens: Array(count).fill(1), ...extra } };
  };
  const result = await runInputLimit({}, probe(13000));
  assert.equal(result.passed, true);
  assert.equal(result.tokenCount, 13000);
  assert.deepEqual(result.paths, ['/apply-template', '/tokenize']);
  assert.equal(result.completionRequests, 0);
  for (const transport of [probe(12000), probe(13000, { tokens: Array(13000).fill(-1) }),
    async () => { throw new Error('Probe context limit'); }, async () => ({ value: {} })]) {
    assert.equal((await runInputLimit({}, transport)).passed, false);
  }
});

test('closed owned endpoint fails boundedly before inference dispatch', async () => {
  const result = await runUnavailable();
  assert.equal(result.passed, true);
  assert.equal(result.completionRequests, 0);
  assert.equal(result.credentialsRemoved, true);
  assert.equal(result.state, 'unavailable');
});

test('missing binary and naturally failing missing model are reaped without readiness or inference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step06-negative-tests-'));
  try {
    const binary = await runMissingAsset({ kind: 'binary', binary: process.execPath, evidenceRoot: root });
    assert.equal(binary.passed, true);
    assert.equal(binary.spawnRejected, true);
    assert.equal(binary.credentialsRemoved, true);
    const model = await runMissingAsset({ kind: 'model', binary: process.execPath, evidenceRoot: root,
      argsForModel: missingModelArgs });
    assert.equal(model.passed, true);
    assert.equal(model.naturalExit.code, 7);
    assert.equal(model.naturalExit.signal, null);
    assert.equal(model.ownedChildStoppedAndReaped, true);
    assert.equal(model.missingModelDiagnostic, true);
    assert.deepEqual((await readdir(root)).sort(), ['missing-binary.log', 'missing-model.log']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unrelated exits, wrong missing path and observed late exit never qualify missing model', async () => {
  for (const scenario of ['unrelated', 'wrong-path', 'late']) {
    const root = await mkdtemp(join(tmpdir(), 'step06-negative-diagnostic-'));
    try {
      const times = [0, 0, 10001, 10001];
      const result = await runMissingAsset({ kind: 'model', binary: process.execPath, evidenceRoot: root,
        ...(scenario === 'late' ? { now: () => times.shift() ?? 10001 } : {}),
        argsForModel: scenario === 'unrelated' ? () => ['-e', 'process.exitCode=7'] :
          scenario === 'wrong-path' ? () => missingModelArgs({ model: '/wrong/absent-model.gguf' }) : missingModelArgs });
      assert.equal(result.passed, false, scenario);
      assert.equal(result.ownedChildStoppedAndReaped, true);
      assert.equal(result.credentialsRemoved, true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('timeout, success and private-key diagnostics cannot pass missing-model qualification', async () => {
  for (const [name, script] of [['timeout', 'setInterval(() => {}, 1000)'], ['success', 'process.exitCode = 0']]) {
    const root = await mkdtemp(join(tmpdir(), `step06-negative-${name}-`));
    try {
      const result = await runMissingAsset({ kind: 'model', binary: process.execPath, evidenceRoot: root,
        exitTimeoutMs: 100, argsForModel: () => ['-e', script] });
      assert.equal(result.passed, false);
      assert.equal(result.credentialsRemoved, true);
      assert.equal(result.ownedChildStoppedAndReaped, true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  const root = await mkdtemp(join(tmpdir(), 'step06-negative-secret-'));
  try {
    const result = await runMissingAsset({ kind: 'model', binary: process.execPath, evidenceRoot: root,
      argsForModel: ({ apiKeyPath }) => ['-e', `process.stderr.write(require('fs').readFileSync(${JSON.stringify(apiKeyPath)})); process.exitCode=1`] });
    assert.equal(result.passed, false);
    assert.equal(result.diagnosticAuditPassed, false);
    assert.equal(result.credentialsRemoved, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
