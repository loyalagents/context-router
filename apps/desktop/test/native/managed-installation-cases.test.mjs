import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('native installation parser matches the shared cross-language acceptance corpus', () => {
  const fixture = path.resolve(import.meta.dirname, '../fixtures/managed-installation-cases.json');
  const corpus = JSON.parse(readFileSync(fixture, 'utf8'));
  assert.equal(corpus.version, 1);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cr-installation-corpus-')));
  const driver = path.join(root, 'driver'), native = path.resolve(import.meta.dirname, '../../native');
  try {
    const built = spawnSync('/usr/bin/clang', [
      '-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security', '-I', native,
      path.resolve(import.meta.dirname, '../fixtures/managed-installation-cases.m'), path.join(native, 'package.m'), '-o', driver,
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(built.status, 0, built.stderr);
    const result = spawnSync(driver, [fixture], { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), corpus.cases.map(({ name, accepted }) => ({ name, accepted })));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
