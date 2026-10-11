import fs from 'node:fs';
import path from 'node:path';

const fail = () => {
  throw new Error('Credential unavailable');
};
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.uid === b.uid &&
  a.mode === b.mode &&
  a.nlink === b.nlink;
const stable = (a, b) =>
  same(a, b) &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
const regular = (s, uid) =>
  s.isFile() &&
  s.uid === uid &&
  (s.mode & 0o7777) === 0o600 &&
  s.nlink === 1 &&
  s.size >= 73 &&
  s.size <= 74;

/** Read one existing export, without following aliases, blocking on a FIFO or changing it. */
export function readCredential(file) {
  let fd;
  const bytes = Buffer.alloc(75);
  try {
    if (
      typeof file !== 'string' ||
      file.length > 4096 ||
      !path.isAbsolute(file) ||
      path.resolve(file) !== file ||
      /[\u0000-\u001f\u007f]/u.test(file) ||
      typeof process.getuid !== 'function'
    )
      fail();
    const uid = process.getuid(),
      parent = path.dirname(file);
    const names = [path.parse(parent).root];
    for (const part of parent
      .slice(names[0].length)
      .split(path.sep)
      .filter(Boolean))
      names.push(path.join(names.at(-1), part));
    const ancestors = names.map((name) => ({ name, stat: fs.lstatSync(name) }));
    for (let i = 0; i < ancestors.length; i++) {
      const s = ancestors[i].stat;
      if (!s.isDirectory() || (s.uid !== 0 && s.uid !== uid)) fail();
      if (
        (s.mode & 0o022) !== 0 &&
        !(
          s.uid === 0 &&
          (s.mode & 0o1000) !== 0 &&
          ancestors[i + 1]?.stat.uid === uid
        )
      )
        fail();
    }
    const parentStat = ancestors.at(-1).stat;
    if (
      parentStat.uid !== uid ||
      (parentStat.mode & 0o7777) !== 0o700 ||
      fs.realpathSync(parent) !== parent
    )
      fail();
    const before = fs.lstatSync(file);
    if (!regular(before, uid)) fail();
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    const opened = fs.fstatSync(fd);
    if (!regular(opened, uid) || !stable(before, opened)) fail();
    let length = 0;
    while (length < bytes.length) {
      const n = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!n) break;
      length += n;
    }
    const after = fs.fstatSync(fd);
    if (
      length !== opened.size ||
      !same(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      !stable(after, fs.lstatSync(file))
    )
      fail();
    for (const ancestor of ancestors)
      if (!same(ancestor.stat, fs.lstatSync(ancestor.name))) fail();
    if (fs.realpathSync(parent) !== parent) fail();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    if (!/^cr_mcp_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\n?$/.test(text)) fail();
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  } catch {
    fail();
  } finally {
    bytes.fill(0);
    if (fd !== undefined) fs.closeSync(fd);
  }
}
