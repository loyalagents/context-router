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

function nestedFixture(t) {
  const { root, file } = fixture(t);
  const higher = path.join(root, 'higher');
  const middle = path.join(higher, 'middle');
  const parent = path.join(middle, 'private');
  for (const directory of [higher, middle, parent])
    fs.mkdirSync(directory, { mode: 0o700 });
  const nested = path.join(parent, 'client.token');
  fs.renameSync(file, nested);
  return { root, higher, middle, parent, file: nested };
}

test('credential reader refuses a group- or world-writable higher ancestor', (t) => {
  const { higher, parent, file } = nestedFixture(t);
  for (const mode of [0o770, 0o707]) {
    fs.chmodSync(higher, mode);
    assert.equal(fs.statSync(parent).mode & 0o7777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o7777, 0o600);
    assert.throws(
      () => readCredential(file),
      /^Error: Credential unavailable$/,
    );
  }
});

test('credential reader refuses a symlink in higher ancestry', (t) => {
  const { root, higher, file } = nestedFixture(t);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(higher, alias);
  const aliased = path.join(alias, path.relative(higher, file));
  assert.equal(fs.statSync(aliased).ino, fs.statSync(file).ino);
  assert.throws(
    () => readCredential(aliased),
    /^Error: Credential unavailable$/,
  );
  assert.equal(readCredential(file), token);
});

test('credential reader pins the root-owned sticky ancestor exception', (t) => {
  if (process.getuid() === 0) {
    t.skip(
      'Immediate root-owned child differs from requester only for a non-root user',
    );
    return;
  }
  const { higher, middle, file } = nestedFixture(t);
  const original = fs.lstatSync;
  // Synthetic ownership metadata exercises boundaries without chown/root access.
  // Top-level tests run serially; restore the shared fs method in every case.
  for (const { owner, mode, childOwner, accepted } of [
    { owner: 0, mode: 0o1777, childOwner: process.getuid(), accepted: true },
    { owner: 0, mode: 0o777, childOwner: process.getuid(), accepted: false },
    {
      owner: process.getuid(),
      mode: 0o1777,
      childOwner: process.getuid(),
      accepted: false,
    },
    { owner: 0, mode: 0o1777, childOwner: 0, accepted: false },
  ]) {
    fs.lstatSync = function (candidate, ...args) {
      const stat = original.call(this, candidate, ...args);
      if (candidate !== higher && candidate !== middle) return stat;
      return Object.assign(
        Object.create(Object.getPrototypeOf(stat)),
        stat,
        candidate === higher
          ? { uid: owner, mode: (stat.mode & ~0o7777) | mode }
          : { uid: childOwner },
      );
    };
    try {
      if (accepted) assert.equal(readCredential(file), token);
      else
        assert.throws(
          () => readCredential(file),
          /^Error: Credential unavailable$/,
        );
    } finally {
      fs.lstatSync = original;
    }
  }
});

test('credential reader detects mid-read higher-ancestor replacement with the same credential inode', (t) => {
  const { root, higher, middle, parent, file } = nestedFixture(t);
  const parking = path.join(root, 'parking');
  fs.mkdirSync(parking, { mode: 0o700 });
  const before = {
    root: fs.statSync(root),
    higher: fs.statSync(higher),
    parent: fs.statSync(parent),
    file: fs.statSync(file),
  };
  const original = fs.readSync;
  let swapped = false;
  fs.readSync = function (...args) {
    const count = original.apply(this, args);
    if (!swapped) {
      swapped = true;
      const old = path.join(parking, 'old');
      fs.renameSync(higher, old);
      fs.mkdirSync(higher, { mode: 0o700 });
      fs.renameSync(path.join(old, 'middle'), middle);
    }
    return count;
  };
  try {
    assert.throws(
      () => readCredential(file),
      /^Error: Credential unavailable$/,
    );
  } finally {
    fs.readSync = original;
  }
  assert.equal(swapped, true);
  assert.notEqual(fs.statSync(higher).ino, before.higher.ino);
  assert.equal(fs.statSync(root).nlink, before.root.nlink);
  assert.equal(fs.statSync(parent).ino, before.parent.ino);
  const after = fs.statSync(file);
  for (const field of [
    'dev',
    'ino',
    'size',
    'mode',
    'nlink',
    'mtimeMs',
    'ctimeMs',
  ])
    assert.equal(after[field], before.file[field], field);
  assert.equal(fs.readFileSync(file, 'utf8'), `${token}\n`);
});
