import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('Demo setup buttons copy exact bound commands without selection, remain open and refuse stale runtime', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'desktop-demo-copy-')));
  const driver = path.join(root, 'driver'), image = path.join(root, 'demo-setup.png');
  const native = path.resolve(import.meta.dirname, '../../native');
  try {
    const built = spawnSync('/usr/bin/clang', [
      '-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security', '-framework', 'AppKit',
      '-I', native, path.resolve(import.meta.dirname, '../fixtures/menu-demo-setup.m'),
      ...['process', 'package', 'envelope', 'maintenance', 'model-cleanup'].map(name => path.join(native, `${name}.m`)), '-o', driver,
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(built.status, 0, built.stderr);
    const result = spawnSync(driver, [root, image], { env: {}, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, `status=${result.status} signal=${result.signal} ${result.error?.message ?? ''}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    const base = `'${root}/Demo App'"'"'s.app/Contents/MacOS/context-router' demo --root '${root}/Root'"'"'s demo' --store '${'a'.repeat(32)}' --generation '${'b'.repeat(32)}' --endpoint 'http://127.0.0.1:3211/mcp'`;
    assert.deepEqual(payload, {
      commands: ['login A', 'launch A', 'login B --client claude --auth subscription', 'launch B --client claude --auth subscription', 'desktop prepare', 'status'].map(action => `${base} ${action}`),
      refusals: 11, modalCopy: true, privatePasteboard: true, sent: 0,
    });
    assert.ok(existsSync(image));
    if (process.env.CR_MENU_SETUP_EVIDENCE_DIR) {
      mkdirSync(process.env.CR_MENU_SETUP_EVIDENCE_DIR, { recursive: true });
      copyFileSync(image, path.join(process.env.CR_MENU_SETUP_EVIDENCE_DIR, 'demo-setup.png'));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
