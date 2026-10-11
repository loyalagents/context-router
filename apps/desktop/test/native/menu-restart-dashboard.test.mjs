import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('Restart opens the current dashboard once at readiness and suppresses failed or stopping generations', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'desktop-menu-restart-')));
  const driver = path.join(root, 'driver');
  const native = path.resolve(import.meta.dirname, '../../native');
  try {
    // Initial codes may already have expired; opening a ready dashboard must
    // still let the user request a replacement through the menu.
    for (const digit of ['a', 'b', 'c'])
      mkdirSync(path.join(root, 'exports', digit.repeat(32)), { recursive: true, mode: 0o700 });
    const built = spawnSync('/usr/bin/clang', [
      '-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'AppKit',
      '-I', native, path.resolve(import.meta.dirname, '../fixtures/menu-restart-dashboard.m'),
      ...['process', 'package', 'envelope', 'maintenance', 'model-cleanup'].map(name => path.join(native, `${name}.m`)),
      '-o', driver,
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(built.status, 0, built.stderr);
    const result = spawnSync(driver, [root], { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'dashboard-opens-on-ready-after-each-restart-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
