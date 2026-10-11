import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCredential } from '../../scripts/mcp-bridge/credential.mjs';

const token = `cr_mcp_${'a'.repeat(22)}.${'b'.repeat(43)}`;
function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cr-bridge-token-')),
  );
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'client.token');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}
test('credential reader accepts exact private export with optional LF', (t) => {
  const { file } = fixture(t);
  assert.equal(readCredential(file), token);
  fs.writeFileSync(file, token);
  assert.equal(readCredential(file), token);
});
test('credential reader refuses aliases, unsafe metadata and bounded malformed content', (t) => {
  const { root, file } = fixture(t);
  const refuse = (candidate = file) =>
    assert.throws(
      () => readCredential(candidate),
      /^Error: Credential unavailable$/,
    );
  refuse('relative.token');
  refuse(`${root}/../${path.basename(root)}/client.token`);
  const link = path.join(root, 'link');
  fs.symlinkSync(file, link);
  refuse(link);
  const hard = path.join(root, 'hard');
  fs.linkSync(file, hard);
  refuse();
  fs.unlinkSync(hard);
  fs.chmodSync(file, 0o644);
  refuse();
  fs.chmodSync(file, 0o600);
  fs.chmodSync(root, 0o755);
  refuse();
  fs.chmodSync(root, 0o700);
  for (const contents of [
    '',
    `${token}\n\n`,
    `${token}\r\n`,
    'x'.repeat(1024 * 1024),
    `${token.slice(0, -1)}!`,
  ]) {
    fs.writeFileSync(file, contents);
    refuse();
  }
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  refuse();
});
test('credential FIFO refuses promptly without waiting for a writer', (t) => {
  const { file } = fixture(t);
  fs.unlinkSync(file);
  assert.equal(spawnSync('/usr/bin/mkfifo', [file]).status, 0);
  assert.throws(() => readCredential(file), /Credential unavailable/);
});
test('credential reader detects file replacement between lstat and open', (t) => {
  const { file } = fixture(t);
  const original = fs.openSync;
  fs.openSync = function (...args) {
    if (args[0] === file) {
      fs.renameSync(file, `${file}.old`);
      fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => readCredential(file), /Credential unavailable/);
  } finally {
    fs.openSync = original;
  }
});
test('credential reader detects same-inode content changes before open', (t) => {
  const { file } = fixture(t);
  const original = fs.openSync;
  let changing = false;
  fs.openSync = function (...args) {
    if (args[0] === file && !changing) {
      changing = true;
      fs.writeFileSync(file, `cr_mcp_${'c'.repeat(22)}.${'d'.repeat(43)}\n`);
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => readCredential(file), /Credential unavailable/);
  } finally {
    fs.openSync = original;
  }
});
