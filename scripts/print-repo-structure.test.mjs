import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = new URL('../print-repo-structure.sh', import.meta.url);

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'context-router-tree-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'repo with spaces');
  const bin = path.join(temporary, 'bin');
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
  const script = path.join(root, 'print-repo-structure.sh');
  fs.copyFileSync(source, script);
  fs.chmodSync(script, 0o755);
  return {
    root, bin,
    write(relative, content = '') {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return target;
    },
    run(args = []) {
      // Bash is explicit so PATH can contain no external tools at all.
      return spawnSync('/bin/bash', [script, ...args], {
        cwd: temporary, env: { PATH: bin }, encoding: 'utf8', timeout: 10000,
      });
    },
  };
}

function successful(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

test('default depth is bounded; explicit depth can expose deeper entries', (t) => {
  const f = fixture(t);
  f.write('one/two/three/four/five/six.txt');
  const normal = successful(f.run());
  assert.match(normal, /\+--four\//);
  assert.doesNotMatch(normal, /five|six\.txt/);
  assert.match(successful(f.run(['--depth', '6'])), /\+--six\.txt/);
  const shallow = successful(f.run(['--depth', '1']));
  assert.match(shallow, /\+--one\//);
  assert.doesNotMatch(shallow, /\+--two\//);
});

test('hierarchy keeps directory descendants together before sibling files', (t) => {
  const f = fixture(t);
  f.write('apps/backend/prisma/migrations/hidden.sql');
  f.write('apps/backend/prisma.config.ts');
  f.write('apps/backend/.visible-config');
  f.write('apps/backend/space file.txt');
  const output = successful(f.run());
  assert.match(output,
    /\|  \|  \+--prisma\/\n\|  \|  \|  \+--migrations\/\n\|  \|  \+--\.visible-config\n\|  \|  \+--prisma\.config\.ts\n\|  \|  \+--space file\.txt/);
  assert.match(output, /\*\*apps\/desktop\*\*/);
});

test('exclusions are applied to entries at every level before traversal', (t) => {
  const f = fixture(t);
  const exclusions = [
    'node_modules', 'dist', '.next', 'build', 'coverage', '.git',
    '.cache', '.pnpm-store', '.claude', 'fixture.lock', '.DS_Store',
  ];
  for (const name of exclusions) {
    f.write(`${name}/excluded-sentinel`);
    f.write(`visible/${name}/excluded-sentinel`);
  }
  f.write('visible/retained.txt');
  const output = successful(f.run(['--depth', '6']));
  assert.match(output, /retained\.txt/);
  assert.doesNotMatch(output, /excluded-sentinel/);
  for (const name of exclusions) assert.ok(!output.includes(`+--${name}`), name);
});

test('symlinks are displayed but never followed, including loops', (t) => {
  const f = fixture(t);
  f.write('visible.txt');
  fs.symlinkSync(f.root, path.join(f.root, 'loop'));
  fs.symlinkSync('missing', path.join(f.root, 'broken'));
  const output = successful(f.run(['--depth', '64']));
  assert.match(output, /\+--loop@\n/);
  assert.match(output, /\+--broken@\n/);
  assert.equal(output.split('+--visible.txt').length, 2);
});

test('output is identical with tree absent, present, or failing on PATH', (t) => {
  const f = fixture(t);
  f.write('visible/retained.txt');
  const withoutTree = successful(f.run());
  for (const exitCode of [0, 1]) {
    fs.writeFileSync(path.join(f.bin, 'tree'),
      `#!/bin/bash\nprintf 'called' > "$0.called"\nprintf 'UNEXPECTED TREE OUTPUT\\n'\nexit ${exitCode}\n`,
      { mode: 0o755 });
    assert.equal(successful(f.run()), withoutTree);
    assert.equal(fs.existsSync(path.join(f.bin, 'tree.called')), false);
  }
});

test('help and invalid depth arguments are handled before rendering', (t) => {
  const f = fixture(t);
  assert.match(successful(f.run(['--help'])), /Usage:/);
  for (const args of [
    ['--unknown'], ['--depth'], ['--depth', ''], ['--depth', '0'],
    ['--depth', '-1'], ['--depth', '04'], ['--depth', '1.5'],
    ['--depth', 'no'], ['--depth', '65'], ['--depth', '9999999999999999999999'],
    ['--depth', '2', 'extra'],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:|Error:/);
  }
});

test('unreadable directories fail visibly unless excluded or beyond depth', (t) => {
  if (process.getuid?.() === 0) return t.skip('root bypasses directory permissions');
  const f = fixture(t);
  const denied = path.join(f.root, 'denied');
  fs.mkdirSync(denied);
  fs.chmodSync(denied, 0);
  try {
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot read or search directory/);
    assert.doesNotMatch(result.stdout, /## Key Directories/);
    successful(f.run(['--depth', '1']));
    fs.chmodSync(denied, 0o700);
    fs.renameSync(denied, path.join(f.root, 'node_modules'));
    fs.chmodSync(path.join(f.root, 'node_modules'), 0);
    successful(f.run());
  } finally {
    for (const name of ['denied', 'node_modules']) {
      const directory = path.join(f.root, name);
      if (fs.existsSync(directory)) fs.chmodSync(directory, 0o700);
    }
  }
});
